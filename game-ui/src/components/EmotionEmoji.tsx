import { useEffect, useRef } from "react";
import lottie, { type AnimationItem } from "lottie-web";
import { faceForEmotionState } from "../utils/emotionFace";
import type { AvatarEmotion } from "../types/StakeholderAvatar";
import styles from "./EmotionEmoji.module.css";
import HoverTooltip from "./HoverToolTip";

import ANGRY from "./emoji/angry.json";
import ANXIOUS from "./emoji/anxious.json";
import FRUSTRATED from "./emoji/frustrated.json";
import ENTHUSIASTIC from "./emoji/enthusiastic.json";
import SKEPTICAL from "./emoji/skeptical.json";
import APATHETIC from "./emoji/apathetic.json";
import RELIEVED from "./emoji/relieved.json";
import OVERWHELMED from "./emoji/overwhelmed.json";

/**
 * One self-hosted Noto Animated Emoji (Lottie JSON, see ./emoji/) per non-neutral face
 * `faceForEmotionState` can return. Reuses that function's own state-string normalization rather
 * than re-parsing `emotionState` here, so this always agrees with the avatar's own facial
 * expression about what a given state means. "smile" (neutral, or a label recognized as
 * positive-but-mild - or an unrecognized one) has no entry: that state gets no badge at all.
 */
const EMOJI_BY_FACE: Partial<Record<AvatarEmotion, object>> = {
  veryAngry: ANGRY,
  concernedFear: ANXIOUS,
  concerned: FRUSTRATED,
  smileBig: ENTHUSIASTIC,
  suspicious: SKEPTICAL,
  serious: APATHETIC,
  calm: RELIEVED,
  hectic: OVERWHELMED,
};

function titleCase(s: string): string {
  return s.length > 0 ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

export interface EmotionEmojiProps {
  /** The stakeholder's raw `emotional_state` string, e.g. "angry" or "mildly frustrated". */
  emotionState: string | null | undefined;
  className?: string;
}

/**
 * A small looping animated emoji shown next to a stakeholder's speech bubble whenever they're
 * feeling something other than neutral (docs/plans/player-settings-and-tts.md follow-up: voices
 * don't carry emotion - edge-tts's free backend has no real expressive-style support, and a
 * prosody-only approximation was tried and dropped as imperceptible). This is how mood is
 * surfaced instead: hover or focus explains what it means.
 *
 * Renders nothing for a neutral (or unrecognized) state, so a caller can render this
 * unconditionally next to every speech bubble without checking first.
 */
export default function EmotionEmoji({ emotionState, className }: EmotionEmojiProps) {
  const containerRef = useRef<HTMLSpanElement | null>(null);
  const face = faceForEmotionState(emotionState);
  const icon = face === "smile" ? null : EMOJI_BY_FACE[face] ?? null;

  useEffect(() => {
    if (!icon || !containerRef.current) return;
    const anim: AnimationItem = lottie.loadAnimation({
      container: containerRef.current,
      renderer: "svg",
      loop: true,
      autoplay: true,
      animationData: icon,
    });
    return () => anim.destroy();
  }, [icon]);

  if (!icon) return null;

  const label = titleCase((emotionState || "").trim().toLowerCase());

  return (
    <HoverTooltip description={`Feeling ${label}. Voices don't change with mood, so watch for this instead.`}>
      <span
        className={`${styles.emoji} ${className || ""}`}
        tabIndex={0}
        role="img"
        aria-label={`Feeling ${label}`}
      >
        <span ref={containerRef} className={styles.animation} aria-hidden="true" />
      </span>
    </HoverTooltip>
  );
}
