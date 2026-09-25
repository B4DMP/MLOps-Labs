import { Icon } from "@iconify/react";
import { BarRow, Empty, Section, StatTile, TileRow } from "../parts";
import { prettify } from "../palette";
import type { ResultsPayload } from "../types";
import styles from "../tabs.module.css";

/** The tags in the order the game teaches them. Facts are last: they describe the system, not a
 * person's stance. */
const TAGS = ["driver", "boundary", "trade_off", "fact"] as const;

const TAG_LABEL: Record<string, string> = {
  driver: "Driver",
  boundary: "Boundary",
  trade_off: "Trade-off",
  fact: "Fact",
};

/**
 * What the player found out and how they read it.
 *
 * Counts only, never wording (D7). The screen says *that* a boundary was read as a driver, not
 * *which* note it was, so a second run is still worth playing.
 */
export default function IntelTab({ results }: { results: ResultsPayload }) {
  const { per_stakeholder: rows, confusion, confidence } = results.intel;

  const gathered = rows.reduce((sum, r) => sum + r.gathered, 0);
  const available = rows.reduce((sum, r) => sum + r.available, 0);
  const correct = rows.reduce((sum, r) => sum + r.correct, 0);
  const tagged = correct + rows.reduce((sum, r) => sum + r.wrong, 0);

  if (gathered === 0 && available === 0) {
    return <Empty>No intel was gathered in this run.</Empty>;
  }

  const maxCell = Math.max(1, ...TAGS.flatMap((t) => TAGS.map((u) => confusion[t]?.[u] ?? 0)));

  return (
    <>
      <TileRow>
        <StatTile
          label="Notes found"
          value={available ? `${gathered} of ${available}` : gathered}
          hint="How much of what was there to find you actually found"
        />
        <StatTile
          label="Read correctly"
          value={tagged ? `${correct} of ${tagged}` : "none tagged"}
          hint="Notes where your tag matched what the stakeholder meant"
        />
        <StatTile label="Confirmed" value={confidence.verified} hint="Verified in the room" />
      </TileRow>

      <Section
        title="Coverage by stakeholder"
        note="How much of what each person had to tell you, you actually found. An empty bar is a conversation that never happened."
      >
        {rows.map((row) => (
          <BarRow
            key={row.id}
            label={results.stakeholders[row.id] ?? prettify(row.id)}
            ratio={row.available ? row.gathered / row.available : 0}
            value={`${row.gathered} of ${row.available}`}
          />
        ))}
      </Section>

      <Section
        title="How you read them"
        note="Across: what a note really was. Down: how you tagged it. The outlined diagonal is a correct read; anything off it is a distinction you missed."
      >
        <table className={styles.matrix}>
          <thead>
            <tr>
              <th />
              {TAGS.map((tag) => (
                <th key={tag} scope="col">
                  You tagged {TAG_LABEL[tag]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {TAGS.map((truth) => (
              <tr key={truth}>
                <th scope="row">Really a {TAG_LABEL[truth]}</th>
                {TAGS.map((tagged_as) => {
                  const count = confusion[truth]?.[tagged_as] ?? 0;
                  const right = truth === tagged_as;
                  return (
                    <td
                      key={tagged_as}
                      className={`${styles.cell} ${right ? styles.cellRight : ""}`}
                      style={{
                        background: count
                          ? `rgba(42, 120, 214, ${0.12 + 0.6 * (count / maxCell)})`
                          : "rgba(100, 116, 139, 0.07)",
                      }}
                      title={`${count} note${count === 1 ? "" : "s"}`}
                    >
                      {count || ""}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {tagged > 0 && tagged === correct && (
          <p className={styles.sectionNote}>
            <Icon icon="ph:check-circle-bold" aria-hidden /> Every note you tagged, you read correctly.
          </p>
        )}
      </Section>
    </>
  );
}
