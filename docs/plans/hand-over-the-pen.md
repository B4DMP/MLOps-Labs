# Hand the Pen, as an engagement card

Status: implemented. Reworks the version shipped in commit `0acd871`. Written so it can be built by
someone who has not seen the discussion that led to it.

## The pitch (player view)

You have four slots and a room full of people who each know part of the system better than you do.
Play **Hand the Pen** from your engagement cards, choose **one person**, and pay attention tokens.
That person decides what they would change and drafts it into your plan, right now, in front of you.
There are no take-backs: the draft is locked.

You choose who, they choose what. How good the draft is depends on how much they trust you, which
is the Trust reading already in their dossier. Someone who trusts you does the job considerately and
sometimes goes further than one slot normally allows. Someone neutral drafts what they asked for.
Someone who does not trust you drafts to suit themselves: a sign-off gate you did not want, or an
overreach. Giving the pen to someone who distrusts you gives you the worst draft and wins back the
most goodwill, which may be what stops them vetoing later.

Two more things make it a gamble:

- **They may take over a slot.** If their pick lands on something you already put on the card, their
  version replaces yours. You see it happen, and you plan the remaining slots around the result.
- **It tells you what they wanted.** The draft comes from one of their own asks, so the note lands in
  your dossier, verified. It is a way to scout a person, paid for in tokens and a locked slot.

So the question is never "who is the most powerful", it is "who do I dare to trust with a slot, and
what will it cost me in tokens that I could have spent scouting".

## Goal

Replace some of the guessing in the pitch with a decision about people. The player trades tokens, a
slot and some control for a draft whose quality they can predict from the relationship, a note they
did not have, and a relationship effect they cannot get any other way.

## What is wrong with the shipped version

Commit `0acd871` built an earlier design. This plan changes four things about it:

| shipped | this plan | why |
|---|---|---|
| The player picks a component and a person, from a "Hand it over" button in the node inspector | The player picks only the person, by playing an engagement card | The stakeholder should decide what they want implemented. A player-chosen component is the player's plan with a name on it |
| The button sits under the Governance ladder ("Unlocks once it's implemented" is directly above it) | **Hand it over** stays in the composer, but moves to the proposal section at the foot of the sidebar, beside the slot tickets, with its token cost. The card is also on the shelf | Under the ladders it reads as a governance action and spends nothing visibly. It is about the whole plan, not one component, so it belongs with the slots |
| The draft is sealed until the next evaluate, with filters on every `pitch:state` payload | The draft is revealed the moment the card is played and is an ordinary locked slot | Sealing was only there to avoid collisions with the player's own slots. Takeover handles those, and the sealed-state plumbing was the biggest source of risk |
| Drafts skew to governance sign-offs | Drafts follow the stakeholder's own item types and levels | `draft_for_pen` calls `card_search.candidate_changes(..., all_intel=[])`, so only plain next rungs exist. An automation ask two rungs up never matches, and a Low-trust holder takes the governance gate whenever the component works |

Kept as shipped: trust bands, the trust and control bonus, the small fairness costs, never crossing a
Boundary, the High-trust two-step dividend, `AtomicChange.delegated_to`, `GraphOp.source_id = "pen"`
and the uncapped op in `resolve_step_cap`, the locked slot, and the balance sim (extended below).

## What this is not

[graph-redesign/BACKLOG.md](graph-redesign/BACKLOG.md) rejects "Trade dialogue option" (a compromise
must be built by the player from Trade-off items), "Defer / promises dialogue option" and "Cite
Evidence". This is none of them: nothing is promised, there is no dialogue option, and a stakeholder
acts on one of their own existing items. Confirm with whoever wrote those rejections before building.

## Facts this rests on

Checked against the code on 2026-10-11.

- **A card is a list of changes.** `AtomicChange(target, kind, axis, value, trigger, delegated_to)`,
  at most `MAX_ATOMIC_CHANGES = 4` (`pitch_debate_service/session.py`). A Driver or Trade-off is
  satisfied by atoms, with partial credit for progress.
