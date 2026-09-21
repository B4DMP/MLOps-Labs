# A second glossary for the world the game is set in

The MLOps glossary teaches the practice: drift, feature store, canary release. Since the content
moved into one setting, the text around those terms is full of another vocabulary the player also
has to follow: middle aisle, order suggestion, residual stock, minimum order quantity. Those are
not MLOps concepts and do not belong in that file, but a player who does not know them reads the
snippet less well than the stakeholder who wrote it.

`gameConfig/DomainGlossary.json` holds them: 40 terms in five categories, the same schema, hover
card and surfaces as before, underlined **wavy** instead of dotted so the two are distinguishable
at a glance without reading them. The MLOps glossary grew by ten in the same pass, to 139.

## Why one matcher rather than two

The obvious build is a second highlighter next to the first. That breaks on overlap, which this
domain has plenty of: "distribution centre" is a warehouse, while "distribution" on its own is
still the statistical one. Two independent passes would mark the phrase twice, once per glossary,
and nest one mark inside the other.

So both glossaries are compiled into a single regular expression and matched in one pass, the same
pass that already existed. That gives three things for free:

- A word is highlighted once, never twice.
- The longest form at a position wins, which is already how the matcher settles "data drift" over
  "drift". It now settles "distribution centre" over "distribution" the same way, with neither
  glossary needing to know the other exists.
- Highlighting stays one pass per block, so it is no more expensive than before.

What has no tie-breaker is an *identical* spelling in both files. There, the glossary compiled
first takes every occurrence and the other entry never appears. The API sends the MLOps glossary
first, so it wins, and three places report the situation rather than letting it pass:

- the loader prints it at startup (`GlossaryFactory.collisions`),
- the admin preview lists it against the saved other glossary while you type,
- `test_no_spelling_is_claimed_by_both_glossaries` fails on the real content.

The domain glossary was written to have none: where a collision threatened, the domain form is the
longer, more specific one ("distribution centre", "scan line", "loyalty app"), which is also what
makes it win the match. Bare "store" was left out for the same reason, since "feature store" is
already MLOps vocabulary.

Matching *behaviour* is shared, since there is one regular expression: case sensitivity, whole word
matching and the per-block cap come from the first glossary. A later glossary setting them
differently is reported at load time (`shared_setting_conflicts`) rather than silently ignored.
`min_term_length`, `underline_style`, the categories and the surfaces stay per glossary.

## The setting's own names for MLOps things

Not every in-world phrase is domain vocabulary. "The nightly forecast job" is the setting's name
for a batch inference run, and a player who hovers it should learn that, because the transfer from
this story to their own work is the entire point of teaching the practice through one.

Those phrases are therefore aliases on the MLOps terms, not entries in the domain glossary, and
they are underlined dotted like any other MLOps term:

| phrase in the game | MLOps term it opens |
| --- | --- |
| nightly forecast job, forecast job, nightly run | batch inference |
| forecast, forecasts | inference |
| forecast service | model serving |
| nightly store export, store export | data ingestion |
| weekly retrain | retraining |
| model catalogue | model registry |

The rule of thumb for which file a phrase belongs in: if knowing it helps a player outside this
game, it is MLOps and the phrase is an alias there. If it only makes sense inside a supermarket,
it is domain vocabulary.

## Lines that pointed at deleted content

Going through the MLOps glossary for those aliases turned up fifteen `why_it_matters` lines still
written against the six hand written challenges, which were removed when the game moved into the
setting: "the whole Data Instability challenge", "The Platform Choice challenge", along with
numbers those challenges carried, such as a 50ms latency ceiling and a 95 percent accuracy target
that no intel item states any more. They are rewritten against the world the game is set in now,
mostly in terms of the morning order window, availability and the leaflet deadline.

References to the cast by name were left alone: those six stakeholders still exist.

## Surfaces

Each glossary carries its own surface switches, so the two can be highlighted in different places.
The matcher is compiled per surface and a glossary that is off there contributes nothing, rather
than being matched and then discarded. Both files currently have the same surfaces on, with speech
bubbles off, as before.

## What changed

