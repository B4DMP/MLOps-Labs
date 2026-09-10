# Intel provenance captions

## Problem

A playtester could not tell where an intel item came from. Right now the dossier note shows a
category and a stamp. It never says how the item got there.

There are four ways an item enters the dossier:

| # | How it got there | Where in code | Stamp today |
|---|---|---|---|
| A | Seeded at challenge start because the stakeholder said it in public | `load_known_intel_items_for_challenge` | `ON RECORD` |
| B | Player classified an offline artifact | `handle_intel_item_categorization` | `UNCONFIRMED` |
| C | Player verified it in Online Intel Gathering | `handle_intel_verification` | `CONFIRMED` |
| D | Stakeholder revealed or corrected it during Pitch & Debate | `correct_and_verify_intel_item` | `CONFIRMED` |

The two-stamp split separated A from C and D. C and D still look identical. B says nothing about
which artifact it came from.

## Fix

Store where each item came from. Show it as one line on the note.

## Backend

Add `IntelSource` enum to `domain/requirement.py`:

```
PUBLIC_RECORD = "public_record"
OFFLINE_ARTIFACT = "offline_artifact"
INTERVIEW = "interview"
DEBATE = "debate"
```

Add `source: IntelSource` to `StakeholderIntelItem`. Default `OFFLINE_ARTIFACT`.

Set it at each of the four write sites above.

Replace `is_public_record` with `source == PUBLIC_RECORD`. Do not keep both. The bool was the
narrow version of this field. `_is_public_record` in `intel_handler.py` becomes `_resolve_source`
and keeps the same fallback: read the persisted value, fall back to the artifact config's
`is_known` when it is missing.

Ship `source` on the dossier payload next to `intel_type`.

For B, also ship enough to name the artifact: `artifact_type` (email, Slack message, meeting
notes, document). Read it from `OfflineIntelArtifactFactory.get_artifact_for_requirement`.

## Frontend

Add `source` and `artifact_type` to `IntelEntry` in `StakeholderDossier.tsx`.

Render one caption line under the note body, small, muted, below the description:

| Source | Caption |
|---|---|
| A | Said openly in the team channel |
| B | Your read of their {artifact_type} |
| C | They told you this directly |
| D | Came out during the pitch |

Copy rules: player language, not system language. No enum names. No "intel item". No "verified"
where a plain verb works. Keep each caption under six words so it fits one line at note width.

B is the only caption that changes with data. Fall back to "Your read of a document" when
`artifact_type` is missing.

## Open questions

Does D need to name which stakeholder said it? It can be a different stakeholder than the one
whose note it is. Check whether `revealed_intel` carries the speaker. If it does, "Slipped out
when {name} pushed back" reads better than a generic line. If it does not, leave the generic line
and do not add plumbing for it yet.

## Not in scope

Clicking the caption to open the source artifact. That is the source-preview modal, tracked
separately. The caption should be plain text until that lands, then become the affordance.

## Test

- New game: A items read as public, B items name the artifact.
- Verify a wrong guess in Online Intel: caption flips from B to C along with the stamp.
- Save from before this change: captions still resolve through the artifact-config fallback.
