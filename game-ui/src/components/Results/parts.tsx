import { useState, type ReactNode } from "react";
import { Icon } from "@iconify/react";
import HoverTooltip from "../HoverToolTip";
import styles from "./tabs.module.css";

/** One headline number with its label: the "stat tile" the data-viz method prefers to a one-bar
 * chart. */
export function StatTile({
  label,
  value,
  hint,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
}) {
  return (
    <HoverTooltip description={hint} block>
      <div className={styles.tile}>
        <span className={styles.tileValue}>{value}</span>
        <span className={styles.tileLabel}>{label}</span>
      </div>
    </HoverTooltip>
  );
}

export function TileRow({ children }: { children: ReactNode }) {
  return <div className={styles.tileRow}>{children}</div>;
}

/** A section heading with an optional one-line explanation. */
export function Section({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: ReactNode;
}) {
  return (
    <section className={styles.section}>
      <h3 className={styles.sectionTitle}>{title}</h3>
      {note && <p className={styles.sectionNote}>{note}</p>}
      {children}
    </section>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className={styles.empty}>{children}</p>;
}

export interface TableView {
  columns: string[];
  rows: Array<Array<string | number>>;
}

/**
 * A chart that can always be read as a table.
 *
 * Not decoration: three of the categorical colours sit below 3:1 contrast on this surface, and the
 * method's rule is that such a chart must ship visible labels or a table view. It is also just the
 * honest fallback for anyone who cannot use the picture. The toggle is one control above the chart
 * so it never moves the plot.
 */
export function ChartTable({
  title,
  chart,
  table,
}: {
  title: string;
  chart: ReactNode;
  table: TableView;
}) {
  const [asTable, setAsTable] = useState(false);
  return (
    <div className={styles.chartBlock}>
      <div className={styles.chartHead}>
        <h4 className={styles.chartTitle}>{title}</h4>
        <button
          type="button"
          className={styles.viewToggle}
          onClick={() => setAsTable((v) => !v)}
          aria-pressed={asTable}
        >
          <Icon icon={asTable ? "ph:chart-line-bold" : "ph:table-bold"} aria-hidden />
          {asTable ? "Show chart" : "View as table"}
        </button>
      </div>
      {asTable ? (
        <div className={styles.tableWrap}>
          <table className={styles.dataTable}>
            <thead>
              <tr>
                {table.columns.map((column) => (
                  <th key={column} scope="col">
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row, i) => (
                <tr key={i}>
                  {row.map((cell, j) => (
                    <td key={j}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className={styles.chartArea}>{chart}</div>
      )}
    </div>
  );
}

/** A horizontal bar with a label and a direct value: the form for comparing magnitude across a
 * handful of named things. Thin, one colour, the number printed rather than implied. */
export function BarRow({
  label,
  ratio,
  value,
  color,
  marker,
}: {
  label: ReactNode;
  /** 0..1 */
  ratio: number;
  value: ReactNode;
  color?: string;
  /** Something to sit before the label, e.g. a colour key for the entity. */
  marker?: ReactNode;
}) {
  const width = `${Math.round(Math.max(0, Math.min(1, ratio)) * 100)}%`;
  return (
    <div className={styles.barRow}>
      <span className={styles.barLabel}>
        {marker}
        {label}
      </span>
      <span className={styles.barTrack} aria-hidden>
        <span className={styles.barFill} style={{ width, background: color }} />
      </span>
      <span className={styles.barValue}>{value}</span>
    </div>
  );
}
