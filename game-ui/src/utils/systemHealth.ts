/**
 * Shared with PerformanceView and the dossier header's Performance badge, so "how is the
 * system doing" always reads the same bucket boundaries and colour, whichever chrome shows it.
 * The player never sees the raw number, only where it sits.
 */

export type HealthBucket = "healthy" | "strained" | "failing" | "unknown";

export function healthBucket(value?: number): HealthBucket {
  if (value === undefined) return "unknown";
  if (value > 75) return "healthy";
  if (value > 45) return "strained";
  return "failing";
}

export const HEALTH_BUCKET_WORD: Record<HealthBucket, string> = {
  healthy: "holding up",
  strained: "strained",
  failing: "failing",
  unknown: "unclear",
};

export function healthBucketColor(bucket: HealthBucket): string {
  if (bucket === "healthy") return "#198754";
  if (bucket === "strained") return "#fd7e14";
  if (bucket === "failing") return "#dc3545";
  return "#6c757d";
}
