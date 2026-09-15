# Intel Item and Pitch Debate Redesign

## 1. Overview and Core Philosophy

### 1.1 Serious Game Context
The project is a serious game for stakeholder engagement in MLOps. Players act as a Project Manager navigating technical, architectural, and organizational alignment across diverse stakeholders (Data Engineers, Data Scientists, Compliance Officers, Product Owners, Site Reliability Engineers).

The foundation of the game is the **MLOps Environment Graph**:
- **Graph Topology**: Components (e.g., Feature Store, Data Validation, Model Registry, CI/CD, Alerting) and directed edges (data flows, trigger flows, deployment pipelines).
- **State & Maturity**: Components and edges hold nominal and effective levels (`broken`, `absent`, `manual`, `automated`, `governed`).
- **Dependencies & Capping**: Downstream components are constrained by the maturity and health of upstream components.
- **Grounding of Stakeholder Demands**: Demands are no longer abstract tags or arbitrary dialogue choices—they are concrete proposed mutations or invariant constraints on the MLOps graph.

### 1.2 Core Redesign Objectives
1. **Drop Convincer Archetypes completely**: Archetype guessing ("Trial Balloon", "How to Convince", framing profiles) is removed. The game focuses purely on technical and strategic alignment through MLOps graph operations and stakeholder intel.
2. **Re-ground the 4 Intel Categories**:
   - **Driver**: Positive demand ("I want $X$"). Triggers objection if missing.
   - **Trade-Off**: Disjunctive compromise ("I want $X$, but will drop it if $Y$ is fulfilled"). Satisfied if **either** $X$ or $Y$ is met.
   - **Boundary**: Negative constraint ("$X$ must NOT happen"). Triggers objection/veto if violated.
   - **Fact**: Observed graph reality. Cannot be slotted into an action card, but unlocks upstream dependency upgrades.
3. **Streamline Engagement Cards**: Revert the V2 expansion and establish a focused, component-directed roster.
4. **Drastically Streamline Pitch Debate**: Eliminate complex dialogue mini-games. Pitching is an iterative negotiation where players modify their card, receive one-round stakeholder feedback, and decide whether to re-amend, gather more intel, or commit to simulation.

---

## 2. Revised Intel Item Taxonomy & Semantics

The four categories remain: **Driver**, **Trade-Off**, **Boundary**, and **Fact**.

```
+---------------------------------------------------------------------------------------------------+
|                                      Intel Item Categories                                        |
+-------------------+--------------------------------+-----------------------+----------------------+
|      Driver       |           Trade-Off            |       Boundary        |         Fact         |
|  "I want X done"  | "I want X, but waive it for Y" | "X must NOT happen"   | "X is currently Y in |
|                   |                                |                       | the environment"     |
+-------------------+--------------------------------+-----------------------+----------------------+
| Single graph      | Dual graph demand              | Negative constraint / | Current graph state  |
| change demand     | (Disjunctive: X OR Y)          | invariant predicate   | observation          |
+-------------------+--------------------------------+-----------------------+----------------------+
| Slotted in card   | Slotted in card                | Slotted or unslotted  | Cannot be slotted;   |
|                   |                                | (checked globally)    | informs dependencies |
+-------------------+--------------------------------+-----------------------+----------------------+
| Objection if NOT  | Objection if NEITHER           | Objection / Veto      | Feasibility preview; |
| in proposal       | X nor Y is satisfied           | if violated           | unlocks pre-reqs     |
+-------------------+--------------------------------+-----------------------+----------------------+
```

### 2.1 Driver (Positive Demand)
- **Formulation**: *"I want [Component X] to be automated / improved."*
- **Role in Card Building**: Slotted into the Action Card to apply its graph operation.
- **Pitch Objection Trigger**: If a stakeholder holds an active Driver whose target operation is **not** covered by the proposal, that stakeholder raises an objection.

### 2.2 Trade-Off (Disjunctive Compromise)
- **Problem with Previous Design**: Framed unnaturally as soft demands or vague exchanges, making them trivially obvious or mechanically ambiguous.
- **New Formulation**: 
  > *"I have demand X, but I am willing to drop it if demand Y is fulfilled."*
- **Mechanics**:
  - Encapsulates **two distinct demands** ($X$ and $Y$).
  - **Fulfillment Rule**: Satisfied if **at least one** of the two demands is implemented in the Action Card ($X \lor Y$).
  - **Dossier & UI Presentation**: Rendered as a **single unified intel item** in the dossier and picker, with both options ($X$ and $Y$) clearly visible.
  - **Player Agency**: The player chooses which branch ($X$ or $Y$) to fulfill based on their budget, architecture plans, and conflicts with other stakeholders.
  - **Pitch Objection Trigger**: Raises an objection **only if neither** $X$ nor $Y$ is satisfied.

