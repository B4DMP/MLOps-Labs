# Rate limiting on auth endpoints

Split out of `session-persistence-and-url-routing.md` — self-contained, doesn't depend on the
cookie/CSRF work there, deliberately deferred to its own pass.

## Problem

No rate limiting exists anywhere in `game-api` today (confirmed by search: no `cooldown`,
`rate_limit`, `TTLCache`, `slowapi`, etc.). `login` has no throttling on repeated attempts.
`auth_service.py`'s verification/forgot-password code-send paths
(`_send_code_email` callers at `auth_service.py:112-128,230-247,306-314`) send unconditionally on
every request with no cooldown at all — a script can spam a player's inbox at will. The
session-persistence plan additionally makes `change-password` reachable while already logged in
(not just via the forgot-password flow), which is a natural brute-force target once it's a
routine, always-available action rather than a rare recovery path.

## Scope

- A basic in-memory sliding-window limiter, no new infrastructure.
- Applied to: `login`, `change-password`, and the three code-send call sites above.
- Explicitly not: a distributed/shared limiter (Redis-backed or similar) — not needed for the
  current single-container deployment (`docker-compose.yml` runs one `api` service), and adding
  one now would be solving a scaling problem this app doesn't have yet.

## Decision

In-memory sliding window: a small module, a dict of `{key: [timestamps]}` guarded by an
`asyncio.Lock`, no new dependency required (`cachetools.TTLCache` is a nice-to-have convenience,
not a requirement). Keyed by `username` where one is already supplied (change-password, code
resends), falling back to client IP where there isn't one yet (login itself, before success).
Cap: 5 attempts / 15 minutes per key, `429` + `Retry-After` header on the 6th.

**Known limitation, not a blocker**: state resets on container restart/redeploy, and would not be
shared if `game-api` is ever scaled to multiple replicas. Fine for the current single-container
deployment; worth a line in `INSTALL_AND_USAGE.md` so a future move to multiple replicas doesn't
quietly lose the limiting along with everything else that assumes single-process state. If that
ever changes, the fix is a Redis-backed limiter (new `docker-compose.yml` service, a new
dependency, connection management) — meaningfully bigger, not attempted here.

**Cost estimate**: on the order of half a day including tests — one small module, three or four
call sites wiring it in.

## Backend

New `game-api/src/mlops_serious_game/application/services/rate_limit.py`:

- `check_rate_limit(key: str, *, max_attempts: int = 5, window_seconds: int = 900) -> None`:
  raises (or returns a `retry_after` seconds value, whichever fits the calling convention better —
  decide at implementation time) when the key has hit the cap within the window; otherwise records
  the attempt and allows it.
- A background sweep (or simply pruning expired timestamps from the list on each check) keeps the
  dict from growing unbounded — no separate cleanup task needed if pruning happens inline.

Wire into:
- `login` (keyed by the submitted username, or IP if that's cleaner given `login` currently
  receives username+password together — decide based on what's already available at the call
  site).
- `change-password` (keyed by the authenticated username — this endpoint only exists once a
  session-persistence-plan cookie is valid, so a username is always available).
- The three `_send_code_email` call sites in `auth_service.py` (keyed by username, since a code
  send always has one).

On rejection: `429` with a `Retry-After` header giving the caller a concrete wait time rather than
just "try again later."

## Tests

`game-api/tests/test_rate_limit.py`:
- Sixth attempt within the window is `429` with `Retry-After`.
- The window resets after it elapses (test with a small window or by monkeypatching time).
- A different username/IP is unaffected by another key's attempts.
- Wired into `login`: 6 failed logins for one username within 15 minutes get rate-limited; a 7th
  for a *different* username still succeeds.
- Wired into `change-password` and the code-send paths similarly.

Run via `docker compose exec api python -m pytest tests/ -q`.

## Order of work

1. `rate_limit.py` + its own unit tests (standalone, no call sites yet).
2. Wire into `login`.
3. Wire into `change-password` (depends on that endpoint existing — from
   `session-persistence-and-url-routing.md`'s Profile management work landing first).
4. Wire into the three code-send call sites.
5. `INSTALL_AND_USAGE.md` note about the single-process limitation.

## Open questions

- Should the cap (5/15min) differ per endpoint — e.g. tighter on `change-password` than on code
  resends, since a resend is player-initiated and self-limiting by nature (you stop clicking once
  you have the code) while a password attempt is exactly what a brute-force script would hammer?
- Is IP-based fallback for pre-auth `login` attempts good enough, given shared lab-machine NAT
  could mean many legitimate students share one IP? Might need combining username+IP rather than
  either alone.
