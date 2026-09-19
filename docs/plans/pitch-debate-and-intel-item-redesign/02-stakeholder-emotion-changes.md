# 02 Stakeholder Emotion Changes & Dynamics

## 1. Overview and Design Objectives

Stakeholder emotions in the MLOps Serious Game model the human and political friction of technical decisions. Rather than treating stakeholders as static scoring bots, the emotion system captures dynamic psychological reactions across three major game events:
1. **The Pitch**: How stakeholders react when an Action Card is proposed and negotiated in the meeting room.
2. **Vetoes & Rejections**: How stakeholders react when proposals violate hard limits or stall out in stalemate.
3. **The Simulation**: How stakeholders react post-commit when graph mutations and pipeline runs succeed, stall, or cause regressions.

### 1.1 The Seven Underlying Emotion Dimensions
Every stakeholder maintains a continuous state vector $\mathbf{e} \in [0.0, 1.0]^7$:
- **`trust`**: Faith in team leadership, PM competence, and technical integrity.
- **`interest`**: Level of engagement and curiosity in project outcomes.
- **`stress`**: Psychological strain, anxiety, and operational pressure.
- **`confidence`**: Self-assurance in decisions and project trajectory.
- **`perceived_risk`**: Subjective vulnerability to compliance, stability, or model failures.
- **`sense_of_control`**: Feeling of agency and procedural influence over outcomes.
- **`fairness`**: Perception of equity, transparency, and respect for their agenda.

### 1.2 Non-Uniform Dimensional Shifts
A key requirement is that **emotion dimensions must not shift uniformly**. Different events activate distinct psychological axes:
- A violated constraint impacts `perceived_risk` and `trust`, not just a flat emotion drop.
- An unaddressed driver impacts `fairness` and `sense_of_control`.
- A misclassified fact erodes `confidence` in the PM's technical competence.

These differential movements drive the emergent **Emotional States** (`angry`, `anxious`, `frustrated`, `enthusiastic`, `skeptical`, `relieved`, `overwhelmed`, `apathetic`, `neutral`).

---

## 2. Card Pitching Emotion Formula

When an Action Card is pitched, every active stakeholder in the room computes an emotional response based on the alignment between the card's operations and their personal intel items, modulated by their organizational **Power** and **Interest**.

### 2.1 Alignment Score $\text{align}(st) \in [-1.0, 1.0]$

Let $\mathcal{I}(st)$ be the set of active intel items belonging to stakeholder $st$:
- $\mathcal{D}(st)$: Set of Drivers
- $\mathcal{T}(st)$: Set of Trade-Offs (each having demands $X_k$ and $Y_k$)
- $\mathcal{B}(st)$: Set of Boundaries (negative constraints / predicates)
### 2.1 Continuous Demand Alignment Score $\text{align}_{\text{demand}}(st) \in [-1.0, 1.0]$

Stakeholder demand fulfillment is **continuous rather than binary (digital)**: intel items are composed of one or more primitive (canonical, indivisible) atomic graph operations. A proposal can therefore partially satisfy an item by covering a subset of its atoms.

Let $\mathcal{C}_{\text{atoms}}$ be the set of atomic graph operations enacted by the proposed Action Card $\mathcal{C}$.
For any item demand $o$, let $\text{atoms}(o)$ be its constituent set of atomic operations.

We evaluate continuous positive fulfillment $f \in [0.0, 1.0]$:

1. **Driver Continuous Fulfillment** $f(d) \in [0.0, 1.0]$:
   The fraction of the driver's required atomic operations covered by the proposal:
   $$f(d) = \frac{|\text{atoms}(d) \cap \mathcal{C}_{\text{atoms}}|}{|\text{atoms}(d)|}$$
   *(If $d$ has 2 atomic operations and the card covers 1, $f(d) = 0.5$).*

