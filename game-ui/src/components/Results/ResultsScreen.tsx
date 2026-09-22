import { useEffect, useState } from "react";
import { Icon } from "@iconify/react";
import { useGameWebSocket } from "../../services/websocket/useGameWebSocket";
import LoadingScreen from "../LoadingScreen";
import ResultsHero from "./ResultsHero";
import ResultsTabs from "./ResultsTabs";
import type { MetricInfo } from "./tabs/MetricsTab";
import type { ResultsPayload } from "./types";
import styles from "./ResultsScreen.module.css";

type NewGameMode = "spiral" | "fresh";

interface NewGameChoice {
  mode: NewGameMode;
  title: string;
  icon: string;
  body: string;
}

/**
 * Two ways to play again, offered as a choice rather than one button with a toggle. Next iteration
 * leads, because it is the one that teaches the spiral: an MLOps project does not restart from
 * nothing, it comes back round to requirements carrying the system it already has.
 */
const NEW_GAME_CHOICES: NewGameChoice[] = [
  {
    mode: "spiral",
    title: "Next iteration",
    icon: "ph:arrows-clockwise-bold",
    body:
      "Back to requirements with the system you built. Its maturity, its technical debt and its " +
      "anti-patterns come with you, and so does the room's memory of you.",
  },
  {
    mode: "fresh",
    title: "Fresh start",
    icon: "ph:sparkle-bold",
    body: "A clean slate. New challenges, a pipeline built from scratch and a room with no history.",
  },
];

export interface ResultsScreenProps {
  /** Names, icons and colours for the metric gauges, from the same source as the in-game HUD. */
  metricInfo?: Record<string, MetricInfo>;
}

/**
 * The end-of-game debrief (docs/plans/results-screen.md): a shareable hero card, what shaped the
 * result, and a tab per detail section.
 *
 * Asks for a fresh computation rather than the cached one, because the player may have arrived here
 * straight from the last challenge and the cache tracks the run rather than pinning it.
 */
export default function ResultsScreen({ metricInfo = {} }: ResultsScreenProps) {
  const { emit, subscribe, isConnected, lastError } = useGameWebSocket();
  const [results, setResults] = useState<ResultsPayload | null>(null);
  const [attempt, setAttempt] = useState(0);
  // Which mode was pressed, and what the last error was at that moment. Kept together so "still
  // starting" can be derived rather than reset in an effect: a refusal arrives as a *different*
  // error than the one on screen when the button was pressed, which ends the pending state.
  const [pressed, setPressed] = useState<{ mode: NewGameMode; errorAtPress: string | null } | null>(null);
  const starting = pressed && pressed.errorAtPress === lastError ? pressed.mode : null;

  useEffect(() => subscribe<ResultsPayload>("results:data", (data) => setResults(data)), [subscribe]);

  // The server has opened the new run. Reloading re-runs the normal game init, which reads the new
  // run's position and deals its first challenge, exactly as `settings:account_reset` does.
  useEffect(() => subscribe("game:new_run_started", () => window.location.reload()), [subscribe]);

  const startNewGame = (mode: NewGameMode) => {
    setPressed({ mode, errorAtPress: lastError });
    emit("game:new_run", { mode });
  };

  useEffect(() => {
    if (isConnected) emit("results:get", { refresh: true });
  }, [emit, isConnected, attempt]);

  if (!results) {
    return lastError ? (
      <div className={styles.wrapper}>
        <div className={styles.failure} role="alert">
          <Icon icon="ph:warning-circle-bold" aria-hidden />
          <p>Your results could not be loaded: {lastError}</p>
          <button type="button" className={styles.retry} onClick={() => setAttempt((n) => n + 1)}>
            Try again
          </button>
        </div>
      </div>
    ) : (
      <LoadingScreen isConnected={isConnected} />
    );
  }

  return (
    <div className={styles.wrapper}>
      <div className={styles.column}>
        <ResultsHero results={results} />

        <ResultsTabs results={results} metricInfo={metricInfo} />

        <footer className={styles.footer}>
          {results.replay_allowed ? (
            <section className={styles.newGame} aria-labelledby="results-newgame-title">
              <h2 id="results-newgame-title" className={styles.newGameTitle}>
                Play again
              </h2>
              <div className={styles.choices}>
                {NEW_GAME_CHOICES.map((choice) => (
                  <button
                    key={choice.mode}
                    type="button"
                    className={`${styles.choice} ${choice.mode === "spiral" ? styles.choiceLead : styles.choiceFresh}`}
                    disabled={starting !== null}
                    onClick={() => startNewGame(choice.mode)}
                  >
                    <span className={styles.choiceHead}>
                      <Icon icon={choice.icon} aria-hidden />
                      {starting === choice.mode ? "Starting" : choice.title}
                    </span>
                    <span className={styles.choiceBody}>{choice.body}</span>
                  </button>
                ))}
              </div>
              <p className={styles.keepNote}>Your results so far are kept whichever you pick.</p>
            </section>
          ) : (
            <div className={styles.notice} role="note">
              <Icon icon="ph:warning-circle-bold" aria-hidden />
              <span>
                <strong>Important notice:</strong> please refrain from participating again with
                another username, as duplicate sessions would invalidate our empirical research
                results.
              </span>
            </div>
          )}
          <div className={styles.saved}>
            <Icon icon="ph:check-circle-bold" aria-hidden />
            <span>All responses have been securely recorded. You may now close this tab.</span>
          </div>
        </footer>
      </div>
    </div>
  );
}
