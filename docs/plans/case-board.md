# Case board: a dossier tab where players connect stakeholders

Status: proposal, nothing implemented. Written so it can be built without the session that
produced it.

Mockup (static, nothing is wired to the game): [../mockups/case-board.html](../mockups/case-board.html).
Open it in a browser. `?notes` overlays numbered design notes, `?p=0`, `?p=1`, `?p=2` pick the
board state. Screenshots in [../mockups/screenshots/](../mockups/screenshots/). The mockup needs
internet for icons only. The dialogue in it is invented and the avatars are stand-ins.

## Goal

The game's tension is between people, yet the dossier shows each stakeholder alone and the
connections only surface as objections after a pitch. Give the player a deduction verb: look at
two stakeholders, say how they are tied (allies, a rift, or a chain), and get a short overheard
scene plus a concrete effect in the pitch.

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
- Coverage probe ([../mockups/relations_probe.py](../mockups/relations_probe.py), run in the `api`
  container against the assembled 144 items): shared floors on one `(target, axis)` give ally pairs
  in 8 of 11 challenges (up to 3 in one). Floor above ceiling gives rift pairs from items alone in
  only 2 of 11, so rifts must also come from the conflict block. 3 challenges have no derived
  thread at all, one of them the 2-stakeholder demo. **Chains were not measured**: step 0 does it.
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

**D1 Eligibility and tag leakage (needs owner sign-off, recommendation given).**
A confirmed thread says something true about the items behind it, for instance that two items are
both floors. If the thread ignores the player's tags, confirming it leaks whether a tag was right,
which breaks "no tag leaks" (plan 11). Recommendation: a thread is only *eligible* when the player
holds an item on each side **and** their own tags on those items are compatible with the relation
(ally: both tagged Driver or Trade-off; rift: one side Driver or Trade-off, the other Boundary or
Trade-off, or the conflict block's two positions; chain: a stance tagged Driver plus the upstream
owner's item or a Fact). A mistagged note then simply offers no thread. That reads as "nothing
there", never as "your tag is wrong", and it rewards tagging well. The alternative (ground truth,
accept the leak) is simpler and weaker. Decide before step 2.

**D2 What a relation is.** Derived per challenge from ground-truth items (`ctx.all_intel`, the
same input scoring uses), never stored in content:

| kind | rule | pair |
|---|---|---|
| ally | two stakeholders have a floor on the same `(target, axis)` | unordered |
| rift | stakeholder A's floor is above stakeholder B's ceiling on the same `(target, axis)`, or two items write different values to one trigger or attribute (reuse `_set_values`, `_value_clauses`), or the challenge's `conflict` block names them | unordered |
| chain | A has a floor on target T, T's effective level is capped by upstream U, and B owns U's stage (`owner_role`) or holds a stance on U | ordered, A waits on B |

Each relation has a stable `id` (hash of kind and sorted stakeholder ids and target), a list of the
item ids behind each side, and the target. Sorted output, no randomness.

**D3 Effects, all numbers in config (D38 convention):**

| kind | effect once the player has confirmed the thread |
|---|---|
| ally | when A's read is agreeing after a pitch, B gets a small trust and fairness lift (`ally_lift`), once per pitch per stakeholder, and a log cause says why |
| rift | the composer marks the two items as a compromise pair when a Trade-off branch serves both, and the dossier names it. No scoring change |
| chain | the composer marks the dependent change "after {B}'s step" so the player sees the cap before a technical objection costs patience |

Threads only act when confirmed. The relation exists in the world regardless, but knowing it is
what the player earns.

**D4 Attempts.** 3 wrong or empty guesses per challenge (`case_board_attempts`). A thread the
player cannot yet judge costs nothing and says only that they do not know enough about both people.

**D5 Scope.** Current challenge only. Hidden in the demo phase and whenever fewer than 3
stakeholders are in the room. Earlier threads stay in the event log.

