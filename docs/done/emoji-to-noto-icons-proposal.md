# Proposal: swap raw emoji for Iconify `noto:` icons, via a central registry

## Why

Raw emoji characters (`📣`, `💬`, `🎯`, ...) render however the player's OS emoji font
draws them — flat monochrome on some Linux setups, a different art style on Windows vs.
macOS vs. Android. Iconify's `noto:` collection ships the actual Google Noto Color Emoji
artwork as SVG, fetched the same way this project already fetches every `ph:` icon
(`@iconify/react`'s `<Icon>` component, already a dependency — no new package). That
gives every player the same rich, colorful art, while keeping the "let's use emoji, they're
expressive" instinct that was behind the original choice.

## Two different jobs the emoji were doing — they don't all migrate the same way

Going through the audit, the emoji in this codebase fall into two groups that need
different treatment:

1. **Decorative / flavor emoji** — chat reactions, wiki emblems, checklist bullets,
   callout tone-markers (💡🔍⚠️). These just need to *look right*. Noto is a straight
   swap: drop the character, use the matching `noto:` icon, done. This is almost
   everything in the list below.

2. **Functional, dynamically-recolored glyphs** — the edge-trigger chip in
   [nodeChrome.tsx](../../game-ui/src/components/graph/nodeChrome.tsx) (`<text fill={color}>{glyph}</text>`)
   and the same `TRIGGER_ICONS` glyphs used in `PerformanceDashboard.tsx` and
   `ComposeActionProposalModal.tsx`. These are tinted at render time to match the
   edge/state color, the same trick we just applied to the intel category tags
   (`ph:target-bold` etc. colored via `style={{ color }}`). A Noto icon is a fixed-color
   raster asset — it can't take a `color` override, so putting one here would silently
   drop the color-coding these chips exist to carry. **Recommendation: leave these on
   Phosphor solid icons** (`ph:*-bold`, not `-duotone`, so they read as clean line art at
   9–14px), not Noto. This is a smaller, separate fix from the one below — flagging it
   here so it doesn't get lost, but proposing it stays out of this pass unless you want
   it folded in.

Everything under "Decorative" in the table below is what this pass would actually touch.

## Central registry

New file: `game-ui/src/utils/emojiIcons.ts`

```ts
import { Icon, type IconProps } from "@iconify/react";

/** Every decorative emoji in the UI, one name -> one Iconify id. Change the art here,
 *  not at the call site. Functional/recolored glyphs (edge trigger chips) are NOT here -
 *  see nodeChrome.tsx / stageCanvas.ts's TRIGGER_ICONS, which stay on Phosphor on purpose. */
export const EMOJI_ICON = {
  publicChannel: "noto:megaphone",       // 📣 was: public-record channel marker
  chatThread: "noto:speech-balloon",     // 💬 was: thread / DM marker
  members: "noto:busts-in-silhouette",   // 👥
  reactionThumbsUp: "noto:thumbs-up",    // 👍
  reactionEyes: "noto:eyes",             // 👀
  reactionRocket: "noto:rocket",         // 🚀
  wiki: "noto:books",                    // 📚
  contributor: "noto:bust-in-silhouette",// 👤
  actionItems: "noto:clipboard",         // 📋
  checklistDone: "noto:ballot-box-with-check", // ☑
  // ☐ has no Noto equivalent (not a real Unicode emoji, just a dingbat) - stays ph:square
  driverTarget: "noto:direct-hit",       // 🎯 (IntelTag.ts - see note below)
  boundaryStop: "noto:stop-sign",        // 🛑
  tradeOffScale: "noto:balance-scale",   // ⚖️
  emotion: "noto:performing-arts",       // 🎭
  avatarGlasses: "noto:glasses",         // 👓
  avatarBeard: "noto:bearded-person",    // 🧔
  tokenCoin: "noto:coin",                // 🪙
  techDebtReceipt: "noto:receipt",       // 🧾
  cardJoker: "noto:joker",               // 🃏
  searchGlass: "noto:magnifying-glass-tilted-left", // 🔍
  tip: "noto:light-bulb",                // 💡
  vetoStrip: "noto:prohibited",          // 🚫 (VetoDialog strips this from raw text)
} as const;

export type EmojiIconName = keyof typeof EMOJI_ICON;

export function EmojiIcon({ name, ...props }: { name: EmojiIconName } & Omit<IconProps, "icon">) {
  return <Icon icon={EMOJI_ICON[name]} {...props} />;
}
```

Note on `driverTarget` / `boundaryStop` / `tradeOffScale`: these three plus
`⛓`/`⚠️`/`⛔` and the status dots (`🟢🟡🔴`) are also candidates, but several of them
*are* the same kind of dynamically-recolored functional glyph as group 2 above (status
pips, "resistant/wavering/committed" stakeholder states color-code by CSS class already).
Where a spot already gets its color from a CSS class or `styleClass` rather than from the
character itself, recommend leaving it Phosphor + CSS-colored rather than Noto, for the
same reason as the trigger chips. The table below calls out which is which.

## Full inventory → proposed mapping

All `noto:` ids below were verified to exist against the live Iconify API before writing
this (`api.iconify.design/noto.json?icons=...`) — none are guesses.

| Emoji | Where | Group | Proposal |
|---|---|---|---|
| 📣 | `IntelArtifactViewer.tsx:109` public-channel marker | Decorative | `noto:megaphone` |
| 💬 | `IntelArtifactViewer.tsx:109,144`; `StakeholderInteractionArea.tsx:323` | Decorative | `noto:speech-balloon` |
| 👥 | `IntelArtifactViewer.tsx:116` member count | Decorative | `noto:busts-in-silhouette` |
| 👍 | `IntelArtifactViewer.tsx:141` reaction chip | Decorative | `noto:thumbs-up` |
| 👀 | `IntelArtifactViewer.tsx:142` reaction chip | Decorative | `noto:eyes` |
| 🚀 | `IntelArtifactViewer.tsx:143` reaction chip | Decorative | `noto:rocket` |
| 📚 | `IntelArtifactViewer.tsx:160` wiki header | Decorative | `noto:books` |
| 👤 | `IntelArtifactViewer.tsx:163` contributor line | Decorative | `noto:bust-in-silhouette` |
| 📋 | `IntelArtifactViewer.tsx:178`; `StakeholderDossier.tsx:2306` | Decorative | `noto:clipboard` |
| ☑ | `IntelArtifactViewer.tsx:179` | Decorative | `noto:ballot-box-with-check` |
| ☐ | `IntelArtifactViewer.tsx:180` | Decorative | no Noto equivalent — keep `ph:square-bold` |
| 🎯🛑⚖️🛡️🏷️ | `IntelTag.ts` `emoji` field | **Already fixed** | Now rendered via `icon`/`color` fields (Phosphor, CSS-recolored) — the `emoji` field is dead weight; suggest deleting it once nothing reads it |
| ⚡ | `ActionCardCardComponent.tsx:322`; `ComposeActionProposalModal.tsx` glyphs; `PowerInterestMatrix.tsx:540` | Mixed — check if `color`-tinted at each site | Where plain text: `noto:high-voltage`. Where dynamically colored: keep Phosphor |
| ❓ | `ActionCardCardComponent.tsx:334` | Decorative | `noto:question-mark` |
| ⛓ | `ActionCardCardComponent.tsx:339`; `PerformanceDashboard.tsx:1358` | Check color-tint | Likely Phosphor `ph:link-break-bold` if state-colored |
| 🟢🟡🔴 | `ac_simulation.tsx:845-848`; `CheatSheetModal.tsx:115` | Functional (state color) | Keep as CSS-colored dots/Phosphor, not Noto — the color *is* the signal |
| ✋⏰📦📊🆕📉🚨✅ | `stageCanvas.ts` `TRIGGER_ICONS`, consumed by `nodeChrome.tsx` (SVG `<text fill={color}>`) and chip labels in `PerformanceDashboard.tsx`/`ComposeActionProposalModal.tsx` | **Functional, recolored** | Keep Phosphor solid icons, not Noto (see "two jobs" above) |
| 👁 | `ComposeActionProposalModal.tsx`; `PowerInterestMatrix.tsx:541` | Check color-tint | Plain text → `noto:eye`; if colored, keep Phosphor |
| 🎭 | `ConfigEditor.tsx:528`; `StakeholderDossier.tsx:1890` | Decorative | `noto:performing-arts` |
| 👓 | `ConfigEditor.tsx:617` | Decorative | `noto:glasses` |
| 🧔 | `ConfigEditor.tsx:622` | Decorative | `noto:bearded-person` |
| 🪙 | `EngagementCards.tsx:74` | Decorative | `noto:coin` |
| 🧾 | `PerformanceDashboard.tsx:1364` | Decorative | `noto:receipt` |
| ⛔ | `StakeholderDossier.tsx:1835,1837` (Boundary Violated / Resistant) | Functional (state color) | Keep CSS-colored, Phosphor `ph:prohibit-bold` (matches `IntelTag.ts` boundary icon) |
| ⚠️ | `StakeholderDossier.tsx:1840` (Wavering) | Functional (state color) | Keep CSS-colored Phosphor `ph:warning-bold` |
| 🃏 | `StakeholderDossier.tsx:1889` | Decorative | `noto:joker` |
| 🔍 | `StakeholderDossier.tsx:2306` (empty-state) | Decorative | `noto:magnifying-glass-tilted-left` |
| 💡 | `StakeholderDossier.tsx:2317,2319` | Decorative | `noto:light-bulb` |
| 🚫 | `VetoDialog.tsx:124` (stripped from text, not rendered as an icon) | N/A | No change needed — it's a regex strip, not a display glyph |

"Functional (state color)" rows need a quick look at each call site before deciding —
some of these (⚡❓⛓👁) might turn out to be plain decorative text with no `color`/`fill`
prop, in which case they go straight to Noto too. I didn't want to guess without reading
each render site; that's the first step of implementation, not something to settle in
this proposal.

## Sequencing

1. Confirm this split (decorative → Noto, functional/recolored → stays Phosphor) is the
   right call — in particular whether you want the trigger-chip Phosphor conversion
   (currently still raw emoji, same OS-dependency bug, just not swapped to Noto) folded
   into this pass or done separately.
2. Add `emojiIcons.ts` + `EmojiIcon` component.
3. Sweep the "Decorative" rows above, file by file, swapping the literal character for
   `<EmojiIcon name="..." />`.
4. For each "check color-tint" row, read the call site, then route to Noto or Phosphor
   accordingly.
5. Delete the now-dead `emoji` field on `IntelTagMeta` (`IntelTag.ts`) once nothing reads
   it, rather than leaving an unused fallback.
6. `docker compose exec ui npx tsc --noEmit` after each file to keep the diff verifiable
   in small steps rather than one giant multi-file commit.

No visual QA in a real browser was done for this proposal — once you sign off on the
mapping, implementation should include an actual look at a few of these (chat reactions,
the wiki header, the empty-state icons) since Noto's rendered size/baseline can look
different from Phosphor's next to the same text.
