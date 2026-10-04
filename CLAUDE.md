# Working in this repo

## Never install into the host/global Python or Node environment

This project runs entirely in Docker (`docker-compose.yml`: `postgres`, `api` / container
`game-api`, `ui` / container `game-ui`). The host machine's global `python`/`pip` is **not**
this project's environment — it belongs to the user's other, unrelated work.

- **Never** run `pip install`, `npm install -g`, or similar against the host/global interpreter
  to satisfy this project's dependencies, "just to get a test to import" or for any other reason.
- To run the backend test suite, use the running container:
  `docker compose exec api python -m pytest tests/ -q`.
  `python -m pytest` (not the bare `pytest` entry point) is what puts `/app` on `sys.path`;
  without it `conftest.py` fails to import `mlops_serious_game` before any test runs.
  Don't add `-w /app`: the image already sets `WORKDIR /app`, and on Windows under Git Bash
  MSYS rewrites the `/app` argument into a Windows path, so Docker rejects it with
  `Cwd must be an absolute path`.
  If the container isn't running, `docker compose up -d` first (see `INSTALL_AND_USAGE.md`).
- To run the frontend test suite: `docker compose exec ui npm test`.
- If a container image is missing a dependency the code now needs, add it to
  `game-api/pyproject.toml` (or `game-ui/package.json`) and rebuild the image
  (`docker compose build api`) - don't patch around it by installing on the host.
- If Docker itself is unavailable and there is no other way to verify, say so explicitly rather
  than reaching for the host environment - don't silently substitute it.
- This applies to every language/toolchain in this repo (Python, Node), not just the backend.

## Know the gameplay flow before changing a screen

Read `docs/gameplay-flow.md` first: which screen the player sees when, what advances it, and where
each concept (power/interest, intel, pitch, veto, simulation) is first introduced. Put new help
or explanations on the screen where the player first meets the thing, and reuse the existing
component instead of building a duplicate. Update that document when the flow changes.

## Keep comments short

Default to 1-2 lines. Only go to 3-4 when the reasoning genuinely isn't obvious from the code
(a non-obvious constraint, a workaround for a specific bug, a subtle invariant). Never write a
comment block longer than the diff it explains.
