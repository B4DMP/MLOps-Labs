import { MetricsContext } from "./MetricProvider";
import { useContext } from "react";
import { Icon } from "@iconify/react";
import styles from "./MetricTab.module.css";

interface MetricTabProps {
  current_phase: number;
}

const SEGMENTS = 10;

/**
 * Metric rail: one panel, one gauge per metric, divided rather than scattered. The bar is
 * segmented like a game HUD meter (each segment is a tenth of the maximum), which reads as
 * a score at a glance and keeps the whole rail one row tall. The metric colour is used as
 * an accent - icon badge, fill, tinted ground - instead of flooding a card.
 */
function MetricTab({ current_phase }: MetricTabProps) {
  const { metrics } = useContext(MetricsContext);

  return (
    <div
      className={`${styles.rail} intro6`}
      data-intro-group="intro6"
      data-step="2"
      data-intro="Here you can see how the action card changed the metrics."
    >
      {Object.values(metrics).map((item) => {
        if (!item.phases[current_phase]) return null;
        const value = item.value ?? item.start_value;
        const max = item.max_value ?? 50;
        const ratio = Math.min(Math.max(max > 0 ? value / max : 0, 0), 1);
        const filled = Math.round(ratio * SEGMENTS);

        return (
          <div
            key={item.id}
            className={styles.gauge}
            style={{ ["--metric" as string]: item.metric_color }}
            tabIndex={0}
            aria-label={`${item.name}: ${value} of ${max}`}
          >
            <span className={styles.badge} aria-hidden>
              <Icon icon={item.metric_icon} />
            </span>

            <div className={styles.body}>
              <div className={styles.topline}>
                <span className={styles.name}>{item.name}</span>
                <span className={styles.value}>
                  <span className={styles.number} id={`metric-value-${item.id}`}>
                    {value}
                  </span>
                  <span className={styles.max}>/{max}</span>
                </span>
              </div>

              <span className={styles.segments} aria-hidden>
                {Array.from({ length: SEGMENTS }, (_, i) => (
                  <span
                    key={i}
                    className={`${styles.segment} ${i < filled ? styles.segmentOn : ""}`}
                  />
                ))}
              </span>
            </div>

            <span className={styles.tip} role="tooltip">
              <strong className={styles.tipTitle}>{item.name}</strong>
              <span className={styles.tipBody}>
                {item.description ?? "DESCRIPTION PLACEHOLDER"}
              </span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

export default MetricTab;
