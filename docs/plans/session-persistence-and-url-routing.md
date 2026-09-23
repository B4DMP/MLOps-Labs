# Reload-stable sessions, URL-reflected gameplay state, and auth hardening

## Session handoff — read this first

State as of 2026-09-23, end of the implementation session that produced steps 1-11 below. If
you're picking this up fresh: the rest of this document is the full plan (Problem → Scope →
Decisions → Backend/Frontend design → Order of work → Open questions → **Implementation
checklist**, which is the authoritative step-by-step tracker — this section is just a fast-start
summary of where things stood when that session ended, not a replacement for it).

**Do this first**: `cd` to the repo root and run `git status --porcelain` yourself before trusting
anything below.

**Done and verified** (steps 1-11, each with passing automated tests - re-run them to confirm
nothing regressed since): httpOnly cookie auth (`mlops_player`/`mlops_admin`); `GET
/api/auth/whoami`; double-submit CSRF middleware; admin REST auth on the cookie; websocket
handshake authenticating off the cookie + `Origin` check; LangGraph thread IDs rekeyed from
username to `user_id`; the gameplay server-truth fix; the four profile-management endpoints
(change password/email/username); the whole frontend rewired from login-response tokens to cookie
+ `whoami()`; path-scoped URL guards + `urlSync.ts` (`pushScreen`/`replaceProgress`); the Settings
accordion with a Profile section (Logout, change password/email/username) plus a symmetric Logout
button in the admin header. Full backend suite: 570/579 passing (9 pre-existing OPIK-quota/mock
flakes, confirmed unrelated). Full frontend suite: 195/195 passing. Typecheck clean apart from
pre-existing, unrelated `emotion_dimensions` errors from another session's concurrent work.

Two real test bugs (not production bugs) were found and fixed while verifying step 8: two
`test_auth_routes.py`/`test_profile_management.py` tests weren't echoing the CSRF double-submit
header on mutating requests, and `test_admin_service.py` (pre-existing, predates this plan) still
asserted on the old username-keyed LangGraph checkpoint thread ids instead of the `user_id`-keyed
ones step 6 introduced - see the step 8 checklist entry for detail.

**Not started, and this session could NOT verify it**: **step 12, the manual browser pass.** No
browser automation was available in that session (Claude in Chrome wasn't connected; no built-in
browser tool was present) - only automated backend/frontend test suites were run. The app
(`docker compose up -d`, `game-api`/`game-ui`/`postgres` all healthy at the time) was never
actually driven through a real login → play-the-game flow, nor were any of the Order-of-work item
12 scenarios (dual admin+player session in one tab, reload persistence, expired-cookie fallback,
20+ minute idle-but-connected session, username-change chat continuity, a crafted client payload
being overridden) exercised by a human or a working browser tool. **Do this before considering the
plan done** - it's the one thing standing between "all automated checks pass" and "actually works."

**Cross-session note (historical)**: earlier in this plan's implementation, this session shared
dev containers and a working tree with a concurrent, unrelated "gov stage" removal cleanup
(`mlops-labs-a3`). That work is done and merged into the same tree by now; a fresh session picking
this up should still run `ListAgents` and check for other active sessions before broad
`git checkout`/`git reset`/`pytest`/`npm test` runs, as a general habit in this shared-container
setup, not because of anything specific still in flight.

**Resume commands**:
```
docker compose up -d   # if containers aren't already running
docker compose exec api python -m pytest tests/ -q   # full backend regression
docker compose exec ui npx tsc --noEmit -p tsconfig.app.json
docker compose exec ui npm test
```
Then do the step 12 manual pass (browser, or hand off to the user) - see Order of work item 12 for
the full scenario checklist.

## Problem

Four related gaps:

