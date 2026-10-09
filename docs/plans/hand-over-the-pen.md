# Hand over the pen

Status: proposal, nothing implemented. Written so it can be built by someone who has not seen
the discussion that led to it.

## The pitch (player view)

You have four slots and a room full of people who each know part of the system better than you do.
**Hand over the pen**: choose one component and one person, and that person drafts that part of the
plan. The draft stays sealed until you pitch, and once you have handed it over there is no taking
it back.

What they draft depends on how much they trust you, which is the Trust reading you already see in
their dossier. Someone who trusts you does the job properly and goes the extra mile, often more
than a slot normally buys. Someone neutral does exactly what they asked for. Someone who does not
trust you drafts to suit themselves: a sign-off gate you did not want, an overreach, or a repair
that never lands.

So the question is never "who is the most powerful", it is "who do I dare to trust with this". Give
the pen to someone who distrusts you and you get a worse draft, but you win back more goodwill than
any other move can, which may be what stops them vetoing later. The most interesting component to
hand over is the one the challenge just broke: its owner is accountable for it, and an owner who
does not buy in leaves it broken.

## Goal

Replace some of the guessing in the pitch with a decision about people. The player trades a slot
and some control for a draft whose quality they can predict from the relationship, and for a
relationship effect they cannot get any other way.

## What this is not

[graph-redesign/BACKLOG.md](graph-redesign/BACKLOG.md) rejects "Trade dialogue option" (a
compromise must be built by the player from Trade-off items), "Defer / promises dialogue option"
and "Cite Evidence". This is none of them: nothing is promised, there is no dialogue option, and a
stakeholder acts on a component the player chose using their own existing items or their ownership.
Confirm with whoever wrote those rejections before building.

## Facts this rests on

Checked against the code on 2026-10-09.

- **A card is a list of changes, not items.** `AtomicChange(target, kind, axis, value, trigger)`,
  at most `MAX_ATOMIC_CHANGES = 4` (`application/pitch_debate_service/session.py`). A stakeholder's
  Driver or Trade-off is satisfied by atoms (`driver_fulfillment`, `trade_off_fulfillment`) with
  partial credit for progress.
- **One slot moves one step.** `resolve_step_cap` (`application/graph_service/apply.py`) caps a card
  raise to the next allowed rung, and from Broken or Absent that rung is Manual, not Absent. A
  broken component needs "Fix It" (to Manual) and "Automate It" (to Automated) in two slots.
- **An unhappy owner degrades the change.** `resolve_degradation`: when the target owner's buy-in is
  under `debt_buyin_threshold` (0.4 in `MlopsGraph.json`) the raise lands one allowed step lower, and
  a degraded repair of something Broken stays Broken. Owner buy-in is the stakeholder's pitch read
  (`owner_buyin` in `graph_service/pipeline.py`). `graph.owner_of(target)` is the component's
  `owner_role`, else its stage owner, and for an edge the owner of the component it feeds.
- **Trust is already a readable number.** `EmotionFactory.derive_all_dimensions`
  (`domain/emotion_factory.py`) buckets each of the seven dimensions into `low` (up to 0.34),
  `medium` and `high` (from 0.66). The dossier's emotion hover card shows exactly these. Emotions
  persist between challenges and recover a quarter of the way back each time.
- **Veto comes from two places**: a violated Boundary of a high-power stakeholder, or buy-in under
  the line (`scoring.outcome`). A pen never picks a Boundary, so it cannot fix a veto caused by one.
- **Fairness is not wired.** `calculate_dynamic_weights` (`domain/emotion.py`) has a term that
  lowers fairness and trust when a stakeholder's share of slots is below their share of demands,
  but `evaluate_pitch` calls it without `room_demands` or `card_slotted_counts`, so it never fires.
  This plan does not depend on it.
- **Every challenge opens with a world event** that breaks one target (`on_enter_ops` in
  `GameProgression.json`). In all 10 non-demo challenges that target's owner is in the room, and in
  8 of 10 the owner also holds an item on it. The two without are 118 (Alex owns `deploy.shadow`,
  only Ruth has an item on it) and 119 (Ruth owns `e.perf_alert`, only Emilia does).
