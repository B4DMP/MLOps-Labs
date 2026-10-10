import React, { useState, useEffect, useMemo } from "react";
import type { StakeholderAvatar, AvatarEmotion } from "../types/StakeholderAvatar";
import { colorForStakeholderId } from "../types/StakeholderAvatar";
import { generateOpenPeepsDataUri } from "../assets/openPeepsAvatar";
import styles from "./StakeholderAvatarComponent.module.css";
import HoverTooltip from "./HoverToolTip";

// Talking mouth-flap: alternates an "open mouth" face with a "closed mouth" one, picking a
// random face from each pool every beat so the same stakeholder doesn't repeat one fixed loop.
const OPEN_MOUTH_FACES: AvatarEmotion[] = ["smileTeethGap", "smileLOL", "smileBig", "explaining"];
const CLOSED_MOUTH_FACES: AvatarEmotion[] = ["contempt", "calm", "cute", "driven", "old", "tired"];

function pickMouthFace(pool: AvatarEmotion[], avoid?: AvatarEmotion): AvatarEmotion {
  if (pool.length === 1) return pool[0];
  let choice = pool[Math.floor(Math.random() * pool.length)];
  while (choice === avoid) {
    choice = pool[Math.floor(Math.random() * pool.length)];
  }
  return choice;
}

export interface StakeholderAvatarProps {
  avatar?: StakeholderAvatar;
  emotion?: AvatarEmotion;
  play_blink_animation?: boolean;
  isFramed?: boolean;
  isSpeaking?: boolean;
  size?: number | string;
  className?: string;
  style?: React.CSSProperties;
  title?: string;
  clothingColor?: string;
  stakeholderColor?: string;
  /** Used only as a last-resort deterministic color when nothing else (clothingColor,
   * stakeholderColor, avatar.clothingColor) is set - so a stakeholder config entry never has to
   * hand-pick a hex to look visually distinct. */
  stakeholderId?: string;
  backgroundColor?: string;
  flip?: boolean;
  /** Crops to the head and shoulders. Use it wherever the avatar is drawn small. */
  thumb?: boolean;
  /** Head and shoulders in a card-shaped frame, with room at the foot for a caption. */
  portrait?: boolean;
  hoverToSuspicious?: boolean;
  isHovered?: boolean;
  onClick?: () => void;
  onMouseEnter?: (e: React.MouseEvent<HTMLImageElement>) => void;
  onMouseLeave?: (e: React.MouseEvent<HTMLImageElement>) => void;
}

