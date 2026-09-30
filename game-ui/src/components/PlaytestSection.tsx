import { useEffect, useRef, useState } from "react";
import { useGameWebSocket } from "../services/websocket/useGameWebSocket";
import styles from "./SettingsPanel.module.css";

type ActionId = "card" | "skip" | "jump_intro" | "jump_outro";

const ACTIONS: Array<{ id: ActionId; label: string; event: string; payload?: Record<string, unknown> }> = [
  { id: "card", label: "Auto-pitch a card", event: "playtest:auto_card" },
  { id: "skip", label: "Skip this challenge", event: "playtest:skip_challenge" },
  {
    id: "jump_intro",
    label: "Jump to intro questionnaire",
    event: "playtest:jump_to_questionnaire",
    payload: { target: "intro" },
  },
  {
    id: "jump_outro",
    label: "Jump to outro questionnaire",
    event: "playtest:jump_to_questionnaire",
    payload: { target: "outro" },
  },
];

interface PlaytestResult {
  ok: boolean;
  outcome?: "PASS" | "SOFT_PASS" | "VETO" | null;
  changes?: unknown[];
  choices?: number;
  evaluated?: number;
  min_buy_in?: number | null;
  reason?: "nothing_to_slot" | "no_non_veto_card";
}

/** What the tool found, in a sentence. A refusal says why, since "there is no card the room will
 * accept" is a fact about the room and not a failure of the tool. */
function describe(result: PlaytestResult, action: ActionId): string {
  if (result.ok) {
    const clean = result.outcome === "PASS" ? "a clean pass" : "a pass with reservations";
    const count = result.changes?.length ?? 0;
    return `Slotted ${clean}: ${count} change${count === 1 ? "" : "s"}, picked from ${result.choices ?? 0} that would get through.`;
  }
  const untouched = action === "skip" ? " Nothing was committed." : "";
  if (result.reason === "nothing_to_slot") return `There is nothing to build a card on yet.${untouched}`;
  const best = result.min_buy_in == null ? "" : ` The closest came to ${Math.round(result.min_buy_in * 100)}% buy-in.`;
  return `No card found that the room would not veto, after trying ${result.evaluated ?? 0}.${best}${untouched}`;
}

export interface PlaytestSectionProps {
  /** Called once a skip has actually gone through, so the caller can get the settings panel out
   * of the way. Optional: the section still works, minus that courtesy, without it. */
  onSkipped?: () => void;
}

/**
 * The playtest tools in the settings panel (docs/plans/results-screen.md, D9): auto-pitch a card
 * the room will not veto, or skip the challenge outright.
 *
 * Shown only when the server has `ENABLE_PLAYTEST_TOOLS` on, and the server checks the flag again on
 * every event, so hiding the buttons is a courtesy and not the gate.
 *
 * Using either marks the account as a playtest account **permanently**, so each button needs two
 * presses: the first arms it, the second sends it. The armed state lives here, in a child of the
 * modal, so it disappears when the panel closes rather than waiting to be pressed by accident later.
 *
 * A skip does **not** reload the page. `handle_playtest_skip_challenge` runs the challenge to its
 * end through the game's own handlers, which already send the same `game:state_update` (or
 * `game:progress_change`) event a normal "Proceed" click sends - `Game.tsx` picks that up on its
 * own and reopens the briefing for whatever came next, exactly as an ordinary round completion
 * does. A reload would throw that away and restart the whole session instead, which reads as a
 * logout. This only closes the settings panel, so the briefing underneath is visible.
 */
export default function PlaytestSection({ onSkipped }: PlaytestSectionProps) {
  const { emit, subscribe, lastError } = useGameWebSocket();
  const [armed, setArmed] = useState<ActionId | null>(null);
  // What was pressed, and the error on screen at that moment. "Still working" is derived from it: a
  // refusal arrives as a different error, which ends the wait without an effect to reset state.
  const [pending, setPending] = useState<{ id: ActionId; errorAtPress: string | null } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const busy = pending !== null && pending.errorAtPress === lastError;

  // Held in refs so the subscriptions below are registered once per mount, not on every render.
  const onResult = useRef((action: ActionId, result: PlaytestResult) => {
    setPending(null);
    setNote(describe(result, action));
  });
  const onSkippedRef = useRef(onSkipped);
  useEffect(() => {
    onSkippedRef.current = onSkipped;
  }, [onSkipped]);

  useEffect(() => {
    const offCard = subscribe<PlaytestResult>("playtest:auto_card_result", (r) => onResult.current("card", r));
    const offSkip = subscribe<PlaytestResult>("playtest:skip_result", (r) => onResult.current("skip", r));
    // The game underneath has already moved on (see the component note); just get out of its way.
    const offDone = subscribe("playtest:skipped", () => {
      setPending(null);
      onSkippedRef.current?.();
    });
    // A questionnaire jump also changes what's showing underneath the panel, same as a skip.
    const offJumped = subscribe("playtest:jumped", () => {
      setPending(null);
      onSkippedRef.current?.();
    });
    return () => {
      offCard();
      offSkip();
      offDone();
      offJumped();
    };
  }, [subscribe]);

  const press = (id: ActionId, event: string, payload?: Record<string, unknown>) => {
    if (busy) return;
    if (armed !== id) {
      setArmed(id);
      setNote(null);
      return;
    }
    setArmed(null);
    setPending({ id, errorAtPress: lastError });
    emit(event, payload ?? {});
  };

  return (
    <section className={styles.section}>
      <h3 className={styles.sectionTitle}>Playtest tools</h3>
      <p className={styles.diagnostic}>
        For testing only. Using either marks this account as a playtest account, permanently, so it is
        left out of the research data.
      </p>
      <div className={styles.playtestActions}>
        {ACTIONS.map((action) => (
          <button
            key={action.id}
            type="button"
            className={armed === action.id ? styles.dangerButton : styles.cancelButton}
            disabled={busy}
            onClick={() => press(action.id, action.event, action.payload)}
          >
            {busy && pending?.id === action.id
              ? "Working"
              : armed === action.id
                ? "Click again to confirm"
                : action.label}
          </button>
        ))}
      </div>
      {note && (
        <p className={styles.diagnostic} role="status">
          {note}
        </p>
      )}
    </section>
  );
}
