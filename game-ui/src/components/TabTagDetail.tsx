import styles from "./TabTagDetail.module.css";

interface TabTagDetailProps {
  emotion: string;
  patience: string | null;
  keyFlags: string[];
  changeHint: string;
  intel: { summary: string; breakdown: string[] } | null;
}

/** Body of the stakeholder tab hover tag: labelled rows whose parts never break mid-phrase. */
export default function TabTagDetail({ emotion, patience, keyFlags, changeHint, intel }: TabTagDetailProps) {
  return (
    <div className={styles.rows}>
      <div className={styles.row}>
        <span className={styles.key}>Mood</span>
        <b className={styles.chunk}>{emotion}</b>
      </div>
      {patience && <div className={`${styles.row} ${styles.warn}`}>{patience}</div>}
      {keyFlags.length > 0 && (
        <div className={styles.row}>
          {keyFlags.map((flag) => (
            <b key={flag} className={styles.chunk}>{flag}</b>
          ))}
        </div>
      )}
      {changeHint && <div className={styles.row}>{changeHint}</div>}
      {intel && (
        <div className={styles.row}>
          <span className={styles.key}>Intel</span>
          <b className={styles.chunk}>{intel.summary}</b>
          {intel.breakdown.length > 0 && (
            <div className={styles.sub}>
              {intel.breakdown.map((part) => (
                <span key={part} className={styles.chunk}>{part}</span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
