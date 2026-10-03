import { formatAxisLevel } from "./stageCanvas";

/** Hover sentence for a hand-off, built from the two component names and the edge's own state. */
export function describeHandoff(
  fromName: string,
  toName: string,
  edge: { automation?: number; governance?: number; trigger?: string },
): string {
  const auto = edge.automation ?? 1;
  const fires =
    auto <= 0
      ? "Broken, so nothing flows."
      : auto === 1
      ? "Not set up yet, so nothing flows."
      : auto === 2
      ? `Fires only when asked (${formatAxisLevel("automation", auto)}).`
      : `Fires by itself (${formatAxisLevel("automation", auto)}).`;
  const gov = edge.governance ?? 0;
  const signOff =
    gov > 0
      ? `Needs sign-off (${formatAxisLevel("governance", gov)}).`
      : `Needs no sign-off (${formatAxisLevel("governance", gov)}).`;
  return `Hand-off from ${fromName} to ${toName}. ${fires} ${signOff}`;
}