export function StakeholderAvatarComponent({
  avatar,
  emotion,
  play_blink_animation = false,
  isFramed = true,
  isSpeaking = false,
  size = "100%",
  className = "",
  style = {},
  title,
  clothingColor,
  stakeholderColor,
  stakeholderId,
  backgroundColor,
  flip,
  thumb = false,
  portrait = false,
  hoverToSuspicious = true,
  isHovered: propIsHovered,
  onClick,
  onMouseEnter,
  onMouseLeave,
}: StakeholderAvatarProps) {
  const [isBlinking, setIsBlinking] = useState(false);
  const [speakMouth, setSpeakMouth] = useState<AvatarEmotion>("explaining");
  const [internalHovered, setInternalHovered] = useState(false);

  const isHovered = propIsHovered !== undefined ? propIsHovered : internalHovered;

  // Mouth-flap toggle (cycles every 190ms when isSpeaking is true) - independent of the CSS head-
  // sway animation's own speed (see StakeholderAvatarComponent.module.css). Only the mouth layer
  // swaps - the eyes stay on whatever face is already selected below, so talking never changes
  // the eyes.
  useEffect(() => {
    if (!isSpeaking) return;
    let mouthOpen = true;
    setSpeakMouth(pickMouthFace(OPEN_MOUTH_FACES));
    const interval = setInterval(() => {
      mouthOpen = !mouthOpen;
      setSpeakMouth((prev) => pickMouthFace(mouthOpen ? OPEN_MOUTH_FACES : CLOSED_MOUTH_FACES, prev));
    }, 190);
    return () => clearInterval(interval);
  }, [isSpeaking]);

  useEffect(() => {
    if (!play_blink_animation) {
      setIsBlinking(false);
      return;
    }

    let blinkTimer: any = null;
    let blinkDurationTimer: any = null;
    let isCancelled = false;

    const scheduleBlink = () => {
      const delay = Math.floor(Math.random() * 3000) + 3000; // 3-6s interval
      blinkTimer = setTimeout(() => {
        if (isCancelled) return;
        setIsBlinking(true);
        blinkDurationTimer = setTimeout(() => {
          if (isCancelled) return;
          setIsBlinking(false);
          scheduleBlink();
        }, 150); // 150ms blink duration
      }, delay);
    };

    scheduleBlink();

    return () => {
      isCancelled = true;
      if (blinkTimer) clearTimeout(blinkTimer);
      if (blinkDurationTimer) clearTimeout(blinkDurationTimer);
    };
  }, [play_blink_animation]);

  const svgDataUri = useMemo(() => {
    // Determine the face / emotion to render - never touched by isSpeaking, so the eyes hold
    // still while only the mouth (below) flaps during talking.
    let selectedFace: AvatarEmotion = "smile";
    if (hoverToSuspicious && isHovered) {
      selectedFace = "suspicious";
    } else if (emotion) {
      selectedFace = emotion;
    } else if (avatar?.emotion) {
      selectedFace = avatar.emotion;
    } else if (avatar?.face) {
      selectedFace = avatar.face;
    }

    const bgCol = isFramed ? (backgroundColor || stakeholderColor || avatar?.backgroundColor) : undefined;
    const finalClothingColor = clothingColor || stakeholderColor || (avatar as any)?.stakeholder_color || avatar?.clothingColor
      || (stakeholderId ? colorForStakeholderId(stakeholderId) : undefined);
    const finalFlip = flip !== undefined ? flip : Boolean(avatar?.flip);

    return generateOpenPeepsDataUri({
      head: avatar?.head,
      face: selectedFace,
      mouthFace: isSpeaking ? speakMouth : undefined,
      facialHair: avatar?.facialHair,
      facialHairProbability: avatar?.facialHairProbability,
      accessories: avatar?.accessories,
      accessoriesProbability: avatar?.accessoriesProbability,
      skinColor: avatar?.skinColor,
      clothingColor: finalClothingColor,
      headContrastColor: avatar?.headContrastColor,
      backgroundColor: bgCol,
      flip: finalFlip,
      blink: isBlinking,
      thumb,
      portrait,
    });
  }, [avatar, emotion, isBlinking, isSpeaking, speakMouth, isFramed, clothingColor, stakeholderColor, stakeholderId, backgroundColor, flip, thumb, portrait, hoverToSuspicious, isHovered]);

  const handleMouseEnter = (e: React.MouseEvent<HTMLImageElement>) => {
    if (hoverToSuspicious) {
      setInternalHovered(true);
    }
    onMouseEnter?.(e);
  };

  const handleMouseLeave = (e: React.MouseEvent<HTMLImageElement>) => {
    if (hoverToSuspicious) {
      setInternalHovered(false);
    }
    onMouseLeave?.(e);
  };

  const img = (
    <img
      src={svgDataUri}
      alt={title || "Stakeholder Avatar"}
      className={`stakeholder-avatar ${isSpeaking ? styles.speaking : ""} ${className}`}
      onClick={onClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      style={{
        width: typeof size === "number" ? `${size}px` : size,
        height: typeof size === "number" ? `${size}px` : size,
        objectFit: "contain",
        display: "inline-block",
        userSelect: "none",
        pointerEvents: "auto",
        cursor: onClick ? "pointer" : undefined,
        ...style,
      }}
    />
  );

  // A percentage size needs a block wrapper, or it collapses inside the inline tooltip span.
  const fillsParent = typeof size === "string" && size.endsWith("%");
  return (
    <HoverTooltip description={title} block={fillsParent}>
      {img}
    </HoverTooltip>
  );
}

export default StakeholderAvatarComponent;
