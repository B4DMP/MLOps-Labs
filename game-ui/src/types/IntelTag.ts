/**
 * Intel tags (plan 02). Driver, Boundary and Trade-off describe a stakeholder: an action on the
 * MLOps graph and how much they care about it. Facts are pre-authored Challenge-Intel, not player-taggable.
 * Every screen reads labels, icons and colours from here so the tags look the same everywhere.
 */
export type IntelTag = "driver" | "boundary" | "trade_off";

/** Existing per-component CSS classes each tag reuses, so colours stay consistent. */
export type IntelTagStyleKey = "requirement" | "preference" | "friction" | "default";

export interface IntelTagMeta {
  type: IntelTag | "fact";
  label: string;
  shortLabel: string;
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
    icon: "ph:scales-bold",
    color: "#d97706",
    about: "stakeholder",
    description: "Something they would give up or accept losing to get what they want.",
    styleKey: "friction",
  },
];

/** Display meta for "fact" items: shown on Challenge-Intel, never offered as a tag choice. */
export const CHALLENGE_INTEL_META: IntelTagMeta = {
  type: "fact",
  label: "Challenge-Intel",
  shortLabel: "CHI",
  icon: "ph:certificate-duotone",
  color: "#7c3aed",
  about: "system",
  description: "How the system stands at the start of the challenge.",
  styleKey: "default",
};

const FALLBACK: IntelTagMeta = {
  type: "driver",
  label: "Intel",
  shortLabel: "INTEL",
  icon: "ph:tag-bold",
  color: "#64748b",
  about: "stakeholder",
  description: "",
  styleKey: "default",
};

export function intelTagMeta(type?: string | null): IntelTagMeta {
  if (type === "fact") return CHALLENGE_INTEL_META;
  return INTEL_TAGS.find((t) => t.type === type) ?? FALLBACK;
}

export function intelTagLabel(type?: string | null): string {
  return intelTagMeta(type).label;
}