- **State storage.** `PitchState` is stored as JSON in the latest `GameChallenge` row
  (`pitch_debate_service/store.py`), so new fields need no migration. `GraphOp` already has
  `source_id`.
- The composer keeps the card in local state and sends the whole list on `pitch:evaluate`.
  `pitch:state` carries `reads` and `predictions` computed from the current card on every update,
  and the client chooses what to show (`isRevealed`).
- Edge requirements are hidden on a first playthrough (`is_edge_requirement`,
  `is_first_playthrough` in `application/intel_handler.py`). Demo phases are listed by
  `PhaseFactory.demo_phase_ids()`.

## Design

### What the player does

1. Select a component in the composer. The inspector gets **Hand it over**.
2. A short list shows the people in the room who can take it (below). Each row shows their avatar,
   name, power and interest chips and their **Trust** reading (Low, Medium or High, the same words
   as the dossier). People who cannot take it are disabled with a reason.
3. Confirm. The component is now **reserved**: its options are disabled in the inspector, the
   canvas node and a slot card show "{Name} drafts this one" with a sealed marker, and the slot
   cannot be removed. Nothing about the change itself is shown.
4. The other slots work as normal. They can never collide with the draft because the draft is on
   a component the player already knows is taken.
5. When the player pitches, the draft is revealed: the holder says what they would do with the
   component (a short spoken beat, then the slot shows the change) and the room reacts to the whole
   card as usual.

Who can take a component: its owner (`graph.owner_of`, already shown in the composer), or a
stakeholder the player holds a note from about that component. Nobody else, so the list never
reveals a stake the player has not found.

### The draft (deterministic, decided at hand-over)

`draft_for_pen(stakeholder, target, ctx, card) -> PenDraft` in new
`application/pitch_debate_service/pen.py`, pure. Trust band comes from the holder's stored emotions
through `EmotionFactory.derive_all_dimensions`.

Legal changes on the component are the ones `card_search.candidate_changes` already accepts: target
allowed, level above the current one and in `graph.allowed_for`, and a governance raise only once
the component is implemented. A draft **never crosses a Boundary** of anyone in the room, so the
pen can cost a slot and buy-in but can never make the challenge unwinnable.

