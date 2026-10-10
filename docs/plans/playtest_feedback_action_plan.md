# Playtest Feedback and Change Request Action Plan

## 1. Executive Summary

This document consolidates, categorizes, and provides technical implementation specifications for the 26 feedback points collected during the initial playtest of **MLOps Labs**. 

The playtest feedback reveals four core themes:
1. **Technical and MLOps Theming**: The game currently feels heavily skewed toward generic stakeholder diplomacy. It needs deeper MLOps domain terminology, engineering failure modes, and technical trade-offs.
2. **State Continuity**: Stakeholders and accumulated intel are inadvertently cleared or filtered out between phases, breaking the player's mental model of building a long-term enterprise knowledge base.
3. **Information Architecture and Onboarding**: Players experience cognitive overload during the offline intel gathering phase (9 items in rapid succession) and lack clear explanations for why items are categorized or how buy-in target thresholds are derived.
4. **UI Ergonomics and Affordances**: Several small visual glitches (fixed heights clipping text, misleading clickable cursors on non-clickable emoji chips, leaked roles in email signatures, lack of drag-and-drop prioritization) detract from the overall polish.

---

## 2. Categorization Matrix

Each item is categorized by its primary technical domain (**Frontend**, **Backend**, **Full-Stack**, **Game Design and Content**) and work item type (**Bugfix**, **Feature Request**).

| # | Item Description | Layer | Work Item Type | Estimated Effort | Priority |
| :- | :--- | :--- | :--- | :--- | :--- |
| **1** | Highlight MLOps keywords in freetext; move technical MLOps planning into focus | Full-Stack / Content | Feature Request | Medium | High |
| **2** | Prioritize intel items via drag-and-drop in dossier; feed into pitch auto-selection | Full-Stack | Feature Request | Medium | Medium |
| **3** | Ensure unambiguous single-category intel classification OR allow multi-tagging | Game Design / Full-Stack | Feature Request | Medium | High |
| **4** | Stakeholders articulate concrete MLOps failure modes in pitch phase | Full-Stack / Content | Feature Request | Medium | High |
| **5** | Intel about stakeholders should not disappear between phases | Backend | Bugfix | Small | Critical |
| **6** | Stakeholders from previous phases should not disappear from the dossier | Backend / Frontend | Bugfix | Small | Critical |
| **7** | Rebalance "Team Sync-up" engagement card (increase cost / add trade-off) | Game Design / Backend | Bugfix (Balancing) | Small | High |
| **8** | Detect, introduce, and flag contradictory intel across stakeholders in dossier | Full-Stack / Content | Feature Request | Large | Medium |
| **9** | Stakeholder resistance rating carries over between phases (weighted sum) | Backend | Feature Request | Medium | High |
| **10** | Visually display intel source (offline analysis vs online dialogue) in dossier | Frontend | Feature Request | Small | Medium |
| **11** | Clarify or expand 3-item limit when assembling pitch action cards | Frontend / UX | Feature Request | Small | Medium |
| **12** | Direct interaction affordance when clicking seated stakeholders (e.g., Reuben) | Frontend | Feature Request | Small | High |
| **13** | Explain buy-in target threshold origin (Stakeholder Matrix Power/Interest) | Frontend / UX | Feature Request | Small | High |
| **14** | Formally introduce newly introduced stakeholders when a new phase begins | Full-Stack / Content | Feature Request | Medium | Medium |
| **15** | Provide onboarding instructions for offline intel gathering (purpose and mechanics) | Frontend / UX | Feature Request | Small | High |
| **16** | Add visual animation when a new intel item is added to the dossier | Frontend | Feature Request | Small | Low |
| **17** | Reduce initial cognitive load in offline intel gathering (pre-populate baseline intel) | Game Design / Config | Feature Request | Small | High |
| **18** | Fix unclear intel text (Requirements Reuben architecture memo) | Game Design / Content | Bugfix (Content) | Small | Medium |
| **19** | Add "NEW" and "SHIFTED" status badges to stakeholder dossier tabs | Frontend | Feature Request | Small | Medium |
| **20** | Retain reference to previous-phase stakeholders in dossier (sub-grouping / badge) | Full-Stack | Bugfix / Defect | Small | High |
| **21** | Remove interactive pointer cursor and hover state from reaction emojis | Frontend | Bugfix (CSS) | Small | Low |
| **22** | Clean email signatures (remove raw role description and body header leaks) | Frontend / Backend | Bugfix | Small | Medium |
| **23** | Eliminate uniform "crucial / non-negotiable" phrasing; make tagging detective work | Game Design / Content | Feature Request | Medium | High |
| **24** | Fix premature validation of convincer profiles during offline intel phase | Backend | Bugfix (Logic) | Small | Critical |
| **25** | Fix layout clipping on revealed intel pill in chat history | Frontend | Bugfix (CSS) | Small | Medium |
| **26** | Highlight High-Power and High-Interest stakeholders on dossier tabs | Frontend | Feature Request | Small | High |

