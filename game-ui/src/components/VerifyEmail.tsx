import { useState } from "react";
import { Icon } from "@iconify/react";
import { motion } from "motion/react";
import styles from "./VerifyEmail.module.css";

interface VerifyEmailProps {
  username: string;
  onSubmit: (code: string) => void;
  onResend: () => void;
  onBack: () => void;
  isLoading?: boolean;
  isResending?: boolean;
  errorMessage?: string;
  onClearError?: () => void;
}

export function VerifyEmail({
  username,
  onSubmit,
  onResend,
  onBack,
  isLoading = false,
  isResending = false,
  errorMessage,
  onClearError,
}: VerifyEmailProps) {
  const [code, setCode] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (code.trim() && !isLoading) {
      onSubmit(code.trim());
    }
  };

  const handleCodeChange = (val: string) => {
    setCode(val.replace(/[^0-9]/g, "").slice(0, 6));
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
        <h2 className={styles.cardTitle}>Verify Your Email</h2>
        <p className={styles.cardSubtitle}>
          We sent a 6-digit code to the email address for <strong>{username}</strong>. Enter it below to continue.
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
            <label htmlFor="verify-code-input" className={styles.formLabel}>
              <Icon icon="ph:shield-check-bold" style={{ fontSize: "1rem" }} />
              <span>Verification Code</span>
            </label>
            <input
              id="verify-code-input"
              type="text"
              inputMode="numeric"
              className={styles.formInput}
              placeholder="000000"
              value={code}
              autoFocus
              disabled={isLoading}
              onChange={(e) => handleCodeChange(e.target.value)}
            />
          </div>

          <div className="d-flex flex-column gap-2 mt-3">
            <button
              type="submit"
              className={`d-flex align-items-center justify-content-center gap-2 ${styles.actionButton}`}
              disabled={isLoading || code.trim().length !== 6}
            >
              <span>{isLoading ? "Verifying..." : "Verify"}</span>
              <Icon icon="ph:arrow-right-bold" />
            </button>

            <button
              type="button"
              className={styles.linkButton}
              onClick={onResend}
              disabled={isLoading || isResending}
              style={{ alignSelf: "center", margin: "0.25rem 0" }}
            >
              {isResending ? "Sending a new code..." : "Resend code"}
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

export default VerifyEmail;
