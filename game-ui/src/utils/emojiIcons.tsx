import { Icon, type IconProps } from "@iconify/react";

/**
 * Every decorative emoji in the UI, one semantic name -> one Iconify id, so the art can be
 * changed in one place instead of hunting down every literal character. Most entries are
 * `noto:*` (Google's colored emoji artwork, OS-independent unlike a raw emoji character, which
 * renders however the player's own OS emoji font draws it). A few are Phosphor icons instead:
 * Noto is a fixed-color raster asset that can't take a `color` override, so anything that needs
 * to be recolored at render time (status/state glyphs) stays Phosphor here, and anywhere else it
 * still appears as a literal character in the codebase - see docs/plans/emoji-to-noto-icons-proposal.md.
 */
export const EMOJI_ICON = {
  publicChannel: { icon: "noto:megaphone" }, // 📣
  chatThread: { icon: "noto:speech-balloon" }, // 💬
  members: { icon: "noto:busts-in-silhouette" }, // 👥
  reactionThumbsUp: { icon: "noto:thumbs-up" }, // 👍
  reactionEyes: { icon: "noto:eyes" }, // 👀
  reactionRocket: { icon: "noto:rocket" }, // 🚀
  wiki: { icon: "noto:books" }, // 📚
  contributor: { icon: "noto:bust-in-silhouette" }, // 👤
  actionItems: { icon: "noto:clipboard" }, // 📋
  checklistDone: { icon: "ph:check-square-duotone", color: "#16a34a" }, // ☑ (no Noto ballot-box glyph)
  checklistTodo: { icon: "ph:square-duotone", color: "#94a3b8" }, // ☐
  emotion: { icon: "noto:performing-arts" }, // 🎭
  avatarGlasses: { icon: "noto:glasses" }, // 👓
  avatarBeard: { icon: "noto:bearded-person" }, // 🧔
  tokenCoin: { icon: "noto:coin" }, // 🪙
  techDebtReceipt: { icon: "noto:receipt" }, // 🧾
  cardJoker: { icon: "noto:joker" }, // 🃏
  searchGlass: { icon: "noto:magnifying-glass-tilted-left" }, // 🔍
  tip: { icon: "noto:light-bulb" }, // 💡
  questionMark: { icon: "noto:question-mark" }, // ❓
  chains: { icon: "noto:chains" }, // ⛓
  dotGreen: { icon: "noto:green-circle" }, // 🟢
  dotYellow: { icon: "noto:yellow-circle" }, // 🟡
  dotRed: { icon: "noto:red-circle" }, // 🔴
  power: { icon: "ph:lightning-fill", color: "#eab308" }, // ⚡ - reuses the yellow already used for it elsewhere
  balanceScale: { icon: "noto:balance-scale" }, // ⚖️ (decorative headings - the intel "trade_off" tag itself stays Phosphor, see IntelTag.ts)
  noEntry: { icon: "noto:no-entry" }, // ⛔
  checkMark: { icon: "noto:check-mark-button" }, // ✅
  warning: { icon: "noto:warning" }, // ⚠️
  vetoStrip: { icon: "noto:prohibited" }, // 🚫
} as const;

export type EmojiIconName = keyof typeof EMOJI_ICON;

export function EmojiIcon({ name, style, ...props }: { name: EmojiIconName } & Omit<IconProps, "icon">) {
  const def = EMOJI_ICON[name];
  return <Icon icon={def.icon} style={"color" in def ? { color: def.color, ...style } : style} {...props} />;
}
