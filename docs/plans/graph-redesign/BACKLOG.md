# BACKLOG: planned, not done

Things deliberately cut from the graph redesign, plus ideas that surfaced during it. Nothing here blocks [STATE.md](STATE.md). Add to it freely, including during implementation, so cuts are recorded instead of forgotten.

## Cut from v1 on purpose

| item | why cut | what it needs |
|---|---|---|
| Player created instances | D12. Instance lifecycle in the card would double the card surface and pull instances into coverage math. | `instance_create` and `instance_retire` as card ops, instance targets on Driver items, UI for picking an instance |
| Instance lifecycle rules | Instances only change through challenges and world events in v1. | state machine per instance kind, decay rules such as a dataset going stale after N challenges |
| Instances in coverage | Keeps buy-in math on components and edges only. | a second coverage term |
| Attribute level fog of war | Fog covers levels and triggers. Attributes are shown once the target is observed. | per attribute knowledge entries |
| Multi target intel items | One suggested target per Driver keeps coverage readable. Metric credit already gives some flexibility. | partial coverage rules for composite items |
| Stakeholder alliances | Leverage / Alliance removed in v3. Challenge conflicts cover the important part. | stance model between stakeholders, coalition effects, UI for who moves with whom |
| Escalation Point regeneration | D15. **Flagged for playtest**: first knob to turn if 3 per game is too harsh. | earn rule, for example one per phase closed without a veto |
| Per phase patience | D14, per challenge. | patience persisted across challenges |
| Dynamic objection prose | Objections are pre authored strings. | runtime paraphrase in stakeholder voice with a cache, same effect |
| Pattern chains | Patterns are independent predicates. No cascades between them. | causal links, ordering, compound effects |
| Feedback edges that cap | Only pipeline edges cap. Feedback and governs edges are drawn and read by patterns. | cycle-safe capping, for example iterate to a fixed point |
| Player facing debt repayment | No dedicated action to pay debt down. | a repay action or an engagement card that targets debt |

## Moved into the plan

| item | now in |
|---|---|
| Graph edges as mechanics | [01](01-graph-core.md), v3. Pipeline edges carry maturity and trigger, cap downstream effective levels, propagate breaks. |

## Rejected

| item | reason |
|---|---|
| Leverage intel category (Motivation, Alliance) | No clear effect in the pitch. Language covers persuasion, conflicts cover inter-stakeholder tension. |
| Evidence as a stakeholder tag | Split: environment truths are Facts, external limits are Boundaries with an owner. |
| Defer / promises dialogue option | No learning value, extra state and complexity. |
| Cite Evidence dialogue option | Stakeholders know their own environment. The PM is the one in the fog. |
| Trade dialogue option | Compromises must be built by the player from Trade-off items, not handed out by a button. |
| Corporate noise filler in the card | A card is intel only. Fewer items is allowed, filler is not. |
| Convincer fit only against the two most powerful stakeholders | Fit applies to every stakeholder in the room. |

## Ideas raised, not evaluated

- Component level costs: raising to `governed` costs more than `absent` to `manual`, so the player cannot max everything.
- Time pressure: challenges that expire if the graph does not reach a level within N phases.
- Stakeholder turnover: a stakeholder leaves mid game, grudges transfer or die with them.
- Comparative scoring against a reference architecture at game end.
- Replay export of the op log for teaching.
- Difficulty presets tuned by thresholds only: veto threshold, patience, Escalation Points, debt threshold, edge slack.

## Rules for this file

- An item leaves "Cut" only by being planned in a numbered plan, or by moving to "Rejected" with a reason.
- Do not implement anything from here as a side effect of another task.
