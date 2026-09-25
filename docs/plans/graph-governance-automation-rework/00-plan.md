# MLOps Graph: Automation/Governance Rework — Plan

Branch: `feature/graph-governance-automation-rework`. Status: design agreed, no code changed yet.
Supersedes the earlier German drafts (`00-overview.md`, `01-options-design.md` — removed, folded
in here).

## 1. Problem statement

### 1.1 One slot buys an unlimited maturity jump

`Level` (`domain/graph.py:14`) is a single `IntEnum`:
`BROKEN(0) < ABSENT(1) < MANUAL(2) < AUTOMATED(3) < GOVERNED(4)`. `apply.py:_apply_one` resolves a
`raise_to` op as `new = max(current, requested)` — nothing forces an intermediate step. In the
compose UI (`ComposeActionProposalModal.tsx`), one `AtomicChange` costs exactly one of
`MAX_ATOMIC_CHANGES = 3` slots, regardless of whether it moves a target by one level or by four.
Net effect: a player can move three components from `broken` to `governed` in a single round.

### 1.2 Attributes are not a player action

`Component.attributes` (story attributes such as `tool`, `sourcing`, `hosting` —
`domain/graph.py:74-96`) exist in the data model but are only ever written by content
(`set_attr` ops from intel items, world events). The compose UI never exposes them. The player's
only real lever today is `raise_to` / `set_trigger`.

### 1.3 Governance is not a coherent concept

- `GOVERNED` sits *above* `AUTOMATED` on the same axis, so a component can never be "manual but
  governed" — even though a strictly reviewed manual process (four-eyes sign-off on a manual
  step) is the normal case in real MLOps practice, not an edge case.
- Some components skip `AUTOMATED` in `allowed_levels` but still allow `GOVERNED` directly.
  Example: `req.kpi_definition` → `allowed_levels: [0,1,2,4]` (`gameConfig/MlopsGraph.json`). This
  is only expressible today because governance isn't its own axis — a component that cannot be
  automated is still forced through the "automated" rung to reach the maturity value that
  happens to be called "governed".
- Every one of the 31 edges allows the full `[0,1,2,3,4]` range, and the player picks any trigger
  from `allowed_triggers` freely — including edges where automation doesn't make sense (e.g. an
  edge between two decision artifacts).
