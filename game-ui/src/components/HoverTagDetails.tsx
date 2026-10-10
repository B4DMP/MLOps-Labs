import styles from "./TabTagDetail.module.css";

/** Bodies of the dossier's shared hover tag for the Power, Interest and Intel badges. */

export function PowerTagDetail({ high }: { high: boolean }) {
  return (
    <div className={styles.rows}>
      <div className={high ? styles.warn : styles.lead}>{high ? "High power" : "Low power"}</div>
      <div className={styles.para}>Can this person stop you?</div>
      <div className={styles.para}>
        {high ? (
          <>
            <b className={styles.chunk}>Yes:</b> they can veto the whole plan.
          </>
        ) : (
          <>
            <b className={styles.chunk}>No:</b> they can only grumble.
          </>
        )}
      </div>
      <div className={`${styles.para} ${styles.muted}`}>
        Together with interest, it sets how strongly they react.
      </div>
    </div>
  );
}

export function InterestTagDetail({ high }: { high: boolean }) {
  return (
    <div className={styles.rows}>
      <div className={high ? styles.warn : styles.lead}>{high ? "High interest" : "Low interest"}</div>
      <div className={styles.para}>
        {high ? "They care a lot, so your words and your proposal " : "They care less, so your words and your proposal "}
        <b className={styles.chunk}>{high ? "move their mood strongly." : "move their mood gently."}</b>
      </div>
      <div className={`${styles.para} ${styles.muted}`}>
        Together with power, it sets how strongly they react.
      </div>
    </div>
  );
}

export function IntelTagDetail({ summary, breakdown }: { summary: string; breakdown: string[] }) {
  return (
    <div className={styles.rows}>
      <b className={styles.chunk}>{summary}</b>
      {breakdown.length > 0 && (
        <div className={styles.sub}>
          {breakdown.map((part) => {
            const [count, ...rest] = part.split(" ");
            return (
              <span key={part} className={styles.chunk}>
                <b>{count}</b> {rest.join(" ")}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function PatienceTagDetail() {
  return (
    <div className={styles.rows}>
      <div className={styles.para}>
        Bringing them the <b className={styles.chunk}>same problem again</b> wears on them.
      </div>
      <div className={styles.para}>
        <b className={styles.chunk}>Answer what they asked for</b> and it eases.
      </div>
    </div>
  );
}