---

## 3. Categorized Breakdown

### 3.1. Frontend (UI / UX)

#### Bugfixes
* **Item 21: Reaction Emojis Clickable Hover Effect**
  * *Location*: `game-ui/src/components/IntelArtifactViewer.module.css` (lines 315-323)
  * *Defect*: `.reactionChip` defines `cursor: pointer;` and a background hover transition, tricking users into clicking on cosmetic reaction icons.
  * *Fix*: Remove pointer cursor and hover pseudo-class, changing cursor to `default`.
* **Item 25: Revealed Intel Text Cut-Off in Chat History**
  * *Location*: `game-ui/src/components/StakeholderInteractionArea.tsx` (line 233)
  * *Defect*: The container enforces a fixed `height: "40px"`. Multi-line descriptions overflow and clip vertically.
  * *Fix*: Replace `height: "40px"` with `minHeight: "40px"` and `height: "auto"`, adding flex wrapping.

#### Feature Requests and UX Enhancements
* **Item 10: Intel Source Origin Badges**
  * *Location*: `game-ui/src/components/StakeholderDossier.tsx`
  * *Description*: Add an origin pill (e.g., 📄 "Offline Document" vs 💬 "Direct Dialogue") to each intel sticky note based on its source.
* **Item 11: Pitch Action Card Selection Feedback**
  * *Location*: `game-ui/src/components/PitchActionCardModal.tsx`
  * *Description*: The modal caps selection at 3 items without explaining the rationale. Add a counter header explaining the limitation (e.g., "Executive Attention Limit: Select up to 3 core levers") or allow unlocking a 4th slot with remaining attention tokens.
* **Item 12: Direct Stakeholder Click Affordance**
  * *Location*: `game-ui/src/components/online_intel_gathering.tsx`
  * *Description*: Clicking a seated stakeholder currently only switches the dossier tab. Provide a contextual action popover (e.g., "Direct Query", "Review Stance", or prompt to play an Engagement Card) so the interaction feels responsive.
* **Item 13: Demystify Buy-In Target Thresholds**
  * *Location*: `game-ui/src/components/pitch_debate.tsx`, `StakeholderDossier.tsx`
  * *Description*: The target threshold (e.g., 80% for High Power / High Interest, 65% for High Power / Low Interest) appears arbitrary. Add a breakdown tooltip displaying the calculation: `Base Target derived from Stakeholder Grid (Power: High, Interest: High)`.
* **Item 15: Offline Intel Gathering Tutorial and Narrative Purpose**
  * *Location*: `game-ui/src/components/offline_intel_gathering.tsx`
  * *Description*: Display a collapsible briefing header explaining the player's objective: analyzing raw artifacts to separate hard requirements, preferences, and personal friction before meeting the team.
* **Item 16: Micro-Animation for Dossier Item Additions**
  * *Location*: `game-ui/src/components/StakeholderDossier.tsx`
  * *Description*: Implement a subtle pulse or slide-in animation when a newly verified or tagged intel item arrives.
* **Item 19: "NEW" and "SHIFTED" Badges on Dossier Tabs**
  * *Location*: `game-ui/src/components/StakeholderDossier.tsx`
  * *Description*: Mark stakeholder tabs with a "NEW" badge if introduced in the active phase, or "SHIFTED" if their power, interest, or emotion changed.
* **Item 26: High Power / High Interest Visual Emphasis**
  * *Location*: `game-ui/src/components/StakeholderDossier.tsx`, `StakeholderDossier.module.css`
  * *Description*: Add a gold border indicator or VIP star badge on tabs of key decision-makers who possess veto power.

---

