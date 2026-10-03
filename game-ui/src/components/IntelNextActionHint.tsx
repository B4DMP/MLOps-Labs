import { useCallback, useState } from "react";
import styles from "./IntelNextActionHint.module.css";

/** Which control the artifact screen is pointing at right now. */
export type IntelHintKind = "tag" | "next" | "known" | "finish";

export const INTEL_HINT_TEXT: Record<IntelHintKind, string> = {
  tag: "Which of these fits what they just said? Pick one.",
  next: "Tagged. Press the arrow for the next artifact.",
  known: "Already on record, nothing to pick. Press the arrow.",
  finish: "All sorted. Press Finish & Continue.",
};

/** A hint fades once the player has acted on it this many times. */
const HINT_FADE_AFTER_USES = 2;
const STORAGE_PREFIX = "mlops_intel_next_hint_uses";

type UseCounts = Partial<Record<IntelHintKind, number>>;

function storageKey(userId: number): string {
  return `${STORAGE_PREFIX}:${userId}`;
}

function readCounts(userId: number): UseCounts {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(storageKey(userId)) ?? "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeCounts(userId: number, counts: UseCounts): void {
  try {
    window.localStorage.setItem(storageKey(userId), JSON.stringify(counts));
  } catch {
    // Best effort: without storage the hints simply keep showing.
  }
}

/** Per-user count of how often each hinted action was taken, so the tooltips stop once learned. */
export function useIntelHintUses(userId: number) {
  const [counts, setCounts] = useState<UseCounts>(() => readCounts(userId));

  const isLearned = useCallback((kind: IntelHintKind) => (counts[kind] ?? 0) >= HINT_FADE_AFTER_USES, [counts]);

  const recordUse = useCallback(
    (kind: IntelHintKind) => {
      setCounts((prev) => {
        const next = { ...prev, [kind]: (prev[kind] ?? 0) + 1 };
        writeCounts(userId, next);
        return next;
      });
    },
    [userId],
  );

  return { isLearned, recordUse };
}

interface IntelNextActionHintProps {
  kind: IntelHintKind;
  /** "inline" sits above the category buttons, "floating" hangs below the control it points at. */
  variant: "inline" | "floating";
}

export default function IntelNextActionHint({ kind, variant }: IntelNextActionHintProps) {
  return (
    <span
      role={variant === "floating" ? "tooltip" : undefined}
      id={`intel-hint-${kind}`}
      className={`${styles.hint} ${variant === "floating" ? styles.hintFloating : styles.hintInline}`}
    >
      {INTEL_HINT_TEXT[kind]}
    </span>
  );
}
