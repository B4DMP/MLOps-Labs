import { Icon } from "@iconify/react";
import styles from "./PowerInterestExplainer.module.css";

export interface PowerInterestExplainerStakeholder {
  id: string;
  name: string;
  power: string;
  interest: string;
  color?: string;
}

export interface PowerInterestExplainerProps {
  stakeholders: PowerInterestExplainerStakeholder[];
  onClose?: () => void;
}

type Level = "high" | "low";

// Quadrant names match PowerInterestMatrix; the consequence lines are in words only.
const QUADRANTS: Array<{ power: Level; interest: Level; title: string; consequence: string }> = [
  {
    power: "high",
    interest: "low",
    title: "Keep Satisfied",
    consequence: "Can veto, but is moved gently. Do not cross their lines.",
  },
  {
    power: "high",
    interest: "high",
    title: "Manage Closely",
    consequence: "Can veto, and reacts strongly to everything you say and propose.",
  },
  {
    power: "low",
    interest: "low",
    title: "Monitor",
    consequence: "Cannot stop you. At worst a soft pass, and they barely react.",
  },
  {
    power: "low",
    interest: "high",
    title: "Keep Informed",
    consequence: "Cannot stop you. At worst a soft pass, but they react strongly.",
  },
];

const levelOf = (value: string): Level => (value.toLowerCase() === "high" ? "high" : "low");

export default function PowerInterestExplainer({ stakeholders, onClose }: PowerInterestExplainerProps) {
  return (
    <div className={styles.explainer} role="group" aria-label="Power and interest">
      <div className={styles.header}>
        <h6 className={styles.title}>Who can stop you, and who cares</h6>
        {onClose && (
          <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="Close">
            <Icon icon="ph:x-bold" />
          </button>
        )}
      </div>
      <p className={styles.lead}>
        Power decides who can stop you. Power and interest both raise how strongly someone reacts.
      </p>
      <div className={styles.axisY}>Power</div>
      <div className={styles.grid}>
        {QUADRANTS.map((q) => {
          const members = stakeholders.filter(
            (s) => levelOf(s.power) === q.power && levelOf(s.interest) === q.interest,
          );
          return (
            <div key={q.title} className={styles.quadrant} data-testid={`quadrant-${q.power}-${q.interest}`}>
              <div className={styles.quadTitle}>{q.title}</div>
              <div className={styles.quadAxes}>
                {q.power === "high" ? "High" : "Low"} power, {q.interest === "high" ? "high" : "low"} interest
              </div>
              <div className={styles.chips}>
                {members.map((s) => (
                  <span key={s.id} className={styles.chip} style={{ borderColor: s.color || "#64748b" }}>
                    {s.name}
                  </span>
                ))}
              </div>
              <p className={styles.consequence}>{q.consequence}</p>
            </div>
          );
        })}
      </div>
      <div className={styles.axisX}>Interest</div>
    </div>
  );
}
