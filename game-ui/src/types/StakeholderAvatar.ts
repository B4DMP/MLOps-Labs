export type AvatarEmotion =
  | "angryWithFang"
  | "awe"
  | "blank"
  | "calm"
  | "cheeky"
  | "concerned"
  | "concernedFear"
  | "contempt"
  | "cute"
  | "cyclops"
  | "driven"
  | "eatingHappy"
  | "explaining"
  | "eyesClosed"
  | "fear"
  | "hectic"
  | "lovingGrin1"
  | "lovingGrin2"
  | "monster"
  | "old"
  | "rage"
  | "serious"
  | "smile"
  | "smileBig"
  | "smileLOL"
  | "smileTeethGap"
  | "solemn"
  | "suspicious"
  | "tired"
  | "veryAngry";

export interface StakeholderAvatar {
  head?: string;
  face?: AvatarEmotion;
  emotion?: AvatarEmotion;
  mouth?: string;
  body?: string;
  facialHair?: string;
  facialHairProbability?: number;
  accessories?: string;
  accessoriesProbability?: number;
  skinColor?: string;
  clothingColor?: string;
  headContrastColor?: string;
  backgroundColor?: string;
  flip?: boolean;
}

// Must match gameConfigSchemas/GameStakeholders.schema.json's
// avatar.clothingColor enum exactly - this is the one other place that list of hex values lives.
export const OPEN_PEEPS_CLOTHING_PALETTE = [
  "e78276", "ffcf77", "fdea6b", "78e185", "9ddadb", "8fa7df", "e279c7",
] as const;

/** A stable, deterministic clothing color for a stakeholder id that doesn't author one in
 * config (code-review finding: authors previously had to hand-pick a valid hex, and the six
 * that shipped didn't match the schema's palette at all). Never random - the same id always
 * gets the same color, so avatars stay visually consistent across sessions/reloads. */
export function colorForStakeholderId(stakeholderId: string): string {
  let hash = 0;
  for (let i = 0; i < stakeholderId.length; i++) {
    hash = (hash * 31 + stakeholderId.charCodeAt(i)) | 0;
  }
  const index = Math.abs(hash) % OPEN_PEEPS_CLOTHING_PALETTE.length;
  return OPEN_PEEPS_CLOTHING_PALETTE[index];
}
