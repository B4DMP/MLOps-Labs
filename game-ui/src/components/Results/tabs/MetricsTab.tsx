import { Icon } from "@iconify/react";
import { Line } from "react-chartjs-2";
import type { ChartOptions } from "chart.js";
import "../chartSetup";
import { ChartTable, Empty, Section } from "../parts";
import { CHART_INK, prettify } from "../palette";
import type { MetricResult, ResultsPayload } from "../types";
import styles from "../tabs.module.css";

/** What the game already knows about a metric, from the same source as the in-game HUD. */
export interface MetricInfo {
  name: string;
  metric_color: string;
  metric_icon: string;
}

const SEGMENTS = 10;

/**
 * The gauges the player watched on the dashboard all game, at rest.
 *
 * Deliberately the same look as the in-game `MetricTab` rail, so the screen closes the loop on a
 * HUD the player already knows rather than introducing a scoring language they have never seen.
 * These are reported, never graded: each metric is a weighted read of the same components the
 * Pipeline health pillar already scores.
 *
 * Three of the game's metric colours sit below 3:1 contrast on a light surface, so every gauge
 * prints its name and value in ink, and the chart offers a table view.
 */
export default function MetricsTab({
  results,
  metricInfo,
}: {
  results: ResultsPayload;
  metricInfo: Record<string, MetricInfo>;
}) {
  const { metrics, challenges, own_from: ownFrom } = results.metrics;
  if (metrics.length === 0 || challenges === 0) {
    return <Empty>No metrics were recorded in this run.</Empty>;
  }

  const info = (metric: MetricResult): MetricInfo =>
    metricInfo[metric.id] ?? {
      name: prettify(metric.id),
      metric_color: "#64748b",
      metric_icon: "ph:chart-line-up-bold",
    };

  const inherited = ownFrom > 0;
  const labels = Array.from({ length: challenges }, (_, i) => `${i + 1}`);

  const options: ChartOptions<"line"> = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: {
        position: "bottom",
        labels: { color: CHART_INK.secondary, usePointStyle: true, boxWidth: 8, font: { size: 11 } },
      },
    },
    scales: {
      x: {
        title: { display: true, text: "After challenge", color: CHART_INK.secondary },
        grid: { display: false },
        ticks: { color: CHART_INK.secondary },
      },
      y: { beginAtZero: true, grid: { color: CHART_INK.grid }, ticks: { color: CHART_INK.secondary } },
    },
  };

  return (
    <>
      <Section
        title="Where the gauges ended"
        note={
          inherited
            ? "The change shown is what this iteration added: the figures continued from where the last one ended."
            : "The change shown is how far each gauge moved over the run."
        }
      >
        <div className={styles.gaugeGrid}>
          {metrics.map((metric) => {
            const meta = info(metric);
            const filled = Math.round(metric.ratio * SEGMENTS);
            return (
              <div key={metric.id} className={styles.gauge}>
                <span className={styles.gaugeBadge} style={{ background: meta.metric_color }} aria-hidden>
                  <Icon icon={meta.metric_icon} />
                </span>
                <div>
                  <div className={styles.gaugeTop}>
                    <span className={styles.gaugeName}>{meta.name}</span>
                    <span className={styles.gaugeValue}>
                      {metric.value}
                      <span className={styles.gaugeMax}>/{metric.max}</span>
                    </span>
                  </div>
                  <span className={styles.segments} aria-hidden>
                    {Array.from({ length: SEGMENTS }, (_, i) => (
                      <span
                        key={i}
                        className={styles.segment}
                        style={i < filled ? { background: meta.metric_color } : undefined}
                      />
                    ))}
                  </span>
                  <div className={styles.gaugeGain}>
                    {metric.gained === 0 ? "no change" : `${metric.gained > 0 ? "+" : ""}${metric.gained} over the run`}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </Section>

      {challenges > 1 && (
        <ChartTable
          title="How they moved"
          chart={
            <Line
              options={options}
              data={{
                labels,
                datasets: metrics.map((metric) => ({
                  label: info(metric).name,
                  data: metric.series,
                  borderColor: info(metric).metric_color,
                  backgroundColor: info(metric).metric_color,
                  borderWidth: 2,
                  pointRadius: 4,
                  pointBorderColor: "#ffffff",
                  pointBorderWidth: 2,
                  tension: 0.25,
                })),
              }}
            />
          }
          table={{
            columns: ["Challenge", ...metrics.map((m) => info(m).name)],
            rows: labels.map((label, i) => [label, ...metrics.map((m) => m.series[i] ?? "-")]),
          }}
        />
      )}
    </>
  );
}
