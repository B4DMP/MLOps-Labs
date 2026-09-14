import { Icon } from "@iconify/react";
import { motion } from "motion/react";
import styles from "./LoadingScreen.module.css";

interface LoadingScreenProps {
  isConnected?: boolean;
}

export function LoadingScreen({ isConnected }: LoadingScreenProps) {
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
        <p className={styles.cardSubtitle}>Retrieving progress and scenario data</p>

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
