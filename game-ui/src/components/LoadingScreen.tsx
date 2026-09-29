import { useState } from "react";
import { Icon } from "@iconify/react";
import { motion } from "motion/react";
import styles from "./LoadingScreen.module.css";

interface LoadingScreenProps {
  isConnected?: boolean;
}

// Deadpan narrator, same voice as the rest of the game's flavor text (technique 1, no context
// needed since this screen fires from several different transitions). One picked per mount so a
// repeat load doesn't always show the same line.
const LOADING_LINES = [
  "Retrieving progress and scenario data.",
  "Reticulating stakeholder opinions.",
  "Confirming that at least one deadline is already unrealistic.",
  "The trucks have not left yet.",
  "Warming up three stakeholders and one overdue pipeline.",
  "Assembling the next scenario: a supplier, a deadline, and a strong opinion about both.",
];

export function LoadingScreen({ isConnected }: LoadingScreenProps) {
  const [line] = useState(() => LOADING_LINES[Math.floor(Math.random() * LOADING_LINES.length)]);
  return (
    <div className={styles.loadingWrapper}>
      <motion.div
        className={styles.loadingCard}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.22, ease: "easeOut" }}
      >
        <h3 className={styles.cardTitle}>
          <Icon icon="svg-spinners:pulse-2" className={styles.pulseIcon} />
          <span>Loading Game</span>
        </h3>
        <p className={styles.cardSubtitle}>{line}</p>

        {isConnected !== undefined && (
          <div className={styles.statusPill}>
            <span
              className="rounded-circle d-inline-block"
              style={{
                width: "8px",
                height: "8px",
                backgroundColor: isConnected ? "#4ade80" : "#fbbf24",
              }}
            />
            <span>{isConnected ? "Server Connected" : "Connecting to Server..."}</span>
          </div>
        )}
      </motion.div>
    </div>
  );
}

export default LoadingScreen;