2. **Trade-Off Continuous Fulfillment** $f(t) \in [0.0, 1.0]$:
   Each trade-off encapsulates two alternative demand branches, $X_t$ and $Y_t$. Each branch evaluates its fractional coverage:
   $$f(X_t) = \frac{|\text{atoms}(X_t) \cap \mathcal{C}_{\text{atoms}}|}{|\text{atoms}(X_t)|}, \qquad f(Y_t) = \frac{|\text{atoms}(Y_t) \cap \mathcal{C}_{\text{atoms}}|}{|\text{atoms}(Y_t)|}$$
   Because a Trade-Off represents a disjunctive compromise (*"I want $X$, but will drop it if $Y$ is fulfilled"*), its fulfillment is governed by whichever branch the player addressed most effectively:
   $$f(t) = \max\left( f(X_t), \; f(Y_t) \right) \in [0.0, 1.0]$$

3. **Net Demand Alignment Ratio $\text{align}_{\text{demand}}(st)$**:
   Each item's fractional score $f \in [0.0, 1.0]$ maps linearly to $[-1.0, +1.0]$ via $2 f - 1$:
   - $f = 1.0 \implies +1.0$ (fully satisfied)
   - $f = 0.5 \implies 0.0$ (partially satisfied / neutral)
   - $f = 0.0 \implies -1.0$ (completely unaddressed)

   $$\text{align}_{\text{demand}}(st) = \frac{\sum_{d \in \mathcal{D}(st)} (2 f(d) - 1) + \sum_{t \in \mathcal{T}(st)} (2 f(t) - 1)}{|\mathcal{D}(st)| + |\mathcal{T}(st)|}$$

   - Fully satisfied wishlist: $\text{align}_{\text{demand}}(st) = +1.0$.
   - Fully neglected wishlist: $\text{align}_{\text{demand}}(st) = -1.0$.
   - Proportional partial progress: continuous spectrum across $[-1.0, +1.0]$.
   - If $|\mathcal{D}(st)| + |\mathcal{T}(st)| = 0$, $\text{align}_{\text{demand}}(st) = 0.0$.

### 2.2 Sensitivity Modulation by Power and Interest

A stakeholder's reaction magnitude is scaled by their organizational footprint:
- $\text{power}(st) \in [0.0, 1.0]$: Higher power makes stakeholders more demanding and assertive.
- $\text{interest}(st) \in [0.0, 1.0]$: Higher interest amplifies emotional reactivity; low interest dampens it toward apathy.

We define the **Reactivity Multiplier** $\mu(st) \in [0.0, 1.0]$:

$$\mu(st) = 0.5 \cdot \text{power}(st) + 0.5 \cdot \text{interest}(st)$$

- If $\text{power} = 1.0$ and $\text{interest} = 1.0$, the formula reaches maximum sensitivity: $\mu(st) = 1.0$.
- If $\text{power} = 0.0$ and $\text{interest} = 0.0$, reactivity is extinguished: $\mu(st) = 0.0$.
- In the campaign configuration (`GameProgression.json`), qualitative discrete presets map to:
  - `"high"` $\to 0.8$
  - `"low"` $\to 0.3$
  Yielding $\mu(st) \in [0.3, 0.8]$ for standard story stakeholders (e.g., $\mu = 0.8$ for high/high stakeholders like Reuben or Emilia, and $\mu = 0.3$ for low/low stakeholders like Ruth in Phase 1).

### 2.3 Decoupled Boundary Breach Impact
Boundaries represent invariant constraints ("must NOT happen" / safety limits) rather than tradeable goals. A boundary is not an item to be averaged into a percentage; crossing a red line is an acute crisis.

If proposal $\mathcal{C}$ violates $n_{\text{breach}}(st)$ boundaries belonging to stakeholder $st$, an acute **Constraint Breach Vector** $\mathbf{b}$ is applied alongside the proposal deltas:

