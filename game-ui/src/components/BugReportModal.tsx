import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@iconify/react";
import { submitBugReport } from "../services/api/bugReports";
import styles from "./BugReportModal.module.css";
import HoverTooltip from "./HoverToolTip";

interface BugReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentPhase?: number;
  currentChallenge?: number;
  challengeTitle?: string;
}

const MAX_MESSAGE_LENGTH = 4000;

export default function BugReportModal({
  isOpen,
  onClose,
  currentPhase,
  currentChallenge,
  challengeTitle,
}: BugReportModalProps) {
  const [isClosing, setIsClosing] = useState(false);
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "sent" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setIsClosing(false);
      setMessage("");
      setStatus("idle");
      setError(null);
    }
  }, [isOpen]);

  const handleClose = () => {
    if (isClosing) return;
    setIsClosing(true);
    setTimeout(() => {
      setIsClosing(false);
      onClose();
    }, 200);
  };

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, isClosing]);

  if (!isOpen) return null;

  const handleSubmit = async () => {
    if (!message.trim() || status === "submitting") return;
    setStatus("submitting");
    setError(null);
    try {
      await submitBugReport({
        message: message.trim(),
        debugInfo: {
          timestamp: new Date().toISOString(),
          currentPhase,
          currentChallenge,
          challengeTitle,
          userAgent: navigator.userAgent,
        },
      });
      setStatus("sent");
    } catch (e) {
      setStatus("error");
      setError(e instanceof Error ? e.message : "Could not submit your bug report.");
    }
  };

  return createPortal(
    <div
      className={`${styles.backdrop} ${isClosing ? styles.backdropClosing : ""}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      <div
        className={`${styles.panel} ${isClosing ? styles.panelClosing : ""}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.header}>
          <h1 className={styles.headerTitle}>
            <Icon icon="ph:bug-bold" className={styles.headerIcon} />
            <span>Report a Bug</span>
          </h1>
          <HoverTooltip description="Close (Esc)">
            <button
              type="button"
              className="btn-close btn-close-white"
              onClick={handleClose}
              aria-label="Close"
              style={{ cursor: "pointer" }}
            />
          </HoverTooltip>
        </div>

        <div className={styles.modalBody}>
          {status === "sent" ? (
            <p className={styles.successText}>
              <Icon icon="ph:check-circle-bold" />
              Thanks, we got it. We'll take a look.
            </p>
          ) : (
            <>
              <p className={styles.intro}>
                Ran into something broken or confusing? Describe what happened and what you
                expected instead.
              </p>
              <textarea
                className={styles.textarea}
                value={message}
                maxLength={MAX_MESSAGE_LENGTH}
                placeholder="What went wrong?"
                autoFocus
                onChange={(e) => setMessage(e.target.value)}
              />
              <div className={styles.debugSummary}>
                <span>Sent along automatically: timestamp, your account email, current phase/challenge, page URL.</span>
              </div>
              {status === "error" && <p className={styles.errorText}>{error}</p>}
            </>
          )}
        </div>

        <div className={styles.footer}>
          {status === "sent" ? (
            <button className={styles.actionButton} onClick={handleClose}>
              <span>Done</span>
              <Icon icon="ph:check-bold" />
            </button>
          ) : (
            <>
              <button className={styles.secondaryButton} onClick={handleClose}>
                Cancel
              </button>
              <button
                className={styles.actionButton}
                onClick={handleSubmit}
                disabled={!message.trim() || status === "submitting"}
              >
                <span>{status === "submitting" ? "Sending…" : "Send Report"}</span>
                {status !== "submitting" && <Icon icon="ph:paper-plane-tilt-bold" />}
              </button>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