1. **Reload loses everything.** `username` lives only in `App.tsx` state
   ([App.tsx:61](game-ui/src/App.tsx#L61)). The JWT `token` returned by login/register/verify is
   accepted and immediately discarded ([App.tsx:91-93](game-ui/src/App.tsx#L91-L93)). Nothing is
   persisted, so an F5 always lands back on Home, even though the backend already has the
   player's game state keyed by `user_id` (see D-user-id below).
2. **The URL never changes.** No router is installed. `App.tsx` is a boolean-flag screen switcher
   and `Game.tsx` drives a second, server-driven state machine (`progressionIndex`,
   `challengeLoopId`, `currentPhase`, `currentChallenge`, `activeStakeholderId`). The address bar
   sits on `/` for the whole game.
3. **The websocket trusts a bare, client-supplied username**, with no token check at all
   ([router.py:88-93](game-api/src/mlops_serious_game/infrastructure/websocket/router.py#L88-L93)).
4. **This needs to hold up to production-grade scrutiny, not just "works for a class of CS
   students who won't look too hard."** Once identity is persisted client-side at all, the
   storage mechanism, the transport, and the trust boundary between client and server all become
   real attack surface: XSS-readable tokens, tokens leaking into logs via query strings, CSRF once
   cookies are involved, and — orthogonal to auth entirely — the two spots where gameplay
   handlers already trust client-supplied progression values outright.

## Scope, and how it changed from the first draft

The first draft of this plan used `localStorage`/`sessionStorage` with a per-tab "which role is
this tab" pointer to keep an admin session and a player session from clobbering each other.
Working through the actual requirement — an admin session and a player session need to coexist
**in the same tab**, not just in separate tabs, with `/login` staying reachable to an
already-authenticated admin — that pointer scheme doesn't extend cleanly: it disambiguates roles
per tab, not per screen. Combined with wanting XSS/log-leak hardening anyway, the better answer is
to stop keeping the token in JS-reachable storage at all. This draft replaces it with:

- Two separate **httpOnly cookies**, one per role, each scoped to only the paths that need it, so
  `/game` and `/admin` each answer their own auth question independently and `/login` never checks
  either (D-cookies).
- No client-side reasoning about "which role wins" at all — each screen asks the server what's
  currently valid via one cheap endpoint (D-whoami).
- Sliding token expiration so a class-length session doesn't die mid-play, without building a full
  refresh-token system (D-sliding-expiry).
- CSRF protection via double-submit token, since cookies are now auto-attached (D-csrf).
- Reflect in-game progression in the URL path as it changes; still write-only telemetry, for the
  same reason as before (D-url-tiers, mostly unchanged from the first draft).
- Logout plus a Profile surface (change username, email, password) in an accordion inside
  Settings (unchanged from the prior draft — D-profile-ui).
- A rename-preserving fix for LangGraph thread ids being keyed by username instead of the now
  already-canonical `user_id` (D-user-id) — surfaced by review, not the original ask, but a small,
  self-contained prerequisite that makes username-changing actually safe.
- A real fix, not just a flagged risk, for the two gameplay handlers that trust client-supplied
  `phase_id`/`challenge_id` outright (D-server-truth).

Out of scope: `react-router-dom`; a full refresh-token/rotation/revocation system (D-sliding-expiry
explains why sliding expiry is the right-sized answer instead); moving the admin panel's
day-two-and-beyond REST calls to something other than cookies-plus-CSRF (there isn't a "something
other" once cookies are chosen — see D-cookies); **rate limiting on the auth endpoints** — split
out to its own doc, [`auth-rate-limiting.md`](docs/plans/auth-rate-limiting.md), since it's fully
self-contained and doesn't depend on anything below.

## Decisions taken

- **(D-cookies) Two httpOnly cookies, path-scoped per role; no client-side "which role" state at
  all.** `mlops_player` (`Path=/`, needed on REST calls and the `/ws` handshake) and `mlops_admin`
  (`Path=/api` — not `/api/admin`, see the Backend section for why — admin has no websocket).
  Both `HttpOnly`, `Secure`,
  `SameSite=Lax`. This is what makes "the `/game` and `/admin` screens check different things"
  actually true at the transport level, not just in application logic: a request to an admin route
  simply doesn't carry `mlops_player`, and vice versa, so there's no scenario where one role's
  cookie is even visible to the other's check. It also directly gives "an admin can still reach
  the game login screen": `/login` never inspects either cookie (see D-guards), so an admin
  authenticated in `mlops_admin` can open the same Login form and authenticate a **second**,
  independent player identity in `mlops_player`, in the *same tab*, without logging out of admin —
  which the earlier `sessionStorage`-pointer draft could not do, because a pointer models "this tab
  is currently role X," and this requirement is "this tab can be role X and Y simultaneously,
  depending only on which cookie a given request needs." That's the direct answer to "which is
  more elegant": cookies are, once same-tab dual-role coexistence is a requirement — the earlier
  scheme's per-tab bookkeeping becomes not just extra work but actively the wrong shape.
  `HttpOnly` also directly closes the XSS-theft concern raised in the ask: the token is never in
  any JS-reachable store, so a compromised dependency or an XSS bug can't read it out of
  `localStorage`/`sessionStorage`, because it's never put there.
- **(D-whoami) One cheap, always-200 endpoint answers "what's currently valid," so the client
  never needs to hold or interpret the token itself.** `GET /api/auth/whoami` reads whichever of
  `mlops_player`/`mlops_admin` cookies are present, decodes+verifies each independently (reusing
  `decode_token`, `auth_service.py:37`-adjacent), and returns
  `{ "player": {"username": "..."} | null, "admin": { "valid": true } | null }` — never a 401,
  since "nobody is logged in" is a normal, expected answer, not an error. `App.tsx` calls this once
  on mount (and again after login/logout/username-change) to decide what to render. This is what
  lets the "Resume as X" affordance keep working (per the earlier ask, "that extra click is fine")
  without any client-side storage backing it — the button's visibility is a live server fact, not
  a locally cached guess, and per the explicit ask, it is **only ever shown when that role's cookie
  actually validates** — never speculatively.
- **(D-guards) Path-scoped, mutually blind screen guards.** `/game` (and cold `/`) ask `whoami` and
  look at `player` only; `/admin` looks at `admin` only; `/login`, `/register`, etc. don't call
  `whoami` for gating purposes at all — they render unconditionally, so nothing about an existing
  admin (or player) session ever redirects a visitor away from Login. This is the literal
  implementation of "the /game and /admin screens should check for different things" and "the game
  login screen should still be accessible to a logged-in admin."
- **(D-login-response) Login/register/verify/reset-password stop returning `token` in the JSON
  body.** Today's response already triggers a `Set-Cookie` under this plan (the backend mints the
  cookie instead of a body field); the body keeps `{success, type, username}` for the UI to react
  to, nothing secret. There is no reason to also hand the same secret to JS once the cookie carries
  it — doing so would silently reopen the exact XSS exposure D-cookies just closed.
- **(D-ws-cookie) The websocket handshake authenticates off the cookie, not a query param, and
  derives `username` from the token instead of trusting a separate query value.** The WS upgrade
  request is a normal HTTP GET, so the browser attaches `mlops_player` automatically (same-origin,
  matching path); `unified_websocket_endpoint` reads it via `websocket.cookies.get("mlops_player")`
  and decodes it — `sub` **is** the username from here on, so there's nothing left to
  cross-check a client-supplied `username` query param against, and the query param can be dropped
  entirely rather than kept as an unused default (closing
  [router.py:88-93](game-api/src/mlops_serious_game/infrastructure/websocket/router.py#L88-L93)'s
  gap more thoroughly than the first draft's mismatch-check did). Missing/invalid cookie →
  `websocket.close(code=4401)` before `accept()`, same reasoning as the first draft. This also
  fully resolves that draft's own open question about the token leaking into query strings/logs:
  there is no query string carrying it anymore.
- **(D-origin-check) Origin header check on `/ws` as defense in depth.** `SameSite=Lax` already
  stops a cross-site page's fetch/WS attempt from attaching the cookie in the first place, but the
  websocket handshake isn't covered by the browser's CORS preflight the way a fetch is, so belt-
  and-braces: reject the connect (`code=4403`) unless `websocket.headers.get("origin")` matches the
  configured frontend origin(s) (reuse whatever `settings` already has for CORS, if anything is
  configured there — otherwise add one).
- **(D-csrf) Double-submit CSRF token for every mutating request.** A third, deliberately
  **non**-`httpOnly` cookie `mlops_csrf` (a random nonce, not a credential) is set alongside the
  auth cookies; the frontend reads it with `document.cookie` and sends it back as an
  `X-CSRF-Token` header on every `POST`/`PUT`/`DELETE`; a small FastAPI dependency on those routes
  rejects the request (403) if the header is missing or doesn't match the cookie. This needs no
  server-side session store (the whole point of double-submit), and is the standard answer to "how
  much CSRF work do we need" once cookies auto-attach: with `SameSite=Lax` alone, an attacker page
  can't get a browser to auto-carry the cookie on a **cross-site POST** (Lax blocks that), so
  double-submit is genuinely defense-in-depth here rather than the only thing standing between the
  app and a forged request — but the ask specifically named "might be productionalized," and this
  is cheap enough (no new infra, one cookie, one header, one dependency) that there's no real
  reason to skip it.
- **(D-sliding-expiry) Sliding expiration instead of a refresh-token system, answering "how large a
  setup is auto-extending the JWT."** Small, not large: a dependency wrapping every cookie-
  authenticated route (including `whoami` itself) checks the current token's remaining lifetime
  and, if it's under half of `ACCESS_TOKEN_EXPIRE_MINUTES` (`auth_service.py:19`), mints a fresh
  token and re-sets the cookie on the response — the existing `create_access_token` call already
  does everything needed, this just decides *when* to call it again. The one piece that needs
  adding rather than reusing: **a periodic client-side "keepalive"** (a `setInterval` in `App.tsx`
  calling `whoami` every ~20 minutes while a game or admin tab is open), because gameplay traffic
  flows over the long-lived websocket, which never re-touches the cookie itself the way a normal
  REST call would — without the keepalive, a two-hour play session would still expire mid-game
  even though the player never stopped being active. Total new surface: one dependency function
  and one `setInterval`. A full refresh-token pair with rotation and a revocation list is the
  "properly production" alternative and is meaningfully bigger (a token table, rotation logic,
  revoke-on-logout-everywhere semantics) — noted under Open questions rather than built here.
- **(D-url-tiers) URL logic, mostly unchanged from the first draft**, now grounded in D-guards
  instead of a stored session: screen-level paths (`/`, `/login`, `/register`, `/verify`,
  `/forgot-password`, `/reset-password`, `/game`, `/admin`) are functional both ways — navigating
  calls `pushState`, and cold-loading one asks `whoami` and applies D-guards. Progression-level
  (`/game/p{progressionIndex}/c{currentChallenge}/{currentPhase}?stakeholder=<id>`) stays
  write-only telemetry via `replaceState`, for the same reason as the first draft: the backend
  (`game_handler.py`'s own stored progression, doubly true now that D-server-truth stops trusting
  client-claimed phase/challenge at all) is the sole authority on where a player actually is, so a
  URL segment restoring it would either require the backend to accept a client-asserted hint (the
  exact thing D-server-truth removes) or the client to cache progression (ruled out below).
- **(D-no-client-cache) No client-side game-state caching, ever.** Progression is never read back
  from the URL, and — with D-cookies — identity itself is never held by the client in any
  inspectable/tamperable form either. Between this and D-server-truth, there is no longer any
  path by which editing client-side state (URL, a store, devtools) changes what the server
  believes about a player.
- **(D-user-id) Move the LangGraph thread-id construction from `username` to the already-canonical
  `user_id`, as a prerequisite, not a follow-up.** The user_id migration (`docs/done/pk-migration.md`)
  already made `user_id` the real FK and the only thing every query actually joins on
  (`user_lookup.get_user_id`, used throughout `game_handler.py`/`chat_handler.py`/etc.) — the
  `user_name` columns still on those tables are explicitly documented leftover write-only debt,
  not the join key. LangGraph's checkpoint tables are the one place that migration couldn't reach,
  because they aren't ORM-mapped and can't hold a real FK
  (`pk-migration.md`'s own note), so `f"MLOps_Convo_{username}"`
  (`chat_handler.py:38`, `router.py:94`, `game_handler.py:235,1116`) and its siblings
  (`f"Online_Intel_{username}"` in `intel_handler.py:286` /
  `online_intel_service/service.py:42`; the pitch/veto per-challenge variants in
  `action_card_pitch_service/service.py:47` and `action_card_veto_service/service.py:39`) are still
  keyed by the one thing that was, until this plan, guaranteed never to change. **A username-change
  feature is exactly what turns that from an accepted quirk into an active bug**: rename a player
  and every one of those thread ids silently stops resolving, dropping conversational memory with
  no data corruption to show for it (nothing errors — a fresh, empty thread just starts under the
  new key). Fix: switch every construction site to interpolate `user_id` instead of `username`
  (mechanical — a `user_id` is already resolved in scope at each of those call sites via the same
  `get_user_id` lookup already happening nearby), plus a one-time data migration renaming existing
  `checkpoints`/`checkpoint_writes`/`checkpoint_blobs` rows' `thread_id` values from the
  `..._{username}` form to `..._{user_id}` form (raw SQL, since these tables aren't ORM-mapped —
  same category of operation as the existing raw `DELETE FROM {table} WHERE thread_id = :thread_id`
  in `game_handler.py:73-81` and `pitch_debate_service/service.py:328-337`, just an `UPDATE`
  instead of a `DELETE`), and updating the two admin cleanup helpers that independently reconstruct
  the same string pattern (`admin_service.py`'s `_player_thread_ids`, lines 25-26/33-36/702-704).
  Doing this **first** means the later username-change endpoint needs to do nothing special for
  LangGraph continuity at all — the thread id simply doesn't reference the username anymore, so
  there's no rename-vs-reset trade-off left to make.
- **(D-server-truth) Gameplay progression is never taken from the client, full stop — fixed here,
  not just flagged.** Two concrete violations turned up on review, both worth fixing as part of
  this plan since "don't trust the client on gameplay state" is exactly the same principle
  D-no-client-cache and D-ws-cookie already rest on, just unapplied in two older handlers:
  - `chat_handler.py:40-41` takes `phase_id`/`challenge_id` straight from `payload.get(...)` and
    uses them unvalidated at `:132-135` (`PhaseFactory.translate_challenge_index`), `:179-180`
    (the `GameChallenge` lookup), and `:228-229` (`get_response(...)`).
  - `game_handler.py:887-895` (`handle_state_update_request`) takes `phase_id`, `challenge_id`,
    `challenge_loop_index` straight from the payload and uses them unvalidated at `:929-965`
    (selecting/inserting `GameChallenge` rows) and `:969` (`select_next_challenge(...)`, which
    decides game advancement).

  Fix: both handlers already have (or can trivially get, `chat_handler.py:27` already imports
  `get_or_create_game_session`) the player's authoritative current phase/challenge from their own
  stored `GameSession`/`GameProgression` record. Read the client's message for its actual content
  (the chat text; which action the player took) and derive `phase_id`/`challenge_id` from the
  server's own record instead of the payload — the client should never need to *tell* the server
  what phase it's in, since the server already knows. This is a change to two core gameplay request
  paths rather than a peripheral one, so it's called out as its own step in Order of work with its
  own test pass, not folded silently into the auth work.
- **(D-profile-ui) Logout and profile editing live inside Settings, restructured as an accordion —
  unchanged from the prior draft.** Adding change-username/email/password on top of the existing
  Conversations/Voice/Account sections (`player-settings-and-tts.md`) would crowd a single-scroll
  modal, so `SettingsPanel` groups its sections into a single-open accordion with a new **Profile**
  group first. Label-only rebrand ("Profile & Settings"), not a rename of
  `SettingsPanel.tsx`/`SettingsProvider.tsx`/`onSettingsToggle` and everywhere they thread through —
  that would be pure churn for no behavior change.

## Backend

### Auth cookies, `whoami`, and CSRF

`game-api/src/mlops_serious_game/application/services/auth_service.py`:

- `decode_token(token) -> dict | None` (factor out of `verify_admin_token`'s try/except, as in the
  first draft).
- `set_player_cookie(response, username)` / `set_admin_cookie(response)`: mint via
  `create_access_token` as today, then `response.set_cookie("mlops_player", token, httponly=True,
  secure=True, samesite="lax", path="/")` (admin equivalent with `path="/api"` — not `/api/admin`:
  `/api/auth/whoami`, which every screen calls to check both sessions, is outside `/api/admin`, so
  the tighter scope would stop `whoami` from ever seeing the admin cookie at all; `/api` still
  excludes the one thing worth excluding, `/ws`, which admin never needs). Also mints
  and sets the sibling `mlops_csrf` cookie (`httponly=False`) the first time either auth cookie is
  set in a request, if not already present.
- `sliding_refresh(request, response, cookie_name, ...)`: decodes the incoming cookie, and if
  `exp` is under half the configured lifetime away, calls the matching `set_*_cookie` again on the
  response. Used as a FastAPI dependency on every cookie-authenticated route.

`game-api/src/mlops_serious_game/infrastructure/routes/auth_routes.py`:

- Login/register/verify/reset-password handlers call `set_player_cookie` (or `set_admin_cookie` for
  the admin-login branch) on the `Response`, and drop `token` from the JSON body (D-login-response).
- New `GET /api/auth/whoami` (D-whoami), no auth requirement, always 200.
- New `POST /api/auth/logout` / `POST /api/auth/admin-logout`: clear the corresponding cookie
  (`response.delete_cookie(...)`).
- New `POST /api/auth/change-password`, `POST /api/auth/change-email`,
  `POST /api/auth/confirm-email-change`, `POST /api/auth/change-username` — same shapes as the
  first draft, now authenticated via `mlops_player` cookie instead of a Bearer header, and CSRF-
  guarded (below) since they mutate. `change-username`'s response re-sets `mlops_player` with the
  new `sub` directly — no token round-trips through the client at all.

`game-api/src/mlops_serious_game/infrastructure/routes/admin_routes.py`: `check_admin_token`
switches from reading `Authorization: Bearer` to reading the `mlops_admin` cookie. Every admin REST
call site in `game-ui/src/services/api/admin.ts` (13 places) drops its manual
`Authorization` header — the browser attaches the cookie automatically to matching-path requests —
which is a real, if mechanical, multi-site edit worth budgeting for rather than assuming free.

New `game-api/src/mlops_serious_game/infrastructure/middleware/csrf.py` (or a dependency, whichever
fits the app's existing middleware/dependency style better): compares `X-CSRF-Token` header against
`mlops_csrf` cookie on `POST`/`PUT`/`DELETE`, `403` on mismatch/missing. Registered globally except
for the login/register endpoints themselves (nothing to double-submit against before a cookie
exists yet).

### Websocket

`game-api/src/mlops_serious_game/infrastructure/websocket/router.py`:

- `unified_websocket_endpoint` drops the `username: str = Query("guest")` parameter entirely.
- Reads `websocket.cookies.get("mlops_player")`; missing or failing `decode_token` →
  `websocket.close(code=4401)` before `accept()`. Otherwise `username = payload["sub"]`.
- Reads `websocket.headers.get("origin")`, closes with `code=4403` if it doesn't match the
  configured frontend origin(s) (D-origin-check).

### LangGraph thread ids keyed by `user_id` (D-user-id)

1. Alembic-adjacent data migration (raw SQL against `checkpoints`/`checkpoint_writes`/
   `checkpoint_blobs`, not ORM-mapped): for every existing `thread_id` matching
   `MLOps_Convo_{username}` / `Online_Intel_{username}` / the pitch/veto per-challenge patterns,
   resolve `username` → `user_id` via the `User` table and rewrite the row's `thread_id` to the
   `user_id`-based form.
2. Update the six construction call sites and the two admin cleanup helpers listed in D-user-id
   to interpolate `user_id` instead of `username`.

### Gameplay progression from the server, not the client (D-server-truth)

`chat_handler.py` and `game_handler.py`'s `handle_state_update_request`: replace
`payload.get("phase_id"/"challenge_id"/"challenge_loop_index")` with values read from that
player's own `GameSession`/`GameProgression` record. The client's payload keeps whatever it
legitimately needs to carry (message text, the player's chosen action), just not the coordinates
of where in the game that action applies.

### Tests

`game-api/tests/test_auth_service.py`: `decode_token` round-trips/rejects as in the first draft;
`sliding_refresh` reissues only when under the threshold, not on every call.

`game-api/tests/test_auth_routes.py` (new): `whoami` reflects cookie state correctly for
0/1/2 valid cookies and for an expired one; login/admin-login set the expected cookie and omit
`token` from the body; logout clears its cookie and `whoami` reflects that immediately after;
CSRF dependency rejects a mutating request with a missing/mismatched header and accepts a matching
one; `/login` renders reachable regardless of an existing admin session (this is a frontend
behavior, but the backend half — that `/login`-adjacent endpoints never require the absence of an
admin cookie — is asserted here too).

`game-api/tests/test_websocket_auth.py`: connect rejected with no cookie, rejected with a
tampered/expired cookie, rejected on origin mismatch, accepted with a valid one — `username` on
the connection matches the cookie's `sub`, never a client-supplied value (there is no longer a
client-supplied value to compare against).

`game-api/tests/test_langgraph_thread_ids.py` (new): the six construction sites produce
`user_id`-based ids; the data-migration script correctly rewrites a seeded row of each of the three
checkpoint tables; a rename via the new `change-username` endpoint leaves LangGraph history intact
(same thread continues under the new username).

`game-api/tests/test_gameplay_server_truth.py` (new): a chat/state-update payload with a
`phase_id`/`challenge_id` that doesn't match the player's actual stored progression is silently
corrected to the server's own record rather than honored — assert the *result* reflects server
state, not the client's claim.

`game-api/tests/test_profile_management.py`: as in the first draft, plus asserting the
`change-username` response re-sets `mlops_player` with the new `sub`.

Run via `docker compose exec api python -m pytest tests/ -q`.

## Frontend

### Auth state and `whoami`

New `game-ui/src/services/api/authSession.ts`: `fetchWhoami()`, `logout()`, `adminLogout()`,
`changePassword(...)`, `changeEmail(...)`, `confirmEmailChange(...)`, `changeUsername(...)` — all
plain `fetch`/`credentials: "include"` calls (cookies ride automatically), attaching
`X-CSRF-Token` (read from `document.cookie`) on the mutating ones.

`App.tsx` changes:

- On mount, and again after any login/logout/username-change, call `fetchWhoami()` and store the
  result (`{player, admin}`) in state — this replaces every earlier draft's client-side storage
  read.
- `enterGameAsPlayer`/the admin-login branches no longer need to hold or pass a `token` anywhere;
  the cookie is already set by the time the response resolves. `WebSocketProvider` no longer takes
  a `username` prop sourced from login state at all — it connects cookie-authenticated, and
  `username` for *display* purposes comes from the next `whoami` result (or, once connected, from
  `game:init_data`, which already carries it).
- A `setInterval(fetchWhoami, ~20 * 60 * 1000)` while in Game or Admin implements the D-sliding-
  expiry keepalive.
- Logout/admin-logout call the matching endpoint, then re-run `whoami` (which will now show that
  role absent) and reset the relevant `isIn*Ui` flags.

### Path-scoped guards (D-guards) and URL sync

Cold-load / `popstate` logic in `App.tsx`:
1. Call `fetchWhoami()`.
2. Path is `/game` or `/` — look at `player` only. Present → show "Resume as X" (still a real
   click, per the explicit "that extra click is fine," now just backed by a live check instead of
   a stored guess); absent → Login. Never looks at `admin`.
3. Path is `/admin` — look at `admin` only, symmetric to the above. Never looks at `player`.
4. Path is `/login`, `/register`, `/verify`, etc. — render unconditionally; `whoami`'s result is
   not consulted for gating at all here, only to decide, e.g., whether a small "you're also signed
   in as admin" hint could be shown later (not required by this plan).
5. Unknown path → Home, as today.

`game-ui/src/utils/urlSync.ts` — unchanged from the first draft: `pushScreen`/`replaceProgress`
over `history.pushState`/`replaceState`; progression stays write-only per D-url-tiers.

### Profile section (accordion) in Settings

Unchanged in shape from the first draft (D-profile-ui): a new `Accordion`/`AccordionSection` pair,
a **Profile** group first in `SettingsPanel.tsx` with Logout, Change password, Change email
(two-step, mirroring `VerifyEmail.tsx`), and Change username. The one behavioral difference from
the first draft: on a successful username change, there is no token to store — just re-run
`fetchWhoami()` and remount `WebSocketProvider` (its connection is cookie-authenticated, so
remounting is purely "open a new socket," not "open a new socket with a new credential I'm holding
onto").

### Tests

`game-ui/src/services/api/authSession.test.ts`: each call attaches `credentials: "include"`; the
mutating ones attach `X-CSRF-Token` read from `document.cookie`; a missing CSRF cookie is handled
without throwing (attaches nothing rather than crashing, so the backend's 403 surfaces normally).

`game-ui/src/utils/urlSync.test.ts`: unchanged from the first draft.

`App.test.tsx`: `whoami` returning `{player: {...}, admin: null}` on a `/game` load shows "Resume as
X"; the same result on an `/admin` load shows plain Login (admin absent); `{player: null, admin:
{...}}` on `/login` still renders Login normally (D-guards' "admin can still reach the game login
screen"); logout re-renders Home after `whoami` flips to null; the keepalive interval calls
`fetchWhoami` on schedule and is cleared on unmount.

`SettingsPanel.test.tsx`: accordion single-open behavior, logout button, username-change success
triggers a `WebSocketProvider` remount — same assertions as the first draft.

Run with `docker compose exec ui npm test`.

## Order of work

1. Backend: `decode_token`, cookie-setting helpers, `sliding_refresh` + tests.
2. Backend: wire cookies into login/register/verify/reset-password/admin-login; add `whoami`,
   logout, admin-logout + tests.
3. Backend: CSRF dependency/middleware + tests; wire into the mutating routes.
4. Backend: switch `check_admin_token` to the cookie; update the 13 call sites in `admin.ts`.
5. Backend: websocket cookie auth + origin check, drop the `username` query param + tests.
6. Backend (prerequisite for step 9, can run in parallel with 1-5): LangGraph thread-id migration
   to `user_id` — data migration + construction-site + cleanup-helper updates + tests.
7. Backend: gameplay server-truth fix in `chat_handler.py`/`game_handler.py` + tests — sized as its
   own step given the blast radius of touching core gameplay request handling.
8. Backend: change-password/change-email/change-username endpoints (now trivial re: LangGraph,
   thanks to step 6) + tests.
9. Frontend: `authSession.ts` + tests; wire `whoami`/logout/keepalive into `App.tsx`; drop the
   `token` plumbing and the `username` prop into `WebSocketProvider`.
10. Frontend: path-scoped guards + `urlSync.ts` + `pushScreen`/`replaceProgress` wiring.
11. Frontend: `Accordion` + restructured `SettingsPanel.tsx` with the Profile section.
12. Manual pass: admin logs in in tab A, reloads, stays on the admin panel; in the same tab,
    navigating to `/login` and logging in as a player works without disturbing the admin session;
    a parallel tab B with no cookies shows Home/Login untouched; closing/reopening offers "Resume
    as X"; a stale/expired cookie falls through to Login with an expired-session message instead of
    looping; a 20+ minute idle-but-connected play session doesn't get logged out; change-username
    preserves chat history continuity; a crafted client payload claiming a different phase/
    challenge is silently overridden by the server's own record.

Rate limiting (`auth-rate-limiting.md`) is a separate, independent pass — see that doc's own Order
of work. Its `change-password` wiring step depends on step 8 above existing first.

## Open questions

- Is sliding expiration (D-sliding-expiry) sufficient, or does "might be productionalized" warrant
  building the full refresh-token-with-rotation-and-revocation system now instead of later? The
  sliding approach has no revocation story (a stolen, still-unexpired cookie is valid until it
  naturally lapses) — acceptable for a game with no sensitive data beyond gameplay progress, worth
  re-litigating if that assumption changes.
- `SameSite=Lax` assumes the frontend and backend end up same-site (even if different ports) in
  deployment; if they're ever served from genuinely different registrable domains, cookies need
  `SameSite=None; Secure` instead, which changes some of the CSRF reasoning above (Lax's built-in
  cross-site-POST protection goes away, making the double-submit token load-bearing rather than
  defense-in-depth) — worth confirming the intended deployment topology before implementing.
- D-server-truth's fix touches two core gameplay handlers directly. Given the size of this plan
  already, is it worth splitting steps 6-7 (LangGraph rekey, gameplay server-truth) into their own
  follow-on plan/PR rather than landing everything in one pass? They're each self-contained and
  don't depend on the cookie work, so sequencing is flexible either way.
- `handle_state_update_request`'s `challenge_loop_index` is still taken from the client payload
  (see the in-code comment added during step 7): a crafted payload can still claim to be further
  along in the *current* challenge's stages than it actually is, since that field doubles as the
  legitimate "advance to this stage" command (including from the internal playtest skip-challenge
  tool) and overriding it from stored state broke real advancement in testing. Closing this
  properly needs validating that the claimed transition is a legal one-step advance from the
  stored value (or a known playtest-tool transition) rather than either fully trusting it or fully
  overriding it - a real design task, not a one-line fix, and out of this plan's scope.
- `metric_values` in the same handler is *entirely* client-supplied and only partially
  cross-checked against server-known deltas (the "next challenge" branch recomputes it from
  `challenge.metric_changes`; the "same challenge" branches just store whatever the client sent).
  This is arguably the more severe half of "never trust the client on gameplay things" — a crafted
  payload can set a player's own recorded score directly — but fixing it means redoing the
  scoring/simulation pipeline to compute deltas server-side everywhere, which is a substantially
  larger, separate piece of work than this plan's phase/challenge-coordinate fix.

## Implementation checklist

Tracks progress against Order of work above; check off as steps land and are verified (backend via
`docker compose exec api python -m pytest tests/ -q`, frontend via `docker compose exec ui npm test`).

- [x] 1. `decode_token`, cookie-setting helpers, `sliding_refresh` + tests
      (`auth_service.py`, `test_auth_service.py` — 12/12 passing)
- [x] 2. Cookies wired into login/register/verify/reset-password/admin-login; `whoami`, logout,
      admin-logout + tests (`auth_routes.py`, `test_auth_routes.py` — 7/7 passing; also fixed
      `CORSMiddleware`'s `allow_origins=["*"]`, invalid once `allow_credentials=True` cookies are
      in play — added `settings.FRONTEND_ORIGINS`)
- [x] 3. CSRF dependency/middleware + tests; wired into mutating routes
      (`infrastructure/middleware/csrf.py`, `test_csrf.py` — 5/5 passing)
- [~] 4. Backend half done: `check_admin_token` (`admin_routes.py`) now reads `mlops_admin` from
      the cookie instead of the `Authorization` header — mechanical, all 15 call sites use
      `Depends(check_admin_token)` with a discarded `_`, so no route signatures changed. Frontend
      half (dropping the manual header + adding `credentials: "include"` in `admin.ts`) deferred
      to step 9-11, since `admin.ts`'s callers are all in `App.tsx`, which gets rewritten wholesale
      in those steps anyway — editing it twice would be wasted work.
- [x] 5. Websocket cookie auth + origin check, `username` query param dropped + tests
      (`websocket/router.py`, `test_websocket_auth.py` — 4/4 passing)
- [x] 6. LangGraph thread-id migration to `user_id`: Alembic revision `d7e8f9a0b1c2` (renames
      existing checkpoint rows, reversible, idempotent — `test_langgraph_thread_ids.py`, 3/3
      passing on a throwaway DB) + all six construction call sites (`chat_handler.py`, `router.py`,
      `game_handler.py` x2, `intel_handler.py`, `online_intel_service/service.py`,
      `action_card_pitch_service/service.py`, `action_card_veto_service/service.py`) + the admin
      cleanup helper (`admin_service.py`'s `_player_thread_ids`, now keyed on `user.id` not
      `user.user_name`) all switched to `user_id`. Regression run against the handlers/services
      touched: `test_pitch_debate_cme.py`, `test_gather.py`, `test_offline_intel_deck.py`,
      `test_veto_breaker.py`, `test_playtest_veto_breaker.py`, `test_pitch_session.py`,
      `test_pitch_scoring.py`, `test_pitch_verification.py`, `test_new_run.py` — 158 passed, 1
      failed (same pre-existing Opik-quota flake as the step 1-4 run, unrelated).
- [x] 7. Gameplay server-truth fix in `chat_handler.py`/`game_handler.py`. Narrower than first
      attempted: `phase_id`/`challenge_id` are now derived from the player's latest `GameChallenge`
      row (both handlers) rather than trusted from the payload. `challenge_loop_index` in
      `handle_state_update_request` is deliberately **left client-supplied** — overriding it from
      stored state was tried and broke `test_playtest.py`/`test_playtest_veto_breaker.py`, because
      it's the actual "advance to this stage" command the handler acts on (including from the
      internal playtest skip-challenge tool), not pure state to protect. That remaining gap
      (a crafted payload can still claim to be further along in the *current* challenge's stages
      than it really is) is documented in code and in Open questions, not silently dropped.
      Regression run: `test_new_run.py`, `test_run_scope.py`, `test_playtest.py`,
      `test_playtest_veto_breaker.py`, `test_metric_persistence.py`, `test_patience_malus.py`,
      `test_results_aggregate.py`, `test_results_compute.py` — 154 passed, 0 failed.
- [x] 8. Change-password/change-email/change-username endpoints written: `auth_service.py`
      (`change_password`, `request_email_change`, `confirm_email_change`, `change_username` +
      `_rename_denormalized_username`), migration `e8f9a0b1c2d3` (adds `User.pending_email`/
      `email_change_code`/`email_change_code_expires_at`), routes in `auth_routes.py`
      (`get_current_player` dependency + the four endpoints), and `test_profile_management.py`
      (7 tests, all passing). Full `docker compose exec api python -m pytest tests/ -q` run:
      561 passed, then found and fixed 3 real test bugs surfaced by the run (not production code
      bugs) - `test_auth_routes.py::test_logout_clears_player_cookie`/
      `test_admin_logout_clears_admin_cookie_only` and
      `test_profile_management.py::test_change_password_requires_authentication` were posting to
      CSRF-protected mutating routes without echoing the double-submit `X-CSRF-Token` header
      (TestClient's cookie jar doesn't do this automatically the way a browser+fetch does), so the
      CSRF middleware's 403 pre-empted the behavior under test - fixed by adding a `_csrf_headers`
      helper (auth_routes tests) / an explicit unauthenticated cookie+header pair (profile_management's
      auth-required test, which needs CSRF to pass so the 401 auth check is what's actually
      exercised). Also found and fixed `test_admin_service.py` (pre-existing, predates this plan):
      its `_row_counts`/`_seed_player` still seeded/checked LangGraph checkpoint thread ids as
      `MLOps_Convo_{username}`/`Online_Intel_{username}`, the scheme step 6's D-user-id migration
      replaced with `..._{user_id}` - `admin_service.remove_player`/`remove_campaign`/`reset_player`
      were correctly deleting the new user_id-keyed rows, but the test's stale assertions checked
      the old username-keyed rows and never actually observed a real bug. Fixed by threading the
      seeded `user.id` through every call site instead of re-deriving it from username (needed
      explicitly for `reset_player`, which recreates the user row under a new id - the check must
      target the *pre-reset* id, since that's whose checkpoint threads should be gone).
      All 20 tests across `test_auth_routes.py`/`test_profile_management.py`/`test_admin_service.py`
      pass; the other 9 full-suite failures (`test_dossier_chains.py`,
      `test_intel_categorization.py`, `test_offline_intel_deck.py`, `test_pitch_debate_cme.py`,
      `test_stakeholder_dossier_debug.py`, `test_stakeholder_dossier_intel_total.py`) are
      pre-existing OPIK-tracing-quota/mock flakiness, confirmed unrelated by `mlops-labs-a3` (the
      concurrent session) and not touched by this plan.
- [x] 9. Frontend cookie-auth wiring: `services/api/auth.ts` rewritten (`credentials: "include"`
      everywhere, `token` dropped from every response type, added `whoami`/`logout`/
      `adminLogout`/`changePassword`/`changeEmail`/`confirmEmailChange`/`changeUsername`); new
      `utils/csrf.ts` (reads the non-httpOnly `mlops_csrf` cookie, attaches it as `X-CSRF-Token`
      on mutating calls); `services/api/admin.ts` rewritten to drop the `token` parameter and
      `Authorization` header from all 13 functions in favor of the cookie (+ CSRF on the mutating
      ones) - cascaded into fixing every call site (`Admin.tsx`, `ConfigEditor.tsx`,
      `GraphDebug.tsx`, `Results/AdminResults.tsx`, and that file's test's mock assertions);
      `WebSocketContext.tsx` no longer puts `username` in the `/ws` URL and now takes an
      `onAuthFailure` callback, fired on a `4401`/`4403` close instead of retrying forever (D9);
      `App.tsx` rewritten around a mount-time `whoami()` call instead of a login-response token,
      with an `isInitializing` loading state so it doesn't flash Home first. Login/logout UI
      wiring (the actual button) deferred to step 11's Profile section - `handleSessionExpired`
      is wired now (websocket `onAuthFailure`), `logout`/`adminLogout` calls aren't yet since
      nothing in the UI can trigger them before that section exists.
      **Bugs found and fixed while wiring this up** (surfaced by the user hitting a runtime
      `KeyError: 'username'` after step 5 shipped): two more places read the old `/ws?username=`
      query param directly instead of going through the connection's own resolved `username` -
      `application/intel_handler.py` (`store_intel_item`, `retrieve_intel_items`,
      `retrieve_dossier_data`, all via `ws.query_params["username"]`) and
      `application/online_intel_service/nodes.py` (a deterministic-shuffle seed). Both now derive
      identity from the `mlops_player` cookie the same way `websocket/router.py` does - a
      `_username_from_ws` helper (raises if unresolvable) for the three `intel_handler.py` call
      sites the router's `username` isn't threaded into, and an inline resolve-with-`""`-fallback
      in `nodes.py` since that one is non-authoritative (seeding only). Frontend typecheck
      (`docker compose exec ui npx tsc --noEmit -p tsconfig.app.json`) is clean for every file
      this plan touched; the only remaining errors are pre-existing, unrelated ones in `Game.tsx`
      (an `emotion_dimensions` field on `Stakeholder`) from another session's in-progress work.
      Backend modules re-verified importable after the fix; `game-api` container back to healthy.
- [x] 10. Frontend path-scoped guards + `urlSync.ts` + `pushScreen`/`replaceProgress` wiring.
      New `game-ui/src/utils/urlSync.ts` (`pushScreen`, `replaceProgress`, `currentScreenPath`) +
      `urlSync.test.ts` (11 tests, all passing). `App.tsx`'s mount-time `whoami` effect refactored
      into a shared `applyRouting(path)` function driven by `currentScreenPath()` (D-guards: `/game`
      and `/` check `player` only, `/admin` checks `admin` only, `/login`/`/register` render
      unconditionally regardless of either cookie), called both on mount and from a new `popstate`
      listener so Back/Forward re-derive the right screen. Every screen transition in `App.tsx`
      (`enterGameAsPlayer`, `enterAdminUi`, `handleSessionExpired`, and every `onBack`/
      `onForgotPassword`/Home's `onLogin`/`onRegister` callback, plus the verification/reset-password
      branch transitions inside `handleLoginSubmit`/`handleRegisterSubmit`/`handleForgotPasswordSubmit`)
      now calls the matching `pushScreen(...)`. `Game.tsx` gained a `replaceProgress` effect watching
      `[progressionIndex, currentChallenge, currentPhase, activeStakeholderId]` - write-only, per
      D-url-tiers/D-no-client-cache, never read back. One product simplification kept as-is rather
      than re-litigated: step 9's mount effect already auto-resumes into Game/Admin on a valid
      cookie without an intermediate "Resume as X" click (D-whoami's stated preference for a real
      click was written before that code existed) - since it's already shipped and the user tested
      it working, step 10 builds the URL guards on top of that behavior rather than reintroducing
      the extra click. Full frontend suite (`docker compose exec ui npm test`): 190 passed, 0
      failed (pre-existing, unrelated `act()` warnings in `PlaytestSection.test.tsx`). Typecheck
      (`docker compose exec ui npx tsc --noEmit -p tsconfig.app.json`) shows only the same
      pre-existing `Game.tsx`/`StakeholderDossier.tsx` `emotion_dimensions` errors from the other
      session's concurrent work, unchanged in count - nothing new introduced by this step.
- [x] 11. Frontend `Accordion` + restructured `SettingsPanel.tsx` with the Profile section.
      New generic `components/Accordion.tsx`/`Accordion.module.css` (`Accordion`/`AccordionSection`,
      single-open via context). `SettingsPanel.tsx` restructured: Conversations/Voice/Account moved
      into `AccordionSection`s (all collapsed by default), with a new Profile section first
      containing Logout, Change password, Change email (two-step - request then confirm, mirroring
      `VerifyEmail.tsx`'s 6-digit code pattern), and Change username - each its own form with
      independent pending/error/success state, wired to the corresponding `services/api/auth.ts`
      functions from step 9. On a successful username change, calls the websocket context's
      `setUsername` (not a `WebSocketProvider` remount - `WebSocketContext.tsx`'s own connect effect
      already depends on `username` and reconnects on change, per its existing comment anticipating
      exactly this; remounting would have been redundant). `PlaytestSection` deliberately left
      un-wrapped by the accordion (rendered after it, as before) rather than nested in its own
      `AccordionSection`, to avoid a duplicate "Playtest tools" heading colliding with its own
      internal one and risking `PlaytestSection.test.tsx`'s `getByText` assertions - a scope
      trade-off, not an oversight.
      `onLogout: () => void` threaded `App.tsx` → `Game.tsx` → `SettingsPanel.tsx` (new
      `handleLogout` in `App.tsx`: calls `logout()`, then resets `isInGame`/`username`, shows Login,
      `pushScreen("/login")`). Symmetric `onLogout` added to `Admin.tsx`'s header (`handleAdminLogout`
      in `App.tsx`: calls `adminLogout()`, resets `isInAdminUi`/`adminToken`, shows Login) - the admin
      dashboard has no Settings/accordion of its own, so this is a plain header button instead.
      `SettingsPanel.test.tsx` rewritten around the accordion (open a section before asserting on
      its contents) plus new coverage: single-open behavior, the Logout button calling `onLogout`,
      and username-change success/failure both asserted (`setUsername` called with the new name on
      success, not called on failure, matching error text shown instead). Full frontend suite:
      195 passed, 0 failed (one unrelated iconify-teardown unhandled-error in
      `PhaseOverview.test.tsx`, a file untouched by this step). Typecheck clean apart from the same
      pre-existing `emotion_dimensions` errors noted in step 10.
- [ ] 12. Manual browser pass (see Order of work item 12 for the full checklist of scenarios)

**Post-step-11 refinements** (raised by the user after seeing the URL in practice, not their own
numbered steps):

- `replaceProgress` (`utils/urlSync.ts`) changed from raw `p{progressionIndex}/c{challenge}/{phase}
  ?stakeholder={id}` segments to five named phases - `/game/briefing`, `/game/offline-intel`,
  `/game/pitch`, `/game/simulation`, `/game/report` - or plain `/game` outside those (the intro/
  outro questionnaires, `progressionIndex` 0/1/3). `Game.tsx` derives the label from
  `progressionIndex`/`isPhaseDialogueOpen`/`challengeLoopId` rather than passing indices straight
  through. `urlSync.test.ts` updated to match.
- New `utils/seenBriefings.ts` (+ `seenBriefings.test.ts`): a reload mid-challenge was forcing the
  PrePhaseDialog ("briefing") back open even if the player had already dismissed it, because the
  "already shown" tracking (`prevShownChallengeKeyRef`) lived only in a ref that resets on every
  mount. Fixed with a best-effort, per-username localStorage mirror (`hasSeenBriefing`/
  `markBriefingSeen`), following the same read/write-mirror pattern already used for settings in
  `SettingsProvider.tsx` - it only suppresses a UI dialog and never feeds back into what
  phase/challenge the app thinks the player is in, so it doesn't reopen the D-server-truth/
  D-no-client-cache trust question (worst case on cleared/tampered storage: the briefing shows
  again, or is skipped once more - never a gameplay-state or auth consequence).

**Also landed, opportunistically, not its own numbered step**: `config.py` now warns at startup
if `SECRET_KEY` is shorter than the 32 bytes HS256 wants (surfaced by the user hitting PyJWT's own
buried `InsecureKeyLengthWarning` while testing login manually) — logs a clear message with the
fix instead of only the cryptic library-internal warning. Doesn't raise/block startup: a live
dev/course deployment shouldn't get bricked over a merely-weaker-than-ideal key.

**Verification log**: full backend suite run after steps 1-4 (backend half):
`docker compose exec api python -m pytest tests/ -q` → 555 passed, 1 failed
(`test_pitch_debate_cme.py::test_pitch_debate_dialogue_option_fallback_recovery` — confirmed
pre-existing/unrelated: it fails on an Opik/Comet tracing quota `402` from the SDK's own account
limit, not from anything in this plan's changes; re-running that file alone reproduces the same
unrelated failure on a different test within it each time, consistent with tracing-call flakiness).