**D6 Scenes.** The engine decides who speaks, which items they cite and who yields. The LLM only
words each beat, with a template fallback and a stored result per thread, the same split as plan 11
("the outcome is decided before anything is said"). Mechanics never wait on the LLM.

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
def eligible(rel, held_items) -> bool: ...        # D1
```

Reuse `_stance_floors_and_ceilings` (make it public, `stance_floors_and_ceilings`, keep the old
name as an alias for `self_contradictions`).

New `application/case_board_service/`:

- `state.py`: `BoardState {found: list[str], hints: list[str], attempts_left: int, scenes: dict}`.
- `service.py`: `get_board(user, challenge) -> BoardPayload`, `connect(user, challenge, a, b, kind)
  -> ConnectResult` (`found`, `wrong_kind`, `nothing`, `not_enough_intel`, `no_attempts`), and
  `reveal_hint(...)` for Team Sync-Up.
- `scenes.py`: beat scripts per kind (ally: A states, B states, A calls it the same ask; rift: A
  states, B objects citing their item or concession, one side offers the Trade-off branch if there
  is one; chain: A states, B states the upstream position, A is capped), the LLM voicing call and
  `gameConfig/CaseBoardScenes.json` fallbacks (about 12 templates with `{a}`, `{b}`, `{item}`).

Database: `CaseBoardRow` in `infrastructure/database/models.py` and an Alembic migration:
`user_id`, `run_index`, `phase_index`, `challenge_index`, `found` JSON, `hints` JSON,
`attempts_left`, `scenes` JSON, unique on the four keys. Follow `GameEventRow` for style.

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
  engine does, no em dashes. Thread tags are "Same ask", "At odds", "Depends on".

### Docs to update when it ships

`docs/gameplay-flow.md`: step 4 and 5 (Board tab, where threads are first introduced), the
READ_ONLY note, and Gotchas if anything surprising shows up. BACKLOG.md as above.

## Steps

- [ ] 0. **Coverage gate.** Extend `docs/mockups/relations_probe.py` to include the conflict block and
      chains, and run it after any content regeneration. Proceed only if at least 8 of the 11
      challenges (or the current count) give 2 or more eligible threads for a player who has found
      their notes. If chains are too rare, ship ally and rift only. No UI work before this.
- [ ] 1. Owner decision on D1.
- [ ] 2. `domain/relations.py` with tests (pure, no DB).
- [ ] 3. `CaseBoardRow`, migration, `case_board_service`, events and causes, config keys.
- [ ] 4. Websocket handler and router entries (read-only list), backend tests.
- [ ] 5. Scene beats, LLM voicing with template fallback, `CaseBoardScenes.json`.
- [ ] 6. `evaluate_pitch` ally lift and the two payload markers, tests.
- [ ] 7. `CaseBoard.tsx`, `layoutPortraits`, dossier tab, drag and keyboard paths, tests.
- [ ] 8. Composer markers, Team Sync-Up hint, docs, playtest.

## Tests

Backend, in `game-api/tests`, run with `-m "not db"` before pushing (CI has no Postgres):

- `test_relations.py`: ally, rift (floor over ceiling, trigger clash, conflict block) and chain
  cases built with `make_intel_item` from `tests/conftest.py`. Determinism (same input, same ids and
  order). Eligibility under D1: mistagged note offers nothing.
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

- Rifts are rare from items alone (2 of 11), so the board leans on the conflict block for them. That
  is fine because every challenge has one, but check the conflict's two stakeholders are both in
  the room on first play.
- D1 is the main design risk. Without it the board leaks tag correctness.
- Scenes add LLM calls. Cache by relation id and store the result, and fall back to templates when
  the call fails or is slow.
- Mobile and small windows: the board is a 5-person layout in an 840px dossier. Test 6 portraits.
- Content regeneration can change relations. Relations are derived at read time, so nothing is
  stale, but the coverage gate must be rerun after any content run (`make content-run-*`).
