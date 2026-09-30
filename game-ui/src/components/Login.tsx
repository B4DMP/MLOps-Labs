import { useState } from "react";
import { Icon } from "@iconify/react";
import { motion } from "motion/react";
import { ReadyState } from "../services/websocket/types";
import styles from "./Login.module.css";

interface LoginProps {
  onSubmit: (email: string, password: string, startMuted: boolean) => void;
  onForgotPassword: () => void;
  readyState: ReadyState;
  onBack: () => void;
  isLoading?: boolean;
  errorMessage?: string;
  onClearError?: () => void;
}

export function Login({
  onSubmit,
  onForgotPassword,
  readyState,
  onBack,
  isLoading = false,
  errorMessage,
  onClearError,
}: LoginProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [startMuted, setStartMuted] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (email.trim() && password && !isLoading) {
      onSubmit(email.trim(), password, startMuted);
    }
  };

  const handleEmailChange = (val: string) => {
    setEmail(val);
    if (errorMessage && onClearError) {
      onClearError();
    }
  };

  const handlePasswordChange = (val: string) => {
    setPassword(val);
    if (errorMessage && onClearError) {
      onClearError();
    }
  };

  return (
    <div className={styles.loginWrapper}>
      <motion.div
        className={styles.loginCard}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.22, ease: "easeOut" }}
      >

        <h2 className={styles.cardTitle}>Login</h2>
        <p className={styles.cardSubtitle}>
          Resume your saved progress in MLOps Labs
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

        {/* Glassmorphic Info Callout */}
        <div className={styles.infoBox}>
          <Icon
            icon="ph:info-bold"
            className="flex-shrink-0 mt-1"
            style={{ color: "#7dd3fc", fontSize: "1.2rem" }}
          />
          <span>
            Please enter your registered <strong>email</strong> to continue where you left off.
          </span>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <label htmlFor="login-email-input" className={styles.formLabel}>
              <Icon icon="ph:envelope-bold" style={{ fontSize: "1rem" }} />
              <span>Email</span>
            </label>
            <input
              id="login-email-input"
              type="text"
              autoComplete="username"
              className={styles.formInput}
              placeholder="Enter your email"
              value={email}
              autoFocus
              disabled={isLoading}
              onChange={(e) => handleEmailChange(e.target.value)}
            />
          </div>

          <div className="mb-4">
            <label htmlFor="login-password-input" className={styles.formLabel}>
              <Icon icon="ph:lock-key-bold" style={{ fontSize: "1rem" }} />
              <span>Password</span>
            </label>
            <input
              id="login-password-input"
              type="password"
              className={styles.formInput}
              placeholder="Enter your password"
              value={password}
              disabled={isLoading}
              onChange={(e) => handlePasswordChange(e.target.value)}
            />
            <button
              type="button"
              className={styles.secondaryButton}
              style={{
                width: "auto",
                background: "none",
                border: "none",
                color: "#7dd3fc",
                fontSize: "0.85rem",
                fontWeight: 600,
                padding: "0.4rem 0 0",
                textDecoration: "underline",
                textAlign: "left",
              }}
              onClick={onForgotPassword}
              disabled={isLoading}
            >
              Forgot password?
            </button>
          </div>

          <div className="form-check form-switch d-flex align-items-center gap-2 mb-1">
            <input
              type="checkbox"
              role="switch"
              id="login-start-muted"
              className="form-check-input mt-0"
              checked={startMuted}
              disabled={isLoading}
              onChange={(e) => setStartMuted(e.target.checked)}
            />
            <label htmlFor="login-start-muted" className={styles.formLabel} style={{ cursor: "pointer", marginBottom: 0 }}>
              <Icon icon="ph:speaker-slash-bold" style={{ fontSize: "1rem" }} />
              <span>Start muted</span>
            </label>
          </div>

          <div className="d-flex flex-column gap-2 mt-3">
            <button
              type="submit"
              className={`d-flex align-items-center justify-content-center gap-2 ${styles.actionButton}`}
              disabled={isLoading || readyState !== ReadyState.OPEN || !email.trim() || !password}
            >
              <span>{isLoading ? "Starting Game..." : readyState === ReadyState.OPEN ? "Resume Game" : "Connecting..."}</span>
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

export default Login;
