import { useState } from "react";
import { Icon } from "@iconify/react";
import { motion } from "motion/react";
import styles from "./VerifyEmail.module.css";

interface ForgotPasswordProps {
  onSubmit: (email: string) => void;
  onBack: () => void;
  isLoading?: boolean;
  errorMessage?: string;
  onClearError?: () => void;
}

export function ForgotPassword({
  onSubmit,
  onBack,
  isLoading = false,
  errorMessage,
  onClearError,
}: ForgotPasswordProps) {
  const [email, setEmail] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (email.trim() && !isLoading) {
      onSubmit(email.trim());
    }
  };

  const handleChange = (setter: (val: string) => void, val: string) => {
    setter(val);
    if (errorMessage && onClearError) {
      onClearError();
    }
  };

  return (
    <div className={styles.verifyWrapper}>
      <motion.div
        className={styles.verifyCard}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.22, ease: "easeOut" }}
      >
        <h2 className={styles.cardTitle}>Forgot Password</h2>
        <p className={styles.cardSubtitle}>
          Enter the email address of your account. We'll send you a code to reset your password.
        </p>

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

        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <label htmlFor="forgot-email-input" className={styles.formLabel}>
              <Icon icon="ph:envelope-bold" style={{ fontSize: "1rem" }} />
              <span>Email</span>
            </label>
            <input
              id="forgot-email-input"
              type="email"
              className={styles.formInput}
              style={{ letterSpacing: "normal", textAlign: "left" }}
              placeholder="Enter your account email"
              value={email}
              autoFocus
              disabled={isLoading}
              onChange={(e) => handleChange(setEmail, e.target.value)}
            />
          </div>

          <div className="d-flex flex-column gap-2 mt-3">
            <button
              type="submit"
              className={`d-flex align-items-center justify-content-center gap-2 ${styles.actionButton}`}
              disabled={isLoading || !email.trim()}
            >
              <span>{isLoading ? "Sending..." : "Send Reset Code"}</span>
              <Icon icon="ph:arrow-right-bold" />
            </button>

            <button
              type="button"
              className={`d-flex align-items-center justify-content-center gap-2 ${styles.secondaryButton}`}
              onClick={onBack}
              disabled={isLoading}
            >
              <Icon icon="ph:arrow-left-bold" />
              <span>Back to Login</span>
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}

export default ForgotPassword;
