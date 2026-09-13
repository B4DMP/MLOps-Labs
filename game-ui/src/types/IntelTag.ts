/**
 * Intel tags (plan 02). Driver, Boundary and Trade-off describe a stakeholder: an action on the
 * MLOps graph and how much they care about it. Fact describes the system itself.
 * Every screen reads labels, icons and colours from here so the tags look the same everywhere.
 */
export type IntelTag = "driver" | "boundary" | "trade_off" | "fact";

/** Existing per-component CSS classes each tag reuses, so colours stay consistent. */
export type IntelTagStyleKey = "requirement" | "preference" | "friction" | "default";

export interface IntelTagMeta {
  type: IntelTag;
  label: string;
  shortLabel: string;
  /** Emoji for compact labels. */
  emoji: string;
  /** Iconify icon id. */
  icon: string;
  color: string;
  about: "stakeholder" | "system";
  /** One line the player sees while tagging. */
  description: string;
  styleKey: IntelTagStyleKey;
}

export const INTEL_TAGS: IntelTagMeta[] = [
  {
    type: "driver",
    label: "Driver",
    shortLabel: "DRV",
    emoji: "🎯",
    icon: "ph:target-bold",
    color: "#16a34a",
    about: "stakeholder",
    description: "Something they want improved. More is better, and they can live with less.",
    styleKey: "preference",
  },
  {
    type: "boundary",
    label: "Boundary",
    shortLabel: "BND",
    emoji: "🛑",
    icon: "ph:prohibit-bold",
    color: "#2563eb",
    about: "stakeholder",
    description: "A line they will not cross. Break it and they refuse.",
    styleKey: "requirement",
  },
  {
    type: "trade_off",
    label: "Trade-off",
    shortLabel: "TRD",
    emoji: "⚖️",
    icon: "ph:scales-bold",
    color: "#d97706",
    about: "stakeholder",
    description: "Something they would give up or accept losing to get what they want.",
    styleKey: "friction",
  },
  {
    type: "fact",
    label: "Fact",
    shortLabel: "FACT",
    emoji: "🔎",
    icon: "ph:magnifying-glass-bold",
    color: "#64748b",
    about: "system",
    description: "How the system is right now. Nobody's wish, just the state of things.",
    styleKey: "default",
  },
];

const FALLBACK: IntelTagMeta = {
  type: "driver",
  label: "Intel",
  shortLabel: "INTEL",
  emoji: "🏷️",
  icon: "ph:tag-bold",
  color: "#64748b",
  about: "stakeholder",
  description: "",
  styleKey: "default",
};

export function intelTagMeta(type?: string | null): IntelTagMeta {
  return INTEL_TAGS.find((t) => t.type === type) ?? FALLBACK;
}

export function intelTagLabel(type?: string | null): string {
  return intelTagMeta(type).label;
}
