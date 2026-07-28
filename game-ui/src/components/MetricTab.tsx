import { MetricsContext } from "./MetricProvider";
import { useContext } from "react";
import { Icon } from "@iconify/react";
import type { ActionCard } from "../types/ActionCard";
import styles from "./MetricTab.module.css";

interface MetricTabProps {
  current_phase: number;
  showMetricValueChanges: boolean;
  last_ac: ActionCard;
}

function MetricTab({
  current_phase,
  showMetricValueChanges,
  last_ac,
}: MetricTabProps) {
  const { metrics } = useContext(MetricsContext);

  const calculateProgress = (current: number): number => {
    return Math.min(Math.max((current / 100) * 100, 0), 100);
  };

  return (
    <div className="container-fluid intro6" data-intro-group="intro6" data-step="2" data-intro="Here you can see how the action card changed the metrics.">
      <div className="row justify-content-end">
        <div className="col-auto">
          <div className="d-flex flex-nowrap gap-3">
            {Object.values(metrics).map(
              (item) =>
                item.phases[current_phase] && (
                  <div
                    key={item.id}
                    className="stat-card hover-card p-2  text-white rounded"
                    style={{
                      minWidth: "180px",
                      backgroundColor: item.metric_color,
                    }}
                  >
                    <div className="d-flex align-items-center justify-content-between">
                      <div className="d-flex align-items-center gap-2">
                        <span style={{ fontSize: "1.2rem", lineHeight: 1 }}>
                          <Icon
                            icon={item.metric_icon}
                            style={{
                              fontSize: "25px",
                              color: "white",
                              flexShrink: 0,
                            }}
                          />
                        </span>

                        <span className="fw-semibold">{item.name}</span>
                      </div>

                      <span className="fw-bold fs-5" id={`metric-value-${item.id}`}>
                        {item.value ?? item.start_value}
                      </span>
                      {!showMetricValueChanges && (
                        <span style={{ fontSize: "0.8rem", lineHeight: 1 }}>
                          /{item.max_value ?? "x"}
                        </span>
                      )}
                      {last_ac && showMetricValueChanges && (
                        <span
                          className={styles.metricChangeText}
                          style={{
                            color:
                              (last_ac.metric_changes[item.id] ?? 0) == 0
                                ? "black"
                                : (last_ac.metric_changes[item.id] ?? 0) > 0
                                  ? "green"
                                  : "red",
                          }}
                        >
                          {(last_ac.metric_changes[item.id] ?? 0) >= 0 && "+"}
                          {(last_ac.metric_changes[item.id] ?? 0)}
                        </span>
                      )}
                    </div>

                    <div className="mt-2">
                      <small
                        className="text-muted"
                        style={{
                          fontSize: "0.75rem",
                          lineHeight: "1.2",
                          display: "block",
                        }}
                      >
                        {item.description ?? "DESCRIPTION PLACEHOLDER"}
                      </small>
                    </div>

                    <div className="progress mt-2" style={{ height: "6px" }}>
                      <div
                        className="progress-bar"
                        role="progressbar"
                        style={{
                          width: `${calculateProgress(
                            item.value ?? item.start_value,
                          )}%`,
                          backgroundColor: "white",
                        }}
                      />
                    </div>
                  </div>
                ),
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default MetricTab;