| | |
| --- | --- |
| `gameConfig/DomainGlossary.json` | new: 34 terms, five categories, wavy underline |
| `gameConfigSchemas`, `gameConfigUISchemas` | a schema and UI schema for it; `underline_style` and `kind` added to both glossaries' schemas |
| `domain/glossary.py` | `kind` on a config, `underline_style` in settings |
| `domain/glossary_factory.py` | holds several glossaries, reports collisions and shared-setting conflicts |
| `routes/glossary_routes.py` | returns `{glossaries: [...]}`, MLOps first |
| `glossaryMatcher.ts` | takes several configs and an optional surface, resolves each term's category and underline against its own glossary |
| `GlossaryProvider.tsx` | one matcher per surface over all glossaries |
| `GlossaryTermMark.tsx`, `Glossary.module.css` | underline style comes from the term's glossary |
| `GlossaryPreview.tsx` | previews the draft together with the saved other glossary, and flags cross-file collisions |
| `gameConfig/MLOpsGlossary.json` | the setting's phrasings added as aliases; fifteen lines that referenced deleted challenges rewritten |

The client still understands an older single-config response, so a stale frontend against a new API
keeps highlighting MLOps terms.

## Deciding where a word goes

Every candidate was counted in the assembled content first, because a term nobody writes is not
worth an entry and a word written ninety times is worth getting right.

Two words were argued about and left out:

- **"risk"**, 92 uses, is too ordinary to highlight: it is not one concept and a mark on every
  other sentence teaches nothing. **"risk assessment"** (37 uses) is the concept, is a component in
  the graph, and was added instead.
- **"protect the margin"** is a phrase rather than a term. "margin" already lights up inside it,
  which is the entry a player wants.

Added to the MLOps glossary, with their counts in the content: data contract (108), consent (47),
governance (42, as an alias of model governance), risk assessment (37), data retention (5),
censored demand (2), forecast error (3), data aggregation (2), benchmark (1, as an alias of
baseline), key performance indicator (1, as an alias of business metric), backtesting (1).
Seasonality and forecast horizon were added ahead of their use: neither is written down yet, but
both are vocabulary the live stakeholder agents reach for, and seasonality earns its place by
being the thing players will otherwise mistake for drift.

Added to the domain glossary: truck (25, the "before the trucks leave" deadline), overstock (6,
promoted out of being a spelling of residual stock, since too much stock and leftover promotional
stock are different problems), physical stock (5, the counted shelf against the system's belief),
bulk order (2), liability (2), safety stock (0, ahead of use). "inventory" became a spelling of
stock on hand.

## Density

With both glossaries loaded, an intel artifact of about 110 words carries around 7 marks, roughly
one every 15 words, at most 14 in the densest snippet. These additions moved that from 6.7 to 7.1,
so the density question is not something they introduced. If playtesting finds it busy, the levers
in order of bluntness are: turn the domain glossary off on intel artifacts, lower
`max_highlights_per_term_per_block` to 0 for a single glossary, or add a per-block total cap, which
the matcher does not currently have.

## Coverage

27 of the 34 terms appear in the 106 assembled snippets, 286 occurrences in total, led by scan
line, till, promotion week, distribution centre and order window. The seven that do not appear yet
(category team, core range, goods receipt, markdown, minimum order quantity, shelf capacity,
shrinkage) are live-dialogue vocabulary: stakeholder agents have the setting in their prompt and
reach for them in conversation, where no static count can see them.

## Open questions

1. **Two underlines in one sentence** is untested with real players. If wavy and dotted together
   read as noise rather than as two vocabularies, the cheapest knob is turning the domain glossary
   off on the busiest surface (intel artifacts) rather than dropping the distinction.
2. **The hover card looks identical** for both. The category chip names the group ("Supply Chain"
   against "Data Engineering") but nothing says which vocabulary it belongs to. A small label may
   be worth it once the wavy underline has been seen in play.
3. **The seven unused terms** should be checked against a real playthrough transcript rather than
   the static corpus before anyone decides they are dead weight.
4. **`min_term_length` is 3 in the domain glossary** against 2 in the MLOps one, which keeps very
   short forms out. Nothing currently relies on it; it is there because domain words are ordinary
   English and a two-letter form would pepper the text.
