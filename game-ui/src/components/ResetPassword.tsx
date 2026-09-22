import { useState } from "react";
import { Icon } from "@iconify/react";
import { motion } from "motion/react";
import styles from "./VerifyEmail.module.css";

interface ResetPasswordProps {
  username: string;
  onSubmit: (code: string, newPassword: string, newPasswordConfirm: string) => void;
  onBack: () => void;
  isLoading?: boolean;
  errorMessage?: string;
  onClearError?: () => void;
}

export function ResetPassword({
  username,
  onSubmit,
  onBack,
  isLoading = false,
  errorMessage,
  onClearError,
}: ResetPasswordProps) {
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newPasswordConfirm, setNewPasswordConfirm] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (code.trim() && newPassword && newPasswordConfirm && !isLoading) {
      onSubmit(code.trim(), newPassword, newPasswordConfirm);
    }
  };

  const clearError = () => {
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
        <h2 className={styles.cardTitle}>Reset Password</h2>
        <p className={styles.cardSubtitle}>
          Enter the code we sent for <strong>{username}</strong> along with your new password.
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
          <div className="mb-3">
            <label htmlFor="reset-code-input" className={styles.formLabel}>
              <Icon icon="ph:shield-check-bold" style={{ fontSize: "1rem" }} />
              <span>Reset Code</span>
            </label>
            <input
              id="reset-code-input"
              type="text"
              inputMode="numeric"
              className={styles.formInput}
              placeholder="000000"
              value={code}
              autoFocus
              disabled={isLoading}
              onChange={(e) => {
                setCode(e.target.value.replace(/[^0-9]/g, "").slice(0, 6));
                clearError();
              }}
            />
          </div>

          <div className="mb-3">
            <label htmlFor="reset-new-password-input" className={styles.formLabel}>
              <Icon icon="ph:lock-key-bold" style={{ fontSize: "1rem" }} />
              <span>New Password</span>
            </label>
            <input
              id="reset-new-password-input"
              type="password"
              className={styles.formInput}
              style={{ letterSpacing: "normal", textAlign: "left" }}
              placeholder="Enter a new password"
              value={newPassword}
              disabled={isLoading}
              onChange={(e) => {
                setNewPassword(e.target.value);
                clearError();
              }}
            />
          </div>

          <div className="mb-4">
            <label htmlFor="reset-new-password-confirm-input" className={styles.formLabel}>
              <Icon icon="ph:lock-key-bold" style={{ fontSize: "1rem" }} />
              <span>Confirm New Password</span>
            </label>
            <input
              id="reset-new-password-confirm-input"
              type="password"
              className={styles.formInput}
              style={{ letterSpacing: "normal", textAlign: "left" }}
              placeholder="Re-enter the new password"
              value={newPasswordConfirm}
              disabled={isLoading}
              onChange={(e) => {
                setNewPasswordConfirm(e.target.value);
                clearError();
              }}
            />
          </div>

          <div className="d-flex flex-column gap-2 mt-3">
            <button
              type="submit"
              className={`d-flex align-items-center justify-content-center gap-2 ${styles.actionButton}`}
              disabled={isLoading || code.trim().length !== 6 || !newPassword || !newPasswordConfirm}
            >
              <span>{isLoading ? "Resetting..." : "Reset Password"}</span>
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

export default ResetPassword;
