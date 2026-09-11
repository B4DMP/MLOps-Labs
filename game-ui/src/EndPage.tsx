import { Icon } from "@iconify/react";
import styles from "./EndPage.module.css";

export default function EndPage() {
  return (
    <div className={styles.wrapper}>
      <div className={`card shadow-lg border-0 rounded-4 overflow-hidden ${styles.panel}`}>
        {/* Header */}
        <div className={styles.header}>
          <h2 className={styles.headerTitle}>
            <span>Game Completed</span>
          </h2>

        </div>

        {/* Body */}
        <div className={styles.body}>
          {/* Hero Section */}
          <div className={styles.heroSection}>
            <div className={styles.trophyCircle}>
              <Icon icon="ph:confetti-bold" style={{ fontSize: "2.25rem", color: "var(--primary-bg)" }} />
            </div>
            <h3 className={styles.heroTitle}>You Completed the Game!</h3>
            <p className={styles.heroSubtitle}>
              Thank you for participating and helping us evaluate this serious game.
            </p>
          </div>

          {/* Warning Notice */}
          <div className={styles.warningAlert} role="alert">
            <Icon icon="ph:warning-circle-bold" style={{ fontSize: "1.5rem", flexShrink: 0, marginTop: "2px" }} />
            <div>
              <strong>Important Notice:</strong> Please refrain from participating again with another username, as duplicate sessions would invalidate our empirical research results.
            </div>
          </div>

          {/* Safe to close */}
          <div className={styles.footerNote}>
            <Icon icon="ph:check-circle-bold" style={{ color: "var(--primary-bg)" }} />
            <span>All responses have been securely recorded. You may now close this tab.</span>
          </div>
        </div>
      </div>
    </div>
  );
}
