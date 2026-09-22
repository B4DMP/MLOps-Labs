import { Line } from "react-chartjs-2";
import type { ChartOptions } from "chart.js";
import "../chartSetup";
import { BarRow, ChartTable, Empty, Section, StatTile, TileRow } from "../parts";
import { CHART_INK, prettify, stakeholderColor } from "../palette";
import type { ResultsPayload } from "../types";
import styles from "../tabs.module.css";

const asPercent = (value: number) => Math.round(value * 100);

/**
 * How the room felt, at the end and along the way.
 *
 * Final mood is a bar per person (magnitude across a handful of named things). The trajectory is a
 * line per person in a colour bound to *them*, not to their rank this run, so a reader who learned
 * that one colour is one stakeholder is never repainted.
 */
export default function StakeholdersTab({ results }: { results: ResultsPayload }) {
  const relations = results.pillars.find((p) => p.id === "stakeholder_relations");
  const finalMood = (relations?.detail.per_stakeholder ?? {}) as Record<string, number>;
  const grudges = Number(relations?.detail.fired_grudges ?? 0);

  const ids = Object.keys(finalMood).sort((a, b) => finalMood[b] - finalMood[a]);
  if (ids.length === 0) {
    return <Empty>Nobody's mood was recorded in this run.</Empty>;
  }

  const nameOf = (id: string) => results.stakeholders[id] ?? prettify(id);
  const colorOf = (id: string) => stakeholderColor(id, results.stakeholder_order);

  const warmest = ids[0];
  const coldest = ids[ids.length - 1];

  const labels = results.decisions.length
    ? results.decisions.map((d) => `${d.position}`)
    : Array.from({ length: results.mood.steps }, (_, i) => `${i + 1}`);
  const trajectoryIds = Object.keys(results.mood.series);

  const options: ChartOptions<"line"> = {
    responsive: true,
    maintainAspectRatio: false,
    spanGaps: false,
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: {
        position: "bottom",
        labels: { color: CHART_INK.secondary, usePointStyle: true, boxWidth: 8, font: { size: 11 } },
      },
      tooltip: {
        callbacks: {
          title: (items) => {
            const decision = results.decisions[items[0]?.dataIndex ?? 0];
            return decision ? `${decision.position}. ${decision.name}` : `After challenge ${items[0]?.label}`;
          },
          label: (item) => ` ${item.dataset.label}: ${item.parsed.y == null ? "not in the room" : `${asPercent(item.parsed.y)}%`}`,
        },
      },
    },
    scales: {
      x: {
        title: { display: true, text: "After challenge", color: CHART_INK.secondary },
        grid: { display: false },
        ticks: { color: CHART_INK.secondary },
      },
      y: {
        min: 0,
        max: 1,
        grid: { color: CHART_INK.grid },
        ticks: { color: CHART_INK.secondary, callback: (v) => `${asPercent(Number(v))}%` },
      },
    },
  };

  return (
    <>
      <TileRow>
        <StatTile label="Warmest" value={nameOf(warmest)} hint={`${asPercent(finalMood[warmest])}% at the end`} />
        <StatTile label="Coldest" value={nameOf(coldest)} hint={`${asPercent(finalMood[coldest])}% at the end`} />
        <StatTile
          label="Grudges that fired"
          value={grudges}
          hint="Work waved through without someone, which came back later"
        />
      </TileRow>

      <Section title="Where the room ended up" note="Their mood after the last challenge, most positive first.">
        {ids.map((id) => (
          <BarRow
            key={id}
            marker={<span className={styles.swatch} style={{ background: colorOf(id) }} aria-hidden />}
            label={nameOf(id)}
            ratio={finalMood[id]}
            color={colorOf(id)}
            value={`${asPercent(finalMood[id])}%`}
          />
        ))}
      </Section>

      {results.mood.steps > 1 && trajectoryIds.length > 0 && (
        <ChartTable
          title="How it moved"
          chart={
            <Line
              options={options}
              data={{
                labels,
                datasets: trajectoryIds.map((id) => ({
                  label: nameOf(id),
                  data: results.mood.series[id],
                  borderColor: colorOf(id),
                  backgroundColor: colorOf(id),
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
            columns: ["Challenge", ...trajectoryIds.map(nameOf)],
            rows: labels.map((label, i) => [
              label,
              ...trajectoryIds.map((id) => {
                const value = results.mood.series[id][i];
                return value == null ? "-" : `${asPercent(value)}%`;
              }),
            ]),
          }}
        />
      )}
    </>
  );
}
