import { useState } from "react";
import { Icon } from "@iconify/react";
import { ReadyState } from "../services/websocket/types";
import styles from "./Register.module.css";

interface RegisterProps {
  onSubmit: (username: string, campaignKey: string) => void;
  readyState: ReadyState;
  onBack: () => void;
  isLoading?: boolean;
}

export function Register({
  onSubmit,
  readyState,
  onBack,
  isLoading = false,
}: RegisterProps) {
  const [username, setUsername] = useState("");
  const [campaignKey, setCampaignKey] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (username.trim() && campaignKey.trim() && !isLoading) {
      onSubmit(username.trim(), campaignKey.trim());
    }
  };

  return (
    <div className={styles.registerWrapper}>
      <div className={styles.registerCard}>

        <h2 className={styles.cardTitle}>Register</h2>
        <p className={styles.cardSubtitle}>
          Join a study campaign and begin your MLOps Labs session. <br /> Your game will be saved automatically.
        </p>

        {/* Callouts (Stacked by default, 2-column on small screens) */}
        <div className={styles.calloutsRow}>
          <div className={styles.infoBox}>
            <Icon
              icon="ph:info-bold"
              className="flex-shrink-0 mt-1"
              style={{ color: "#7dd3fc", fontSize: "1.2rem" }}
            />
            <span>
              Please choose a <strong>username</strong> and enter the <strong>campaign key</strong> provided with your study invitation.
            </span>
          </div>

          <div className={styles.consentBox}>
            <Icon
              icon="ph:shield-check-bold"
              className="flex-shrink-0 mt-1"
              style={{ color: "#38bdf8", fontSize: "1.25rem" }}
            />
            <div>
              <strong>Research Consent:</strong> By playing, you agree that your in-game actions will be logged and analyzed for scientific research, and that all published results are strictly anonymized.
            </div>
          </div>
        </div>

        {/* Form (Stacked by default, 2-column on small screens) */}
        <form onSubmit={handleSubmit}>
          <div className={styles.inputGrid}>
            <div className={styles.formGroup}>
              <label htmlFor="register-username-input" className={styles.formLabel}>
                <Icon icon="ph:user-bold" style={{ fontSize: "1rem" }} />
                <span>Username</span>
              </label>
              <input
                id="register-username-input"
                type="text"
                className={styles.formInput}
                placeholder="Choose your username"
                value={username}
                autoFocus
                disabled={isLoading}
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>

            <div className={styles.formGroup}>
              <label htmlFor="register-campaign-key-input" className={styles.formLabel}>
                <Icon icon="ph:key-bold" style={{ fontSize: "1rem" }} />
                <span>Campaign Key</span>
              </label>
              <input
                id="register-campaign-key-input"
                type="text"
                className={styles.formInput}
                placeholder="Enter invitation campaign key"
                value={campaignKey}
                disabled={isLoading}
                onChange={(e) => setCampaignKey(e.target.value)}
              />
            </div>
          </div>

          <div className={styles.buttonRow}>
            <button
              type="submit"
              className={`d-flex align-items-center justify-content-center gap-2 ${styles.actionButton}`}
              disabled={isLoading || readyState !== ReadyState.OPEN || !username.trim() || !campaignKey.trim()}
            >
              <span>{isLoading ? "Starting Game..." : readyState === ReadyState.OPEN ? "Start New Game" : "Connecting..."}</span>
              <Icon icon="ph:arrow-right-bold" />
            </button>

            <button
              type="button"
              className={`d-flex align-items-center justify-content-center gap-2 ${styles.secondaryButton}`}
              onClick={onBack}
              disabled={isLoading}
            >
              <Icon icon="ph:arrow-left-bold" />
              <span>Back to Title Screen</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default Register;
