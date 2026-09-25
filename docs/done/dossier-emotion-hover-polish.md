# Dossier emotion hover polish

## Problem

Three things came up while spot-checking `test1`'s emotional states in the dossier
(`StakeholderDossier.tsx`, `EmotionRevealBadge`):

1. **Hover reveal only shows the states's own gating dimensions.** `derive_gating_dimensions`
   (`game-api/src/mlops_serious_game/domain/emotion_factory.py:207`) returns only the 2-4
   dimensions that appear in the *winning* state's `conditions` (e.g. `angry` only surfaces
   `fairness`/`trust`/`stress` - the other four dimensions never show up even though the backend
   already has them). A player who wants to understand a stakeholder's full mood, or move a
   dimension the current state doesn't mention, can't see it.

2. **No guidance on how to move a dimension.** The reveal card names each dimension and its
   bucket (Low/Med/High) but gives no hint about what raises or lowers it. Players are left to
   infer cause and effect from trial and error.

3. **The compact badge micro-ticks are unreadable.** Next to the badge label,
   `EmotionRevealBadge` renders up to 3 `<span className={styles.emotionMicroTick}>` bars
   (`StakeholderDossier.tsx:481-489`). Each bar's CSS class comes from
   `getEmotionBucketMeta(dim.metric, dim.bucket).tickClass`
   (`StakeholderDossier.tsx:371-378`), which only ever picks one of three magnitude classes:

   | Bucket | height | opacity |
   |---|---|---|
   | `emotionTickLow` | 5px | 0.4 |
   | `emotionTickMedium` | 8px | 0.65 |
   | `emotionTickHigh` | 11px | 0.95 |

   (`StakeholderDossier.module.css:647-660`). All three bars render in the same `currentColor`
   (the emotion's own color) - magnitude is the *only* thing encoded, via a few px of height and
   a bit of opacity, with no valence (good/bad) distinction and no per-dimension identity. That's
   why the observed patterns (`angry` -> `--|`, `frustrated` -> `|--`, `anxious` -> `ooo`,
   `relieved` -> `-o|`) don't read as anything: they're just whichever 2-3 conditions that state
   happens to test, in condition-declaration order, rendered as near-identical thin bars a couple
   of pixels apart in height. The reveal *card* solves this already with its 3-cell segment bar
   plus good/bad color (`getEmotionBucketMeta`'s valence branch, `emotionFillGood` vs
   `emotionFillHigh`) - the compact badge version just doesn't reuse it.

Separately: the stakeholder portrait polaroid (`.polaroidFrame`, `StakeholderDossier.module.css:483-498`,
currently `width: 104px`) is a bit large relative to the rest of the header and should shrink.

## Fix

### 1. Show all 7 dimensions on hover, not just the gating ones

Keep the compact badge micro-ticks limited to the current gating dimensions (that's the "why this
state" signal and should stay focused) - but the reveal *card* should show all 7 emotion
dimensions, not just the 2-4 that gate the current state.

Backend: add a new `EmotionFactory` method (or extend `get_emotion_dimensions_dict`) that returns
*all* configured dimensions bucketed, e.g. `derive_all_dimensions(ev) -> list[{metric, bucket}]`,
reusing `_bucket_dimension_value`. Ship it alongside the existing gating info so nothing that
already reads `emotion_dimensions` breaks:

```python
"emotion_dimensions": EmotionFactory.get_emotion_dimensions_dict(emotion_values_dict),
"emotion_dimensions_full": EmotionFactory.get_all_dimensions_dict(emotion_values_dict),
```

Frontend: `EmotionRevealBadge` renders the reveal card from `gatingInfo.dimensions` today
(`StakeholderDossier.tsx:501-521`). Change it to render from the full 7-dimension list, and bold
or otherwise mark which of those are the ones actually gating the current state (reuse
`gatingInfo.dimensions` to compute a `Set<string>` of gating metric names for that highlight).
Order: gating dimensions first, then the rest in a fixed, stable order (the `EMOTION_DIMENSION_LABEL`
key order already gives one).

### 2. Short "how to influence" hint per dimension

Add a one-line, player-facing hint per dimension, shown on hover/focus of that dimension's row
(reuse the existing `title` attribute for a zero-cost tooltip, consistent with how
`EmotionRevealBadge` itself falls back to a `title` when there's no reveal). Keep each hint under
~8 words, framed as an action, not a mechanic:

| Dimension | Hint |
|---|---|
| `trust` | Deliver what you promised them |
| `interest` | Keep addressing what they actually asked for |
| `stress` | Resolve their blockers, avoid boundary breaches |
| `confidence` | Ship clean, working simulation runs |
| `perceived_risk` | Close compliance and safety gaps |
| `sense_of_control` | Give their agenda a real seat at the table |
| `fairness` | Match their share of demands with a share of slots |

Source: the dimension weight table in
`docs/plans/pitch-debate-and-intel-item-redesign/02-stakeholder-emotion-changes.md` (section 2.4)
and the malus/veto tables in the same doc (sections 3-4) - these hints should stay consistent with
whatever actually moves that dimension in `domain/emotion.py`, so if those weights change, revisit
the copy.

Add a static `EMOTION_DIMENSION_HINT: Record<string, string>` next to `EMOTION_DIMENSION_LABEL` in
`StakeholderDossier.tsx` and wire it into each `emotionDimRow`'s `title`.

### 3. Redesign the compact badge micro-ticks

Replace the height/opacity-only bars with the same encoding the reveal card already uses and
players can already read: a small 3-cell segment indicator, filled up to the bucket's level, in
the dimension's *valence* color (good/bad), not just the state's color. Concretely, reuse
`getEmotionBucketMeta` exactly as the reveal card does (it already returns a `fillClass` chosen by
good/bad, not just magnitude) instead of the current `tickClass`-only lookup.

Practically: replace `.emotionMicroTick` (a single variable-height bar) with a mini version of
`.emotionDimSegments`/`.emotionDimSegment` (3 fixed-size cells, `seg === level` filled) at a
smaller scale (e.g. 3x4px cells instead of the card's full-size ones). This makes the badge and
the reveal card visually consistent - hovering just "zooms in" on the same shape, rather than
switching to a different encoding.

Keep the `is_current: false` (pending/leaning) treatment - dashed border, muted fill - matching
today's `emotionMicroTicksPending`/`emotionMicroTickPending`.

### 4. Shrink the stakeholder portrait

`.polaroidFrame` (`StakeholderDossier.module.css:483-498`) is `width: 104px`. Shrink it modestly,
e.g. to `88px`, and rescale `.sellotape`'s `left`/`width` (`StakeholderDossier.module.css:514-526`,
currently `left: 26px; width: 52px`) proportionally so the tape stays centered on the narrower
frame. Check `.polaroidCaption` font-size still fits at the new width without wrapping badly for
the longest stakeholder name.

## Open questions

- Should the full 7-dimension reveal card get taller/scroll, or is 7 rows always going to fit
  comfortably at the current `.emotionRevealCard` width (210px)? Rough check: 7 rows at the
  current `.emotionDimRow` line-height/gap (~18-20px each) is ~140px, which should still fit
  without scrolling, but confirm against the viewport-edge flip logic in the `useLayoutEffect`
  (`StakeholderDossier.tsx:433-452`) once real content is in.
- Exact shrink amount for the portrait (88px vs something else) - pick by eye once the header
  layout is in front of us; not worth over-specifying here.

## Not in scope

- Changing how emotion states/dimensions are computed (`domain/emotion.py`,
  `EmotionValueConfig.json`) - this is presentation only.
- Per-dimension history/trend (whether a dimension is rising or falling) - the hint is static
  guidance, not a live trend indicator.

## Test

- Hover each of the 9 emotional states (or force them via the DB, as done for `test1`) and confirm
  the reveal card lists all 7 dimensions, with the gating ones visually distinguished.
- Hover/focus a dimension row and confirm the short hint tooltip appears.
- Confirm the compact badge ticks now show filled/empty cells in a valence color, and that a
  `neutral`/pending stakeholder still renders the dashed "leaning toward" treatment.
- Confirm the portrait still centers its tape and caption at the new width, across the longest
  stakeholder display name in `GameStakeholders.json`.
