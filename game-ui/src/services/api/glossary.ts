const API_HOST =
  import.meta.env.VITE_API_HOST ||
  (import.meta.env.MODE === "development"
    ? "localhost:8000"
    : window.location.host);

const PROTOCOL = window.location.protocol === "https:" ? "https:" : "http:";
const BASE_URL = `${PROTOCOL}//${API_HOST}`;

/** Surfaces that can highlight glossary terms, each switchable from the admin config. */
export interface GlossarySurfaces {
  stakeholder_messages: boolean;
  speech_bubbles: boolean;
  intel_notes: boolean;
  intel_artifacts: boolean;
  dossier_profile: boolean;
  dialogue_options: boolean;
  challenge_briefing: boolean;
  action_proposal: boolean;
}

export type GlossarySurface = keyof GlossarySurfaces;

/** How a glossary's terms are underlined, which is how a player tells the two apart. */
export type GlossaryUnderlineStyle = "dotted" | "wavy" | "dashed" | "solid";

export interface GlossarySettings {
  enabled: boolean;
  underline_style?: GlossaryUnderlineStyle;
  case_sensitive: boolean;
  match_whole_words: boolean;
  max_highlights_per_term_per_block: number;
  min_term_length: number;
  surfaces: GlossarySurfaces;
}

export interface GlossaryCategory {
  id: string;
  label: string;
  color: string;
  icon?: string;
}

export interface GlossaryTerm {
  id: string;
  term: string;
  aliases: string[];
  category: string;
  definition: string;
  why_it_matters?: string;
  read_more?: string;
  disabled?: boolean;
}

export interface GlossaryConfig {
  /** "mlops" for the practice, "domain" for the world the game is set in. */
  kind?: string;
  settings: GlossarySettings;
  categories: GlossaryCategory[];
  terms: GlossaryTerm[];
}

export const EMPTY_GLOSSARY: GlossaryConfig = {
  kind: "mlops",
  settings: {
    enabled: false,
    underline_style: "dotted",
    case_sensitive: false,
    match_whole_words: true,
    max_highlights_per_term_per_block: 1,
    min_term_length: 2,
    surfaces: {
      stakeholder_messages: false,
      speech_bubbles: false,
      intel_notes: false,
      intel_artifacts: false,
      dossier_profile: false,
      dialogue_options: false,
      challenge_briefing: false,
      action_proposal: false,
    },
  },
  categories: [],
  terms: [],
};

/**
 * Loads every glossary. Unauthenticated on purpose: it is static teaching content the client
 * needs before a player has done anything.
 *
 * The response carries them as a list because they are matched together in one pass, so that a
 * phrase both of them claim is decided once instead of being highlighted twice. An older API
 * that returns a single config is still understood, and counts as the MLOps one.
 */
export async function fetchGlossaries(): Promise<GlossaryConfig[]> {
  const response = await fetch(`${BASE_URL}/api/glossary`, { method: "GET" });

  if (!response.ok) {
    throw new Error("Failed to load the glossaries.");
  }

  const payload = await response.json();
  if (Array.isArray(payload?.glossaries)) {
    return payload.glossaries as GlossaryConfig[];
  }
  return payload?.terms ? [payload as GlossaryConfig] : [];
}