### 3.2. Backend (API, Data Persistence, Game Engine)

#### Bugfixes
* **Item 5: Intel Wiped Across Phases**
  * *Location*: `game-api/src/mlops_serious_game/infrastructure/websocket/handlers/intel_handler.py` (line 42)
  * *Defect*: `clear_intel_items_for_user(websocket)` is called unconditionally at the beginning of each offline intel phase, wiping all stored intel items.
  * *Fix*: Remove the destructive wipe. Accumulate intel items across phases, scoped by `session_id` or `username`.
* **Item 6 and Item 20: Stakeholders Disappearing from Dossier Across Phases**
  * *Location*: `game-api/src/mlops_serious_game/application/intel_handler.py` (line 705)
  * *Defect*: `retrieve_dossier_data()` restricts stakeholder inclusion to `StakeholderFactory.get_active_stakeholders(curr_challenge.phase_id)`. Previous stakeholders drop out of the payload.
  * *Fix*: Include all stakeholders encountered up to the current phase, flagging inactive ones as `is_active_in_challenge: false`.
* **Item 24: Premature Convincer Profile Validation**
  * *Location*: `game-api/src/mlops_serious_game/application/intel_handler.py` (lines 718-720)
  * *Defect*: `is_val = bool(cat_arch and cat_arch == real_arch)` automatically sets `convincer_status = "validated"` if the player guesses the right tag during offline intel gathering, before any dialogue verification occurs.
  * *Fix*: Decouple categorized choice from validation status. Convincer profiles must remain `unconfirmed` until verified through explicit dialogue or cards.

#### Feature Requests
* **Item 9: Persistent Stakeholder Resistance Rating Across Phases**
  * *Location*: `game-api/src/mlops_serious_game/infrastructure/database/models.py`, `chat_handler.py`, `intel_handler.py`
  * *Description*: Persist stakeholder resistance state across phases in `game_sessions.stakeholder_states` using an exponential moving average or weighted carry-over formula:
    $$R_{t} = \alpha \cdot R_{t-1} + (1 - \alpha) \cdot R_{\text{phase}}$$
    This prevents players from repeatedly antagonizing a stakeholder without long-term consequences.

---

### 3.3. Full-Stack and Cross-Cutting Architecture

* **Item 1: MLOps Technical Focus and Keyword Highlighting**
  * *Frontend*: Implement a regex-based keyword parser in `StakeholderInteractionArea.tsx` and `IntelArtifactViewer.tsx` that highlights technical terms (e.g., Feature Drift, Data Lineage, Canary Rollout, Model Registry, SLA) with clickable tooltips explaining their significance.
  * *Backend / Config*: Create a central terminology dictionary in `gameConfig/MLOpsGlossary.json` and inject domain-specific trade-offs into prompt templates.
* **Item 2: Drag-and-Drop Prioritization of Dossier Intel**
  * *Frontend*: Allow reordering intel cards inside `StakeholderDossier.tsx`.
  * *Backend*: Persist the prioritized order in session state and auto-populate the top-ranked items when opening the Pitch Action Card modal.
* **Item 4: Stakeholders Express Concrete MLOps Failure Modes**
  * *Backend*: Update objection prompts in `pitch_debate_service` to require stakeholders to articulate specific technical risks (e.g., silent data corruption, GPU memory exhaustion, lack of rollback mechanisms).
  * *Frontend*: Render the threat assessment visually in `pitch_debate.tsx`.
* **Item 8: Contradiction Detection and Flagging in Dossier**
  * *Game Design / Config*: Define conflicting pairs of intel in `RequirementObjects.json` (e.g., Emilia demands cloud SaaS dashboards while Reuben strictly forbids third-party data transmission).
  * *Frontend*: Provide a "Flag Contradiction" button when viewing related intel items.
  * *Backend*: Reward players with attention tokens or credibility points for identifying contradictions before the pitch phase.
* **Item 14: Structured Phase Transitions and Stakeholder Introductions**
  * *Frontend*: Build an introductory splash modal when entering a new phase.
  * *Backend*: Emit a `phase:stakeholders_introduced` event listing newly arriving stakeholders and their organizational roles.
* **Item 22: Clean Corporate Email Signature and Artifact Formatting**
  * *Frontend*: In `IntelArtifactViewer.tsx` (line 68), remove the bracketed character role description from email signatures.
  * *Backend / Config*: Clean regex parsing in `cleanText` to remove stray `Subject:`, `Title:`, or `To:` lines generated by LLM prompts.

