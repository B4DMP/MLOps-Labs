import { Icon } from "@iconify/react";
import HoverTooltip from "../HoverToolTip";
import styles from "./ConversationHistory.module.css";

interface SpeechControlsProps {
  isLive: boolean;
  onPlay: () => void;
  onStop?: () => void;
}

/** Stop shows only on the line being narrated; play (replay while live) is on every line. */
export default function SpeechControls({ isLive, onPlay, onStop }: SpeechControlsProps) {
  return (
    <span className={styles.controls}>
      {isLive && onStop && (
        <HoverTooltip description="Stop">
          <button type="button" className={styles.controlBtn} onClick={onStop} aria-label="Stop speaking">
            <Icon icon="ph:stop-fill" />
          </button>
        </HoverTooltip>
      )}
      <HoverTooltip description={isLive ? "Replay" : "Play"}>
        <button
          type="button"
          className={styles.controlBtn}
          onClick={onPlay}
          aria-label={isLive ? "Replay from the start" : "Read this message aloud"}
        >
          <Icon icon={isLive ? "ph:arrow-clockwise-bold" : "ph:play-fill"} />
        </button>
      </HoverTooltip>
    </span>
  );
}