- **One slot moves one step**, except the pen op: `resolve_step_cap` (`graph_service/apply.py`)
  skips the cap when `source_id == "pen"`, which is how the High-trust dividend works.
- **An unhappy owner degrades the change** (`resolve_degradation`, buy-in under 0.4 in
  `MlopsGraph.json`), and a degraded repair of something Broken stays Broken.
- **Trust is a readable number.** `EmotionFactory.derive_all_dimensions` buckets each dimension into
  low (up to 0.34), medium and high (from 0.66), as the dossier hover card shows.
- **Engagement cards** live in `gameConfig/GameEngagementCards.json`. Direct-effect cards
  (Patience-Reset, Pep-Talk) have `effect_kind` set, no dialogue turns, an immediate effect and a
  one-line reaction in the chat tab. They are played through `gather_handler.handle_gather_open`,
  which deducts tokens, records the card in the challenge's `action_card`, and reveals intel through
  `revealed_db_entries`. `max_plays_per_phase` and `repeatable_target` limit plays.
- **Attention tokens are spendable on the pitch screen.** The composer is a popup over the pitch
  screen (`docs/gameplay-flow.md`), so cards stay playable while it is open. The client sends the new
  token count with the play, and the server trusts it (a known gap in `docs/gameplay-flow.md`
  Gotchas, unchanged here).
- **Edge items are hidden on a first playthrough** (`is_edge_requirement`, `is_first_playthrough` in
  `application/intel_handler.py`).
- **Demo phases** are listed by `PhaseFactory.demo_phase_ids()`.
- **Fairness is not wired** into `evaluate_pitch` (`calculate_dynamic_weights` never receives its
  inputs). The pen's fairness costs are direct emotion deltas, so they are unaffected.

## Design

### The card

A new entry in `GameEngagementCards.json`:

- `title` "Hand the Pen", `effect_kind` `"pen"`, `target_type` `"stakeholder"`,
  `stakeholder_selection_amount` 1, `token_cost` a config value (start at 4, which sits above
  Investigate Component and Pep-Talk), `max_plays_per_phase` 1.
- `max_plays_per_phase` stays at 1 until the balance sim has covered two pens in one card. Raising it
  is a config change.
- It is not offered in demo phases, after the pitch is committed, or when no slot can take a draft
  (below).

### What the player does