---

### 3.4. Game Design, Content, and Balancing (JSON Configs and Prompts)

* **Item 3 and Item 23: Nuanced Detective Work vs Keyword Matching**
  * *Current Issue*: Snippets frequently reuse exact words like "crucial", "mandates", and "non-negotiable", turning tagging into mechanical keyword search.
  * *Revision*: Rewrite artifact templates in `OfflineIntelArtifacts.json` to convey implicit stances:
    * *Core Requirement*: Grounded in regulatory compliance, hardware boundaries, or system correctness.
    * *Negotiable Preference*: Grounded in workflow convenience, past tooling habits, or developer ergonomics.
    * *Personal Friction*: Grounded in past organizational trauma, distrust between departments, or fear of obsolescence.
* **Item 7: Rebalance "Team Sync-up" Engagement Card**
  * *Location*: `gameConfig/GameEngagementCards.json` (`eng_3`)
  * *Current Problem*: Costs 2 tokens, targets all stakeholders simultaneously (`stakeholder_selection_amount: -1`), and reveals intel for everyone with zero drawbacks, making single-target cards obsolete.
  * *Adjustment*: Increase token cost to 4, limit revealed items to high-level unconfirmed snippets, or add a dilution penalty (higher noise risk).
* **Item 17: Pacing and Cognitive Load Adjustment**
  * *Adjustment*: Reduce the number of uncategorized artifacts presented at the start of a challenge from 9 down to 4 or 5. Pre-fill 2 or 3 baseline items into the dossier as known organizational facts.
* **Item 18: Rewrite Requirements Reuben Technical Memo**
  * *Location*: `gameConfig/OfflineIntelArtifacts.json` (`art_1_requirements_reuben_dispute_stance`)
  * *Revision*: Clarify the architectural rationale to distinguish between a strict security policy (auditability, access controls) and personal platform bias.

---

## 4. Deep-Dive Implementation Notes for Key Items

### 4.1. Fixing Intel and Stakeholder Retention (Items 5, 6, 20)

In `game-api/src/mlops_serious_game/infrastructure/websocket/handlers/intel_handler.py`:
```python
# BEFORE (Destructive wipe):
async def handle_get_offline_artifacts(websocket: WebSocket, username: str, payload: dict) -> None:
    ...
    # Clear previous challenge intel items when starting offline intel gathering phase
    await clear_intel_items_for_user(websocket)
    load_known_intel_items_for_challenge(curr_challenge, username)
    ...

# AFTER (Additive retention):
async def handle_get_offline_artifacts(websocket: WebSocket, username: str, payload: dict) -> None:
    ...
    # Ensure known dispute stances for the new challenge are seeded without deleting existing items
    load_known_intel_items_for_challenge(curr_challenge, username)
    ...
```

In `game-api/src/mlops_serious_game/application/intel_handler.py`:
```python
# BEFORE (Only current phase stakeholders):
active_st_ids = StakeholderFactory.get_active_stakeholders(curr_challenge.phase_id) or StakeholderFactory.get_available_stakeholders()

# AFTER (All historical stakeholders up to current phase):
all_phases = PhaseFactory.get_phases()
encountered_st_ids = []
for p_idx in range(curr_challenge.phase_id + 1):
    if p_idx < len(all_phases):
        for ps in all_phases[p_idx].stakeholders:
            if ps.stakeholder_id not in encountered_st_ids:
                encountered_st_ids.append(ps.stakeholder_id)
```

### 4.2. Fixing Premature Convincer Validation (Item 24)

In `game-api/src/mlops_serious_game/application/intel_handler.py` (`retrieve_dossier_data`):
```python
# BEFORE (Auto-validates if player guess matches real archetype):
st_arch_entry = session_archs.get(st_id, {})
cat_arch = st_arch_entry.get("categorized_archetype")
real_arch = st_arch_entry.get("real_archetype") or getattr(st, 'convincer_archetype', '')
is_val = bool(cat_arch and cat_arch == real_arch)
status = "validated" if is_val else ("unconfirmed" if cat_arch else "unknown")

# AFTER (Requires explicit verification event):
st_arch_entry = session_archs.get(st_id, {})
cat_arch = st_arch_entry.get("categorized_archetype")
is_val = bool(st_arch_entry.get("is_verified", False))
status = "validated" if is_val else ("unconfirmed" if cat_arch else "unknown")
```

