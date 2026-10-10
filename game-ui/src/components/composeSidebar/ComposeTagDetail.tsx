import type { ReactNode } from "react";
import styles from "./ComposeTagDetail.module.css";

/** One line of detail: a plain string, or a node for a line with emphasis. */
export type TagLine = string | ReactNode;

/** Plain-text twin of a tag, for `aria-label`. */
export function tagText(label: string, lines?: TagLine[]): string {
  const text = (lines ?? []).filter((l): l is string => typeof l === "string");
  return text.length ? `${label}: ${text.join(" ")}` : label;
}

/**
 * Body of a composer tooltip: a heading line, then one block per detail line. Lines wrap only
 * between words of a sentence, never inside a `<b>` chunk, so "Held back" stays together.
 */
export default function ComposeTagDetail({ label, lines }: { label: ReactNode; lines?: TagLine[] }) {
  return (
    <div className={styles.root}>
      <div className={styles.label}>{label}</div>
      {(lines ?? []).filter(Boolean).map((line, i) => (
        <div key={i} className={styles.line}>
          {line}
        </div>
      ))}
    </div>
  );
}
