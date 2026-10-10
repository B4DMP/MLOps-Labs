# StakeholderDossier Refactoring Implementation Plan

## Problem Statement

Both [StakeholderDossier.tsx](file:///c:/Users/michal/Documents/DBIS/B4DMP/MLOps-Labs/game-ui/src/components/StakeholderDossier.tsx) (2,529 lines) and [StakeholderDossier.module.css](file:///c:/Users/michal/Documents/DBIS/B4DMP/MLOps-Labs/game-ui/src/components/StakeholderDossier.module.css) (2,230 lines) have grown into monolithic files containing:
- Domain interfaces and type declarations
- Pure calculations and mapping helpers
- Independent UI sub-components (Emotion badge, Header buttons, Buy-in card, Filter bar, Sticky notes, Debug answer keys)
- State management for window dragging, auto-paging, phase change badges, animation queues, and hover tags
- A massive, single CSS module with interleaved component rules

This refactoring splits the dossier into focused, single-responsibility sub-components, custom hooks, pure utility modules, and scoped CSS modules within `game-ui/src/components/dossier/`, while preserving 100% backward compatibility for all consuming screens ([Game.tsx](file:///c:/Users/michal/Documents/DBIS/B4DMP/MLOps-Labs/game-ui/src/Game.tsx), [pitch_debate.tsx](file:///c:/Users/michal/Documents/DBIS/B4DMP/MLOps-Labs/game-ui/src/components/pitch_debate.tsx), [offline_intel_gathering.tsx](file:///c:/Users/michal/Documents/DBIS/B4DMP/MLOps-Labs/game-ui/src/components/offline_intel_gathering.tsx), [PerformanceDashboard.tsx](file:///c:/Users/michal/Documents/DBIS/B4DMP/MLOps-Labs/game-ui/src/components/PerformanceDashboard.tsx), [ComposeActionProposalModal.tsx](file:///c:/Users/michal/Documents/DBIS/B4DMP/MLOps-Labs/game-ui/src/components/ComposeActionProposalModal.tsx)).

---

## Target Component Architecture

```
game-ui/src/components/
├── StakeholderDossier.tsx            # Thin orchestrator (< 250 LOC) re-exporting public types/props
├── StakeholderDossier.module.css     # Window container, notebook binding, desk wrapper (< 200 LOC)
└── dossier/
    ├── types.ts                      # IntelEntry, StakeholderDossierEntry, StakeholderBuyInInfo, etc.
    ├── constants.ts                  # Metadata maps (CATEGORY_META, PIP_META, STAGE_META, etc.)
    ├── utils.ts                      # Pure helpers (toChains, phaseLabel, confidenceOf, pips, etc.)
    ├── utils.test.ts                 # Unit tests for pure calculations and mappings
    │
    ├── hooks/
    │   ├── useDossierPaging.ts       # Active page derivation, jump-to-intel/stakeholder, sync
    │   ├── usePhaseChangeBadges.ts   # NEW / SHIFTED badges, pulse timer, dwell seen dismissal
    │   ├── useAppearAnimations.ts    # Newly added note queue & consumption timer
    │   ├── useWindowDrag.ts          # Draggable modal window coordinates
    │   └── useHoverInfoTag.ts        # Shared portaled flip-down tooltip tag & bounds clamping
    │
    └── subcomponents/
        ├── EmotionRevealBadge.tsx    # Emotion badge + portaled 7-dimension reveal card
        ├── EmotionRevealBadge.module.css
        ├── HeaderIconButton.tsx      # Portaled hover-tag leather button for binder header
        ├── DossierHeader.tsx         # Binder title, feature buttons, prev/next arrows, close button
        ├── DossierTabBar.tsx         # Top bookmark tabs, emotion label, key player flags, pip bar
        ├── DossierTabBar.module.css
        ├── BuyInCard.tsx             # Pitch debate buy-in progress bar, notch & lock overlay
        ├── BuyInCard.module.css
        ├── DossierFilterBar.tsx      # Phase chips, confidence chips, search box, hint
        ├── DossierFilterBar.module.css
        ├── IntelStickyNote.tsx       # Sticky note card, re-tag popup, debug key, trade-off text, stamps
        ├── IntelStickyNote.module.css
        ├── DossierPage.tsx           # Page scroll, polaroid frame, avatar, system header, notes grid
        └── DossierPage.module.css
```

---

## Detailed Refactoring Phases

### Phase 1: Pure Types, Constants & Utility Extraction
Extract non-JSX domain logic and helper functions into dedicated modules:
- **`dossier/types.ts`**:
  - `IntelEntry`, `StakeholderDossierEntry`, `IntelChain`, `StakeholderBuyInInfo`, `IntelDebugInfo`, `StakeholderDebugInfo`, `IntelArtifactData`, `TradeOffBranch`, `StakeholderDossierProps`, `IntelPipStatus`.
- **`dossier/constants.ts`**:
  - `CATEGORY_META`, `INTEL_PIP_META`, `INTEL_PIP_ORDER`, `ARTIFACT_TYPE_LABEL`, `EMOTION_DIMENSION_LABEL`, `EMOTION_BUCKET_META`, `INVERTED_EMOTION_DIMENSIONS`, `EMOTION_VALENCE_COLOR`, `STAGE_META`, `STATUS_META`, `CONF_ORDER`, `PHASE_SHORT_LABELS`, timing constants (`CHANGE_BADGE_PULSE_TIMEOUT_MS`, `CHANGE_BADGE_SEEN_MS`).
- **`dossier/utils.ts`**:
  - `toChains(items)`: Grouping intel into refinement chains sorted by position.
  - `chainText(chain)`: Search text generator.
  - `phaseLabel(phase, phases)` & `phaseShortLabel(phase, phases)`.
  - `confidenceOf(item)`: Normalizing confidence state.
  - `getIntelPipStatus(item)` & `getIntelPips(st)` & `describeIntelPips(pips)`.
  - `getEmotionBucketMeta(metric, bucket)`.
  - `getSourceCaption(item)`: Plain language caption and icon for note origin.

### Phase 2: Custom Hooks Extraction
Move imperative effects and complex state machines out of the component:
- **`useDossierPaging`**:
  - Encapsulates `currentPageIndex`, `effectiveDossierData`, `requestPageChange`, `findStakeholderIndex`, `findStakeholderIndexByIntelId`.
  - Auto-switches page on `activeStakeholderId` change or `highlightedIntelId` change.
  - Auto-scrolls to highlighted sticky note.
- **`usePhaseChangeBadges`**:
  - Encapsulates comparison of power/interest between phases, `pulsingChangeIds`, `dismissedChangeIds`, pulse timeout (15s), and dwell timer (1s).
- **`useAppearAnimations`**:
  - Encapsulates `pendingAppearKeys`, signature change tracking, and consume timer.
- **`useWindowDrag`**:
  - Encapsulates `position`, `handleMouseDown`, and mousemove/mouseup listeners.
- **`useHoverInfoTag`**:
  - Encapsulates `infoTag` state, `showInfoTag`, `hideInfoTag`, and layout effect boundary clamping.

### Phase 3: Sub-component Extraction & CSS Scoping
Split the JSX and corresponding CSS into cohesive visual units:
1. **`EmotionRevealBadge`**:
   - Isolates badge render, portal positioning, 3-cell segment bars, and valence coloring.
   - Moves `.powerInterestBadge`, `.emotionBadge`, `.emotionRevealCard`, etc. to `EmotionRevealBadge.module.css`.
2. **`HeaderIconButton` & `DossierHeader`**:
   - Isolates icon buttons with portaled hover tag and header layout controls (Briefing, Performance, System, Log, Settings, Cheat Sheet, Prev/Next, Close).
3. **`DossierTabBar`**:
   - Bookmark tab strip with name word-break, emotion icons, key-player lightning/eye flags, change badges, and pip fill bar.
4. **`BuyInCard`**:
   - Self-contained buy-in breakdown bar with threshold notch, card/emotion stacked progress, and unrevealed lock overlay.
5. **`DossierFilterBar`**:
   - Dock footer with phase filter chips (Now + phase short labels), search input, confidence filter chips, and hidden note count counter.
6. **`IntelStickyNote`**:
   - Note body, rotation classes, paper colors (on_record, confirmed, inferred, unconfirmed, refuted), status badges, rubber stamps, trade-off highlighted text with `GlossaryText`, re-tag popover, chain history stack, locked layer count, drag-and-drop handler.
7. **`DossierPage`**:
   - Assembles the page scroll area: Polaroid snapshot & tape, avatar, role description, power/interest/intel summary badges, sticky note grid, ghost note, and empty state card.

### Phase 4: Main Component Assembly & Backward Compatibility
- Refactor `StakeholderDossier.tsx` to compose the hooks and sub-components.
- Keep `StakeholderDossier.tsx` at the root of `src/components/` so all existing imports throughout the project continue to work without modification.
- Re-export all public types (`IntelEntry`, `StakeholderDossierEntry`, `IntelChain`, etc.) and helper functions (`phaseLabel`, `phaseShortLabel`) from `StakeholderDossier.tsx`.

---

## Unit Testing Plan

### 1. Pure Utilities (`dossier/utils.test.ts`)
- **`phaseLabel` & `phaseShortLabel`**:
  - Retain and expand existing tests from [StakeholderDossier.test.tsx](file:///c:/Users/michal/Documents/DBIS/B4DMP/MLOps-Labs/game-ui/src/components/StakeholderDossier.test.tsx).
  - Verify edge cases: out-of-bounds indices, empty phase list, custom phase names.
- **`toChains`**:
  - Grouping items by `chain_id` or `id`.
  - Verifying `newest` vs `older` separation based on `chain_position`.
- **`confidenceOf` & `CONF_ORDER`**:
  - Public record items mark as `on_record`.
  - Inferred and refuted confidence mappings.
  - Sorting stability (unconfirmed/refuted first, verified/on_record after).
- **`getIntelPips` & `describeIntelPips`**:
  - Correct count of found vs hidden pips according to `intel_total`.
  - Correct pluralization in pip breakdown text.
- **`getEmotionBucketMeta`**:
  - Normal metrics (e.g. `trust`): high is good, low is bad.
  - Inverted metrics (e.g. `stress`, `perceived_risk`): low is good, high is bad.
  - Medium bucket neutral valence.
- **`getSourceCaption`**:
  - Correct icons and copy for `public_record`, `interview`, `debate`, `offline_artifact`.

### 2. Custom Hooks (`dossier/hooks/*.test.ts`)
- **`useDossierPaging`**:
  - Auto-switches page when `highlightedIntelId` matches an item on another page.
  - Auto-switches page when `activeStakeholderId` changes.
  - Fires `onActiveStakeholderChange` with `null` when switching to System page.
- **`usePhaseChangeBadges`**:
  - Identifies new stakeholder in current phase vs shifted power/interest.
  - Automatically clears pulsing state after 15s timeout.
  - Dismisses badge when tab is visited for > 1s dwell time.

### 3. Component Tests
- **`EmotionRevealBadge.test.tsx`**:
  - Renders compact badge with emotion name and micro-ticks.
  - Opens portal reveal card on focus/mouseenter with all 7 emotion dimensions and segment bars.
- **`BuyInCard.test.tsx`**:
  - Renders card progress, emotion progress, and total score.
  - Renders red notch at threshold percentage.
  - Displays lock overlay when `isRevealed` is false.
  - Displays "Boundary Violated" badge when `boundaryViolated` is true.
- **`DossierFilterBar.test.tsx`**:
  - Clicking "Now" filters to current phase; clicking again toggles off.
  - Typing in search input invokes search callback.
  - Confidence filter chip updates active filter state.
- **`IntelStickyNote.test.tsx`**:
  - Renders correct rubber stamp (★ ON RECORD, ✓ CONFIRMED, ✓ INFERRED, ✗ REFUTED, ? UNCONFIRMED).
  - Unconfirmed note opens re-tag popover on click; confirmed note does not.
  - Re-tag selection triggers websocket emit callback.
  - Highlights trade-off branch X and Y when `categorized_type === "trade_off"`.
- **`StakeholderDossier.test.tsx` (Integration)**:
  - Renders modal when `isOpen={true}`, returns null when `isOpen={false}` (and `isEmbedded={false}`).
  - Renders embedded mode with 100% dimensions when `isEmbedded={true}`.
  - Tab clicking navigates between stakeholder pages and the System page.

---

## Todo Tracker

- [ ] **Step 1: Domain Logic & Types**
  - [ ] Create `game-ui/src/components/dossier/types.ts` with all interfaces
  - [ ] Create `game-ui/src/components/dossier/constants.ts` with metadata maps
  - [ ] Create `game-ui/src/components/dossier/utils.ts` with pure calculation functions
  - [ ] Create `game-ui/src/components/dossier/utils.test.ts` and verify with Vitest
- [ ] **Step 2: Custom Hooks**
  - [ ] Create `useHoverInfoTag.ts`
  - [ ] Create `useWindowDrag.ts`
  - [ ] Create `useAppearAnimations.ts`
  - [ ] Create `usePhaseChangeBadges.ts`
  - [ ] Create `useDossierPaging.ts`
- [ ] **Step 3: Sub-components & CSS Splitting**
  - [ ] Extract `EmotionRevealBadge.tsx` + `EmotionRevealBadge.module.css` + unit test
  - [ ] Extract `HeaderIconButton.tsx` & `DossierHeader.tsx`
  - [ ] Extract `DossierTabBar.tsx` + `DossierTabBar.module.css`
  - [ ] Extract `BuyInCard.tsx` + `BuyInCard.module.css` + unit test
  - [ ] Extract `DossierFilterBar.tsx` + `DossierFilterBar.module.css` + unit test
  - [ ] Extract `IntelStickyNote.tsx` + `IntelStickyNote.module.css` + unit test
  - [ ] Extract `DossierPage.tsx` + `DossierPage.module.css`
- [ ] **Step 4: Orchestrator & Integration**
  - [ ] Refactor `StakeholderDossier.tsx` into concise orchestrator (< 250 LOC)
  - [ ] Clean up `StakeholderDossier.module.css` (keep only top-level modal/binder frame styles)
  - [ ] Update `StakeholderDossier.test.tsx` integration suite
  - [ ] Run full test suite (`npm run test`) and type check (`npm run build`)
