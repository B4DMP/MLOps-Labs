import { useState, type ReactNode } from "react";
import StakeholderAvatarComponent from "../StakeholderAvatarComponent";
import SpokenText from "../SpokenText";
import SpeechControls from "./SpeechControls";
import type { AvatarEmotion, StakeholderAvatar } from "../../types/StakeholderAvatar";
import { shortName, type ChatMsg, type Stance } from "./chat";
import styles from "./ConversationHistory.module.css";

interface MessageBubbleProps {
  msg: ChatMsg;
  name: string;
  metric?: string;
  color: string;
  avatar?: StakeholderAvatar;
  stakeholderId?: string;
  isLive: boolean;
  activeSentenceIndex: number | null;
  renderText: (text: string) => ReactNode;
  stance?: Stance;
  onPlay?: () => void;
  onStop?: () => void;
}

const STANCE_LABEL: Record<Stance, string> = { pushback: "Pushback", objection: "Objection" };

export default function MessageBubble({
  msg,
  name,
  metric,
  color,
  avatar,
  stakeholderId,
  isLive,
  activeSentenceIndex,
  renderText,
  stance,
  onPlay,
  onStop,
}: MessageBubbleProps) {
  const [hovered, setHovered] = useState(false);
  const face = (hovered ? "suspicious" : msg.facial_expression || avatar?.face || avatar?.emotion || "smile") as AvatarEmotion;
  const mood = msg.emotional_state ? msg.emotional_state.replace(/_/g, " ") : "";

  return (
    <article
      className={`${styles.bubble} ${isLive ? styles.bubbleLive : ""}`}
      style={{ ["--c" as string]: color }}
      data-testid="chat-bubble"
    >
      <button
        type="button"
        className={styles.avatarBtn}
        disabled={!onPlay}
        onClick={() => (isLive && onStop ? onStop() : onPlay?.())}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        aria-label={`${name}: read this message aloud`}
      >
        <span className={styles.avatarFace}>
          <StakeholderAvatarComponent
            avatar={avatar}
            emotion={face}
            play_blink_animation={true}
            isFramed={false}
            thumb
            size="100%"
            stakeholderColor={color}
            stakeholderId={stakeholderId}
            title={name}
          />
        </span>
      </button>
      <div className={styles.bubbleBody}>
        <header className={styles.header}>
          <span className={styles.name}>{shortName(name, metric)}</span>
          {metric && <span className={styles.role}>{metric}</span>}
          {mood && <span className={styles.mood}>{mood}</span>}
          {stance && (
            <span className={`${styles.stance} ${stance === "objection" ? styles.stanceObjection : styles.stancePushback}`}>
              {STANCE_LABEL[stance]}
            </span>
          )}
          {onPlay && <SpeechControls isLive={isLive} onPlay={onPlay} onStop={onStop} />}
        </header>
        <p className={styles.text}>
          {isLive ? (
            <SpokenText text={msg.message} activeSentenceIndex={activeSentenceIndex} renderSentence={renderText} />
          ) : (
            renderText(msg.message)
          )}
        </p>
      </div>
    </article>
  );
}
