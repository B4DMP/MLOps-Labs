# Dockerfile production hardening

Follow-up from the graph-redesign code review (batch J, `docs/plans/graph-redesign/review-findings/J.md`).

## The gap

`game-api/Dockerfile`'s `CMD` runs `fastapi dev ...` — the development server (auto-reload, not
meant to serve real traffic). This is the same image `.gitlab-ci.yml`'s `build-game-api` job
builds and `push-game-images`/`deploy-game-to-k8s` ship to the k8s deployment. Unlike `game-ui`,
which has a separate `Dockerfile` (dev) and `Dockerfile.prod` (production build via
`build-game-ui`), `game-api` has only one `Dockerfile` and no prod variant.

Confirmed pre-existing: identical on `main`, not introduced by `graph-redesign`, not referenced by
any `D`-numbered decision in `STATE.md`.

## Options

1. Add `game-api/Dockerfile.prod` running `fastapi run` (or `uvicorn`/`gunicorn` with workers),
   mirroring the `game-ui` dev/prod split. `.gitlab-ci.yml`'s `build-game-api` job switches to it.
2. Decide the current traffic/ops model genuinely doesn't need a production server yet (e.g. low
   traffic, internal tool) and explicitly document that as the accepted risk instead.

## Status

Deferred, not fixed as part of the graph-redesign review — this is a repo-wide production-readiness
question independent of that branch's diff, not something to silently change inside a code review
pass. Needs a decision on which option above (or a variant) before implementation.
