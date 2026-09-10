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
}

export type GlossarySurface = keyof GlossarySurfaces;

export interface GlossarySettings {
  enabled: boolean;
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
  settings: GlossarySettings;
  categories: GlossaryCategory[];
  terms: GlossaryTerm[];
}

export const EMPTY_GLOSSARY: GlossaryConfig = {
  settings: {
    enabled: false,
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
    },
  },
  categories: [],
  terms: [],
};

/**
 * Loads the glossary. Unauthenticated on purpose: it is static teaching content the client
 * needs before a player has done anything.
 */
export async function fetchGlossary(): Promise<GlossaryConfig> {
  const response = await fetch(`${BASE_URL}/api/glossary`, { method: "GET" });

  if (!response.ok) {
    throw new Error("Failed to load the MLOps glossary.");
  }

  return response.json();
}
