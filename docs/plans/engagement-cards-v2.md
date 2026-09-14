# Engagement Cards V2 Design Plan

## 1. Summary of Changes

Roster update for pitch phase GATHER cards. Fixes misleading card names, eliminates blind archetype roulette, grounds dialogues in real MLOps stance items.

| Card | Name | Cost | Target | Yield |
|---|---|---|---|---|
| `eng_0` | Verify Intel Item | 5 | 1 held note | Upgrades note to Verified. Voiced dialogue. |
| `eng_1` | 1-on-1 Deep Dive | 4 | 1 stakeholder | 3 turns: deep inquiry + 1-on-1 negotiation template. |
| `eng_2` | Probe Requirements | 3 | 2 stakeholders | 1 turn each: reveals Boundary -> Trade-off -> Driver. |
| `eng_3` | Team Sync-up | 2 (1x/phase) | Whole room | 1 turn: general perspective across active stakeholders. |
| `eng_4` | How to Convince | 2 | 1 stakeholder | Test 1 of 7 static archetypes. Confirms or eliminates. |
| `eng_5` | Colleague Intel | 2 | Source + Subject | Ask Source about Subject (convincer style, red lines, trade-offs). |
| `eng_6` | Objection Discussion | 3 | 1 skeptical target | Voiced pre-pitch pushback. Yields `potential_objection` dossier item. |

---

## 2. Probe Requirements (`eng_2`)

### Scope
- Covers 3 stance types: `boundary`, `trade_off`, `driver`.
- Severity-first reveal order:
  1. `boundary` (red lines / hard limits)
  2. `trade_off` (negotiation space)
  3. `driver` (positive motivations)

### Turn Options
- Dialogue buttons show natural inquiry phrasing based on item metric + type:
  - Boundary: *"What are your hard limits on {metric}?"*
  - Trade-off: *"Where is your flexibility between {metricA} and {metricB}?"*
  - Held hypothesis test: *"We noted {item_gist} — does this hold?"*
- No raw meta-labels ("Open question") or blind archetype guesses.

### Target Modal Warning
- Checks target's remaining unrevealed items in (`boundary`, `trade_off`, `driver`).
- If remaining count == 0:
  - Card shows badge: `⚠️ No requirements left to probe`.
  - Disabled with tooltip: *"Target has already revealed all requirements."*
- Prevents wasted Attention Tokens.

---

## 3. "How to Convince" (`eng_4`)

### Purpose
- Dedicated card for discovering stakeholder Convincer Profile.
- Replaces generic Trial Balloon roulette in other cards.

### Mechanics
- Cost: 2 Attention Tokens.
- Target: 1 stakeholder whose archetype is unverified.
- Menu offers static choice of the 7 predefined archetypes:
  1. Technical Excellence
  2. Business Value
  3. Safety & Reliability
  4. Control & Governance
  5. People & Trust
  6. Autonomy
  7. Pragmatism
- Outcome:
  - **Hit**: Convincer profile verified in dossier.
  - **Miss**: Eliminates selected archetype (struck through in dossier). Stakeholder gives constructive pushback clue in speech bubble. No harsh mood penalty.

---

## 4. Colleague Intel (`eng_5`)

### Purpose
- Backchannel social elicitation. Ask Source about Subject.

### Targeting
- Player picks:
  - **Source**: Colleague in the room.
  - **Subject**: Target stakeholder.

### Inquiry Options (Ground in existing intel taxonomy)
1. **Convincer Style**: *"How does [Subject] evaluate new proposals?"*
   - Yields clue on Subject's archetype.
2. **Red Lines**: *"What will [Subject] veto outright?"*
   - Yields clue on Subject's primary Boundary.
3. **Trade-offs & Drivers**: *"What does [Subject] really care about, and where will they compromise?"*
   - Yields clue on Subject's Drivers and Trade-offs.

### Voicing
- Player question shown in dialogue bubble.
- Source responds via speech bubble (deterministic backend ground truth voiced by LLM persona).

---

## 5. Objection Discussion (`eng_6`)

### Purpose
- Pre-wire meeting. Smoke out objections before formal pitch debate.

### Candidate Eligibility & Story Alignment
- **Trigger**: Stakeholder has friction.
  - Red or Amber buy-in band at discussion table.
  - OR holds an active unresolved Boundary against current proposal.
- **Narrative**:
  - Stakeholder shows visible hesitation at table (crossed arms, skeptical glance).
  - Story note: *"[Name] has unresolved reservations about this challenge."*
- Target modal only allows selecting eligible stakeholders (or flags them with warning icons).

### Mechanics
- Cost: 3 Attention Tokens.
- Target: 1 skeptical stakeholder.
- Interaction:
  - Stakeholder voices anticipated objection in speech bubble.
  - Generates new dossier item: `potential_objection`.
    - Shows objection class (`boundary`, `technical`, `stance`, `price`) and target metric.
- Pitch Prep Integration:
  - Card builder highlights which proposal items counter this anticipated objection.
  - If counter item is included in pitch card, objection is pre-emptively neutralized before debate starts.

---

## 6. Actionable Card Descriptions

Short, clear in-game descriptions for cards:

| Card | Description |
|---|---|
| `eng_0` **Verify Intel Item** | *"Fact-check an unconfirmed note so you don't pitch on false assumptions."* |
| `eng_1` **1-on-1 Deep Dive** | *"Book dedicated face time with 1 stakeholder to ask 3 targeted questions."* |
| `eng_2` **Probe Requirements** | *"Ask 2 stakeholders what they need. Uncovers hard red lines and trade-offs."* |
| `eng_3` **Team Sync-up** | *"Call a quick all-hands to see where everyone in the room stands."* |
| `eng_4` **How to Convince** | *"Test your pitch angle on 1 stakeholder to see how they like to be persuaded."* |
| `eng_5` **Colleague Intel** | *"Ask a colleague for the inside scoop on another stakeholder's priorities."* |
| `eng_6` **Objection Discussion** | *"Sit down with a skeptic to smoke out their pushback before the pitch."* |

---

## 7. In-Game Visibility & Placeholder Tracking

> [!NOTE]
> Placeholder cards (`How to Convince`, `Colleague Intel`, `Objection Discussion`) and a design notice banner have been added to `game-ui/src/components/pitch_phase.tsx` for developer and player visibility during design.
> **Action Item**: Remove/replace these static placeholders and the notice banner once the backend handlers, dialogue options, and interactive components are fully implemented.
