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

function makeConfig(
  terms: GlossaryTerm[],
  settingsOverrides: Partial<GlossaryConfig['settings']> = {},
  configOverrides: Partial<GlossaryConfig> = {}
): GlossaryConfig {
  return {
    ...configOverrides,
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
    categories: configOverrides.categories ?? [],
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

describe('buildGlossaryMatcher across two glossaries', () => {
  const mlops = makeConfig(
    [makeTerm({ id: 'distribution', term: 'distribution', aliases: ['feature distribution'] })],
    { underline_style: 'dotted' },
    { kind: 'mlops', categories: [{ id: 'general', label: 'MLOps', color: '#6366f1' }] }
  );
  const domain = makeConfig(
    [makeTerm({ id: 'distribution_centre', term: 'distribution centre', aliases: ['warehouse'] })],
    { underline_style: 'wavy' },
    { kind: 'domain', categories: [{ id: 'general', label: 'Supply Chain', color: '#0d9488' }] }
  );

  it('prefers the longer phrase, so the warehouse beats the statistical term', () => {
    const matcher = buildGlossaryMatcher([mlops, domain]);
    const matches = matcher.findMatches('the distribution centre ships overnight');

    expect(matches).toHaveLength(1);
    expect(matches[0].matched).toBe('distribution centre');
    expect(matches[0].term.id).toBe('distribution_centre');
    expect(matches[0].entry.kind).toBe('domain');
  });

  it('still matches the MLOps term when the domain phrase is not there', () => {
    const matcher = buildGlossaryMatcher([mlops, domain]);
    const matches = matcher.findMatches('the input distribution moved last week');

    expect(matches).toHaveLength(1);
    expect(matches[0].term.id).toBe('distribution');
    expect(matches[0].entry.kind).toBe('mlops');
  });

  it('never highlights one word twice: the two glossaries share a single pass', () => {
    const matcher = buildGlossaryMatcher([mlops, domain]);
    const matches = matcher.findMatches('a distribution centre and a distribution shift');

    // Sorted by position, non-overlapping, one mark per occurrence.
    const spans = matches.map((m) => [m.start, m.end]);
    for (let i = 1; i < spans.length; i += 1) {
      expect(spans[i][0]).toBeGreaterThanOrEqual(spans[i - 1][1]);
    }
  });

  it('carries each glossary underline style and its own category through the match', () => {
    const matcher = buildGlossaryMatcher([mlops, domain]);

    const domainMatch = matcher.findMatches('the warehouse is full')[0];
    expect(domainMatch.entry.underlineStyle).toBe('wavy');
    expect(domainMatch.entry.category?.label).toBe('Supply Chain');

    const mlopsMatch = matcher.findMatches('the feature distribution moved')[0];
    expect(mlopsMatch.entry.underlineStyle).toBe('dotted');
    // Same category id in both files, resolved against the glossary the term came from.
    expect(mlopsMatch.entry.category?.label).toBe('MLOps');
  });

  it('an identical spelling in both files goes to the glossary compiled first', () => {
    const clashing = makeConfig(
      [makeTerm({ id: 'domain_label', term: 'label' })],
      {},
      { kind: 'domain' }
    );
    const mlopsLabel = makeConfig(
      [makeTerm({ id: 'mlops_label', term: 'label' })],
      {},
      { kind: 'mlops' }
    );

    const matches = buildGlossaryMatcher([mlopsLabel, clashing]).findMatches('check the label');
    expect(matches).toHaveLength(1);
    expect(matches[0].term.id).toBe('mlops_label');
  });

  it('leaves out a glossary that has this surface switched off', () => {
    const domainOffHere = makeConfig(
      [makeTerm({ id: 'shelf', term: 'shelf capacity' })],
      { surfaces: { stakeholder_messages: false, speech_bubbles: true } as GlossaryConfig['settings']['surfaces'] },
      { kind: 'domain' }
    );
    const text = 'the shelf capacity and the feature distribution';

    const inChat = buildGlossaryMatcher([mlops, domainOffHere], 'stakeholder_messages');
    expect(inChat.findMatches(text).map((m) => m.term.id)).toEqual(['distribution']);

    const inBubble = buildGlossaryMatcher([mlops, domainOffHere], 'speech_bubbles');
    expect(inBubble.findMatches(text).map((m) => m.term.id).sort()).toEqual(['distribution', 'shelf']);
  });
});
