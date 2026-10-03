import { useEffect, useRef, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import styles from "./NarratorGate.module.css";
import OnceIcon from "./Results/OnceIcon";
import WALKIE_TALKIE_ICON from "./Results/icons/radio-walkie-talkie.json";
import {
  confirmNarratorGate,
  declineNarratorGate,
  getNarratorGateState,
  registerNarratorGateHost,
  subscribeNarratorGate,
} from "../utils/narratorGate";
import { setSessionMuted } from "../utils/speech";

interface NarratorGateProps {
  open: boolean;
  loading?: boolean;
  /** Reload wording: "Continue with voice" instead of "Begin the walkthrough". */
  compact?: boolean;
  onConfirm: () => void;
  onDecline: () => void;
}

const FOCUSABLE = "button";

export default function NarratorGate({ open, loading = false, compact = false, onConfirm, onDecline }: NarratorGateProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);

  // Focus the primary button on open and give focus back on close.
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    primaryRef.current?.focus();
    return () => previous?.focus?.();
  }, [open]);

  if (!open) return null;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onDecline();
      return;
    }
    if (e.key !== "Tab") return;
    const items = Array.from(panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    const inside = panelRef.current?.contains(active) ?? false;
    if (e.shiftKey && (active === first || !inside)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (active === last || !inside)) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <div className={styles.overlayLayer} onKeyDown={handleKeyDown}>
      <div
        ref={panelRef}
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="narrator-gate-title"
        aria-describedby="narrator-gate-note"
      >
        <div className={styles.header}>
          <OnceIcon icon={WALKIE_TALKIE_ICON} className={styles.heroIcon} />
          <div>
            <h2 id="narrator-gate-title" className={styles.title}>
              Your narrator is ready
            </h2>
            <p className={styles.subtitle}>It reads the briefings aloud and walks you through each screen.</p>
          </div>
        </div>

        <div className={styles.body}>
          <div className={styles.actions}>
            <button
              ref={primaryRef}
              type="button"
              className={styles.primaryButton}
              aria-disabled={loading}
              onClick={() => {
                if (!loading) onConfirm();
              }}
            >
              {loading ? (
                <>
                  <span className={styles.spinner} aria-hidden />
                  <span>Loading the voice</span>
                </>
              ) : (
                <span>{compact ? "Continue with voice" : "Begin the walkthrough"}</span>
              )}
            </button>
            <button type="button" className={styles.secondaryButton} onClick={onDecline}>
              Read it myself
            </button>
          </div>
          <p id="narrator-gate-note" className={styles.note}>
            Browsers keep audio off until you interact with the page. One click and the narrator can speak.
          </p>
          <div role="status" aria-live="polite" className={styles.srOnly}>
            {loading ? "Loading the narrator voice" : ""}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Mount once near the app root (inside `SettingsProvider` and the websocket provider). */
export function NarratorGateHost() {
  const state = useSyncExternalStore(subscribeNarratorGate, getNarratorGateState);

  useEffect(() => registerNarratorGateHost(), []);

  const handleDecline = () => {
    setSessionMuted(true);
    declineNarratorGate();
  };

  return createPortal(
    <NarratorGate
      open={state.open}
      loading={state.loading}
      compact={state.compact}
      onConfirm={confirmNarratorGate}
      onDecline={handleDecline}
    />,
    document.body,
  );
}
