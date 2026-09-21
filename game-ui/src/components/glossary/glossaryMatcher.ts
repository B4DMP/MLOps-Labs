import type {
  GlossaryCategory,
  GlossaryConfig,
  GlossarySurface,
  GlossaryTerm,
  GlossaryUnderlineStyle,
} from "../../services/api/glossary";

/** A term together with everything the highlight needs, resolved once at build time. */
export interface GlossaryEntry {
  term: GlossaryTerm;
  /** Which glossary it came from: "mlops" or "domain". */
  kind: string;
  /** That glossary's underline style, which is how a player tells the two vocabularies apart. */
  underlineStyle: GlossaryUnderlineStyle;
  /** Resolved from the term's own glossary, since two glossaries may use the same category id. */
  category?: GlossaryCategory;
}

/** One occurrence of a glossary term inside a string. */
export interface GlossaryMatch {
  start: number;
  end: number;
  /** The text exactly as it appeared, so the highlight never rewrites the author's wording. */
  matched: string;
  term: GlossaryTerm;
  entry: GlossaryEntry;
}

export interface GlossaryMatcher {
  /** Every occurrence in `text`, left to right, already capped and de-overlapped. */
  findMatches: (text: string) => GlossaryMatch[];
  /** Lookup used by the hover card and by the admin preview. */
  termById: (id: string) => GlossaryTerm | undefined;
  /** Everything known about a term, including which glossary it came from. */
  entryById: (id: string) => GlossaryEntry | undefined;
  /** How many forms the matcher is watching for, counting aliases across every glossary. */
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
  entryById: () => undefined,
  formCount: 0,
};

function asList(input: GlossaryConfig | GlossaryConfig[] | null): GlossaryConfig[] {
  if (!input) return [];
  return Array.isArray(input) ? input : [input];
}

/**
 * Compiles every glossary into a single regular expression.
 *
 * One pass over the text per block keeps highlighting cheap enough to run inline while a chat is
 * streaming, and it is also what keeps the two glossaries honest with each other. Because they
 * share one alternation, a word can only ever be highlighted once, and longer forms are placed
 * first so that the longest reading of a phrase wins at any given position. That is what settles
 * the overlaps between the two vocabularies without either of them having to know about the
 * other: "distribution centre" is the warehouse, while a bare "distribution" is still the
 * statistical one, and "feature store" stays a feature store next to a domain term for a shop.
 *
 * Two forms of exactly the same length and spelling have no such tie-breaker, and the glossary
 * compiled first takes every occurrence. The API sends the MLOps glossary first, so it wins, and
 * the backend reports any such pair at load time as the authoring mistake it is.
 *
 * When a surface is given, a glossary that has switched that surface off contributes nothing,
 * which lets the two be enabled in different places.
 */
export function buildGlossaryMatcher(
  input: GlossaryConfig | GlossaryConfig[] | null,
  surface?: GlossarySurface
): GlossaryMatcher {
  const configs = asList(input).filter((config) => {
    if (!config?.settings?.enabled) return false;
    if (!surface) return true;
    return Boolean(config.settings.surfaces?.[surface]);
  });

  if (configs.length === 0) return EMPTY_MATCHER;

  const byId = new Map<string, GlossaryEntry>();
  const forms: { form: string; entry: GlossaryEntry }[] = [];
  // Matching behaviour is shared, so the first enabled glossary sets it for the whole pass.
  const leading = configs[0];

  configs.forEach((config, configIndex) => {
    const minLength = Math.max(1, config.settings.min_term_length ?? 2);
    const categories = new Map((config.categories || []).map((c) => [c.id, c]));
    const kind = config.kind || (configIndex === 0 ? "mlops" : `glossary_${configIndex}`);
    const underlineStyle = config.settings.underline_style || "dotted";

    for (const term of config.terms || []) {
      if (term.disabled) continue;
      const entry: GlossaryEntry = {
        term,
        kind,
        underlineStyle,
        category: categories.get(term.category),
      };
      // Two glossaries could reuse an id; the first one compiled keeps it, as with forms.
      if (!byId.has(term.id)) byId.set(term.id, entry);

      for (const form of [term.term, ...(term.aliases || [])]) {
        const trimmed = (form || "").trim();
        if (trimmed.length < minLength) continue;
        forms.push({ form: trimmed, entry });
      }
    }
  });

  if (forms.length === 0) return EMPTY_MATCHER;

  // Stable sort, so forms of equal length stay in the order their glossaries were given in.
  forms.sort((a, b) => b.form.length - a.form.length);

  // Group ordinals map a capture group back to its entry without a second lookup pass.
  const groupEntries: GlossaryEntry[] = [];
  const alternatives: string[] = [];
  for (const { form, entry } of forms) {
    const pattern = toPattern(form);
    if (!pattern) continue;
    alternatives.push(`(${pattern})`);
    groupEntries.push(entry);
  }

  if (alternatives.length === 0) return EMPTY_MATCHER;

  const maxPerTerm = leading.settings.max_highlights_per_term_per_block ?? 1;

  // Guard on both sides against word characters and hyphens, so "feature" does not light up
  // inside "feature-store" and "AUC" does not light up inside "SAUCE".
  const body = alternatives.join("|");
  const source = leading.settings.match_whole_words
    ? `(?<![\\w-])(?:${body})(?![\\w-])`
    : `(?:${body})`;

  let regex: RegExp;
  try {
    regex = new RegExp(source, leading.settings.case_sensitive ? "g" : "gi");
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

      let entry: GlossaryEntry | undefined;
      for (let group = 1; group < hit.length; group += 1) {
        if (hit[group] !== undefined) {
          entry = groupEntries[group - 1];
          break;
        }
      }

      if (entry) {
        // Counted per glossary as well as per term, so an id shared by both files cannot make
        // one of them invisible.
        const key = `${entry.kind}:${entry.term.id}`;
        const used = seenPerTerm.get(key) ?? 0;
        if (maxPerTerm === 0 || used < maxPerTerm) {
          seenPerTerm.set(key, used + 1);
          matches.push({
            start: hit.index,
            end: hit.index + hit[0].length,
            matched: hit[0],
            term: entry.term,
            entry,
          });
        }
      }
    }

    return matches;
  };

  return {
    findMatches,
    termById: (id: string) => byId.get(id)?.term,
    entryById: (id: string) => byId.get(id),
    formCount: alternatives.length,
  };
}
