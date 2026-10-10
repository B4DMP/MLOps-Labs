# Case board: a dossier tab where players connect stakeholders

Status: implemented (steps 0 to 8), not yet playtested. Step 8 playtest is the remaining item.

Mockup (static, nothing is wired to the game): [../mockups/case-board.html](../mockups/case-board.html).
Open it in a browser. `?notes` overlays numbered design notes, `?p=0`, `?p=1`, `?p=2` pick the
board state. Screenshots in [../mockups/screenshots/](../mockups/screenshots/). The mockup needs
internet for icons only. The dialogue in it is invented and the avatars are stand-ins.

## Goal

The game's tension is between people, yet the dossier shows each stakeholder alone and the
connections only surface as objections after a pitch. Give the player a deduction verb: look at
two stakeholders, say how they are tied (allies, a rift, a chain, or a shared step), and get a concrete effect in
the pitch.

## What this is not

[graph-redesign/BACKLOG.md](graph-redesign/BACKLOG.md) records two earlier decisions this plan
must not quietly undo:

- "Stakeholder alliances" was cut: it needed a stance model between stakeholders, coalition effects
  and UI. This plan has **no authored stance model**. Relations are derived from the intel items
  that already exist and from each challenge's `conflict` block. It adds effects (table below) and
  this one UI.
- "Leverage intel category (Motivation, Alliance)" was rejected for having no clear effect in the
  pitch. There is **no new intel category** here, and every thread type has a defined effect.

When this plan is accepted, move the "Stakeholder alliances" row of BACKLOG.md into it.

## Facts this rests on

Checked against the code on 2026-10-08.

- `domain/requirement.py` has `_stance_floors_and_ceilings(item)`: what an item needs reached
  (floors) and accepts as a stopping point (ceilings), as `(target, axis, level)`, for Driver,
  Boundary and Trade-off. `self_contradictions` already uses it inside one stakeholder. A
  cross-stakeholder version is the same comparison. `item_target_and_level` gives an item's target.
- Every challenge carries `conflict: ChallengeConflict` (`domain/Challenge.py`,
  `gameConfig/GameProgression.json`): `type` soft or hard, a `target`, and two positions naming a
  stakeholder, a wanted level and an axis. All 11 challenges have one. That is an authored rift,
  already guaranteed to be answerable by the content gates.