- Content already reproduces the confusion. `RequirementObjects.json`, item
  `gen_heatwave_kpi_gap_monica_kpi_automation` (challenge 113): the text says *"proposed
  automating the KPI definition"*, but the op is `{"target": "req.kpi_definition", "level": 4}` —
  level 4 is `GOVERNED`, not `AUTOMATED` (the component doesn't allow `AUTOMATED` at all). The
  author wanted to express "fully done" and had no value for "manual but disciplined" to reach for
  except the one that happens to be named "governed". The counter-item from `efficiency_emilia` in
  the same challenge (`..._emilia_kpi_manual`, type `trade_off`) says *"keeping the KPI definition
  manual"* while `concedes.accepts_max_level: 4` — she'd also accept level 4. Both stakeholders
  mechanically target the same value; the only difference is prose. **This is the root of the
  "only 1–2 viable paths" problem**: the mechanic offers no second, actually-different target
  state for "strict, but deliberately manual".

## 2. Target design

### 2.1 Two decoupled axes

- **AutomationState**: `broken(0) / absent(1) / manual(2) / automated(3)`. No `governed` on this
  axis. Not every target can reach `automated` — gated by a per-target ceiling (successor to
  today's `allowed_levels`).
- **GovernanceLevel**: `none(0) / partial_1(1) / partial_2(2) / full(3)`, as the superset. **Step
  count is variable per target** (decided) — exactly like today's `allowed_levels`, each target
  declares a subset (`allowed_governance`) of these four values. A target can allow `none`/`full`
  with no intermediate step, another all four.
- A target's state becomes the pair `(automation, governance)` instead of one `level`.
  `manual + full` (a strictly reviewed manual process) and `automated + none` (unsupervised
  automation) are both expressible — impossible today.
- **`broken` is never a player-facing option** (decided, in response to explicit follow-up). Only
  the backend may set a target to `broken` — world events, challenge consequences, admin/debug
  ops. No authored option (component or edge, either axis) may have `to_level = broken`; enforced
  both at config load (`validate_graph`) and defensively at runtime (`apply.py` rejects any
  `source_kind="action_card"` op that would set automation to `broken`). This continues what
  already holds today by accident (`raise_to` only ever raises, `AtomicChange` has no `set_to`),
  now made an explicit, checked invariant instead of a side effect of `max()`.
- **`absent` is not a player-facing option either, once a target has regressed to `broken`**
  (decided, follow-up). `broken` (it existed and stopped working) recovering to `absent` (it never
  existed) reads backwards - a player fixing something does not un-build it first. Both are
  automation's resting states: no authored option (component or edge) may target `absent`, exactly
  like `broken`; a target sitting at either one has its next option reach `manual` directly. Enforced
  at config load (`validate_graph`/`_option_errors`) and in the composer's option ladder
  (`graphOptions.ts`'s `optionStatus`, via a `floorOn(axis)` of `absent` on automation).

### 2.2 Node vs. edge: the same two axes mean different things

Confirmed by the existing code, not a new idea: `Edge` is already documented as *"a workflow
between two components"* (`domain/graph.py:100`), carries a `trigger` (`edge_triggers` in
`GraphState`) and the structural fields `kind` (`pipeline`/`feedback`), `slack` (hard/soft
dependency, drives capping) and `stage_flow` (does the edge count as a lifecycle hand-off, or is
it a pure specification dependency). `Component` has none of that — instead it has `attributes`
(technology/tooling choice: `tool`, `sourcing`, `hosting`). There is no `component_triggers`
anywhere in `GraphState` today — components are never triggered, only edges are.

| | **Component (node)** | **Edge (workflow)** |
|---|---|---|
| Automation answers | *Is the work on this component done by a person or by tooling?* No trigger — the question is "who/what executes", not "when". | *Does the hand-off to the next component fire automatically (event/schedule) or only on manual request?* Carries the `trigger`. |
| Governance answers | *Is the content/state of this component reviewed?* (Is the model good, is the KPI definition sound, is the endpoint config compliant.) | *Does this specific hand-off require sign-off before it may happen?* — a gate on the transition itself, independent of the content quality (which the component's own governance already covers). |
| Exclusive to | `attributes` (technology/tooling choice) | `trigger`, `kind` (pipeline/feedback), `slack` (capping hardness), `stage_flow` (lifecycle step vs. spec dependency) |

This produces four genuinely distinct, meaningful states instead of one collapsed scale:

| | Edge manual | Edge automatic |
|---|---|---|
| **Component manual** | fully manual workflow | an event fires automatically, but a person still has to log in and do the work by hand (e.g. paged on data arrival, then a manual ingestion run) |
| **Component automated** | self-service automation: a person decides "now", execution itself then runs through tooling (click "start retrain", the rest is automated) | the classic fully automated pipeline: event fires, tooling executes, no human involved |

That is the kind of added depth the original ask ("more action options, but only where they
actually make sense") was after — achieved without introducing a third axis.

### 2.3 Cost model: 1 slot = 1 step on one axis

- One `AtomicChange`/slot moves **exactly one step on exactly one axis** of one target (e.g.
  `manual → automated`, or independently `none → partial_1`). No slot moves both axes at once, and
  none skips a step.
- `broken/none → automated/full` therefore costs 3 automation + 3 governance steps = 6 slots,
  spread across multiple rounds. This makes the "three components from broken to governed in one
  round" jump structurally impossible without touching the slot count itself.
- Owner degradation (`apply.py:resolve_degradation`, the buy-in mechanic) must act per axis: an
  unhappy owner degrades the axis that was touched by one step, not "the level".
- The BACKLOG idea *"raising to governed costs more than absent→manual"*
  (`docs/plans/graph-redesign/BACKLOG.md:42`) is substantially achieved by the one-step model
  already (every step costs the same, but higher maturity needs strictly more of them). A
  progressive per-tier cost multiplier remains a later balancing knob, not a launch blocker.

### 2.4 Curated options instead of raw values

Instead of "pick a level 0–4" and "pick any trigger from the global list", the player gets a
curated list of **options** per target. Each option moves exactly one step on one axis and (where
relevant) fixes a specific trigger. Authored **individually per component/edge** (decided — not a
generic reusable catalog of 6–10 option types): every one of the 28 components and 31 edges gets
its own, thematically fitting option text. This is the single biggest content-authoring task in
this rework, but it is what gives every option real in-universe meaning instead of a generic
label.

### 2.5 Attributes via mapped options

**Decided**: technology/attribute choice is also a curated option list per component (e.g.
"On-Prem" → "Managed Cloud Service" → "Multi-Cloud"), each option costs one slot and emits a
`set_attr` op with a fixed value — not a free dropdown over the schema's `values` list. This keeps
one consistent interaction pattern across all three player-facing dimensions (automation,
governance, attributes) instead of a special case for attributes only.

## 3. Structural rules for option design

The fix for "only 1–2 viable paths" is not "more options per target" but "real, meaningful
ceilings where they matter" plus "governance as a second, equally valid target state" — achieved
with **two global rules**, not 59 bespoke per-target decisions.

### 3.1 Two component families set the automation ceiling

- **Decision/definition components** — no executable technical process, a human decides
  something: `req.kpi_definition`, `req.acceptance_criteria`, `req.risk_assessment`. Automation
  ceiling: **`manual`** — there is nothing a tool could "execute" instead of a human. Maturity here
  is expressed entirely through the governance axis.
- **Specification-with-enforcement**: `req.data_contracts` — the contract itself is a definition,
  but its enforcement is automatable (schema validation, contract testing). Ceiling:
  **`automated`** (already true today — this existing distinction from the other three
  requirements components was correct but was never applied consistently to them).
- **Execution components** (the remaining 24, across data/model/deploy/ops): ceiling
  **`automated`** — every one of these is a real technical process that is genuinely automated in
  practice (ingestion, validation, training, serving, monitoring, rollback, …). No further
  per-target restriction needed; the differentiation lives in *which* automation option makes
  sense, not in an artificially lowered ceiling.

Result: **3 of 28 components** get a lowered automation ceiling. One rule with two categories, not
28 individual calls.

### 3.2 `on_approval` moves off the automation axis

`on_approval` is removed from every `allowed_triggers` list and instead becomes governance-option
vocabulary (no trigger mechanics there — governance never caps, decision Q1 below, only affects
metrics/requirements/patterns). Consequence for an edge's automation ceiling: **an edge caps at
`manual` if, after removing `on_approval`, no genuine automatic trigger remains.** That is exactly
the three requirements-family edges (`e.contracts_ingest`, `e.risk_acceptance`,
`e.acceptance_eval` — their trigger vocabulary was only `none/manual_request/on_approval`). The
other 28 edges keep real automatic triggers (`scheduled`, `on_data_arrival`, `on_commit`,
`on_new_version`, `on_metric_threshold`, `on_alert`) and so keep the ability to reach `automated`.

Again a single global rule ("ceiling = `automated`, unless no automatic trigger survives"), not 31
individual decisions — and it lines up almost exactly with the three decision components: the
Requirements stage is the one place in the graph where "automate" is simply the wrong vocabulary.
That's the correct real-world read (you don't automate a decision, you discipline the decision
*process*), and it's exactly the differentiation currently missing.

### 3.3 Resulting ceiling table

| Automation ceiling `manual` | Automation ceiling `automated` |
|---|---|
| Components: `req.kpi_definition`, `req.acceptance_criteria`, `req.risk_assessment` | all other 25 components (incl. `req.data_contracts`) |
| Edges: `e.contracts_ingest`, `e.risk_acceptance`, `e.acceptance_eval` | all other 28 edges |

Governance ceiling stays **`full`** for every target for now — governance is meant to be the axis
that's always available. Whether individual targets should be capped lower in a later playtest
pass (e.g. a purely internal tool with no external stakes) is a content-tuning question, not a
structural one, and is deliberately left open (see §9).

### 3.4 Five governance "flavors" per stage

Governance doesn't mean the same thing everywhere. Five stage flavors, each up to 4 steps
(`none/partial_1/partial_2/full`, count variable per target — §2.1). Wording stays individual per
component/edge (decided, §2.4), but every target follows its stage's pattern:

| Stage | Governance means | none → partial_1 → partial_2 → full |
|---|---|---|
| Requirements | how binding the definition/decision is | no check → sign-off by one owner → structured review with documented rationale → change-controlled, versioned baseline |
| Data | data-stewardship rigor | no check → spot-check by data owner → documented lineage + quality/PII review → formal data-governance-board sign-off |
| Modeling | model-risk rigor | no check → peer review of results → model card + fairness/bias review → independent model-risk-committee sign-off |
| Deployment | change-management rigor | no check → tech-lead approval → change-advisory-board review → regulated release process with rollback plan + audit log |
| Monitoring/Ops | incident/SLA accountability | no check → informal on-call awareness → documented runbook + escalation path → SLA-backed on-call with post-incident review |

## 4. Worked examples

One component + one edge per stage — both component families and every edge role appear. Every
option below is one axis-step, i.e. one slot.

### Requirements — `req.kpi_definition` (decision component, ceiling `manual`)

- Automation: **no options** — ceiling is `manual`, the only meaningful non-backend states are
  `absent`/`manual`. No automation slot is ever spent here.
- Governance:
  1. *"Have an owner sign off on the KPI"* (`none→partial_1`)
  2. *"Document the KPI's derivation and align it with the business side"* (`partial_1→partial_2`)
  3. *"Freeze the KPI as a versioned baseline; changes require a change log"* (`partial_2→full`)
- This reframes the challenge-113 example from §1.3: Monica's "automate the KPI" has no automation
  option to reach for anymore (ceiling `manual`) — her proposal becomes *"govern the KPI strictly
  so it's reliably re-evaluated on every forecast shift"*, mechanically identical to what Emilia
  wanted anyway. The disagreement isn't papered over — it's expressed honestly as what it actually
  is: both want `governance→full`, not two different automation states. The real second path shows
  up at the **edge** level (`e.contracts_ingest` below) and via the fact that other components in
  the same requirement genuinely do have an automation path (`req.data_contracts`).

### Requirements — `e.contracts_ingest` (requirements-family edge, ceiling `manual`)

- Automation: **no options** (same reason — ceiling `manual`, `on_approval` removed from the
  trigger vocabulary).
- Governance:
  1. *"Data engineering reviews the contract before ingestion"* (`none→partial_1`)
  2. *"Schema-diff review with a documented sign-off record"* (`partial_1→partial_2`)
  3. *"Contract changes require data-governance-board approval"* (`partial_2→full`)

### Data — `data.ingestion` (execution component, ceiling `automated`)

- Automation (no trigger — purely "who executes", not "when"):
  1. *"Ingestion runs as a script someone executes by hand"* (`absent→manual`)
  2. *"Ingestion runs on a managed automation platform, no manual run required"*
     (`manual→automated`)
- Governance:
  1. *"Spot-check incoming data"* (`none→partial_1`)
  2. *"Lineage documentation + quality report per run"* (`partial_1→partial_2`)
  3. *"New data sources require data-governance-board sign-off"* (`partial_2→full`)

### Data — `e.ingest_validate` (pipeline edge, ceiling `automated`)

- Automation:
  1. *"Trigger validation manually after ingestion"* (`absent→manual`, trigger `manual_request`)
  2. *"Validation runs automatically on every new data arrival"* (`manual→automated`, trigger
     `on_data_arrival`)
- Governance:
  1. *"Failed validations are reported to the data owner"* (`none→partial_1`)
  2. *"Validation rules are versioned and require review"* (`partial_1→full`, deliberately *no*
     intermediate step here — a plain pipeline edge between two execution steps doesn't need a
     third rung to be credible; an example of the variable-step-count decision, §2.1)

### Modeling — `model.training_pipeline` (execution component, ceiling `automated`)

- Automation (no trigger — *when* training runs is decided by inbound edges like
  `e.fs_train`/`e.hpo_train`):
  1. *"A training run is started manually from a notebook/CLI"* (`absent→manual`)
  2. *"Training runs on managed training infrastructure, no manual triggering of the compute
     steps"* (`manual→automated`)
- Governance:
  1. *"A second person reviews training results"* (`none→partial_1`)
  2. *"A model card with a fairness check accompanies every run"* (`partial_1→partial_2`)
  3. *"Independent model-risk review before downstream use"* (`partial_2→full`)

### Modeling — `e.eval_registry` (pipeline edge, ceiling `automated`)

- Automation:
  1. *"Registration is triggered manually after evaluation"* (`absent→manual`, `manual_request`)
  2. *"Successfully evaluated models register automatically"* (`manual→automated`, `on_new_version`)
- Governance:
  1. *"Evaluation results are reviewed before registration"* (`none→partial_1`)
  2. *"Only models with a documented comparison to the prior version are registered"*
     (`partial_1→full`)

### Deployment — `deploy.serving` (execution component, ceiling `automated`)

- Automation (no trigger — *when* it deploys is decided by `e.orch_serving`):
  1. *"The endpoint is set up and configured on a server by hand"* (`absent→manual`)
  2. *"The endpoint runs on a managed serving platform — scaling, restarts, health checks
     automated"* (`manual→automated`)
- Governance:
  1. *"Deployment requires tech-lead approval"* (`none→partial_1`)
  2. *"Change-advisory-board review before production release"* (`partial_1→partial_2`)
  3. *"Regulated release process with rollback plan and audit log"* (`partial_2→full`)

### Deployment — `e.orch_serving` (pipeline edge, ceiling `automated`)

- Automation:
  1. *"Rollout to serving is triggered manually"* (`absent→manual`, `manual_request`)
  2. *"Rollout happens automatically on a new version"* (`manual→automated`, `on_new_version`)
- Governance (replacing today's `on_approval` trigger):
  1. *"Rollout requires tech-lead approval"* (`none→partial_1`)
  2. *"Rollout requires change-advisory-board approval"* (`partial_1→full`)

### Monitoring/Ops — `ops.alerting` (execution component, ceiling `automated`)

- Automation (no trigger — *when* an alert fires is decided by inbound edges `e.perf_alert` /
  `e.drift_alert`):
  1. *"Alerts are read off dashboards and reported by hand"* (`absent→manual`)
  2. *"Alerting runs on a managed monitoring tool that watches thresholds itself"*
     (`manual→automated`)
- Governance:
  1. *"Alert rules are documented and agreed with on-call"* (`none→partial_1`)
  2. *"An escalation path with defined ownership exists"* (`partial_1→partial_2`)
  3. *"SLA-backed on-call with mandatory post-incident review"* (`partial_2→full`)

### Monitoring/Ops — `e.alert_retrain` (feedback edge, ceiling `automated`)

- Automation:
  1. *"Retraining after an alert is triggered manually"* (`absent→manual`, `manual_request`)
  2. *"Retraining is triggered automatically on an alert"* (`manual→automated`, `on_alert`)
- Governance:
  1. *"Automatically triggered retraining is logged"* (`none→partial_1`)
  2. *"The retraining trigger requires review — no blind trust in automation"* (`partial_1→full`) —
     deliberately the counterweight to raw automation: heavy automation *without* this governance
     rung is a plausible future antipattern candidate ("unsupervised feedback loop").

## 5. How this produces genuinely different viable paths

Today, `RequirementObjects.json` expresses a goal as one `{target, level}` pair — one value, one
path. With two axes, a requirement can instead express **multiple equally valid target states**
via `graph_predicates.py`'s existing `any`/`all` combinators, extended with an `axis` field per
clause:

```jsonc
// before: a single target value
{"suggested": {"target": "req.kpi_definition", "level": 4}}

// after: two equally valid, stakeholder-aligned paths
{
  "holds": {
    "any": [
      {"component": "req.data_contracts", "axis": "automation", "op": "gte", "level": "automated"},
      {"component": "req.kpi_definition", "axis": "governance", "op": "gte", "level": "full"}
    ]
  }
}
```

Monica (pro-automation) drives the first branch, Emilia (pro-governance, "keep it manual but
disciplined") the second — both satisfy the same requirement, and the two paths are mechanically
different (different component, different axis), not two different phrasings of the same
`level: 4`. That is the actual answer to "only 1–2 viable paths": not more options per component,
but **requirements that recognize alternative, equally valid solutions across two axes and
multiple components**. This predicate-authoring work belongs to the content-migration phase
(§6, phase 4), but the `axis` field on predicate clauses must be added in phase 2 (domain layer).

## 6. Decisions log (2026-09-23)

1. **Capping**: only the automation axis caps pipeline flow (`EffectiveView`); governance affects
   metrics/requirements/patterns only, never `effective` levels. Keeps the capping fixed-point
   computation one-dimensional.
2. **Attributes**: mapped, curated options — no free dropdown over the schema `values` list.
3. **Option catalog**: authored individually per component/edge — no generic, reusable option-type
   catalog.
4. **Governance step count**: variable per target (`allowed_governance` as a subset of
   `none/partial_1/partial_2/full`, exactly like `allowed_automation`/today's `allowed_levels`).
5. **`broken` is never a player-facing option target.** Only backend/content (world events,
   challenge consequences, admin) may set a target to `broken`; both the option catalog and op
   validation exclude `broken` as a target of `source_kind="action_card"` ops.

## 7. Codebase impact inventory

**Backend, domain/rules:**
- `domain/graph.py`: split `Level` into `AutomationState` + `GovernanceLevel`;
  `Component`/`Edge.allowed_levels` → `allowed_automation` / `allowed_governance`;
  `GraphState.component_levels`/`edge_levels` → two dicts per axis; `trigger_for_level` operates
  on the automation axis only.
- `domain/graph_factory.py` (`validate_graph`): per-axis invariants instead of one; new check that
  no authored option targets `broken`.
- `domain/graph_predicates.py`: `{"component": id, "level": n}`-style clauses need an `axis` field
  (see §5).
- `application/graph_service/apply.py`: `_apply_one` enforces single-step moves;
  `resolve_degradation` degrades per axis; a guard clause rejects any
  `source_kind="action_card"` op that would set automation to `broken`.
- `application/graph_service/effective.py` (capping chain): only the automation axis caps flow
  (decision 1).
- `gameConfigSchemas/MlopsGraph.schema.json` and the matching UI schema.

**Content (`gameConfig/`):**
- `MlopsGraph.json`: 28 components + 31 edges each need `allowed_automation`,
  `allowed_governance`, plus the new per-target option lists. The largest content task in this
  rework.
- `MlopsPatterns.json`, `RequirementObjects.json`, `GameMetrics.json`: **79** occurrences of
  `"governed"`/level-4 references (`grep -rn governed gameConfig/*.json`) need a case-by-case
  remap to `automation=automated` or `governance=full` — not mechanically migratable, since
  "governed" today means both at once.

**Tests (backend):** `test_graph_core.py`, `test_graph_patterns.py`, `test_graph_refactor.py`,
`test_veto_breaker.py`, `test_simulation_pipeline.py` — all assume a single level axis.

**Frontend:**
- `game-ui/src/utils/stageCanvas.ts` (`LEVEL_LABELS`, `LEVEL_META`, `formatLevel`, `LevelMeter`):
  visualize two axes instead of one.
- `ComposeActionProposalModal.tsx`: extend `AtomicChange` with `axis`; option picker instead of a
  raw-value dropdown; slot cost stays 1:1 per axis step.
- `GraphDebug.tsx`, `PerformanceDashboard.tsx`: follow the payload shape change.

## 8. Migration phases

1. **Lock the concept** — this document.
2. **Domain-layer rework** (`graph.py`, `apply.py`, `graph_predicates.py`) with synthetic tests
   only. `gameConfig/` stays on the old shape during this phase — a load-time compatibility
   mapping (old `GOVERNED` → `automation=automated, governance=full`) keeps the container running
   while backend logic already targets the new axes.
3. **Content migration, `MlopsGraph.json`**: author the automation ceiling, governance ceiling and
   option catalog per component/edge, using §3–§4 as the template. Confirmed with the user that
   editing `gameConfig/MlopsGraph.json` directly is in scope for this work, not just documentation
   — do this once phase 2 lands so the new fields are actually read.
4. **Content migration, patterns/requirements/metrics** — the 79 occurrences from §7, plus
   authoring `any`/`axis` requirement predicates where a second path genuinely makes sense (not
   everywhere — some requirements correctly have only one sound solution). Also covers §10–§12:
   re-splitting `RequirementObjects.json` items into one-step moves, moving driver/trade_off
   sourcing to online-only, reassigning `GameProgression.json` phase power/interest per §11, and
   running the §12.4 completability check on every challenge.
5. **Frontend** — option UI in the compose modal, two-axis visualization, manual-workflow vs.
   automated-pipeline distinction on edges.
6. **Playtest pass**, update GDD/docs.

## 9. Explicitly out of scope (complexity guardrails)

- No generic option catalog with IDs, no inheritance mechanism between stages — the stage
  "flavors" in §3.4 are an authoring aid, not a code abstraction. `automation_options` /
  `governance_options` stay per-component/edge, spelled out in full.
- No third axis, no per-component special-purpose axes (e.g. "cost" or "speed" as their own
  dimension) — attributes go through the same option mechanism as automation/governance (§2.5),
  not a fourth axis.
- Governance ceiling defaults to `full` everywhere for now, rather than inventing 59 individual
  ceilings up front. Lowering specific targets is a playtest-driven balancing decision, not part
  of this structural design.

## 10. Stakeholder requirements and intel items must follow the graph rework

The graph is only half the mechanic. `RequirementObjects.json` (106 items: 40 `fact`, 33
`trade_off`, 22 `driver`, 11 `boundary`) is what turns graph targets into things the player
discovers and acts on, and it currently assumes the old one-axis, unlimited-jump model. It needs
to change alongside the graph, not after it — otherwise every driver still says "raise this to
level 4" and the whole rework is invisible to the player.

### 10.1 Intel items must shrink to match the one-step-per-slot rule

Today a `driver` item's `suggested: {target, level}` can name any level 0–4 in one shot — a
Monica-style "automate the KPI" item is one config object. Under §2.3 (1 slot = 1 step on one
axis), that single item can no longer be resolved as one op: reaching `automated` or `full` from
scratch takes several one-step ops in sequence. Concretely:

- `suggested.level` (an absolute value) becomes `suggested.axis` + `suggested.direction` (one step
  up on that axis) — an item asks for *one step*, never a destination level.
- A stakeholder's underlying want (e.g. "I want `data.ingestion` fully automated *and* strictly
  governed") is no longer one item; it's authored as a short sequence of one-step items, most of
  which surface across multiple challenges/phases rather than all at once — matching how the
  option catalog in §4 already exposes each target's progression as a list of discrete steps, not
  one dial. This is what naturally produces more, smaller items per stakeholder — not a headcount
  target to hit for its own sake, but the direct, mechanical consequence of §2.3.
- `trade_off` items (branch_x/branch_y, each with its own `ops`) get the same treatment: each
  branch's `ops` list must resolve to legal single-step moves, so a branch that currently jumps a
  target from `absent` to `governed` becomes a branch that advances it by one step on one axis,
  with the "bigger ask" expressed as a *harder* concession (§10.3) rather than a bigger jump.

### 10.2 Offline artifacts currently make stakeholder gathering optional

`OfflineIntelArtifacts.json` has exactly 106 artifacts, one per `RequirementObjects.json` entry —
verified by id: every requirement has a matching artifact and vice versa
(`requirement_id`/`id` sets are identical, zero on either side). That means **100% of the game's
intel is already obtainable by reading artifacts alone**, before ever talking to a stakeholder.
Online, dialogue-based gathering (`application/online_intel_service`, the pitch/dossier flow) adds
nothing a patient artifact-reader doesn't already have. This is the direct cause of "the intel from
artifacts is already enough to pass the challenge" — it isn't a balancing problem on top of a
sound structure, the structure itself guarantees it.

### 10.3 Proposed fix: only descriptive intel is offline; actionable intel is online-only

Split by function, not by re-inventing the type taxonomy:

- **`fact`** items (*"how the system is, nobody's wish"*, `asserts`, no `ops`) stay available via
  offline artifacts — they're context, not action, and reading them ahead of time is exactly the
  kind of preparation the offline phase should reward.
- **`driver`** and **`trade_off`** items (the ones that resolve into `ops`/`suggested` a card can
  actually use) become **online-only** — obtainable only through stakeholder dialogue/pitch
  debate. An artifact may still *reference* that a driver exists (flavor, foreshadowing) but must
  not hand over the concrete `suggested`/`ops` payload the way it does today.
- **`boundary`** items are mixed in the current schema (some carry only `holds`, some also carry
  `ops`) — decide per item: a boundary with no `ops` (a pure constraint check) can stay offline
  like a fact; one that carries `ops` follows the driver/trade_off rule and goes online-only.

Net effect: reading every artifact in a challenge still tells the player what's going on and who
wants what, but building an actual action card requires having *talked to* the stakeholders whose
drivers/trade-offs it's built from. This is a structural fix, not a numbers-tuning one — it holds
regardless of how many items end up per stakeholder after §10.1.

## 11. Power/interest quadrant coverage

### 11.1 Diagnosis

`Phase.stakeholders: list[PhaseStakeholder]` (`domain/Phase.py:8-12`) assigns each stakeholder a
`power`/`interest` pair (`'high'`/`'low'`) per phase, authored in `GameProgression.json`. Checked
all six phases:

| Phase | high/high ("Manage closely") | low/high ("Inform") | high/low ("Keep satisfied") | low/low ("Monitor") |
|---|---|---|---|---|
| 0 Introduction | efficiency_emilia | model_monica | — | — |
| 1 Requirement Engineering | requirements_reuben | efficiency_emilia | — | automation_alex, reliability_ruth |
| 2 Data Engineering | reliability_ruth | data_dave | — | requirements_reuben, efficiency_emilia |
| 3 Model Engineering | model_monica | data_dave | — | requirements_reuben, efficiency_emilia |
| 4 Model Deployment | automation_alex | requirements_reuben | — | reliability_ruth, efficiency_emilia |
| 5 Monitoring/Usage | efficiency_emilia | reliability_ruth | — | model_monica, requirements_reuben |

**Zero of six phases has a high-power/low-interest stakeholder** — exactly the quadrant the
game's own glossary calls out as the dangerous one: *"High power, low interest is the dangerous
quadrant: they are not paying attention until they veto you"* (`gameConfig/MLOpsGlossary.json`,
`power_interest`). Every phase's high-power stakeholder is also its most interested one, so the
player always knows exactly who to watch — there's no stakeholder who looks safe to ignore and
then vetoes anyway.

### 11.2 Rule

Every phase's stakeholder set should cover all four quadrants at least once (one stakeholder per
quadrant is enough — this isn't about adding more stakeholders, the existing four-per-phase roster
already has the headcount). Phase 0 (Introduction, two stakeholders only) is a plausible exception
— a tutorial phase arguably doesn't need the full matrix — flagged here rather than decided.

### 11.3 Proposed reassignment (phases 1–5, minimal diff: flip one existing low/low to high/low)

| Phase | Flip to high/low | Why (proposed, open to correction) |
|---|---|---|
| 1 Requirement Engineering | `automation_alex` | controls the CI/CD gate downstream; has real leverage even while requirements-phase specifics don't interest him yet |
| 2 Data Engineering | `requirements_reuben` | compliance/data-governance authority over data handling, without being hands-on in data engineering day to day |
| 3 Model Engineering | `efficiency_emilia` | budget holder; doesn't care about modeling internals but cares if it blows the budget |
| 4 Model Deployment | `efficiency_emilia` | same budget leverage over release cost/timeline |
| 5 Monitoring/Usage | `requirements_reuben` | audit/compliance interest in monitoring trails without being an active on-call participant |

This is a one-field content edit per phase (`GameProgression.json`, flip `power` from `low` to
`high` on the named entry) — no new stakeholders, no schema change. The specific choice per phase
is a narrative call, not a mechanical derivation; treat the table as a starting proposal.

## 12. Completability guarantee: every challenge must have a no-veto branch

New invariant, raised directly in response to §10–§11: making high-power stakeholders harder to
read (via §11) and intel harder to assemble (via §10) must never produce a challenge that is
**unwinnable outright** — there must always be at least one legal card the player could build that
keeps every high-power stakeholder present above veto.

### 12.1 Statement

For every challenge, at the *worst-case* graph state under which that challenge can be scheduled,
there must exist at least one combination of that challenge's own intel items — legal under the
slot limit and the new per-step cost model (§2.3) — that keeps every high-power stakeholder in the
challenge's phase (`Phase.stakeholders` with `power: "high"`, §11) at or above the veto threshold
(`VETO_THRESHOLD = 0.4`, `pitch_debate_service/scoring.py:24`).

### 12.2 What "worst case" means

`Challenge.preconditions` / `Challenge.excluded_if` (`domain/Challenge.py:34-35`) are predicates
over the graph, evaluated by `scheduler.py`'s eligibility check — the same `graph_predicates.py`
machinery used everywhere else in the graph. A challenge's eligible set is generally a *range* of
graph states (a precondition rarely pins down the whole graph, only the parts it cares about), so
there is no single worst state in general. The practical approximation for content authors: assume
the **minimum graph** that still satisfies the precondition — every target the precondition
constrains sits at the lowest level that satisfies it, every other target sits at whatever the
lowest level reachable by that point in the game is (its `initial_level`/ceiling floor, not
whatever the current playthrough happens to have built). If a safe branch exists there, it exists
in every less-adversarial state the challenge could actually be scheduled from.

### 12.3 Authoring rule

Each challenge's authored intel items must include, for every high-power stakeholder in its phase,
at least one driver/trade-off (or a ≤3-slot combination of them) that stakeholder would accept —
either a driver they themselves proposed, or a trade-off branch whose `concedes` falls within what
they'd tolerate (mirroring the existing `concedes.accepts_max_level` mechanic, generalized to
whichever axis the branch touches). This is a content checklist, not a new mechanic: it constrains
which items get written for a challenge, not how the engine works.

### 12.4 Proposed automated check

A regression test analogous to `test_graph_patterns.py::test_patterns_cover_every_component_and_pipeline_edge`
(existing coverage-style test, same spirit): for every challenge, build the minimum graph from
§12.2, enumerate ≤3-item combinations of that challenge's own driver/trade-off items, and assert at
least one combination scores every high-power stakeholder's `demand_alignment`
(`pitch_debate_service/scoring.py`) at or above `VETO_THRESHOLD`. This belongs in the
content-migration phase (§13, phase 4) alongside the `any`/`axis` predicate work from §5, since
both operate on the same authored intel items.

## 13. Next steps

With the decisions in §6, the ceiling/option design in §3–§4, and the intel/stakeholder rules in
§10–§12, the data model and content-authoring rules are specified enough to start phase 2: concrete
Pydantic models for `AutomationState`, `GovernanceLevel`, the new `Option` config entity
(component/edge, axis, `from_level`/`to_level`, optional trigger, name/description), and the
updated `GraphOp`/`GraphState` fields. §10–§12 don't block phase 2 (they land in the
content-migration phases, §8), but they do change what "done" means for phase 4: not just
re-authoring 106 items onto the new axes, but re-splitting them per §10.1, re-sourcing them per
§10.3, and passing the §12.4 completability check.
