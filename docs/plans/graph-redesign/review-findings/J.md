# Batch J — Infra/misc — review findings

**Update (2026-09-12), user asked to implement the CI gate**: added `test-game-api` (plain
`python:3.11-slim`, `uv pip install` + `PYTHONPATH=tools pytest tests -q`, `needs: []` since the
suite is pure) and `test-game-ui` (`node:20-slim`, `tsc -b --force` + `npm test` as hard gates,
`eslint . || true` non-blocking given the ~292 pre-existing lint errors documented in
`docs/plans/graph-redesign/10-code-review.md` - flip that once the debt is cleared) to
`.gitlab-ci.yml`'s test stage, both wired into `push-game-images`'s `needs:` alongside
`validate-game-content`. Verified: valid YAML, `needs:` DAG confirmed via `yaml.safe_load`. Not
run against real GitLab CI (no access to trigger a pipeline from here) - the commands mirror
exactly what was verified locally in this session (`docker compose exec api python -m pytest`,
`docker compose exec ui npx tsc`/`npm test`).

Scope: `.gitlab-ci.yml`, `game-api/Dockerfile`, `game-api/Makefile`, `docker-compose.yml`,
`docs/adr/0001-replayable-alembic-migrations.md` + `docs/adr/README.md` (read-only, for
consistency). Reviewed against `main...graph-redesign` diff for these files plus the whole file
where the criteria call for it (Dockerfile/Makefile predate the branch in part).

## Fixed

- `.gitlab-ci.yml:89-94` (`push-game-images` job `needs:`) — the `validate-game-content` test-stage
  job was added on this branch but never wired into the deploy job's `needs:` list. In GitLab CI,
  once a job declares `needs:`, it stops waiting on "the whole previous stage" and only waits on the
  jobs explicitly listed — so `push-game-images` (needs only `build-game-api`/`build-game-ui`) could
  start and push images to the registry, and `deploy-game-to-k8s` roll them out, in parallel with or
  even before `validate-game-content` finishes. A failing content validation would not block a
  deploy; the new safety gate was decorative. **Fixed**: added `- job: validate-game-content` to
  `push-game-images`'s `needs:` (test stage precedes deploy stage, so this is a valid DAG edge).
  Verified the file is still valid YAML (`yaml.safe_load`).

