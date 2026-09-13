import type { AvatarEmotion } from "../types/StakeholderAvatar";

/**
 * Single source of truth for turning a stakeholder's emotional state (a string, e.g.
 * "frustrated" or "enthusiastic" - never a raw score) into what the player sees: an avatar
 * facial expression or a status icon. Mirrors game-api's EmotionValueConfig.json /
 * EmotionFactory.derive_facial_expression_for_state, with substring fallbacks for any label
 * that doesn't match an exact configured state name.
 */
const FACE_BY_STATE: Record<string, AvatarEmotion> = {
  neutral: "smile",
  angry: "veryAngry",
  anxious: "concernedFear",
  frustrated: "concerned",
  enthusiastic: "smileBig",
  skeptical: "suspicious",
  apathetic: "serious",
  relieved: "calm",
  overwhelmed: "hectic",
};

export function faceForEmotionState(emotionState: string | undefined | null): AvatarEmotion {
  const state = (emotionState || "neutral").toLowerCase();
  if (FACE_BY_STATE[state]) return FACE_BY_STATE[state];

  if (state.includes("happy") || state.includes("supportive") || state.includes("positive")) return "smile";
  if (state.includes("angry") || state.includes("rage")) return "veryAngry";
  if (state.includes("frustrat") || state.includes("negative")) return "concerned";
  if (state.includes("anxious") || state.includes("fear")) return "concernedFear";
  if (state.includes("skeptical") || state.includes("suspicious")) return "suspicious";
  if (state.includes("overwhelm") || state.includes("hectic")) return "hectic";
  if (state.includes("relieved") || state.includes("calm")) return "calm";
  if (state.includes("apathetic") || state.includes("serious")) return "serious";

  return "smile";
}

export function iconForEmotionState(emotionState: string | undefined | null): string {
  const state = (emotionState || "neutral").toLowerCase();
  if (
    state.includes("positive") ||
    state.includes("happy") ||
    state.includes("supportive") ||
    state.includes("enthusiastic") ||
    state.includes("relieved")
  ) {
    return "ph:smiley-bold";
  }
  if (
    state.includes("negative") ||
    state.includes("angry") ||
    state.includes("frustrated") ||
    state.includes("skeptical") ||
    state.includes("anxious") ||
    state.includes("overwhelmed")
  ) {
    return "ph:smiley-sad-bold";
  }
  return "ph:smiley-meh-bold";
}