1. Press **Hand it over** in the composer's proposal section, or play **Hand the Pen** from the card shelf. Both play the same card.
2. Pick one person from the existing target picker (`EngagementCardTargetModal`). Each row shows
   avatar, name, power and interest chips and their **Trust** reading (Low, Medium or High, the
   dossier's words). A person with nothing to draft is disabled with the reason.
3. Confirm. The confirm says it cannot be undone and shows the token cost.
4. The server drafts and writes the change into the pitch. The composer opens on the new locked slot
   with a short guide ("{Name} drafted this. Plan the other slots around it."), the holder says a
   line in the chat tab, and a note about the item the draft came from is added to the dossier.

### The draft (deterministic, decided when the card is played)

`draft_for_pen(stakeholder, ctx, card)` in `pitch_debate_service/pen.py`, still pure. It now chooses
the target as well.

**Candidates.** The holder's unmet items in the room, in the player's current state. Skipped: Facts
(they carry no change), Boundaries (except as the Low band's sign-off gate below), anything already
satisfied, anything on a target outside the phase stage, and, on a first playthrough, edge items
(otherwise the pen would reveal what that playthrough hides).

**Ranking by item type, set by the trust band.**

| trust | order | the draft |
|---|---|---|
| High | Trade-off, then Driver | The Trade-off branch with the cheaper first step (the one where they give ground), or their Driver. Then the High dividend: up to `pen_trust_dividend_steps` rungs on that axis in one slot, stopping before a Boundary |
| Medium | Driver, then Trade-off | The Driver's level as written, or the cheaper Trade-off branch |
| Low | Driver, then a sign-off gate | The Driver at the highest step they would accept (it can overshoot other people's ceilings). If the target is already working and allows it, they take the governance gate on it instead |

Within a type, ties are broken by a seeded shuffle, `f"{user_id}:{run}:{challenge_id}:pen:{stakeholder_id}"`,
so a replay gives the same draft and nothing depends on call order.

**No unmet item.** The holder falls back to the next step on a component they own
(`graph.owner_of`) that is not already on the card, so the pen is never empty. If that does not exist
either, the person is disabled in the picker and the card cannot be played on them. Tokens are never
spent on a pen that drafts nothing.

**Legal changes and axes.** The legal set must include the levels the intel names. Call
`candidate_changes(graph, state, allowed=[target], all_intel=held_and_room_items)` so a Driver for
automation level 3 on a component at level 1 produces that change, not only the next rung. This is
the fix for the governance skew. A governance raise stays illegal until the component is implemented
(`state.value(target, "automation") >= MANUAL`), as now.

**Boundary safety (kept).** A draft never newly crosses a Boundary of anyone in the room, so the pen
can cost tokens, a slot and buy-in but never makes the challenge unwinnable.

### Takeover

If the draft's `(target, axis)` matches a change already on the card, the draft replaces it. A change
on the same target but another axis stays.

- The slot count does not grow. If there is no match, the draft needs a free slot, and at least one
  slot must still be the player's own afterwards (`pen_leave_player_slots`, default 1), otherwise the
  card cannot be played.
- The holder's line and a log event say whose change it replaced: "{Name} took over your change on
  {component}". The loss is the point: it is the risk the player takes when they hand over the pen
  late, and it is worse when the holder distrusts them.
- A takeover must keep the room winnable. The sim gate covers replaced slots as well as added ones.

### Effects (config, kept from the shipped version)

| when | effect |
|---|---|
| played | tokens spent, change written as a locked slot (`delegated_to`), event `pen.handed`, dossier note, holder's line (`pen.revealed`) |
| at the same moment, holder | trust and sense of control rise, more the lower their trust was (`pen_trust_gain`, `pen_control_gain`), scaled by reactivity. This is the lever that can lift a distrustful owner over the 0.4 line |
| at the same moment, cost | the holder loses a little fairness for doing the PM's work (`pen_holder_fairness_cost`), everyone else in the room a little for not getting the same treatment (`pen_room_fairness_cost`), both scaled by reactivity. Charged once, so an unchanged card keeps its signature and the re-pitch rules are untouched |
| simulation | no change. The holder's higher buy-in does the work through `resolve_degradation` |
| limits | `max_plays_per_phase` 1, `pen_leave_player_slots` 1, never in a demo phase, never after the pitch is committed |

The bonus and costs move from "at the next evaluate" to "when played". They are applied to the stored
emotions by the handler, not through the pitch evaluation, so the evaluate path has no pen code left.

### State

- `AtomicChange.delegated_to` stays. `same_card` keeps ignoring it.
- **Remove** `PitchState.pen`, `PenState`, `pen_used`, `merge_pen_into_card`, the `pen` and
  `pen_available` keys in `pitch:state`, and the reveal-at-evaluate branch in
  `handle_pitch_evaluate`. Whether the pen was used comes from the challenge's
  `played_engagement_card_ids`, like every other card.
- A card submitted without a locked pen change is rejected, as now: the server compares the
  submission with the stored `delegated_to` slot. `PitchState` is stored as JSON, so removing fields
  needs no migration; old rows that still carry them must load, so make the removal tolerant of the
  extra keys.
- **Remove** `pitch:delegate` from `router.py` and `handle_pitch_delegate`. The card goes through
  `handle_gather_open`, which already deducts tokens, records the play and returns the chat line, so a
  pen play and a Patience-Reset play share one path. Add `effect_kind == "pen"` handling next to the
  existing branches, delegating the draft and the writes to a function in `pen.py`.
- Config: keep the `pen_*` keys in `PitchTuning`, `EmotionValueConfig.json` and its schema, drop
  `pen_max_per_challenge` (replaced by the card's `max_plays_per_phase`) and `pen_enabled`'s
  composer meaning (it now hides the card). Causes: keep `pen.handed`, `pen.revealed`,
  `emotion.pen_trust`, `emotion.pen_holder_resentment`, `emotion.pen_favouritism`, and add
  `pen.takeover`. The test that every cause used in code exists must still pass.

### Frontend

- **Move** the "Hand it over" button out of the node inspector's ladder area (see the next point), and
  **remove** its component picker and the sealed node tint, sealed slot card and sealed ticket states in
  `ComposeActionProposalModal.tsx`. Keep the locked-slot rendering (no Remove) and make it read
  "{Name}'s draft", with "took over your change" when it replaced one.
- **Card shelf** (`EngagementCards.tsx`): the card appears like any other, with its cost. Its target
  picker is `EngagementCardTargetModal`, extended with a Trust reading per row and a reason for a
  disabled row.
- **Composer, proposal section**: the **Hand it over** button, at the foot of the sidebar next to the
  slot tickets, never in the component inspector. It is in the composer because the composer covers
  the shelf. It shows the cost and what you have ("4 tokens, you have 7") and is
  disabled with a reason at too few tokens, when no slot is available, or when the card is spent. It
  opens the same picker and calls the same play path. The composer needs `attentionTokens` and an
  `onPlayPen` callback from `pitch_debate.tsx`, which already owns `tokens`.
- First-time help goes where the player first meets it (`docs/gameplay-flow.md`): a silent `CoachTip`
  the first time a drafted slot appears, in the first real phase. Not in the intro.
- Copy follows the player-text rules in `docs/gameplay-flow.md`: no numbers beyond resource counts
  (the token cost and balance are resource counts), say only what the engine does, no em dashes.
  Suggested: card "Hand the Pen", picker title "Who drafts a slot?", slot label "{Name}'s draft", and
  a confirm that says it cannot be undone.

## Steps

- [ ] 1. `pen.py`: candidates, band ranking, seeded tie-break, owner fallback, intel-aware legal
      changes, takeover. Tests first (pure, no database). Includes the governance-skew regression.
- [ ] 2. **Balance sim before any UI**: extend `game-api/tests/sim_pen.py` (details below).
- [ ] 3. Card config, `effect_kind == "pen"` in `gather_handler`, effects at play time, causes.
- [ ] 4. Remove the sealed state, `pitch:delegate` and the evaluate-time reveal. Keep replay
      deterministic and old stored rows loadable.
- [ ] 5. Frontend: move the button from the inspector to the proposal section with its cost, picker with Trust, locked
      slot labels, coach tip, tests.
- [ ] 6. `docs/gameplay-flow.md`: replace the Hand the Pen bullet and the `pitch:delegate` mention,
      note the card in the Cards list. Playtest, tune numbers in config only.

## Balance sim (step 2)

The worry is a dominant move, and now also a hidden skew. For every non-demo challenge, every person
in the room who can draft, and each trust band (force it by setting the holder's Trust), build the
draft and search the other slots with `card_search` at its usual budget, with and without a card
already on the table so takeover is exercised. Report, against the same room with no pen:

- the axis mix per band: how many drafts are automation, how many governance. **Pass criterion, to
  confirm with the owner:** no band drafts governance in more than about half the cases where the
  holder has an unmet automation item,
- best outcome and how many sampled cards still reach it,
- the share of the challenge's damage won back (`card_search._health_after`),
- the pass rate per recipient, so a single always-best person shows up,
- the cases where a takeover removed the incident repair, and whether a repair still exists.

Pass criteria, to confirm with the owner before building: no recipient or band is best in most
challenges, a Low-trust draft never leaves a challenge without a veto-free card, High-trust drafts help
noticeably but do not make most challenges trivial, and Medium is not a strict improvement over doing
it yourself in every case. If the High band is too strong, drop `pen_trust_dividend_steps` to 1 first.

## Tests

Backend (`game-api/tests`, run with `-m "not db"` before pushing; CI has no Postgres):

- `test_pen.py`: each band's order and choice, a Driver two rungs up now drafts the named level,
  governance only after implementation, never a Boundary crossing, no unmet item falls back to an
  owned component, nobody drafts (the person is ineligible), edge items skipped on a first
  playthrough, seeded tie-break is stable, takeover replaces the same `(target, axis)` only, no
  takeover leaves at least one player slot.
- `test_gather_handler_effects.py` additions: the pen card spends tokens once, is refused when the
  stakeholder has nothing to draft (tokens untouched), in a demo phase, after commit and when spent,
  and adds the dossier note. Handler tests that reach Postgres need `@pytest.mark.db`; `conftest.py`
  auto-marks modules that name `get_session` and similar, but an indirect route is not caught.
- `test_pitch_session.py`: an unchanged card keeps its signature, a submission that drops the locked
  slot is rejected, an old stored `PitchState` with the removed fields still loads.
- `test_graph_core.py`: the pen op skips the step cap and replays to the same state (exists, keep).
- `test_event_log.py`: every new cause exists. `test_impersonation.py`: playing the card is refused
  for an impersonating admin.

Frontend (vitest): the proposal-section button shows cost and balance and is disabled with a reason, the picker
shows Trust and disabled reasons, a drafted slot has no Remove and keeps `delegated_to` through
reordering, the component inspector shows no hand-over control. New third-party stubs go in `src/setupTests.ts`.

## Verify

```bash
docker compose up -d
docker compose exec api python -m pytest tests/test_pen.py tests/test_gather_handler_effects.py tests/test_pitch_session.py -q
docker compose exec -T -e PYTHONPATH=/app api python tests/sim_pen.py
docker compose exec api python -m pytest tests -q -m "not db"
docker compose exec ui npm test -- ComposeActionProposalModal EngagementCardTargetModal
docker compose exec ui npx tsc --noEmit
```

On Windows under Git Bash, set `MSYS_NO_PATHCONV=1` for commands with a `/app` argument. Never
install into the host Python or Node (CLAUDE.md): a new dependency goes in `game-api/pyproject.toml`
or `game-ui/package.json` and the image is rebuilt.

## Risks and open questions

- **Decision: `max_plays_per_phase`.** One per phase is the safe start. Tokens already price it, so a
  higher cap is plausible once the sim has covered two pens (the second would take another slot).
- **Decision: token cost.** 4 is a guess. It should hurt enough that a player skips scouting someone
  to afford it, and not so much that nobody plays it. Tune from playtests, in config.
- **Decision: which reading is "trust".** The Trust dimension alone is simple and matches the
  dossier. A mean of Trust and Fairness is smoother but harder to read.
- **Information.** The pen discloses one of the holder's own items. That is a stakeholder telling you
  directly, so it is a priced way to scout. If you would rather it never scout, restrict picks to items
  already in the dossier, at the cost of most of the surprise.
- **Takeover can erase the incident repair.** The sim gate has to report it. If it is too punishing,
  protect the change that restores the challenge's incident target from takeover.
- **Narrowed card.** A revealed draft can leave fewer veto-free cards. The Boundary rule and the sim
  gate bound it, and Table It remains the way out.
- **Edge components** (triggers) have more variants than nodes. Drafts stay on components until the
  node version has been played.
- **Token deduction is trusted from the client payload** (existing gap). A pen play inherits it.
