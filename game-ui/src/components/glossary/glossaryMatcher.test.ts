import { describe, expect, it } from 'vitest';
import { buildGlossaryMatcher } from './glossaryMatcher';
import type { GlossaryConfig, GlossaryTerm } from '../../services/api/glossary';

function makeTerm(overrides: Partial<GlossaryTerm> & Pick<GlossaryTerm, 'id' | 'term'>): GlossaryTerm {
  return {
    aliases: [],
    category: 'general',
    definition: `definition of ${overrides.term}`,
    ...overrides,
  };
}

function makeConfig(terms: GlossaryTerm[], settingsOverrides: Partial<GlossaryConfig['settings']> = {}): GlossaryConfig {
  return {
    settings: {
      enabled: true,
      case_sensitive: false,
      match_whole_words: true,
      max_highlights_per_term_per_block: 1,
      min_term_length: 2,
      surfaces: {
        stakeholder_messages: true,
        speech_bubbles: true,
      } as GlossaryConfig['settings']['surfaces'],
      ...settingsOverrides,
    },
    categories: [],
    terms,
  };
}

describe('buildGlossaryMatcher', () => {
  it('returns an empty matcher when the glossary is disabled or null', () => {
    const disabled = buildGlossaryMatcher(makeConfig([makeTerm({ id: 't1', term: 'data drift' })], { enabled: false }));
    expect(disabled.findMatches('we saw data drift today')).toEqual([]);
    expect(disabled.formCount).toBe(0);

    const nullConfig = buildGlossaryMatcher(null);
    expect(nullConfig.findMatches('data drift')).toEqual([]);
  });

  it('matches a term and reports the exact matched substring and offsets', () => {
    const term = makeTerm({ id: 't1', term: 'data drift' });
    const matcher = buildGlossaryMatcher(makeConfig([term]));
    const text = 'we saw Data Drift today';
    const matches = matcher.findMatches(text);
    expect(matches).toHaveLength(1);
    expect(matches[0].matched).toBe('Data Drift');
    expect(text.slice(matches[0].start, matches[0].end)).toBe('Data Drift');
    expect(matches[0].term.id).toBe('t1');
  });

  it('prefers the longer alternation match at the same position', () => {
    const drift = makeTerm({ id: 'drift', term: 'drift' });
    const dataDrift = makeTerm({ id: 'data-drift', term: 'data drift' });
    const matcher = buildGlossaryMatcher(makeConfig([drift, dataDrift]));
    const matches = matcher.findMatches('watch for data drift in prod');
    expect(matches).toHaveLength(1);
    expect(matches[0].term.id).toBe('data-drift');
  });

  it('matches a simple plural suffix without it being authored as an alias', () => {
    const term = makeTerm({ id: 't1', term: 'feature store' });
    const matcher = buildGlossaryMatcher(makeConfig([term]));
    expect(matcher.findMatches('two feature stores are live')).toHaveLength(1);
  });

  it('does not treat a word already ending in s as needing a plural match', () => {
    const term = makeTerm({ id: 't1', term: 'bias' });
    const matcher = buildGlossaryMatcher(makeConfig([term]));
    expect(matcher.findMatches('a bias in the model')).toHaveLength(1);
    expect(matcher.findMatches('several biases in the model')).toHaveLength(0);
  });

  it('does not match a term as a substring of a hyphenated compound or a longer word', () => {
    const term = makeTerm({ id: 't1', term: 'feature' });
    const matcher = buildGlossaryMatcher(makeConfig([term]));
    // "feature-store" and "featured" must not light up just because they contain "feature".
    expect(matcher.findMatches('feature-store is not featured')).toHaveLength(0);
    // The bare word on its own still matches.
    expect(matcher.findMatches('this feature is useful')).toHaveLength(1);
  });

  it('respects max_highlights_per_term_per_block', () => {
    const term = makeTerm({ id: 't1', term: 'drift' });
    const matcher = buildGlossaryMatcher(makeConfig([term], { max_highlights_per_term_per_block: 1 }));
    const matches = matcher.findMatches('drift, drift, and more drift');
    expect(matches).toHaveLength(1);
  });

  it('an alias matches the same term as the primary form', () => {
    const term = makeTerm({ id: 't1', term: 'feature store', aliases: ['feature repository'] });
    const matcher = buildGlossaryMatcher(makeConfig([term]));
    const matches = matcher.findMatches('the feature repository is down');
    expect(matches).toHaveLength(1);
    expect(matches[0].term.id).toBe('t1');
  });

  it('skips a disabled term entirely', () => {
    const term = makeTerm({ id: 't1', term: 'data drift', disabled: true });
    const matcher = buildGlossaryMatcher(makeConfig([term]));
    expect(matcher.findMatches('data drift everywhere')).toHaveLength(0);
    expect(matcher.termById('t1')).toBeUndefined();
  });

  it('does not crash on a malformed term - returns the empty matcher instead', () => {
    // An unescaped/unbalanced-looking form should never reach a raw, invalid RegExp source;
    // this guards the try/catch fallback path regardless of how a bad form gets there.
    const term = makeTerm({ id: 't1', term: '(unterminated' });
    const matcher = buildGlossaryMatcher(makeConfig([term]));
    expect(() => matcher.findMatches('some (unterminated text')).not.toThrow();
  });

  it('termById looks up an enabled term by id', () => {
    const term = makeTerm({ id: 't1', term: 'data drift' });
    const matcher = buildGlossaryMatcher(makeConfig([term]));
    expect(matcher.termById('t1')?.term).toBe('data drift');
    expect(matcher.termById('missing')).toBeUndefined();
  });
});