$$\mathbf{b} = \begin{bmatrix}
\text{perceived risk} & +0.25 \\
\text{stress} & +0.20 \\
\text{trust} & -0.20 \\
\text{sense of control} & -0.15
\end{bmatrix}$$

### 2.4 Total Dimensional Pitch Deltas
The net delta applied to each dimension $k$ during a pitch evaluation is:

$$\Delta e_k(st) = \mu(st) \cdot \left[ \text{align}_{\text{demand}}(st) \cdot w_k \;+\; n_{\text{breach}}(st) \cdot b_k \right]$$

where $w_k$ defines the characteristic sensitivity vector for demand alignment:

| Dimension $k$ | Weight $w_k$ | Description of Impact |
|---|---|---|
| **`fairness`** | $+0.28$ | Primary sense of equity; surges when demands are respected, plunges when neglected. |
| **`trust`** | $+0.25$ | Faith in PM leadership and commitments. |
| **`sense_of_control`** | $+0.25$ | Rises when their agenda is adopted; collapses when neglected. |
| **`stress`** | $-0.22$ | Relieved when alignment is high; surges when conflicts arise. |
| **`perceived_risk`** | $-0.20$ | Drops when proposals show careful alignment; rises under uncertainty. |
| **`confidence`** | $+0.18$ | Boost in self-assurance and project viability. |
| **`interest`** | $+0.10$ | Positive alignment reinforces engagement; chronic neglect leads to apathy. |

### 2.5 Dynamic Computation of Dimensional Sensitivity $w_k(st, \mathcal{C})$

To ensure stakeholders feel authentically distinct without causing runaway compounding or negative death spirals, $w_k$ is computed via bounded additive modulation

$$w_k(st, \mathcal{C}) = w_{\text{base}, k} \cdot \text{clamp}\left( 1.0 + \Delta \alpha_{\text{role}}(st, k) + \Delta \beta_{\text{subsystem}}(\mathcal{I}_{st}, k) + \Delta \gamma_{\text{equity}}(st, \mathcal{C}, k), \; 0.75, \; 1.50 \right)$$

> [!IMPORTANT]
> **Anti-Death-Spiral Guarantee**: Raw multiplication ($1.6 \times 1.5 \times 1.5 \approx 3.6$) would cause runaway volatility where a single card pitch drops emotions by $-0.8$, causing unrecoverable death spirals. Clamping the combined modifier in $[0.75, 1.50]$ ensures stakeholders are noticeably distinct (up to $+50\%$ heightened sensitivity on their core concerns) while guaranteeing that **positive accommodation symmetrically restores baseline**, allowing players to recover stakeholder trust through thoughtful amendments.

#### 1. Base Sensitivity Vector $w_{\text{base}, k}$
Provides the baseline sign and calibrated magnitude for each dimension:

| Dimension $k$ | Base $w_{\text{base}, k}$ | Primary Emotional Function |
|---|---|---|
| **`fairness`** | $+0.28$ | Equity and procedural justice in resource allocation. |
| **`trust`** | $+0.25$ | Confidence in PM leadership and fulfilled commitments. |
| **`sense of control`** | $+0.25$ | Autonomy and influence over architecture decisions. |
| **`stress`** | $-0.22$ | Relieved when demands are addressed; surges when conflicts escalate. |
| **`perceived risk`** | $-0.20$ | Drops under sound technical alignment; surges under uncertainty. |
| **`confidence`** | $+0.18$ | Assurance in solution feasibility and model quality. |
| **`interest`** | $+0.10$ | Curiosity and investment in the initiative. |

#### 2. Role Psychological Disposition $\alpha_{\text{role}}(st, k)$ (Encoded in Game Config)
Rather than hardcoding role sensitivities in application logic, $\alpha_{\text{role}}(st, k)$ is encoded directly in the game configuration (`gameConfig/GameStakeholders.json`) under each stakeholder's `emotion_sensitivities` field. Any unlisted dimension defaults to $1.0$.