| trust | the draft | step |
|---|---|---|
| High | the legal change that satisfies their own ask on the component (or the owner's plain next step if they have none) and gives the room the best total alignment | the cap is lifted for this one op: up to two steps in one slot, for example Fix It and Automate It together |
| Medium | their own ask on the component as written: their Driver's level, or the Trade-off branch with the cheaper first step. An owner with no ask on it gets the next step | one step, as any slot |
| Low | among the changes they would accept, the one that serves them and costs the room most: a governance sign-off gate if the component is working and allows it, otherwise the highest step they would accept (which can overshoot other people's ceilings) | one step |

Ties go to item id, so the same inputs always give the same draft.

Some components have a single legal change, notably anything just broken (the repair to Manual).
Then every band drafts the same change, and what differs is the step (High may take it to
Automated), the relationship effect, and how the simulation lands it: a Low-trust owner whose
buy-in is still under 0.4 leaves it Broken (existing rule). That is the sense in which a distrustful
owner can "break" something. A card can only raise levels and set triggers, so nothing is ever
deleted.

### Effects, numbers in config

| when | effect |
|---|---|
| hand-over | component reserved, slot locked, event logged. No dossier note yet |
| at the next evaluate, for the holder | trust and sense of control rise, **more the lower their trust was**, scaled by `calculate_reactivity(power, interest)`: `pen_trust_gain` per band (default low 0.12, medium 0.07, high 0.03) and `pen_control_gain`. This is the lever that can lift a distrustful owner over the 0.4 line |
| reveal | a note is added to the dossier when the draft came from one of their items (verified, "they told you directly"). An owner's default draft adds none |
| simulation | no change. The holder's higher buy-in does the work through `resolve_degradation`; the debrief already shows who degraded what |
| limits | `pen_max_per_challenge` (1), at least `pen_leave_player_slots` (1) other slot free, never in a demo phase, never after the pitch is committed |

### Sealed state (the main implementation risk)

The draft must not reach the client before the pitch, because `pitch:state` already sends reads and
predictions computed from the card. So:

- `PitchState.pen: PenState | None` holds `stakeholder_id`, `target`, the sealed `AtomicChange`, the
  band used and the item id it came from. The sealed change is **not** in `atomic_changes` and is
  **excluded** from `PitchContext.view` and every `pitch:state` payload (`atomic_changes`,
  `predictions`, `reads`, `boundary_warnings`).
- `handle_pitch_evaluate` and `handle_pitch_commit` append the sealed change to the card
  server-side before scoring. After the first evaluate it moves into `atomic_changes` with
  `delegated_to` set and `pen.revealed = True`. From then on it is an ordinary, locked slot.
- `same_card` ignores `delegated_to`, and treats the sealed change as part of the card, so
  "change the proposal before pitching again" still works.
- A card submitted without the revealed pen change is rejected.

### Data model

- `AtomicChange.delegated_to: Optional[str] = None`.
- `PitchState.pen` as above, plus `pen_used: list[str]`.
- `GraphOp.source_id = "pen"` for the uncapped op, and `resolve_step_cap` skips the cap when it is
  set. The resolved op is what gets logged, so replay stays deterministic.
- `PitchTuning` (`domain/emotion.py`), `gameConfig/EmotionValueConfig.json` and
  `gameConfigSchemas/EmotionValueConfig.schema.json`: `pen_enabled`, `pen_max_per_challenge`,
  `pen_leave_player_slots`, `pen_trust_gain`, `pen_control_gain`, `pen_trust_dividend_steps` (2).
- Causes in `gameConfig/EventCauses.json`: `pen.handed`, `pen.revealed`, `emotion.pen_trust`. The
  existing check that every cause used in code exists must still pass.
- No Alembic migration.

### Backend

New action events in `router.py` (not in `READ_ONLY_EVENTS`):

| event | payload | result |
|---|---|---|
| `pitch:delegate` | `phase_id`, `challenge_id`, `stakeholder_id`, `target`, `atomic_changes` (the composer's current list) | stores the other changes, computes and seals the draft, replies `pitch:state` with the component reserved. Errors: `demo`, `no_free_slot`, `pen_limit`, `not_eligible`, `target_taken`, `stage_done` |

In `evaluate_pitch` add the relationship bonus for the holder before `reaction_signatures` is
recorded (it is part of the card, so an unchanged card keeps an unchanged signature and the re-pitch
rules keep working), and append a feedback message from the holder at reveal. The holder's line is
decided in code and voiced by the existing pitch voicing chain, with a template fallback so
mechanics never wait on the model.

### Frontend

- `ComposeActionProposalModal.tsx`: **Hand it over** in the inspector, the picker (the `stakeholders`
  prop is already passed, and trust comes with the dossier's emotion data), the reserved state on
  the node, the inspector and a slot card, and no Remove on a delegated slot. `AtomicChange` in the
  UI type gains `delegated_to`.
- `pitch_debate.tsx`: `handleDelegate` emits `pitch:delegate` with `base` and the current changes.
  The pitch deck's change rows show the sealed and revealed states.
- First-time help goes where the player first meets it (see `docs/gameplay-flow.md`): a silent
  `CoachTip` the first time the composer opens in the first real phase. Not in the intro.
- Copy follows the player-text rules in `docs/gameplay-flow.md`: no numbers beyond resource counts,
  say only what the engine does, no em dashes. Suggested: button "Hand it over", picker title "Who
  drafts this?", sealed label "{Name} drafts this one", and a confirm that says it cannot be undone.

## Steps

- [ ] 1. `pen.py` with `draft_for_pen` and tests (pure, no database).
- [ ] 2. **Balance sim before any UI**: `game-api/tests/sim_pen.py`, modelled on
      `tests/sim_incident.py` (same world builder and card search). Details below.
- [ ] 3. Config keys, model fields, causes.
- [ ] 4. Sealed state plumbing: `PitchContext.view`, payload filters, evaluate and commit merging,
      `resolve_step_cap` for the pen op, tests.
- [ ] 5. `pitch:delegate`, evaluate bonus and reveal beat, tests.
- [ ] 6. Composer UI, deck rows, coach tip, frontend tests.
- [ ] 7. `docs/gameplay-flow.md` (step 5 and the Gotchas), playtest, tune numbers in config only.

## Balance sim (step 2)

The worry is a dominant move. For every non-demo challenge, every eligible (person, component) and
each of the three trust bands (force the band by setting the holder's trust), build the locked draft
and search the other slots with `card_search` at its usual budget. Report, against the same room
with no pen:

- best outcome and how many sampled cards reach it,
- the share of the challenge's damage won back (`card_search._health_after`),
- the pass rate when the pen goes to each person, so a single always-best recipient shows up.

Pass criteria, to confirm with the owner before building: no recipient or band is best in most
challenges, a Low-trust draft never leaves a challenge without a veto-free card, High-trust drafts
help noticeably but do not make most challenges trivial, and Medium is not a strict improvement over
doing it yourself in every case. If the High band is too strong, drop `pen_trust_dividend_steps` to 1
before touching anything else.

## Tests

Backend (`game-api/tests`, run with `-m "not db"` before pushing; CI has no Postgres):

- `test_pen.py`: each band's choice, single-option component (broken target), owner with no ask,
  never a Boundary crossing, tie-breaking, eligibility (owner, held note, neither), stable result.
  Use `make_intel_item` and the `real` fixture from `tests/conftest.py`.
- `test_pitch_session.py` additions: the bonus scales with the starting band, an unchanged card keeps
  its signature, the sealed change is scored but absent from the preview view.
- `test_pen_handlers.py`: every error code, the one-pen limit, a card that drops the revealed change
  is rejected, no sealed change in any `pitch:state` payload before reveal, demo refusal. Handler
  tests that reach Postgres need `@pytest.mark.db`; `conftest.py` auto-marks modules that name
  `get_session` and similar, but an indirect route through a service is not caught.
- `test_graph_core.py` additions: the pen op skips the step cap and replays to the same state.
- `test_event_log.py`: every new cause code exists. `test_impersonation.py`: `pitch:delegate` is
  refused for an impersonating admin.

Frontend (vitest): the picker lists and disables correctly, reserved and sealed states render, a
delegated slot has no Remove, `delegated_to` survives reordering. New third-party stubs go in
`src/setupTests.ts`.

## Verify

```bash
docker compose up -d
docker compose exec api python -m pytest tests/test_pen.py tests/test_pitch_session.py tests/test_pen_handlers.py -q
docker compose exec -T -e PYTHONPATH=/app api python tests/sim_pen.py
docker compose exec api python -m pytest tests -q -m "not db"
docker compose exec ui npm test -- ComposeActionProposalModal
docker compose exec ui npx tsc --noEmit
```

On Windows under Git Bash, set `MSYS_NO_PATHCONV=1` for commands with a `/app` argument. Never
install into the host Python or Node (CLAUDE.md): a new dependency goes in `game-api/pyproject.toml`
or `game-ui/package.json` and the image is rebuilt.

## Risks and open questions

- **Decision: trust dividend.** Letting a High-trust drafter take two steps in one slot is the
  strongest reward for the relationship and the biggest balance risk. The sim is the gate.
- **Decision: which reading is "trust".** The Trust dimension alone is simple and matches the
  dossier. A mean of Trust and Fairness is smoother but harder to read.
- **Sealed payload leaks.** Every payload that carries the card or reads must be filtered. A test
  that scans each `pitch:state` before reveal is the safeguard.
- **Irreversibility and re-pitches.** A bad draft stays for the whole challenge. The "never crosses a
  Boundary" rule and the sim gate keep that from being a trap, but a Low-trust draft may make a
  veto-free card narrow. Table It remains the way out.
- **Edge components** (triggers) have more variants than nodes. Start with components only and add
  edges once the node version has been played.
- **Fairness** is not wired (see Facts). Do not add a fairness effect to this plan without wiring
  it for all pitches first, which is a separate change.
- **Information.** A revealed draft from a stakeholder's own item discloses that item. That is a
  stakeholder telling you directly, so the pen is also a priced way to learn what someone wants.
