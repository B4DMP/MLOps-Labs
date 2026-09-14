# Engagement cards

## Where they stand

Five cards in `gameConfig/GameEngagementCards.json`, played in the pitch phase's GATHER stage.

| Card | Cost | Targets | Settles per target |
|---|---|---|---|
| `eng_0` Verify Intel Item | 5 | one held note | that note: verified, corrected if filed wrong |
| `eng_1` 1-on-1 Deep Dive | 4 | 1 stakeholder | 3 notes, any tag |
| `eng_2` Probe Requirements | 3 | 2 stakeholders | 1 Boundary |
| `eng_3` Team Sync-up | 2, once per phase | the whole room | 1 note, any tag |
| `eng_4` Ask Generic Question | 1 | 1 stakeholder | 1 Driver |

Done already:

- Cards 1 to 4 check before they reveal (`plan_engagement` in `online_intel_service/nodes.py`).
  Unconfirmed notes the player holds on the target are verified first, then the rest of
  `intel_reveal_count` reveals notes not found yet. The tag filter reads held notes by the
  player's own tag, so passing one over gives nothing away.
- Cards only reach stakeholders in the current phase (`phase_room`). Team Sync-up reaches all of them.
- A target with a full intel counter is greyed out in the target modal. A card with no target
  left is greyed out in the fan. Counts only, never tags.
- Cards 1 to 4 send `intel:dossier_data`, so the dossier panel refreshes.
- Verify Intel Item is wired in the pitch phase (it had no notes and no confirm handler).

## Open

### 1. Probe Requirements says more than it does

The description promises "several stakeholder's requirements". The filter is Boundary only.
Either rename it to what it is ("Find the red lines") or widen the filter. Renaming is cheaper
and keeps the card distinct from the Deep Dive.

### 2. Tag-filtered cards can still come up empty

Greying uses the counter, which does not know tags on purpose. A stakeholder with only a hidden
Driver left is a valid Probe Requirements target and gives nothing back. Options: refund the
tokens when a card settles nothing, or have the stakeholder say so ("nothing new on hard limits").
Do not grey by tag: that tells the player which tags are left.

### 3. No card reaches Facts

Facts belong to no stakeholder, so cards 1 to 4 never find or check them. This is the deferred
Investigate card from plan 02 and plan 06: target a pipeline stage, settle Facts on that stage
the same check-then-reveal way, grey it by the System page counter.

### 4. No card verifies a convincer archetype

Only the pitch does (`_verify_heard` in `pitch_handler.py`). Candidates, cheapest first:

- **Read the Room.** One stakeholder with a tagged, unverified archetype. Verifies or corrects it.
  The Verify Intel Item of archetypes. Simple, but teaches nothing about the archetypes themselves.
- **Fold it into the Deep Dive.** A tagged, unverified archetype takes one of the three slots,
  before notes. No new card, no new UI.
- **Trial Balloon.** Player picks a stakeholder and pitches one idea in one archetype's language.
  The stakeholder reacts warm or cold. A match verifies the tag; a miss only rules that archetype
  out and marks it struck through in the re-tag picker. Teaches reading reactions, which is what
  archetypes are for. Needs a struck-out state per stakeholder and a reaction prompt.
- **Ask a Colleague.** Ask A how to win over B. Returns B's archetype hint text again
  (`ConvincerArchetypeArtifactFactory`) in A's voice. A second clue, never a verification.

Leaning: Trial Balloon, with Read the Room as the fallback if playtests find it too slow.

### 5. Card economy after the change

A Deep Dive (4) now settles three things, held or new. Verify Intel Item (5) settles one, but
chosen. Check in playtest whether anyone still plays `eng_0`; if not, drop it to 2 or 3.

### 6. Corrections by cards 1 to 4 are quiet

A checked note that was filed wrong gets corrected, and the stamp flips in the dossier. There is
no popup like Verify Intel Item's. The revealed item already carries `was_checked` and
`old_categorized_type`, so the chat bubble or `IntelVerificationDialog` can show it.
