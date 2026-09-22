import { useState } from "react";
import { Icon } from "@iconify/react";
import { motion } from "motion/react";
import { ReadyState } from "../services/websocket/types";
import styles from "./Register.module.css";

interface RegisterProps {
  onSubmit: (
    username: string,
    email: string,
    emailConfirm: string,
    password: string,
    passwordConfirm: string,
    usersOnMachine: number,
    campaignKey: string,
    startMuted: boolean
  ) => void;
  readyState: ReadyState;
  onBack: () => void;
  isLoading?: boolean;
  errorMessage?: string;
  onClearError?: () => void;
}

export function Register({
  onSubmit,
  readyState,
  onBack,
  isLoading = false,
  errorMessage,
  onClearError,
}: RegisterProps) {
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [emailConfirm, setEmailConfirm] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [usersOnMachine, setUsersOnMachine] = useState("1");
  const [campaignKey, setCampaignKey] = useState("");
  const [startMuted, setStartMuted] = useState(false);

  // Whether email is actually required depends on the campaign (test campaigns skip it
  // entirely), which only the backend knows - so the form doesn't require it client-side, and
  // register_user re-validates everything server-side regardless of what's sent here.
  const isFormFilled =
    username.trim() &&
    password &&
    passwordConfirm &&
    usersOnMachine.trim() &&
    campaignKey.trim();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isFormFilled && !isLoading) {
      onSubmit(
        username.trim(),
        email.trim(),
        emailConfirm.trim(),
        password,
        passwordConfirm,
        parseInt(usersOnMachine, 10),
        campaignKey.trim(),
        startMuted
      );
    }
  };

  const handleInputChange = (setter: (val: string) => void, val: string) => {
    setter(val);
    if (errorMessage && onClearError) {
      onClearError();
    }
  };

  return (
    <div className={styles.registerWrapper}>
      <motion.div
        className={styles.registerCard}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.22, ease: "easeOut" }}
      >

        <h2 className={styles.cardTitle}>Register</h2>
        <p className={styles.cardSubtitle}>
          Join a study campaign and begin your MLOps Labs session. <br /> Your game will be saved automatically.
        </p>

        {/* Inline Error Alert */}
        {errorMessage && (
          <div className={styles.errorAlert} role="alert">
            <Icon
              icon="ph:warning-circle-bold"
              className="flex-shrink-0"
              style={{ fontSize: "1.25rem", color: "#f87171" }}
            />
            <span>{errorMessage}</span>
          </div>
        )}

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
                onChange={(e) => handleInputChange(setUsername, e.target.value)}
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
                onChange={(e) => handleInputChange(setCampaignKey, e.target.value)}
              />
            </div>

            <div className={styles.formGroup}>
              <label htmlFor="register-email-input" className={styles.formLabel}>
                <Icon icon="ph:envelope-bold" style={{ fontSize: "1rem" }} />
                <span>Email</span>
              </label>
              <input
                id="register-email-input"
                type="email"
                className={styles.formInput}
                placeholder="Enter your email"
                value={email}
                disabled={isLoading}
                onChange={(e) => handleInputChange(setEmail, e.target.value)}
              />
            </div>

            <div className={styles.formGroup}>
              <label htmlFor="register-email-confirm-input" className={styles.formLabel}>
                <Icon icon="ph:envelope-bold" style={{ fontSize: "1rem" }} />
                <span>Confirm Email</span>
              </label>
              <input
                id="register-email-confirm-input"
                type="email"
                className={styles.formInput}
                placeholder="Re-enter your email"
                value={emailConfirm}
                disabled={isLoading}
                onChange={(e) => handleInputChange(setEmailConfirm, e.target.value)}
              />
            </div>

            <div className={styles.formGroup}>
              <label htmlFor="register-password-input" className={styles.formLabel}>
                <Icon icon="ph:lock-key-bold" style={{ fontSize: "1rem" }} />
                <span>Password</span>
              </label>
              <input
                id="register-password-input"
                type="password"
                className={styles.formInput}
                placeholder="Choose a password"
                value={password}
                disabled={isLoading}
                onChange={(e) => handleInputChange(setPassword, e.target.value)}
              />
            </div>

            <div className={styles.formGroup}>
              <label htmlFor="register-password-confirm-input" className={styles.formLabel}>
                <Icon icon="ph:lock-key-bold" style={{ fontSize: "1rem" }} />
                <span>Confirm Password</span>
              </label>
              <input
                id="register-password-confirm-input"
                type="password"
                className={styles.formInput}
                placeholder="Re-enter your password"
                value={passwordConfirm}
                disabled={isLoading}
                onChange={(e) => handleInputChange(setPasswordConfirm, e.target.value)}
              />
            </div>

            <div className={styles.formGroup}>
              <label htmlFor="register-users-on-machine-input" className={styles.formLabel}>
                <Icon icon="ph:users-bold" style={{ fontSize: "1rem" }} />
                <span>Players On This Device</span>
              </label>
              <input
                id="register-users-on-machine-input"
                type="number"
                min={1}
                className={styles.formInput}
                placeholder="How many people play on this device?"
                value={usersOnMachine}
                disabled={isLoading}
                onChange={(e) => handleInputChange(setUsersOnMachine, e.target.value)}
              />
            </div>
          </div>

          <div className="form-check form-switch d-flex align-items-center gap-2 mb-1">
            <input
              type="checkbox"
              role="switch"
              id="register-start-muted"
              className="form-check-input mt-0"
              checked={startMuted}
              disabled={isLoading}
              onChange={(e) => setStartMuted(e.target.checked)}
            />
            <label htmlFor="register-start-muted" className={styles.formLabel} style={{ cursor: "pointer", marginBottom: 0 }}>
              <Icon icon="ph:speaker-slash-bold" style={{ fontSize: "1rem" }} />
              <span>Start muted</span>
            </label>
          </div>

          <div className={styles.buttonRow}>
            <button
              type="submit"
              className={`d-flex align-items-center justify-content-center gap-2 ${styles.actionButton}`}
              disabled={isLoading || readyState !== ReadyState.OPEN || !isFormFilled}
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
      </motion.div>
    </div>
  );
}

export default Register;
