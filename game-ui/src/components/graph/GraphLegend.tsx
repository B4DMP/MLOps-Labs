import type { CSSProperties } from "react";
import { Icon } from "@iconify/react";
import styles from "./GraphLegend.module.css";

export interface LegendItem {
  label: string;
  swatch?: CSSProperties;
  icon?: string;
  iconColor?: string;
}

export interface LegendGroup {
  heading: string;
  items: LegendItem[];
}

/**
 * The key to the board, on demand rather than permanently occupying a row. A chip that opens a paper
 * panel on hover or focus. `tone` picks the chip's look for the surface it sits on: "desk" for the
 * composer's dark strip, "light" for the dashboard's pale one.
 */
export default function GraphLegend({
  groups,
  tone = "desk",
  open = false,
  dataCoach,
}: {
  groups: LegendGroup[];
  tone?: "desk" | "light";
  /** Held open from outside (the composer's guide points at it). */
  open?: boolean;
  dataCoach?: string;
}) {
  return (
    <span
      className={`${styles.chip} ${tone === "light" ? styles.chipLight : styles.chipDesk} ${open ? styles.chipOpen : ""}`}
      tabIndex={0}
    >
      <Icon icon="ph:list-bullets-bold" />
      <span>Legend</span>
      <span className={styles.panel} role="tooltip" data-coach={dataCoach}>
        {groups.map((group) => (
          <span key={group.heading} className={styles.group}>
            <span className={styles.heading}>{group.heading}</span>
            {group.items.map((item) => (
              <span key={item.label} className={styles.item}>
                {item.icon ? (
                  <Icon icon={item.icon} className={styles.glyph} style={{ color: item.iconColor }} />
                ) : (
                  <span className={styles.swatch} style={item.swatch} />
                )}
                <span>{item.label}</span>
              </span>
            ))}
          </span>
        ))}
      </span>
    </span>
  );
}
