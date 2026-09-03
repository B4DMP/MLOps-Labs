import React, { useState, useEffect, useMemo } from "react";
import type { StakeholderAvatar, AvatarEmotion } from "../types/StakeholderAvatar";
import { generateOpenPeepsDataUri } from "../assets/openPeepsAvatar";

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
  backgroundColor?: string;
  flip?: boolean;
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
  backgroundColor,
  flip,
  hoverToSuspicious = true,
  isHovered: propIsHovered,
  onClick,
  onMouseEnter,
  onMouseLeave,
}: StakeholderAvatarProps) {
  const [isBlinking, setIsBlinking] = useState(false);
  const [speakFrame, setSpeakFrame] = useState(0);
  const [internalHovered, setInternalHovered] = useState(false);

  const isHovered = propIsHovered !== undefined ? propIsHovered : internalHovered;

  // Animated speaking mouth toggle (cycles every 200ms when isSpeaking is true)
  useEffect(() => {
    if (!isSpeaking) {
      setSpeakFrame(0);
      return;
    }
    const interval = setInterval(() => {
      setSpeakFrame((prev) => (prev + 1) % 2);
    }, 200);
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
    // Determine the face / emotion to render
    let selectedFace: AvatarEmotion = "smile";
    if (hoverToSuspicious && isHovered) {
      selectedFace = "suspicious";
    } else if (isSpeaking) {
      selectedFace = speakFrame === 0 ? "explaining" : "smileBig";
    } else if (emotion) {
      selectedFace = emotion;
    } else if (avatar?.emotion) {
      selectedFace = avatar.emotion;
    } else if (avatar?.face) {
      selectedFace = avatar.face;
    }

    const bgCol = isFramed ? (backgroundColor || stakeholderColor || avatar?.backgroundColor) : undefined;
    const finalClothingColor = clothingColor || stakeholderColor || (avatar as any)?.stakeholder_color || avatar?.clothingColor;
    const finalFlip = flip !== undefined ? flip : Boolean(avatar?.flip);

    return generateOpenPeepsDataUri({
      head: avatar?.head,
      face: selectedFace,
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
    });
  }, [avatar, emotion, isBlinking, isSpeaking, speakFrame, isFramed, clothingColor, stakeholderColor, backgroundColor, flip, hoverToSuspicious, isHovered]);

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

  return (
    <img
      src={svgDataUri}
      alt={title || "Stakeholder Avatar"}
      title={title}
      className={`stakeholder-avatar ${className}`}
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
}

export default StakeholderAvatarComponent;