- `game-api/Makefile:26-52` (`generate-items`, `generate-artifacts`, `generate-objections`,
  `assemble-content`, `assemble-content-dry`, `validate-content`, `validate-content-tier0`) — all
  seven targets added on this branch run `uv run python -m content_gen ...` with no `PYTHONPATH`.
  `content_gen` lives at `game-api/tools/content_gen`, and `packages = ["src/mlops_serious_game"]`
  in `pyproject.toml` is the only installed package — `tools/` is never on `sys.path`. Confirmed
  live in the running `api` container: `python -m content_gen --help` from `/app` fails with
  `No module named content_gen`; the same command with `PYTHONPATH=tools` (relative form) /
  `PYTHONPATH=/app/tools` (absolute, matching the Dockerfile `CMD` and the `.gitlab-ci.yml`
  `validate-game-content` job) succeeds and even prints its own usage hint ("run from
  game-api/tools; inside the container: cd /app/tools"). Every one of these seven `make` targets
  would have failed on first use. **Fixed**: prefixed each recipe line with `PYTHONPATH=tools`,
  matching the pattern already used by the Dockerfile `CMD` and the CI job. Re-verified the
  underlying command (`PYTHONPATH=tools python -m content_gen --help`) now succeeds inside the
  running `api` container.

## Confirmed gap (logged per instructions, not fixed — CI change deferred to recommendation below)

- `.gitlab-ci.yml` (whole file) — **the pipeline still never runs the backend pytest suite.**
  Confirmed: stages are `build` (docker builds for `game-api`/`game-ui`), `test`
  (`validate-game-content` only — `content_gen --scope tier0 validate`), `deploy` (push images,
  `kubectl apply`/`rollout`). No job installs `game-api`'s dependencies and runs `pytest`, and none
  runs the frontend's `npm test`/`npm run lint`/`tsc -b` either (per `STATE.md`'s baseline notes,
  those didn't exist before this review pass added them as prerequisite tooling). 193 backend tests
  and the new frontend Vitest suite currently only run when a human (or a review-batch agent)
  remembers to run them by hand; a regression that breaks `pytest tests -q` can reach `main` and
  ship to k8s without CI ever noticing. This is a real, pre-existing gap, not introduced by this
  branch — it predates `graph-redesign` (the `validate-game-content` job that *was* added on this
  branch checks content, not code).
  **Not fixed** per this batch's instructions (CI changes affect shared infra; propose, don't land,
  unless confident it's safe). Recommended finding, logged to `STATE.md`'s Findings backlog by the
  orchestrator: add a `test` stage job that installs `game-api`'s deps (`uv pip install --system -r
  pyproject.toml` against `python:3.11-slim`, no docker-in-docker needed since the suite is pure —
  no DB, no fixtures, confirmed by this review's own instructions) and runs
  `PYTHONPATH=tools python -m pytest tests -q`; give it `needs: []` so it runs independently of the
  image builds, and add it to `push-game-images`'s `needs:` alongside `validate-game-content`. A
  matching frontend job (`npm ci && npm run lint && npx tsc -b --force && npm test`) is a separate,
  smaller addition. Left for a human to land since it changes what gates every future deploy.

## Deferred (pre-existing, out of scope for this diff — needs a separate decision)

**Disposition (2026-09-12): tracked, not fixed here.** Written up as its own follow-up plan at
`docs/plans/dockerfile-production-hardening.md` with two concrete options (add a `Dockerfile.prod`
mirroring `game-ui`, or explicitly accept the current traffic/ops model) — deliberately not decided
or implemented as part of this review, since it's a repo-wide production-readiness call, not a
graph-redesign-diff fix.

- `game-api/Dockerfile:26` — `CMD ["fastapi", "dev", ...]`. `fastapi dev` is the development
  server (auto-reload, not meant for production traffic). This same `Dockerfile` is used both by
  `docker-compose.yml` for local dev *and* by the CI `build-game-api` job that produces the image
  `push-game-images` ships to the k8s deployment — unlike `game-ui`, which has a separate
  `Dockerfile` (dev) and `Dockerfile.prod` (build-arg'd production build via `build-game-ui`),
  `game-api` has only one `Dockerfile` and no prod variant. Confirmed unchanged by this branch
  (identical on `main`) and not referenced by any D-numbered decision in `STATE.md` — this is an
  existing production-readiness gap (single-process dev server serving real traffic), not something
  this branch introduced or that this batch's scope (CI/Docker/Makefile/ADRs *for the
  graph-redesign diff*) should silently rewrite. Flagging for a separate decision: either add a
  `game-api/Dockerfile.prod` using `fastapi run` (or `uvicorn` with workers), mirroring the
  `game-ui` pattern, or explicitly decide the current traffic/ops model doesn't need it yet.

## Verified consistent (no issue)

- `docs/adr/0001-replayable-alembic-migrations.md` vs `game-api/Dockerfile` — the ADR says "The
  Dockerfile copies `alembic.ini` and `alembic/` into the image, so migrating does not depend on
  the compose volume mounts." The Dockerfile diff on this branch adds exactly
  `COPY alembic.ini ./` and `COPY alembic alembic/` with a comment matching the ADR's reasoning
  ("Needed at startup: the API applies pending revisions itself"). Consistent.
- `docs/adr/0001-...md` vs `src/mlops_serious_game/infrastructure/database/migrations.py` and
  `config.py` — `AUTO_MIGRATE` opt-out flag referenced by the ADR exists in both (read-only check,
  file not in this batch's scope to edit).
- `docker-compose.yml` — the added `./game-api/tests:/app/tests` mount matches commit `baa9ddd`
  ("Tests run from the working tree, not from the image") and the fact the Dockerfile deliberately
  does *not* `COPY` a `tests/` directory into the built image (tests are dev-time only, run against
  the bind mount, never baked into the production image — consistent with there being no CI pytest
  job that runs against the image itself; a future pytest CI job per the recommendation above should
  run against checked-out source, not `docker run $GAME_API_IMAGE`, since `tests/` isn't in the
  image).
- `game-api/Makefile`'s `validate-content` (full scope) vs `validate-content-tier0` (`--scope
  tier0`) — intentional pair matching D36 (tier0 frozen as the golden path; full-scope validation
  available separately), not redundant.
- `.gitlab-ci.yml`'s inlined `PYTHONPATH=/app/tools python -m content_gen --scope tier0 validate`
  in the `validate-game-content` job (rather than reusing the Makefile's `validate-content-tier0`
  target) — not a bug: the CI job runs inside the already-built image via `docker run`, where `uv`
  is not necessarily the intended invocation path, so inlining the equivalent command directly
  against the image's installed `python` is the correct approach for that context, not accidental
  duplication.
- `tools/content_gen/work/` size (774K total, 704K in `out/`) copied into the image via `COPY tools
  tools/` — negligible, not an efficiency concern worth a `.dockerignore` entry.

## Summary

2 real bugs found and fixed (both introduced by this branch): the new content-validation CI gate
wasn't actually wired to block deploys, and all seven new Makefile content-gen targets were broken
by a missing `PYTHONPATH`. 1 gap confirmed per explicit instruction (no backend pytest / no frontend
test-lint-typecheck job in CI at all) and logged as a recommended CI change rather than landed
directly. 1 pre-existing, out-of-scope production-readiness item deferred for a separate decision
(`fastapi dev` as the shipped CMD). Everything else in scope checked out consistent with the ADR and
the D-numbered decisions.