```json
{
  "id": "reliability_ruth",
  "name": "Reliability Ruth",
  "metric_id": "reliability",
  "emotion_sensitivities": {
    "stress": 1.6,
    "perceived_risk": 1.5,
    "trust": 1.0,
    "fairness": 1.0,
    "sense_of_control": 1.0,
    "confidence": 1.0,
    "interest": 1.0
  }
}
```

Campaign Stakeholder Sensitivities encoded in `GameStakeholders.json`:
- **Reliability / SRE (`reliability_ruth`)**: `stress`: $1.6$, `perceived_risk`: $1.5$ (operational & on-call anxiety).
- **Compliance & Governance (`requirements_reuben`, `david_kimmel`)**: `perceived_risk`: $1.7$, `fairness`: $1.4$ (audit & legal exposure).
- **Data Scientist / Modeler (`model_monica`)**: `confidence`: $1.6$, `sense_of_control`: $1.5$ (model quality & experimentation agency).
- **Data Engineer (`data_dave`)**: `sense_of_control`: $1.5$, `stress`: $1.3$ (data debt & pipeline ownership).
- **Business Manager / Efficiency (`efficiency_emilia`)**: `fairness`: $1.6$, `trust`: $1.4$ (budget equity & delivery reliability).

*(Note: When implementing this config change, `gameConfigSchemas/GameStakeholdersSchema.json` and `gameConfigUISchemas/GameStakeholdersUISchema.json` must be updated accordingly).*

#### 3. Technical Subsystem Domain Focus $\beta_{\text{subsystem}}(\mathcal{I}_{st}, k)$
The technical components touched by the stakeholder's demands scale specific emotional axes:
- **Governance & Compliance Components** (`gov.audit`, `gov.iam`, `gov.model_cards`, `data.contracts`): Amplifies **`perceived risk`** $(+0.5)$ and **`trust`** $(+0.4)$.
- **Operations & Alerting Components** (`ops.alerting`, `ops.observability`, `ops.rollback`): Amplifies **`stress`** $(+0.6)$ and **`perceived risk`** $(+0.4)$.
- **Automation & Pipeline Components** (`deploy.cicd`, `deploy.orchestration`, `data.ingestion`): Boosts **`stress`** reduction $(+0.5)$ and **`sense of control`** $(+0.4)$.
- **Model Training & Experimentation** (`model.hpo`, `model.evaluation`, `data.feature_store`): Boosts **`confidence`** $(+0.5)$ and **`interest`** $(+0.3)$.

#### 4. Procedural Equity Multiplier $\gamma_{\text{equity}}(st, \mathcal{C}, k)$
Stakeholders evaluate their treatment relative to other stakeholders at the table:

$$\text{slot share}(st) = \frac{|\mathcal{C}_{\text{atoms}} \cap \text{atoms}(\mathcal{I}_{st})|}{|\mathcal{C}_{\text{atoms}}|}, \qquad \text{demand share}(st) = \frac{|\text{atoms}(\mathcal{I}_{st})|}{\sum_{s \in \text{Room}} |\text{atoms}(\mathcal{I}_s)|}$$

If stakeholder $st$ has a high demand share but receives 0 slots while a peer receives 100%, perceived favoritism amplifies the fairness and trust drop:

$$\gamma_{\text{equity}}(st, \text{fairness}) = 1.0 + \max\left(0, \;\text{demand share}(st) - \text{slot share}(st)\right) \times 1.5$$

*(All other dimensions default to $\gamma_{\text{equity}} = 1.0$).*

---

## 3. Misclassified Items: Category-Specific Constant Malus

When a player pitches an Action Card that contains or relies on an incorrectly classified intel item, the owning stakeholder detects the error and **refutes** it. This refutation applies an immediate, **constant malus vector** $\mathbf{m}_{\text{cat}}$ tailored to the specific nature of the category mistake:

