# Possible Pitch Debate Design Changes

> Superseded by [graph-redesign/](graph-redesign/STATE.md). This file stays as motivation and notation reference only.

## Motivation

The current pitch debate is decoupled from the Analyze and Strategize phases: objections are generic, buy-in ignores what the proposal actually covers, and the player has no live negotiation tools. Four specific gaps drive the changes below:

1. **Shallow content link.** Stakeholder buy-in is driven by which dialogue option is chosen, not by what the action card semantically covers. The proposal's graph operations and the stakeholder's intel items are never directly compared.
2. **No semantic comparability.** Intel items are treated as isolated, opaque data points rather than representations of concrete MLOps graph operations. This causes two problems: items that describe the same graph change cannot satisfy each other's objections across stakeholders; and the game degenerates into pattern-matching ("click the correct intel item") rather than genuine reasoning about what changes to the MLOps environment a stakeholder actually needs.
3. **Constrained player agency.** Which archetype or intel to deploy against which stakeholder is system-decided, not player-decided because dialogue options are randomized
4. **No addendum mechanic.** The pitch is a one-shot submission with no way to extend the proposal in response to raised objections as addendums are not yet implemented. 

---



## Gameplay Loop with Addendums

1. **Player (PM) proposes their action card.**
2. **Stakeholders raise objections** based on their intel items (deterministically selected). There are three objection types:
   - **2a)** Based on intel items that were **wrongly categorized** by the player, despite being part of the action card
     → Stakeholder refutes it, correcting the player; item is added/updated in the dossier as *Verified*
     → Affects stakeholder mood
   - **2b)** Based on intel items that are **discovered by the player but NOT part of the action card**
     → The player can decide to add them to the action card as an addendum
     → Can also be resolved with an intel item from a different stakeholder/challenge if they are semantically equivalent (see [Coverage Score](#coverage-score-one-directional))
   - **2c)** Based on intel items that are **not discovered by the player**
     → Stakeholder directly reveals the intel item as part of the objection; item is added to the dossier as *Verified*
     → Affects stakeholder mood 

---

## Persistent, Cross-Stakeholder Intel

- Intel items don't disappear between challenges 
- Each intel item is linked to a change in the MLOps Environment Graph 

---


## Buy-in and Objections

### Notation

| Symbol | Definition |
|---|---|
| $st$ | A stakeholder |
| $\text{power}(st) \in [0,1]$ | The stakeholder's organisational power |
| $\text{interest}(st) \in [0,1]$ | The stakeholder's level of interest / engagement in the project |
| $w(st) \in [0,1]$ | The stakeholder's overall influence weight combining power and interest |
| $\text{atoms}(o)$ | The set of primitive (canonical, indivisible) graph operations that compose operation $o$; for an atomic operation $\text{atoms}(o) = \{o\}$ |
| $\text{pitch\_objections}(st)$ | The set of all intel item operations gathered on $st$ during the current round (Analyze + Strategize phases) |
| $o_i$ | The MLOps graph operation associated with the $i$-th intel item of $st$; each intel item maps to exactly one such operation |
| $\text{current\_proposal}$ | The union of all MLOps graph operations of the intel items making up the current action card + addendums |

---

### Coverage Score (One-Directional)

Let $P$ be the set of all atomic graph operations that make up the current proposal. Since atoms are canonical identifiers, two operations are considered equivalent if and only if they are the same atom.

For each objection operation $o_i \in \text{pitch\_objections}(st)$, the match score is the fraction of its atoms covered by the proposal:

$$\text{match\_score}(o_i) := \frac{|\text{atoms}(o_i) \cap P|}{|\text{atoms}(o_i)|}$$

Each atom contributes equally (uniform weight). For a composite $o_i$, partial coverage is proportional to the number of its atoms that appear in $P$ — if $o_i$ decomposes into $n$ atoms and $k$ of them are in $P$, the score is $k/n$ regardless of how $o_i$ was structured above the atomic level. The measure is one-directional — it iterates over $\text{atoms}(o_i)$ only, so proposal atoms irrelevant to $st$ do not affect the score.

Only objections that are **insufficiently covered** — i.e. where $\text{match\_score}(o_i) < \theta$ for a tunable threshold $\theta$ — are considered active. Well-covered items (above $\theta$) are excluded from both the objection list and the coverage denominator.

Let $O_\theta(st) = \{ o_i \in \text{pitch\_objections}(st) \mid \text{match\_score}(o_i) < \theta \}$ be the set of active objections. Aggregate over active objections only:

$$\text{coverage}(st) :=
\begin{cases}
\dfrac{1}{|O_\theta(st)|} \displaystyle\sum_{o_i \in O_\theta(st)} \text{match\_score}(o_i) & \text{if } O_\theta(st) \neq \emptyset \\[6pt]
1 & \text{otherwise}
\end{cases}$$

$\text{coverage}(st) \in [0,1]$, where $1$ means all active objections are fully addressed (or none exist) and $0$ means none of them are.

---

### Buy-in Formula

$$\text{buy\_in}(st) := \text{coverage}(st) \cdot x \;+\; \text{emotions}(st) \cdot y \qquad x,y \geq 0,\quad x + y = 1$$

Since $\text{coverage}(st) \in [0,1]$, $\text{emotions}(st) \in [0,1]$, and $x + y = 1$ with $x,y \geq 0$, the formula is a convex combination and $\text{buy\_in}(st) \in [0,1]$. This requires emotion metrics to be **normalized to $[0,1]$** before use.

> **Note:** Neither $\text{power}(st)$ nor $\text{interest}(st)$ is included directly in $\text{buy\_in}(st)$ to avoid double-weighting. Instead, stakeholder influence is applied in the final pitch debate score (overall pitch buy-in), where both power and interest weight the stakeholder's buy-in, with **power having a larger impact than interest**:

$$\text{pitch\_score} := \sum_{st} w(st) \cdot \text{buy\_in}(st)$$

where $w(st)$ is the stakeholder's composite influence weight:

$$w(st) := \alpha \cdot \text{power}(st) \;+\; \beta \cdot \text{interest}(st) \qquad \alpha > \beta > 0,\quad \alpha + \beta = 1$$

*(e.g., $\alpha = 0.7$, $\beta = 0.3$, ensuring power is the primary driver of pitch success while interest provides a meaningful secondary contribution).*

> Optionally, if normalizing $\text{pitch\_score} \in [0, 1]$ across all active stakeholders:
>
> $$\text{pitch\_score}_{\text{norm}} := \frac{\sum_{st} w(st) \cdot \text{buy\_in}(st)}{\sum_{st} w(st)}$$

---

### Most Important Current Objection

Because $\text{coverage}(st)$ is a sum of per-item scores, it is **fully decomposable**. The most pressing active objection is the item in $O_\theta(st)$ with the lowest ratio of atoms covered:

$$o_i^* := \arg\min_{o_i \in O_\theta(st)}\; \text{match\_score}(o_i)$$

Stakeholders surface **one objection at a time**: only $o_i^*$ is presented to the player per turn. Clearing it (adding the missing atoms as an addendum) may reveal the next-worst objection $o_j^*$ from the same stakeholder on the following turn.

Players will rarely be able to clear every objection across all stakeholders. The core strategic decision is which stakeholders to fully satisfy and which to leave partially unaddressed — accepting a lower $\text{buy\_in}$ and the risk of a veto or sabotage from the neglected stakeholder.

---

## Other Changes

- Instead of having to wait for the correct archetype or intel to appear in the dialogue options, players should be able to freely choose which intel/archetype they want to use on which stakeholder. It makes no sense that players can choose the stakeholder of corporate noise but not the kind of noise they want to communicate.
- Add buttons: *go back to pitch debate* / *progress to simulation*

---

## UI

- Show the stakeholders' **objections** in the dossier instead of their buy-in
- Show which of the stakeholder's intel items are already part of the action proposal (AC + addendums)