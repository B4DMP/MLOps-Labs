import { useContext } from "react";
import { Icon } from "@iconify/react";
import { PhasesContext } from "./PhaseProvider";
import styles from "./PhaseOverview.module.css";

/**
 * Lifecycle breadcrumb for the Performance Dashboard header. Chevrons point along the MLOps
 * lifecycle, so the shape itself says "these run in order"; the description is a hover card
 * rather than body copy, which keeps the whole rail one header row tall.
 */
/** A representative icon for a lifecycle phase, keyed by (part of) its name rather than its
 *  index - phase 0 is a skipped tutorial in some game states (see `isFirstPlayablePhase`), so
 *  position in the array isn't a stable way to tell phases apart. Stands in for a plain number
 *  on every upcoming phase, compact or not - unlike a number, it means the same thing wherever
 *  it's read. */
function iconForPhase(phaseName: string): string {
  const name = phaseName.toLowerCase();
  if (name.includes("introdu")) return "ph:flag-duotone";
  if (name.includes("requirement")) return "ph:clipboard-text-duotone";
  if (name.includes("data")) return "ph:database-duotone";
  if (name.includes("deploy")) return "ph:rocket-launch-duotone";
  if (name.includes("model")) return "ph:brain-duotone";
  if (name.includes("monitor") || name.includes("usage")) return "ph:gauge-duotone";
  return "ph:circle-duotone";
}

export interface PhaseOverviewProps {
  /** Tiny variant for headers too narrow for six full-width segments: every phase except the
   *  current one collapses to just its marker icon (name still reachable via the hover tip),
   *  so only the active phase claims a share of the leftover width. */
  compact?: boolean;
}

export default function PhaseOverview({ compact = false }: PhaseOverviewProps) {
  const { currentPhase, phases } = useContext(PhasesContext);

  // Equal columns for every phase, one content-sized column for the tail. Set here rather
  // than in CSS because only this component knows how many phases there are. In compact mode
  // every phase is only as wide as its own content, EXCEPT the active one: it's the only track
  // that should grow to fill the leftover width, so it's the only one given an `fr` share.
  // Every other track (done/upcoming icons and the tail) is `max-content`, deliberately never
  // the bare `auto` keyword - with an `fr` track absent, CSS Grid would otherwise distribute
  // leftover free space equally across every `auto`-sized track too (the "stretch to fill" step
  // of the track sizing algorithm), which is what turned the tail's own column into a second,
  // competing patch of blank space instead of a small fixed one.
  const phaseColumns = compact
    ? phases
        .map((_, index) => (index === currentPhase ? "minmax(0, 1fr)" : "minmax(0, max-content)"))
        .join(" ")
    : `repeat(${phases.length}, minmax(0, 1fr))`;
  const tailColumn = compact ? "minmax(0, max-content)" : "auto";

  return (
    <ol
      className={`${styles.rail} ${compact ? styles.compact : ""}`}
      style={{ gridTemplateColumns: `${phaseColumns} ${tailColumn}` }}
      aria-label="MLOps lifecycle phases"
    >
      {phases.map((phase, index) => {
        const state =
          index > currentPhase ? "upcoming" : index === currentPhase ? "active" : "done";
        const isIconOnly = compact && state !== "active";
        // A tip anchored to its step's left edge opens rightward - fine for the first half of
        // the rail, but past the midpoint it starts running off whatever the rail's own right
        // edge is (the header, the card). Flipping it to the step's right edge for the second
        // half keeps it opening back toward the rail instead.
        const flipTip = index >= Math.ceil(phases.length / 2);

        return (
          <li
            key={phase.phase_name}
            className={`${styles.step} ${styles[state]} ${index === 0 ? styles.first : ""} ${
              isIconOnly ? styles.iconOnly : ""
            } ${flipTip ? styles.tipFlip : ""}`}
            tabIndex={0}
            aria-current={state === "active" ? "step" : undefined}
            aria-label={isIconOnly ? phase.phase_name : undefined}
          >
            <span className={styles.marker} aria-hidden>
              {state === "done" ? (
                <Icon icon="ph:check-bold" />
              ) : (
                <Icon icon={iconForPhase(phase.phase_name)} />
              )}
            </span>
            {!isIconOnly && <span className={styles.stepName}>{phase.phase_name}</span>}

            <span className={styles.tip} role="tooltip">
              <strong className={styles.tipTitle}>{phase.phase_name}</strong>
              <span className={styles.tipBody}>{phase.phase_desc ?? "Phase description"}</span>
            </span>
          </li>
        );
      })}

      {/* Not a phase: the faint tail of the rail, saying the lifecycle is a spiral. The game
          plays one turn of it, and this is the only place that admits there is a next one. */}
      {phases.length > 0 && (
        <li className={`${styles.step} ${styles.nextCycle}`} tabIndex={0} role="note">
          <Icon icon="ph:arrows-clockwise-bold" className={styles.nextCycleIcon} aria-hidden />
          <span className="visually-hidden">Next cycle</span>

          <span className={styles.tip} role="tooltip">
            <strong className={styles.tipTitle}>The lifecycle is a spiral</strong>
            <span className={styles.tipBody}>
              After monitoring, a real project turns back to requirements for the next iteration,
              carrying forward everything it has already built. This game plays one turn of that
              spiral.
            </span>
          </span>
        </li>
      )}
    </ol>
  );
}
