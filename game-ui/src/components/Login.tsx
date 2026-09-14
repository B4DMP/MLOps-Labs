import { useState } from "react";
import { Icon } from "@iconify/react";
import { motion } from "motion/react";
import { ReadyState } from "../services/websocket/types";
import styles from "./Login.module.css";

interface LoginProps {
  onSubmit: (username: string) => void;
  readyState: ReadyState;
  onBack: () => void;
  isLoading?: boolean;
  errorMessage?: string;
  onClearError?: () => void;
}

export function Login({
  onSubmit,
  readyState,
  onBack,
  isLoading = false,
  errorMessage,
  onClearError,
}: LoginProps) {
  const [username, setUsername] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (username.trim() && !isLoading) {
      onSubmit(username.trim());
    }
  };

  const handleUsernameChange = (val: string) => {
    setUsername(val);
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
            Please enter your registered <strong>username</strong> to continue where you left off.
          </span>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <label htmlFor="login-username-input" className={styles.formLabel}>
              <Icon icon="ph:user-bold" style={{ fontSize: "1rem" }} />
              <span>Username</span>
            </label>
            <input
              id="login-username-input"
              type="text"
              className={styles.formInput}
              placeholder="Enter your username"
              value={username}
              autoFocus
              disabled={isLoading}
              onChange={(e) => handleUsernameChange(e.target.value)}
            />
          </div>

          <div className="d-flex flex-column gap-2 mt-3">
            <button
              type="submit"
              className={`d-flex align-items-center justify-content-center gap-2 ${styles.actionButton}`}
              disabled={isLoading || readyState !== ReadyState.OPEN || !username.trim()}
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
