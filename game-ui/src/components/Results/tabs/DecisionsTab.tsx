import { Icon } from "@iconify/react";
import { Empty, Section, StatTile, TileRow } from "../parts";
import type { Outcome, ResultsPayload } from "../types";
import styles from "../tabs.module.css";

/** Status colours ship with an icon and a word, never colour alone. */
const OUTCOME_META: Record<Outcome | "UNFINISHED", { label: string; icon: string; chip: string }> = {
  PASS: { label: "Passed", icon: "ph:check-circle-bold", chip: styles.chipGood },
  SOFT_PASS: { label: "Passed, with reservations", icon: "ph:warning-circle-bold", chip: styles.chipWarn },
  VETO: { label: "Vetoed", icon: "ph:x-circle-bold", chip: styles.chipBad },
  STALEMATE: { label: "Tabled", icon: "ph:pause-circle-bold", chip: styles.chipBad },
  UNFINISHED: { label: "Not finished", icon: "ph:circle-dashed-bold", chip: styles.chipNeutral },
};

export default function DecisionsTab({ results }: { results: ResultsPayload }) {
  const { decisions, escalation } = results;
  if (decisions.length === 0) {
    return <Empty>No proposals were put to the room in this run.</Empty>;
  }

  const count = (outcome: Outcome) => decisions.filter((d) => d.outcome === outcome).length;
  const used = Math.max(0, escalation.total - escalation.left);

  return (
    <>
      <TileRow>
        <StatTile label="Passed" value={count("PASS")} />
        <StatTile label="With reservations" value={count("SOFT_PASS")} hint="Went through, but someone was left unhappy" />
        <StatTile label="Vetoed" value={count("VETO")} />
        <StatTile label="Tabled" value={count("STALEMATE")} hint="Left unresolved when no proposal could clear the room" />
        <StatTile
          label="Escalation used"
          value={`${used} of ${escalation.total}`}
          hint="Overrides you spent to push something past the room"
        />
      </TileRow>

      <Section title="Challenge by challenge" note="What you took to the room, and how it went.">
        <div className={styles.rowList}>
          {decisions.map((d) => {
            const meta = OUTCOME_META[d.outcome ?? "UNFINISHED"];
            return (
              <div key={`${d.phase_index}-${d.challenge_index}`} className={styles.row}>
                <span className={styles.rowIndex}>{d.position}</span>
                <div>
                  <div className={styles.rowTitle}>{d.name}</div>
                  <div className={styles.rowSub}>
                    {d.card_title ? `You proposed: ${d.card_title}` : "No proposal recorded"}
                    {d.attention_tokens != null && ` · ${d.attention_tokens} attention left`}
                  </div>
                </div>
                <span className={`${styles.chip} ${meta.chip}`}>
                  <Icon icon={meta.icon} aria-hidden />
                  {meta.label}
                </span>
              </div>
            );
          })}
        </div>
      </Section>
    </>
  );
}
