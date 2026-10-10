import type { Axis } from "../../utils/stageCanvas";

/**
 * What each axis means depends on whether the target is a component or a hand-off between
 * two (00-plan.md section 2.2), so the two inspectors introduce them accordingly.
 */
export const AXIS_HINTS: Record<"component" | "edge", Record<Axis, string>> = {
  component: {
    automation: "Who does the work: a person, or tooling.",
    governance: "How closely this component's own output is reviewed.",
  },
  edge: {
    automation: "Whether the hand-off fires by itself, or only when someone asks.",
    governance: "Whether this hand-off needs sign-off before it may happen.",
  },
};

export const AXIS_ICONS: Record<Axis, string> = {
  automation: "ph:lightning-bold",
  governance: "ph:shield-check-bold",
};

export const GOVERNANCE_INK = "#6d28d9";
