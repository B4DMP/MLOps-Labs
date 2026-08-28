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
