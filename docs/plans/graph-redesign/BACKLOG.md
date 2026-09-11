# BACKLOG: planned, not done

Things deliberately cut from the graph redesign, plus ideas that surfaced during it. Nothing here blocks [STATE.md](STATE.md). Add to it freely, including during implementation, so cuts are recorded instead of forgotten.

Format: one line per item, why it was cut, what it would need.

## Cut from v1 on purpose

| item | why cut | what it needs |
|---|---|---|
| Player created instances | D12. Instance lifecycle in the card would double the action card surface and pull instances into coverage math. | `instance_create` and `instance_retire` as card ops, instance targets on Position items, UI for picking an instance target |
| Instance lifecycle rules | Instances only appear and change through challenges and world events in v1. | state machine per instance kind, transitions on world events, decay rules such as a dataset going stale after N challenges |
| Instances in coverage | Keeps buy-in math on components only, which keeps it explainable. | a second coverage term, weighting between component and instance coverage |
| Attribute level fog of war | Fog covers component levels only. Attributes and instances are shown once the component is observed. | per attribute knowledge entries, more `observe` sources |
| Multi component intel items | One component per Position item keeps coverage readable. | partial coverage rules for composite items, content authoring guidance |
| Coalition depth | Alliance items give simple paired effects. No factions, no chains. | faction model, transitive stance resolution, UI for showing who moves with whom |
| Escalation Point regeneration | D15. Finite for the whole game is the cleanest pressure. **Flagged for playtest**: if 3 for the whole game proves too harsh, this is the first knob to turn. | earn rule, for example one per phase closed without a veto |
| Per phase patience | D14, per challenge. Per phase would make a stalemate scar the rest of the phase. | patience persisted across challenges, UI for showing it decaying |
| Dynamic objection prose | Objections are pre authored strings. | runtime paraphrase in stakeholder voice with a cache, still deterministic in effect |
| Antipattern chains | Antipatterns are independent predicates. No cascades. | causal links between antipatterns, ordering, compound penalties |
| Graph edges as mechanics | Edges are drawn but carry no rules. | flow rules, for example a broken upstream node capping downstream levels |
| Player facing debt repayment plan | Debt is visible but there is no dedicated action to pay it down. | a repay action or an engagement card that targets debt directly |

## Ideas raised, not evaluated

- Component level costs: raising a component from `automated` to `governed` costs more of something than `absent` to `manual`, so the player cannot max everything.
- Time pressure: challenges that expire if the graph does not reach a level within N phases.
- Stakeholder turnover: a stakeholder leaves the project mid game and their grudges transfer or die with them.
- Comparative scoring: end of game report against a reference architecture, showing what a well run project would have built.
- Replay export: the op log is already an event stream, so a full run could be exported and replayed for teaching.
- Difficulty presets tuned by thresholds only, no content change: veto threshold, patience, Escalation Points, debt threshold.

## Rules for this file

- An item leaves this file only by being planned properly, in its own numbered plan, or by being explicitly rejected with a reason.
- Do not implement anything from here as a side effect of another task.
