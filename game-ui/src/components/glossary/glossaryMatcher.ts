import type { GlossaryConfig, GlossaryTerm } from "../../services/api/glossary";

/** One occurrence of a glossary term inside a string. */
export interface GlossaryMatch {
  start: number;
  end: number;
  /** The text exactly as it appeared, so the highlight never rewrites the author's wording. */
  matched: string;
  term: GlossaryTerm;
}

export interface GlossaryMatcher {
  /** Every occurrence in `text`, left to right, already capped and de-overlapped. */
  findMatches: (text: string) => GlossaryMatch[];
  /** Lookup used by the hover card and by the admin preview. */
  termById: (id: string) => GlossaryTerm | undefined;
  /** How many terms the matcher is watching for, counting aliases. */
  formCount: number;
}

const REGEX_SPECIALS = /[.*+?^${}()|[\]\\]/g;

function escapeRegex(value: string): string {
  return value.replace(REGEX_SPECIALS, "\\$&");
}

/**
 * A surface form matches with an optional plural suffix, so the config does not have to list
 * every inflection by hand. Forms already ending in "s" are left alone: "bias" must not also
 * match "biass", and more importantly "biases" is a different word we may want to tag itself.
 */
function toPattern(form: string): string {
  const trimmed = form.trim();
  if (!trimmed) return "";
  // Inside a multi-word form the separator is loose: "feature store", "feature  store" and
  // "feature-store" are the same term as far as a player reading the sentence is concerned.
  const escaped = escapeRegex(trimmed).replace(/\\?\s+/g, "[\\s\\u00a0-]+");
  return /[a-z]$/i.test(trimmed) && !/s$/i.test(trimmed) ? `${escaped}(?:s|es)?` : escaped;
}

const EMPTY_MATCHER: GlossaryMatcher = {
  findMatches: () => [],
  termById: () => undefined,
  formCount: 0,
};

/**
 * Compiles the whole glossary into a single regular expression.
 *
 * One pass over the text per block keeps highlighting cheap enough to run inline while a chat
 * is streaming. Longer forms are placed first in the alternation so that "data drift" wins over
 * "data" and "drift" at the same position, which is what alternation order decides in JS.
 */
export function buildGlossaryMatcher(config: GlossaryConfig | null): GlossaryMatcher {
  if (!config || !config.settings?.enabled) return EMPTY_MATCHER;

  const minLength = Math.max(1, config.settings.min_term_length ?? 2);
  const maxPerTerm = config.settings.max_highlights_per_term_per_block ?? 1;

  const byId = new Map<string, GlossaryTerm>();
  const forms: { form: string; term: GlossaryTerm }[] = [];

  for (const term of config.terms || []) {
    if (term.disabled) continue;
    byId.set(term.id, term);
    const surfaceForms = [term.term, ...(term.aliases || [])];
    for (const form of surfaceForms) {
      const trimmed = (form || "").trim();
      if (trimmed.length < minLength) continue;
      forms.push({ form: trimmed, term });
    }
  }

  if (forms.length === 0) return EMPTY_MATCHER;

  forms.sort((a, b) => b.form.length - a.form.length);

  // Group ordinals map a capture group back to its term without a second lookup pass.
  const groupTerms: GlossaryTerm[] = [];
  const alternatives: string[] = [];
  for (const { form, term } of forms) {
    const pattern = toPattern(form);
    if (!pattern) continue;
    alternatives.push(`(${pattern})`);
    groupTerms.push(term);
  }

  if (alternatives.length === 0) return EMPTY_MATCHER;

  // Guard on both sides against word characters and hyphens, so "feature" does not light up
  // inside "feature-store" and "AUC" does not light up inside "SAUCE".
  const body = alternatives.join("|");
  const source = config.settings.match_whole_words
    ? `(?<![\\w-])(?:${body})(?![\\w-])`
    : `(?:${body})`;

  let regex: RegExp;
  try {
    regex = new RegExp(source, config.settings.case_sensitive ? "g" : "gi");
  } catch {
    // A malformed term should cost highlighting, never the screen it appears on.
    return EMPTY_MATCHER;
  }

  const findMatches = (text: string): GlossaryMatch[] => {
    if (!text) return [];

    const matches: GlossaryMatch[] = [];
    const seenPerTerm = new Map<string, number>();
    regex.lastIndex = 0;

    let hit: RegExpExecArray | null;
    while ((hit = regex.exec(text)) !== null) {
      // Zero-length matches cannot happen with these patterns, but a stuck lastIndex would
      // hang the render, so step past it defensively.
      if (hit[0].length === 0) {
        regex.lastIndex += 1;
        continue;
      }

      let term: GlossaryTerm | undefined;
      for (let group = 1; group < hit.length; group += 1) {
        if (hit[group] !== undefined) {
          term = groupTerms[group - 1];
          break;
        }
      }

      if (term) {
        const used = seenPerTerm.get(term.id) ?? 0;
        if (maxPerTerm === 0 || used < maxPerTerm) {
          seenPerTerm.set(term.id, used + 1);
          matches.push({
            start: hit.index,
            end: hit.index + hit[0].length,
            matched: hit[0],
            term,
          });
        }
      }
    }

    return matches;
  };

  return {
    findMatches,
    termById: (id: string) => byId.get(id),
    formCount: alternatives.length,
  };
}
