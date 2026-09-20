import { useContext } from "react";
import { Icon } from "@iconify/react";
import { PhasesContext } from "./PhaseProvider";
import styles from "./PhaseOverview.module.css";

/**
 * Lifecycle breadcrumb for the Performance Dashboard header. Chevrons point along the MLOps
 * lifecycle, so the shape itself says "these run in order"; the description is a hover card
 * rather than body copy, which keeps the whole rail one header row tall.
 */
export interface PhaseOverviewProps {
  /**
   * Carries the intro1 tour anchor. The rail is rendered in more than one header, and the
   * tour must find exactly one of them, so only the Performance Dashboard sets this.
   */
  isTourAnchor?: boolean;
}

export default function PhaseOverview({ isTourAnchor = false }: PhaseOverviewProps) {
  const { currentPhase, phases } = useContext(PhasesContext);

  const tourProps = isTourAnchor
    ? {
        "data-intro-group": "intro1",
        "data-intro":
          "The serious game consists of five MLOps phases illustrated by this phase overview. The phases cover the whole development process of ML projects from defining business objectives and architecture, over deployment, to monitoring and maintenance.",
        "data-step": "2",
      }
    : {};

  return (
    <ol
      className={`${styles.rail} ${isTourAnchor ? "intro1" : ""}`}
      // Equal columns for the phases, one content-sized column for the tail. Set here rather
      // than in CSS because only this component knows how many phases there are.
      style={{ gridTemplateColumns: `repeat(${phases.length}, minmax(0, 1fr)) auto` }}
      {...tourProps}
      aria-label="MLOps lifecycle phases"
    >
      {phases.map((phase, index) => {
        const state =
          index > currentPhase ? "upcoming" : index === currentPhase ? "active" : "done";

        return (
          <li
            key={phase.phase_name}
            className={`${styles.step} ${styles[state]} ${index === 0 ? styles.first : ""}`}
            tabIndex={0}
            aria-current={state === "active" ? "step" : undefined}
          >
            <span className={styles.marker} aria-hidden>
              {state === "done" ? (
                <Icon icon="ph:check-bold" />
              ) : state === "active" ? (
                <Icon icon="ph:caret-right-bold" />
              ) : (
                index + 1
              )}
            </span>
            <span className={styles.stepName}>{phase.phase_name}</span>

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