### 2.3 Boundary (Negative Constraint / Red Line)
- **Formulation**: *"I do not want [Change X / Condition X] to occur under any circumstances."*
- **Relationship to Driver**: The strict inverse of a Driver. Where a Driver demands a positive change, a Boundary demands that a specific state, configuration, or undesirable change does *not* take place.
- **Pitch Objection Trigger**: Evaluated against the projected graph state. If the Action Card causes the prohibited condition, the owning stakeholder raises a hard objection or exercises their **Veto** (high-power stakeholder).

### 2.4 Fact (System Observation & Dependency Enabler)
- **Formulation**: *"Component X is currently manual, and incoming edge Y has no automated trigger."*
- **Card Building Restriction**: Facts **cannot** be slotted into an Action Card. They represent passive observations, not actionable proposals.
- **Role in Dependencies and Capping**:
  - In the MLOps graph, a downstream component's effective maturity is capped by the maturity of its upstream dependencies (e.g., automated Data Validation cannot deliver value if Data Ingestion is absent or manual).
  - **Without Facts**: If the player does not hold intel about upstream predecessors, the builder shows consequences as uncertain / hidden (`?`).
  - **With Facts**: Once the player discovers Facts revealing an upstream bottleneck, the card builder automatically provides the option to bundle the prerequisite upstream upgrade into the proposal alongside the target component.

---

## 3. Online Intel Gathering & Engagement Cards

The V2 engagement cards system (`engagement-cards-v2.md`) is rolled back in favor of a clean, directed model.

### 3.1 Card Roster

| Card | Target | Cost | Turns / Dialogue | Reveal / Effect |
|---|---|---|---|---|
| **Verify Intel Item** | 1 unverified held note | 5 | Direct confirmation | Verifies note classification in dossier; corrects if misclassified. |
| **Team Sync-Up** | Whole room (all active stakeholders) | 4 (1x/phase) | 1 turn, 4 dialogue options (top 4 affected MLOps components) | Each stakeholder in the room reveals 1 intel item related to the selected component. Cost aligned with 1-to-1 Meeting (4 tokens). |
| **1-to-1 Meeting** | 1 stakeholder | 4 | 3 interaction turns: 3 component options + 1 "most important intel item" option per turn | Stakeholder reveals 1 matching intel item per turn. |
| **Probe Requirements** | 1 stakeholder | 3 | 1 turn, 4 dialogue options (4 MLOps components) | Stakeholder reveals 1 intel item related to the selected component. |
| **Ask Generic Question** | 1 stakeholder | 1 | 1 turn, open-ended | Stakeholder reveals 1 random undiscovered intel item. |
| **Investigate Component** | 1 MLOps graph component | 2 | Component inspector | Discovers/reveals 1 undiscovered Fact intel item about that component. |

### 3.2 Dynamic Component Dialogue Generation
For cards that present component dialogue options (**Team Sync-Up**, **1-to-1 Meeting**, **Probe Requirements**):
- The backend inspects all undiscovered/relevant intel items across stakeholders in the current phase.
- It identifies the **MLOps graph components most frequently referenced** in those items.
- It returns these components as natural dialogue prompts to the frontend (e.g., *"What is your view on data validation?"*).
- This allows players to steer intel gathering deliberately toward the technical subsystems they plan to address.

---

## 4. Action Card Building

1. **Slottable Items**:
   - Only stance items (**Driver**, **Trade-Off**, **Boundary**) can be added to the Action Card slots.
   - **Facts** are excluded from card slots.
2. **Upstream Dependency Bundling**:
   - If a slotted Driver/Trade-off targets a component that is capped by an upstream predecessor, the builder checks player knowledge.
   - If the player holds the Fact describing the upstream state, the builder exposes a bundled upgrade option (e.g., *"Upgrade Data Ingestion to Level 3 alongside Data Validation"*).
3. **No Framing / Convincer Slots**:
   - The card consists purely of graph mutations and constraint commitments. No archetype framing slots exist.

---

## 5. Streamlined Pitch Debate Phase

### 5.1 Elimination of Debate Dialogue Mini-Game
- The previous debate dialogue options (*Reframe*, *Stonewall*, *Emergency Addendum*, *Concede Correction*) are **completely removed**.
- Convincer archetypes and linguistic framing are eliminated.

### 5.2 Negotiation Flow
The Pitch Debate becomes an iterative, player-driven review:

```
[ Build Action Card ]
        |
        v
[ Pitch Proposal ] --------------------------------------------+
        |                                                      |
        v                                                      |
[ Stakeholders React Once ]                                     |
  - Unaddressed Drivers -> Objection                           |
  - Unaddressed Trade-offs (neither X nor Y) -> Objection       |
  - Violated Boundaries -> Hard Objection / Veto Warning        |
  - Misclassified items -> Refutation + Emotion Malus          |
  - Feedback posted as text message in conversation history    |
        |                                                      |
        +-----------------------+----------------------+       |
        |                       |                      |       |
        v                       v                      v       |
[ Modify Action Card ]   [ Play Engagement ]   [ Commit /      |
  - Add/remove items       Cards (if tokens      Proceed ]     |
  - Bundle upstream        remain)                 |           |
        |                       |                  v           |
        +-----------------------+          [ Final Decision ]  |
                                             - Pass            |
                                             - Soft Pass       |
                                             - Veto            |
```

1. **Initial Pitch**:
   - The player submits their constructed Action Card.
2. **Single-Round Stakeholder Feedback**:
   - Each stakeholder in the room evaluates the proposal deterministically against their held intel items.
   - Each stakeholder outputs a concise text reaction in the meeting chat:
     - **Drivers**: Calls out missing features/upgrades they expect.
     - **Trade-Offs**: Notes dissatisfaction only if neither branch ($X$ nor $Y$) was addressed.
     - **Boundaries**: Warns of crossed red lines.
     - **Misclassified Items**: Triggers refutations and emotional penalties (see Section 6).
3. **Player Choices During the Meeting**:
   - **Edit Action Card**: The player can update the card (e.g., slotting an amendment or switching a trade-off branch).
   - **Gather More Intel**: The player can play remaining Engagement Cards if they have Attention Tokens left.
   - **Commit / Proceed**: The player can finalize the pitch at any time.
4. **Outcome (Commit)**:
   - If any high-power stakeholder has a violated Boundary or critically low buy-in: **VETO**.
   - If low-power stakeholders have unaddressed objections: **SOFT PASS** (with penalties/friction).
   - If all critical constraints and drivers are met: **PASS**.

---

## 6. Misclassified Items Handling & Concrete Semantics

When an Action Card is pitched that incorporates **misclassified intel items**:

### 6.1 Pitch Debate Reaction & Consequences
1. **Negative Stakeholder Reaction & Emotional Malus**:
   - The stakeholder to whom the misclassified item belongs reacts negatively.
   - Their **emotion / mood values are penalized** (they become upset, irritated, or angry).
2. **Refutation & Auto-Correction**:
   - The stakeholder **refutes** the player's categorization directly in their feedback message (e.g., *"You completely misunderstood my position on this!"*).
   - The item is **automatically updated** to its correct ground-truth classification in the player's dossier.
   - The Action Card is **automatically adjusted** to reflect the corrected item, which alters the card's effective graph operations and predicates.

### 6.2 Semantic Behavior of Specific Misclassifications

| Misclassification | Resulting In-Game Interpretation |
|---|---|
| **Trade-Off tagged as Driver** | **Treated as a Combined Requirement**: The player loses the disjunctive flexibility ($X \lor Y$). Both trade-off demands are treated as one combined requirement that must be fulfilled together, rather than giving the player the choice of either $X$ or $Y$. |
| **Driver tagged as Boundary** | **Meaning Inversion**: A positive demand is flipped into a negative constraint. For example, if the stakeholder wanted *"Automate model evaluation"*, tagging it as a Boundary interprets it as *"Model evaluation must NOT be automated"*. The card may then actively violate other requirements or falsely flag conflicts. |
| **Boundary tagged as Driver** | **Constraint Turned into Optional Feature**: A strict red line / invariant is misread as a nice-to-have goal, failing to safeguard against vetoes if violated elsewhere. |
| **Fact misclassified as Stance Item** | **Invalid Action**: A passive observation of system state cannot be executed as an action on the graph; stakeholder rejects the action proposal as nonsensical. |

---

## 7. Token Economics Summary

- **Verify Intel Item**: 5 tokens
- **Team Sync-Up**: 4 tokens (1x per phase; aligned with 1-to-1 Meeting)
- **1-to-1 Meeting**: 4 tokens (3 interaction rounds)
- **Probe Requirements**: 3 tokens (1 stakeholder, 4 component options)
- **Investigate Component**: 2 tokens (inspects Fact for a component)
- **Ask Generic Question**: 1 token (1 random undiscovered item)