### 4.3. Rebalancing the "Team Sync-up" Card (Item 7)

In `gameConfig/GameEngagementCards.json`:
```json
{
  "id": "eng_3",
  "title": "Team Sync-up",
  "icon": "ph:users-bold",
  "token_cost": 4,
  "description": "Cross-functional team sync to align perspectives across all active stakeholders.",
  "stakeholder_selection_amount": -1,
  "target_type": "stakeholder",
  "response_snippet": "Synced up with all team members to align perspectives.",
  "max_plays_per_phase": 1,
  "intel_reveal_count": 1,
  "allowed_requirement_types": ["negotiable_preference", "personal_friction"]
}
```

---

## 5. Execution Roadmap

### Phase 1: High-Priority Bugfixes and UI Glitches
* [ ] Remove destructive `clear_intel_items_for_user` call in `intel_handler.py` (Item 5).
* [ ] Fix premature convincer validation in `retrieve_dossier_data` (Item 24).
* [ ] Retain all encountered stakeholders in dossier payload and UI (Items 6, 20).
* [ ] Fix `.reactionChip` cursor pointer and hover styles in `IntelArtifactViewer.module.css` (Item 21).
* [ ] Fix fixed height clipping in `StakeholderInteractionArea.tsx` for revealed intel (Item 25).
* [ ] Clean email signature role leak in `IntelArtifactViewer.tsx` (Item 22).

### Phase 2: Game Balance and Rules Tuning
* [ ] Rebalance `eng_3` (Team Sync-up) in `GameEngagementCards.json` and sync schemas (Item 7).
* [ ] Clarify or expand the 3-item pitch selection limit in `PitchActionCardModal.tsx` (Item 11).
* [ ] Add power and interest target calculation tooltips in `pitch_debate.tsx` and dossier (Item 13).
* [ ] Highlight High-Power and High-Interest stakeholders on dossier tabs (Item 26).
* [ ] Add "NEW" and "SHIFTED" labels to dossier tabs (Item 19).

### Phase 3: Gameplay Depth and MLOps Focus
* [ ] Implement MLOps keyword highlighter in chat responses and artifact viewers (Item 1).
* [ ] Add drag-and-drop intel prioritization to `StakeholderDossier.tsx` (Item 2).
* [ ] Update pitch debate prompts to generate specific MLOps technical objections and failure modes (Item 4).
* [ ] Persist stakeholder resistance ratings across phases via weighted sum (Item 9).
* [ ] Add visual origin badge (offline vs online) to dossier cards (Item 10).
* [ ] Add seated stakeholder click interaction menu (Item 12).

### Phase 4: Narrative, Onboarding, and Content Polishing
* [ ] Add tutorial and narrative briefing banner to offline intel gathering (Item 15).
* [ ] Pre-populate 2 or 3 baseline intel items to reduce cognitive fatigue from 9 to 4 or 5 (Item 17).
* [ ] Rewrite ambiguous artifact descriptions and eliminate repetitive buzzwords (Items 3, 18, 23).
* [ ] Implement micro-animation when adding new items to the dossier (Item 16).
* [ ] Design contradiction flagging mechanic in the dossier (Item 8).
* [ ] Add formal stakeholder introduction sequence on phase transitions (Item 14).

---

## 6. Verification and Test Plan

1. **Docker Environment Verification**:
   * Run type checking on the frontend:
     `docker compose exec ui npx tsc --noEmit`
   * Check Vite HMR logs:
     `docker compose logs ui --tail=50`
   * Check backend startup and websocket events:
     `docker compose logs api --tail=50`
2. **Phase Transition State Integrity**:
   * Advance from Phase 0 to Phase 1 and confirm that Phase 0 stakeholders and intel entries remain visible in the dossier.
   * Verify that newly introduced stakeholders display the "NEW" badge.
3. **Offline Intel Gathering Sanity**:
   * Confirm that tagging an archetype in the offline screen does not mark the profile as "validated" until confirmed in dialogue.
   * Confirm that reaction emojis do not trigger pointer hover effects.
   * Confirm that revealed intel descriptions expand naturally without text clipping.