- Coverage is now a test (`test_real_content_gives_every_playable_room_enough_to_find`), see Risks. The
  numbers below are the first probe ([../mockups/relations_probe.py](../mockups/relations_probe.py), run 2026-10-09,
  best case: every stance item verified; ally pairs from shared floors, rifts from floor over
  ceiling, set-value clashes and the `conflict` block, chains as "B holds a stance on a component
  upstream of A's target", counted as distinct stakeholder pairs). Ally and rift alone give 2 or
  more threads in **5 of 11** challenges, which fails the gate. With chains, **10 of 11** pass; the
  11th is the 2-stakeholder demo, hidden by D5 anyway. Every challenge has a usable rift once an
  item on an edge into the conflict target counts (challenge 118: Alex's driver raises
  `e.cicd_shadow`, an edge into `deploy.shadow`). Step 2 replaced the chain proxy with a structural cap
  check (an upstream component or edge whose allowed maximum, or its holder's ceiling, plus the least
  slack on the way to the target, is below the floor asked). Result: **8 of 11** challenges have 2 or
  more relations (7 of the 10 playable ones have 2 or more distinct stakeholder pairs). The gate
  passes by the plan's wording, narrowly. Weak rooms: 111, 116, 119 (and the demo, 113), 1 relation each.
- Stages carry `owner_role` in `gameConfig/MlopsGraph.json`, and `pitch_handler.py` builds an
  `upstream_map` with `pitch.find_pipeline_predecessors`. Capping logic lives in
  `application/graph_service/effective.py`.
- The dossier renders tabs and pages in `game-ui/src/components/StakeholderDossier.tsx`
  (`tabsContainer`, one page per stakeholder, plus the Challenge-Intel page).
  `retrieve_dossier_data` in `application/intel_handler.py` builds its payload.
- `infrastructure/websocket/router.py` has `READ_ONLY_EVENTS`. A new event is refused for an
  impersonating admin unless it is listed there, so read events go in and actions stay out.
- `GameEvent` (`domain/event.py`, table `GameEventRow`) with causes from `gameConfig/EventCauses.json`
  is how every change must be explained (plan 11 rule: nothing moves emotion, patience, tokens or
  the card without an event).

## Decisions

**D1 Eligibility and tag leakage (decided 2026-10-09).**
A thread is built only from **verified** intel items (`ConfidenceType.VERIFIED`, shown in the
dossier as confirmed/on record). `handle_intel_verification` rewrites a verified item to its true
type, so a thread over verified items can only repeat what the dossier already shows, and cannot
reveal whether an unverified tag was right. A relation is *eligible* when the player holds a
verified item on each side (for a rift from the `conflict` block: a verified item from each of the
two named stakeholders that touches the conflict target or an edge into or out of it). Unverified
notes offer no thread, which also rewards verifying. No tag-compatibility check is needed. Nothing
the board shows may come from an item the player has not verified.

**D2 What a relation is.** Derived per challenge from ground-truth items (`ctx.all_intel`, the
same input scoring uses), never stored in content:

| kind | rule | pair |
|---|---|---|
| ally | two stakeholders both need the same `(target, axis)` reached, or both will only go so far on it (shared ceilings, e.g. two Trade-offs accepting manual only) | unordered |
| rift | stakeholder A's floor is above stakeholder B's ceiling on the same `(target, axis)`, or two items write different values to one trigger or attribute (reuse `_set_values`, `_value_clauses`), or the challenge's `conflict` block names them | unordered |
| chain | A has a floor on target T, T's effective level is capped by upstream U, and B owns U's stage (`owner_role`) or holds a stance on U | ordered, A waits on B |
| step | two stakeholders each have a stance on the same component or edge that is neither an ally pair nor a rift there (typically one asks for automation, the other for governance) | unordered |

Each relation has a stable `id` (hash of kind and sorted stakeholder ids and target), a list of the
item ids behind each side, and the target. Sorted output, no randomness.

**D3 Effects, all numbers in config (D38 convention):**

| kind | effect once the player has confirmed the thread |
|---|---|
| ally | when A's read is agreeing after a pitch, B gets a small trust and fairness lift (`ally_lift`), once per pitch per stakeholder, and a log cause says why |
| rift | the composer marks the two items as a compromise pair when a Trade-off branch serves both, and the dossier names it. No scoring change |
| chain | the composer marks the dependent change "after {B}'s step" so the player sees the cap before a technical objection costs patience |
| step | the composer marks slots on that target "shared by {A} and {B}" (`shared_steps` in the pitch payload). No scoring change |

Threads only act when confirmed. The relation exists in the world regardless, but knowing it is
what the player earns.

**D4 Attempts.** 5 wrong or empty guesses per challenge (`case_board_attempts`; 3 was too harsh in
play). A thread the player cannot yet judge costs nothing and says only that they do not know enough
about both people. The challenge's own conflict (its rift) is on the record already, so it is pinned
for free once both sides are verified (`Relation.on_record`, `sync_on_record`).

**D5 Scope.** Current challenge only. Hidden in the demo phase and whenever fewer than 3
stakeholders are in the room. Earlier threads stay in the event log.

**D6 Scenes (dropped).** An overheard scene per thread was built (template beats plus an LLM wording
pass) and removed again: it was string building over the same two facts the notes already show, so it
added no information. The thread file shows the effect and the notes behind the thread instead,
each note linking to its dossier page.

**D7 Persistence.** New table `case_board` (below), not a column on `GameChallenge`: that table has
several rows per challenge and the latest-row lookups are already a known gotcha in
`docs/gameplay-flow.md`.

**D8 Cards.** Team Sync-Up can reveal that *a* thread exists between two people in the room, as a
dashed hint, without naming its kind. Never for pairs the player is not eligible for.

## Design

### Backend

New `domain/relations.py`, pure, no DB:

```python
RelationKind = Literal["ally", "rift", "chain"]

class Relation(BaseModel):
    id: str
    kind: RelationKind
    a: str                      # stakeholder id (the waiting one for a chain)
    b: str
    target: str
    a_item_ids: list[str]
    b_item_ids: list[str]
    via: str | None = None      # chain: the capping upstream target

def derive_relations(items, conflict, graph) -> list[Relation]: ...
def eligible(rel, held_item_ids) -> bool: ...     # D1: verified item ids on each side
```

Reuse `_stance_floors_and_ceilings` (make it public, `stance_floors_and_ceilings`, keep the old
name as an alias for `self_contradictions`).

New `application/case_board_service/`:

- `state.py`: `BoardState {found: list[str], hints: list[list[str]], attempts_left: int}`.
- `service.py`: `get_board(user, challenge) -> BoardPayload`, `connect(user, challenge, a, b, kind)
  -> ConnectResult` (`found`, `wrong_kind`, `nothing`, `not_enough_intel`, `no_attempts`), and
  `reveal_hint(...)` for Team Sync-Up and `sync_on_record(...)` for the challenge's own rift.

Database: `CaseBoardRow` in `infrastructure/database/models.py` and an Alembic migration:
`user_id`, `run_index`, `phase_index`, `challenge_index`, `found` JSON, `hints` JSON,
`attempts_left`, unique on the four keys. Follow `GameEventRow` for style.

Websocket (`router.py`, handler `handlers/case_board_handler.py`):

| event | direction | notes |
|---|---|---|
| `board:get` | client to server | add to `READ_ONLY_EVENTS`. Replies `board:state` |
| `board:state` | server to client | found threads in full, hints as pairs, `attempts_left`. Never unfound truth |
| `board:connect` | client to server | action, not read-only. Replies `board:result` |
| `board:result` | server to client | result code, the new thread if any, `attempts_left` |

Events and causes: add kind `thread` to `domain/event.py`'s Literal, and in `EventCauses.json`:
`board.thread_found`, `board.thread_wrong_kind`, `board.thread_nothing`, `emotion.ally_backed`.
Words only, no numbers.

Pitch effect, in `pitch_debate_service/session.py` `evaluate_pitch`: `confirmed_relations` becomes a
parameter, filled by `pitch_handler.py` from the board state. A second pass after the stakeholder
loop applies `ally_lift` to `accumulated_deltas[B]` when A `is_agreeing`. Do it **after**
`reaction_signatures` are recorded so the re-pitch "quiet or unchanged" logic is not disturbed.
Rift and chain markers are payload only: add `compromise_pairs` and `after_notes` to the
`pitch:state` payload.

Config: `case_board_attempts` and `ally_lift` in the pitch tuning block of
`gameConfig/EmotionValueConfig.json` (`PitchTuning` in `domain/emotion.py` and the schema in
`gameConfigSchemas/EmotionValueConfig.schema.json`).

### Frontend

- `game-ui/src/components/CaseBoard.tsx` and `CaseBoard.module.css`, rendered as one more tab in
  `StakeholderDossier.tsx` after the person tabs. Copy the geometry and tokens from the mockup
  (cork frame, 78px polaroids, thread and chip styles). Use the real
  `StakeholderAvatarComponent`.
- `layoutPortraits(n)`: a deterministic placement by stakeholder id for 3 to 6 portraits (ellipse
  for up to 6). The mockup's fixed coordinates are for 5 only. Pure function, unit tested.
- Drag to connect with pointer events, plus a keyboard path (focus a portrait, Enter, focus
  another, Enter, then the kind chooser) so the board is not mouse-only. Respect
  `prefers-reduced-motion` for the thread pop.
- The thread file (right column), the stats pills and the dock follow the mockup.
- Composer: `ComposeActionProposalModal.tsx` receives `compromisePairs` and `afterNotes`, and
  shows the marker described in D3. Keep it to a chip on the existing slot or option row.
- Copy follows `docs/gameplay-flow.md` rules: no numbers beyond resource counts, say only what the
  engine does, no em dashes. Thread tags are "Same direction", "At odds", "Depends on".

### Docs to update when it ships

`docs/gameplay-flow.md`: step 4 and 5 (Board tab, where threads are first introduced), the
READ_ONLY note, and Gotchas if anything surprising shows up. BACKLOG.md as above.

## Steps

- [x] 0. **Coverage gate** (run 2026-10-09: passes only with chains, see Facts; rerun in step 2 with the real cap check).
      Original wording: Extend `docs/mockups/relations_probe.py` to include the conflict block and
      chains, and run it after any content regeneration. Proceed only if at least 8 of the 11
      challenges (or the current count) give 2 or more eligible threads for a player who has found
      their notes. If chains are too rare, ship ally and rift only. No UI work before this.
- [x] 1. Owner decision on D1 (verified items only, see D1).
- [x] 2. `domain/relations.py` with tests (pure, no DB). `tests/test_relations.py` also asserts the 8-of-11 gate against the real content.
- [x] 3. `CaseBoardRow`, migration `d1e2f3a4b5c7`, `case_board_service` (state, store, service), `thread` event kind, four causes, config keys. `tests/test_case_board_service.py` uses an in-memory store.
- [x] 4. Websocket handler and router entries (read-only list), backend tests.
- [x] 5. Scene beats and LLM voicing: built, then dropped (see D6). Replaced by linked notes with status and an answer key in debug mode.
- [x] 6. `evaluate_pitch` ally lift and the two payload markers, tests.
- [x] 7. `CaseBoard.tsx`, `layoutPortraits`, dossier tab, drag and keyboard paths, tests.
- [x] 8. Composer markers, Team Sync-Up hint, docs. Still open: a playtest of the board with real players.

## Tests

Backend, in `game-api/tests`, run with `-m "not db"` before pushing (CI has no Postgres):

- `test_relations.py`: ally, rift (floor over ceiling, trigger clash, conflict block) and chain
  cases built with `make_intel_item` from `tests/conftest.py`. Determinism (same input, same ids and
  order). Eligibility under D1: a pair with an unverified note on either side offers nothing.
- `test_case_board_service.py`: result codes, attempts only spent on `wrong_kind` and `nothing`,
  `not_enough_intel` free, no attempts left, hints never name a kind. Use an in-memory fake store so
  the file is not auto-marked `db`. A test that really touches Postgres needs `@pytest.mark.db`.
- Extend `test_pitch_session.py`: ally lift applies once, only when confirmed, only when the other
  side is agreeing, and does not change `reaction_signatures`.
- Extend `test_event_log.py`: every new cause code used in code exists in `EventCauses.json`.
- A router test that `board:connect` is refused under impersonation and `board:get` is allowed.

Frontend (vitest): `layoutPortraits`, the chooser flow with a mocked `emit`, the keyboard path,
the empty and "not enough intel" states. `setupTests.ts` already stubs `@iconify/react` and
`lottie-web`. If the avatar generator needs a stub in jsdom, add it there, not per test file.

## Verify

```bash
docker compose up -d
docker compose exec api python -m pytest tests/test_relations.py tests/test_case_board_service.py tests/test_pitch_session.py -q
docker compose exec api python -m pytest tests -q -m "not db"
docker compose exec ui npm test -- CaseBoard
docker compose exec ui npx tsc --noEmit
```

Never install into the host Python or Node (CLAUDE.md). A new dependency goes in
`game-api/pyproject.toml` or `game-ui/package.json` and the image is rebuilt.

## Risks and open questions

- Rifts are rare from items alone, so the board leans on the conflict block for them. That
  is fine because every challenge has one, but check the conflict's two stakeholders are both in
  the room on first play.
- **Content must keep driving the board.** See [case-board-content-pass.md](case-board-content-pass.md) for the
  bar, the first content pass and the open question of findable rifts.
  Original note: Beyond the free on-record rift, every playable room needs
  at least 3 threads to find tying at least 2 different pairs; `tests/test_relations.py` enforces it
  against the real content (today 3 to 10 per room, 111 and 118 being the thinnest). A content
  regeneration that drops a room under the bar fails that test. Rifts other than the on-record one are
  rare in the items (floor above ceiling almost never happens across stakeholders), so the findable
  threads are allies, chains and shared steps. If playtests want more findable rifts, the content
  stage has to author opposing asks; the board cannot invent them.
- Small windows: the board is a wide 760 x 290 surface scaled by container width, with the thread file
  scrolling underneath. Check 6 portraits at `/?dev=case-board`.
- Content regeneration can change relations. Relations are derived at read time, so nothing is
  stale, but the coverage gate must be rerun after any content run (`make content-run-*`).