```
Player pitches card with misclassified item
                 |
                 v
   Stakeholder refutes classification
                 |
                 +---> 1. Emotion malus vector applied (immediate)
                 +---> 2. Item auto-corrected to ground truth in dossier
                 +---> 3. Action card adapted to corrected semantics
```

### 3.1 Constant Malus Vectors by Intel Category

| Misclassification Case | Emotional Reaction Rationale | Constant Malus Vector $\mathbf{m}$ |
|---|---|---|
| **Trade-Off tagged as Driver** | Stakeholder feels forced: *"I gave you an 'either/or' compromise, and you're treating both as mandatory or ignoring my alternative!"* | `fairness`: $-0.15$<br>`sense_of_control`: $-0.15$<br>`stress`: $+0.10$ |
| **Driver tagged as Boundary** | Meaning inverted: *"I begged for automated testing and you're telling the room I refused it?!"* Extreme frustration at misrepresentation. | `fairness`: $-0.20$<br>`trust`: $-0.15$<br>`stress`: $+0.15$ |
| **Boundary tagged as Driver** | Alarming incompetence: *"My legal/compliance red line is NOT a feature suggestion!"* Triggers acute anxiety and loss of control. | `perceived_risk`: $+0.25$<br>`stress`: $+0.20$<br>`trust`: $-0.20$<br>`fairness`: $-0.10$<br>`sense_of_control`: $-0.15$ |
| **Fact tagged as Stance (Driver/Boundary)** | Bafflement: *"You're proposing current infrastructure state as an action? Do you understand our tech stack?"* | `confidence`: $-0.25$<br>`trust`: $-0.15$<br>`stress`: $+0.05$ |
| **Stance tagged as Fact** | Neglect: *"You wrote off my core requirement as just background trivia!"* | `fairness`: $-0.15$<br>`sense_of_control`: $-0.20$ |

---

---

## 4. Vetoes and Rejection Dynamics

A Veto occurs when a proposal commits while crossing a hard constraint of a high-power stakeholder or failing to meet minimum viable buy-in.

### 4.1 Veto Types & Emotional Fallout

#### A. Hard Boundary Veto (Red Line Crossed)
- **Instigator Stakeholder**:
  - The high-power stakeholder whose Boundary was breached exercises the Veto.
  - **Emotional Shift**:
    - `perceived_risk`: $+0.35$ (feels acute danger to operations/compliance)
    - `trust`: $-0.30$ (feels betrayed or ignored)
    - `stress`: $+0.30$
    - `sense_of_control`: $+0.10$ (asserted dominance via veto)
    - *Dominant State*: Instantly becomes **`angry`** or **`anxious`**.
- **Collateral Room Effect**:
  - Other stakeholders in the room suffer an ambient hit:
    - `stress`: $+0.15$
    - `confidence`: $-0.15$
    - (Meeting degenerated into deadlock).

#### B. Low Buy-In Veto / Stalemate
- Occurs when the overall proposal fails to secure quorum among influential stakeholders.
- **All Active Stakeholders**:
  - `fairness`: $-0.15$
  - `stress`: $+0.15$
  - `confidence`: $-0.20$ (doubt in leadership)
  - `trust`: $-0.10$

---

## 5. Simulation Phase Emotion Updates (Post-Commit)

Once an Action Card passes the Pitch Debate, it commits and executes in the simulation engine. Graph mutations alter component maturity, pipeline connections, and stage metrics. 

Stakeholder emotions update based on **realized simulation outcomes**:

```
[ Simulation Runs ]
        |
        +---> 1. Upstream Capping Check (Did promised upgrades actually deliver?)
        +---> 2. Technical Health Delta (Did stage health improve or regress?)
        +---> 3. Promise Realization (Were stakeholder Drivers physically deployed?)
```

### 5.1 Outcome Scenarios

#### Scenario 1: Clean Delivery (All Promised Upgrades Deliver Full Effective Level)
- When components reach their nominal targets without upstream capping bottlenecks:
  - **Stakeholders whose Drivers/Trade-offs were built**:
    - `trust`: $+0.25$
    - `confidence`: $+0.20$
    - `stress`: $-0.20$
    - `fairness`: $+0.15$
    - *Dominant State*: Shifts toward **`relieved`** or **`enthusiastic`**.

#### Scenario 2: Capped / Deficient Delivery (Upstream Bottleneck)
- When a target component was raised nominally, but effective level remained low because the player failed to resolve upstream dependencies (e.g. Data Validation capped by manual Data Ingestion):
  - **Component Owner & Dependent Stakeholders**:
    - `confidence`: $-0.25$ (feels the PM gave them a broken or cosmetic fix)
    - `stress`: $+0.20$
    - `trust`: $-0.15$
    - *Dominant State*: Shifts toward **`frustrated`** or **`skeptical`**.

#### Scenario 3: Negative Unintended Side-Effects / Technical Debt
- If the simulation reveals unmonitored drift, security gaps, or budget overruns:
  - **Governance / Reliability Owners (e.g. Compliance, SRE)**:
    - `perceived_risk`: $+0.30$
    - `stress`: $+0.25$
    - `trust`: $-0.20$
    - *Dominant State*: Shifts toward **`anxious`** or **`angry`**.

---

## 6. Integration and Architecture Plan

### 6.1 State Storage
- Stored per stakeholder in the game session (`stakeholder_emotion_values: dict[str, dict[str, float]]`).
- Persisted in the database via session state (`apply_emotion_deltas`).

### 6.2 Implementation Touchpoints
1. `pitch_debate_service/scoring.py`:
   - Replace linear mean-shifting in `shift_emotions` with dimensional vector applications.
   - Implement `calculate_pitch_emotion_deltas(action_card, stakeholder_intel, power, interest)`.
2. `domain/emotion_factory.py`:
   - Define the constant malus vectors $\mathbf{m}_{\text{cat}}$ in `EmotionValueConfig.json` or domain code.
3. `pitch_handler.py`:
   - Trigger the pitch emotion delta evaluation upon each card modification pitch event.
   - Dispatch refutation text and emotional malus when an Action Card contains misclassified items.

---

## 7. Automated Test Suite & Empirical Validation

The mathematical formulas, weights, and state transitions have been implemented and verified in the automated test suite:
[game-api/tests/test_emotion_dynamics_simulation.py](file:///Users/belaveltrup/Desktop/MLOps%20Serious%20Game/game-api/tests/test_emotion_dynamics_simulation.py)

### 7.1 Key Validation Results
1. **Achievability of All 9 Emotional States**:
   - `neutral`: Starting baseline and well-balanced inconsequential states.
   - `enthusiastic`: High-interest stakeholders whose demands are fully met and delivered.
   - `relieved`: Stress and risk alleviated following resolution of critical constraints.
   - `skeptical`: Moderate neglect of interested stakeholders.
   - `frustrated`: High-interest stakeholders whose agency is sidelined.
   - `anxious`: Acute risk spike following red-line boundary breaches.
   - `angry`: High-power stakeholders facing full neglect or severe violations.
   - `apathetic`: Low-power/low-interest stakeholders experiencing persistent disengagement.
   - `overwhelmed`: Compounding high stress and acute risk beyond threshold.
2. **Positive vs. Negative Balance**:
   - Equal-magnitude positive recovery prevents death spirals: meeting a stakeholder's demands fully restores emotions from a previous turn of neglect.
3. **Iterative Pitch Lifecycle**:
   - Tested across real challenges (Phase 0, Phase 1, Phase 2) with actual `RequirementObjects.json` items:
     - Initial neglected draft triggers justified pushback (`angry`/`frustrated`).
     - Adding missing drivers or trade-off branches warms up the stakeholder.
     - Clean simulation execution elevates mood to `enthusiastic` or `relieved`.
