import { Section, Collapsible } from "./shared";

const VOICE_MODEL = `VOICE MODEL (don't deviate):
- Good Omens (Gaiman/Pratchett): real large stakes sit completely unremarked next to characters' small, petty, in-the-room focus. Never narrated or explained - just placed there.
- Monty Python (Dead Parrot / Ministry of Silly Walks): institutional denial via escalating euphemism; absurd bureaucratic functions treated with total unblinking sincerity.
- Douglas Adams (the Vogons): a bureaucratic process outweighs, in the characters' own minds, the catastrophe the process just caused - irritation about the paperwork inconvenience, not alarm about the disaster.`;

const ARTIFACT_WRITER_PROMPT = `I'm writing a comedic rewrite of one intel artifact (a single stakeholder's own document - email, meeting notes, memo) for a "serious game" about MLOps. I need a genuinely funny rewrite, not just tightened prose - the failure mode to avoid is competent wry understatement with no real joke in it.

${VOICE_MODEL}

RULE: rewrite the whole text freely in this stakeholder's voice. Hard cap 150 words absolute.

YOUR ASSIGNED DEVICE (from \`content_gen select-humor\` - see humor_selection.py): [DEVICE NAME]. Use ONLY this device across all 5 candidates. If it genuinely does not fit this content, say so in one line and name which other device below you'd use instead - don't silently substitute one anyway. Don't invent a new device here; at this volume (~106 artifacts) "avoid repeating, invent something new each time" runs out fast and either gets ignored or produces strained, forced devices - assignment removes that failure mode.

DEVICE REFERENCE (your assigned one is above; the rest are here only so you know what "a health check" or "personification" means as a category):
- Retroactively-satisfiable criterion: a vague trade-off condition that can always be declared met after the fact.
- Silence mistaken for testimony: an absence gets treated as a deliberate, on-purpose data point.
- Undetectable falsehood in a plausible dataset: almost everything checks out, and not knowing which one thing doesn't is the joke.
- Recursive bureaucracy: a process needs its own meta-process (a form to approve the form).
- Personification: an inanimate process or object is described as having its own attitude toward the rule it's bound by.
- A health check that asks the wrong question: a shallow check (did it run) stands in for the real one (is it correct) - land it with one concrete, absurd, still-plausible example of what the shallow check would wave through.
- A gap left idling with a pet's patience: an automation gap, anthropomorphized as waiting patiently for a human to notice.
[ADD ANY NEWLY SHIPPED DEVICE HERE]

HARD CONSTRAINTS (a strict adversarial reviewer will reject anything that breaks these, no partial credit):
1. Every candidate MUST preserve every fact from the original. State what you preserved.
2. The joke's target must be a process, a form, a deadline, a mismatch of scale - NEVER this stakeholder's own competence or personality. No caricature, no verbal tics, no mockery of who they are.
3. No AI-writing-tell vocabulary: delve, boasts, testament, tapestry, leverage, crucial, robust, seamless, underscore, "not X but Y" constructions, spaced em dashes, "load-bearing," "table stakes," "north star."
4. Must still read as a comprehensible intel document a player can act on.
5. If a joke touches a technical, legal, or compliance term (consent, audit, governance, ownership, liability), it must preserve who or what that term actually refers to - don't personify or redirect it onto the wrong subject (data cannot consent; only the people it belongs to can).
6. Any metaphor or image used must be understandable on a single read. If it needs to be explained, cut it.
7. The joke's mechanism must arise from this artifact's own MLOps component, not an invented, unconnected mechanism bolted on for a laugh. If you have to state a new causal link the original doesn't already support, find the joke somewhere else.
8. Mood is not a joke. Turning up the emotional temperature of a fact already stated doesn't count - needs a second, incongruous, concrete layer.
9. A gap, shallow check, or missing safeguard needs one concrete illustrative instance of what it would actually miss or let through. Naming the category of failure ("only checks if it ran, not if it's correct") is still just an accurate description of the mechanism - not a joke yet. ("...would pass a coin flip too" is the joke.)
10. Hard cap: 150 words absolute.
11. The player is an MLOps novice, not a seasoned practitioner. Never rely on the reader already recognizing an outside professional or cultural register (corporate jargon, legal procedure, a specific sport's officiating rules) to decode the joke - that obscures the fact instead of sharpening it. Self-contained, universally accessible images only. (This is why "institutional euphemism" and "institutional metaphor transplant" aren't in the device list above anymore.)

ORIGINAL ARTIFACT - "[TITLE]" (preserve: [LIST EVERY FACT FROM THE ORIGINAL]):
"[PASTE ORIGINAL ARTIFACT TEXT]"

TASK: Write 5 genuinely funny candidate rewrites using the assigned device. Take real swings - some can be too broad, a reviewer will cut the weak ones. After each candidate, note in one line which facts it preserved, its word count, and confirm it passes rules 5, 6, 7, 8, 9, and 11.`;

const ARTIFACT_REVIEWER_PROMPT = `You are an adversarial reviewer for comedy writing in a serious game about MLOps. Be genuinely harsh - assume every candidate probably fails, and make it prove otherwise. Do not be diplomatic.

HARD RULES (reject immediately, no partial credit, if violated):
1. Preserves every fact from the original (list them and check).
2. The joke's target is a process, a form, a deadline, a mismatch of scale - NEVER this stakeholder's own competence, personality, or a verbal tic assigned to them. Watch closely for small "behavioral tics" - these are a rule-2 violation even when framed as "about the process," because they still individuate and lightly caricature the person rather than the system.
3. No AI-writing-tell vocabulary/constructions: delve, boasts, testament, tapestry, leverage, crucial, robust, seamless, underscore, "not X but Y", spaced em dashes, "load-bearing," "table stakes," "north star."
4. Still reads as a comprehensible intel document a player can act on.
5. Preserves who or what any technical/legal/compliance term actually refers to - flag it if a joke personifies data, a system, or an object as the holder of something (consent, ownership, liability) that only a person can actually hold.
6. Any metaphor or image must be understandable on a single read with no decoding required - if you have to explain it yourself to justify it, fail it.
7. The joke's mechanism must be causally consistent with the artifact's own MLOps component. Trace it explicitly: what causes what, and does that link actually follow from the system described? A joke that's individually funny but requires an invented, unstated causal link fails this rule even if it passes every other one.
8. Mood is not a joke. If a candidate only turns up the emotional temperature of a fact already in the original, with no second incongruous layer, reject it regardless of how well-written it is.
9. A gap/check/flaw described only in the abstract ("only checks X, not Y") is not a joke, even when accurate - reject unless it names one concrete, specific, illustrative instance of what actually falls through. This is the single most common way an otherwise-correct candidate turns out flat.
10. Hard cap 150 words absolute - reject anything over.
11. Confirm each candidate actually used the assigned device, not a different one the writer decided fit better. Repetition of a device across many artifacts is expected and fine at this volume - only reject for using it badly (formulaic, forced), never for using it again.
12. Requires the reader to already know an outside professional or cultural register (corporate jargon, legal procedure, a sport's officiating rules) to decode it - the player is an MLOps novice, and a joke that needs that literacy obscures the fact instead of sharpening it.

ORIGINAL ARTIFACT - "[TITLE]": "[PASTE ORIGINAL ARTIFACT TEXT]"

Facts that must survive: [LIST EVERY FACT FROM THE ORIGINAL]

CANDIDATES:
[PASTE ALL 5 CANDIDATES FROM THE WRITER PASS]

TASK: Verdict (REJECT/WEAK/STRONG) per candidate with a one-to-two sentence reason focused on whether it's actually funny, plus the hard-rule check. Pick your single best candidate and explain the actual comedic mechanism and why it beats the others. Don't hedge; say if none are good enough.`;

const BRIEF_WRITER_PROMPT = `I'm writing a comedic rewrite of one two-stakeholder challenge brief for a "serious game" about MLOps. I need a genuinely funny rewrite, not just tightened prose - the failure mode to avoid is competent wry understatement with no real joke in it.

${VOICE_MODEL}

RULE (garnish, not marinade): rewrite ONLY the situational framing (setup/consequence sentences). Every sentence naming or attributed to a stakeholder is copied character-for-character, including the exact snake_case token (requirements_reuben, reliability_ruth, efficiency_emilia, model_monica, data_dave, automation_alex) - never the display name. Cap: rewritten frame + untouched stakeholder sentences <= 1.15x original word count, or 150 words absolute, whichever is smaller.

DEVICES ALREADY IN USE - don't repeat these exact shapes, but anything else, including something new, is fair game (low volume here, only 11 briefs total, all currently done - this only applies to a rare one-off redo, so discovery is still worth it):
- Problem as ritual preamble (rare, needs a recurring-meeting premise): the failure is restated at the top of every meeting about it, then set aside for the real agenda.
- Literal scale collision: a real, serious risk sits between two arbitrarily trivial agenda items, no metaphor needed.
- Banal contingency collision: a huge-stakes safeguard turns out to be something absurdly small or wrong-register.
- Procedural self-sabotage: a process is over-engineered in exactly the way that causes its own failure.
- Representation mistaken for reality: a decorative stand-in gets treated as the real thing once the real thing is gone.
- Neutral magnitude analogy: a real number is compared to a convention native to this same MLOps component with zero real-world moral valence, so the size lands without tilting toward either side. Prefer this over reaching for an outside metaphor.
- Consequential finding filed with a trivial one: a serious finding shares a checklist or report with something utterly mundane, filed with equal weight.
- A label unrevised by the reality it names: a status label keeps claiming something already visibly false.
[ADD ANY NEWLY SHIPPED DEVICE HERE]

HARD CONSTRAINTS (a strict adversarial reviewer will reject anything that breaks these, no partial credit):
1. Every candidate MUST preserve every negotiation fact from the original. State what you preserved for each.
2. The joke's target must be a process, a form, a deadline, a mismatch of scale - NEVER a specific stakeholder's competence or personality. No caricature, no verbal tics, no mockery of an individual.
3. No AI-writing-tell vocabulary: delve, boasts, testament, tapestry, leverage, crucial, robust, seamless, underscore, "not X but Y" constructions, spaced em dashes, "load-bearing," "table stakes," "north star."
4. Must still function as a clear scenario setup for a player about to negotiate.
5. If a joke touches a technical, legal, or compliance term (consent, audit, governance, ownership, liability), it must preserve who or what that term actually refers to - don't personify or redirect it onto the wrong subject (data cannot consent; only the people it belongs to can).
6. Any metaphor or image used must be understandable on a single read. If it needs to be explained, cut it.
7. The joke's mechanism must arise from the brief's own MLOps component, not an invented, unconnected mechanism bolted on for a laugh (e.g. don't explain a shadow-run/deploy blocker with an unrelated misfiled-paperwork detail). If you have to state a new causal link the brief doesn't already support, find the joke somewhere else.
8. Mood is not a joke. Turning up the emotional temperature of a fact already stated (a truck "idling, impatient") doesn't count - needs a second, incongruous, concrete layer.
9. A gap, shallow check, or missing safeguard needs one concrete illustrative instance of what it would actually miss or let through - not just naming the category of failure.
10. Check the line's OWN resolution logic, not just whether it names a stakeholder, and check any magnitude comparison for connotation (an image implying neglect/overgrowth/carelessness quietly sides with whoever thinks that's a problem) - a neutral comparison has zero real-world moral valence either way.
11. The stakeholder-attributed sentences are copied with zero paraphrase, snake_case tokens intact - not even a synonym swap.
12. The player is an MLOps novice, not a seasoned practitioner. Never rely on the reader already recognizing an outside professional or cultural register (corporate jargon, legal procedure, a specific sport's officiating rules) to decode the joke - that obscures the fact instead of sharpening it. Self-contained, universally accessible images only.

ORIGINAL BRIEF - "[TITLE]" (preserve: [LIST EVERY FACT FROM THE ORIGINAL]):
"[PASTE ORIGINAL BRIEF TEXT]"

TASK: Write 5 genuinely funny candidate rewrites. Take real swings - some can be too broad, a reviewer will cut the weak ones. After each candidate, note in one line which facts it preserved, which mechanism it used, its word count and ratio/cap, and confirm it passes rules 5, 6, 7, 8, 9, 10, 11, and 12.`;

const BRIEF_REVIEWER_PROMPT = `You are an adversarial reviewer for comedy writing in a serious game about MLOps. Be genuinely harsh - assume every candidate probably fails, and make it prove otherwise. Do not be diplomatic.

HARD RULES (reject immediately, no partial credit, if violated):
1. Preserves every negotiation fact from the original (list them and check).
2. The joke's target is a process, a form, a deadline, a mismatch of scale - NEVER a specific stakeholder's competence, personality, or a verbal tic assigned to them. Watch closely for small "behavioral tics" given to a stakeholder - these are a rule-2 violation even when framed as "about the process," because they still individuate and lightly caricature a named person rather than the system.
3. No AI-writing-tell vocabulary/constructions: delve, boasts, testament, tapestry, leverage, crucial, robust, seamless, underscore, "not X but Y", spaced em dashes, "load-bearing," "table stakes," "north star."
4. Still functions as a comprehensible scenario setup for a player about to negotiate.
5. Preserves who or what any technical/legal/compliance term actually refers to - flag it if a joke personifies data, a system, or an object as the holder of something (consent, ownership, liability) that only a person can actually hold.
6. Any metaphor or image must be understandable on a single read with no decoding required - if you have to explain it yourself to justify it, fail it.
7. The joke's mechanism must be causally consistent with the brief's own MLOps component. Trace it explicitly: what causes what, and does that link actually follow from the system the brief describes? A joke that's individually funny but requires an invented, unstated causal link fails this rule even if it passes every other one.
8. Mood is not a joke. If a candidate only turns up the emotional temperature of a fact already in the original, with no second incongruous layer, reject it regardless of how well-written it is.
9. A gap/check/flaw described only in the abstract ("only checks X, not Y") is not a joke, even when accurate - reject unless it names one concrete, specific, illustrative instance of what actually falls through. This is the single most common way an otherwise-correct candidate turns out flat.
10. Check the line's OWN resolution logic (does it quietly declare one side's value the one that matters, even unnamed), and check any magnitude comparison for connotation (neglect/overgrowth/carelessness sides with whoever thinks that's a problem).
11. Verify the stakeholder-attributed sentences are character-for-character identical to the original, snake_case tokens intact - zero paraphrase, not even a synonym swap.
12. Requires the reader to already know an outside professional or cultural register (corporate jargon, legal procedure, a sport's officiating rules) to decode it - the player is an MLOps novice, and a joke that needs that literacy obscures the fact instead of sharpening it.
13. This project already has these jokes elsewhere: [PASTE THE SAME DEVICE LIST FROM THE WRITER PROMPT]. Flag any candidate that repeats one of those exact shapes - a genuinely new device is preferred over a strong instance of something already used twice.

ORIGINAL BRIEF - "[TITLE]": "[PASTE ORIGINAL BRIEF TEXT]"

Facts that must survive: [LIST EVERY FACT FROM THE ORIGINAL]

CANDIDATES:
[PASTE ALL 5 CANDIDATES FROM THE WRITER PASS]

TASK: Verdict (REJECT/WEAK/STRONG) per candidate with a one-to-two sentence reason focused on whether it's actually funny, plus the hard-rule check. Pick your single best candidate and explain the actual comedic mechanism and why it beats the others. Don't hedge; say if none are good enough.`;

export default function Process() {
  return (
    <Section id="process" n="06" title="How these got made">
      <div className="card">
        <div className="card-body">
          <ul className="mb-3">
            <li>Write one candidate, review it adversarially, and if it fails, regenerate with the reviewer's own reason as feedback &mdash; not a fixed 5-candidates-up-front batch; the retry loop already built into <code>content_gen</code> does the same job the manual "write 5, pick the best" method did by hand.</li>
            <li>Review adversarially: assume the candidate fails. Check facts, target, vocabulary, clarity, causal coherence &mdash; then check if it's actually funny.</li>
            <li>Artifacts vs. briefs get separate prompts, not one prompt with a mode switch: which one applies is fixed by content type before the writer is ever called, not a choice the LLM makes, so there's nothing to ask it to pick.</li>
            <li>Assign, don't exclude, for artifacts (~106 of them): "avoid repeating, invent something new" runs out at that volume. <code>content_gen select-humor</code> assigns each artifact a device by deterministic round-robin (section 07). Exclude, don't assign, for briefs (rare, low volume, discovery still worth it).</li>
            <li>Garnish pattern (two-stakeholder briefs): rewrite the framing only, copy stakeholder sentences character-for-character. Turning up the emotional temperature of a fact already stated isn't a joke; it needs a real incongruous layer.</li>
            <li>Bias-clean and length-clean isn't sufficient &mdash; trace the joke's mechanism against the challenge's own component before checking whether it's funny.</li>
            <li>An accurate description of a gap isn't a joke about it &mdash; "only checks if it ran, not if it's correct" is still just the mechanism; "would pass a coin flip too" is the joke. Bit us twice before it became guardrail 16.</li>
            <li>"Institutional euphemism" and "institutional metaphor transplant" both retired outright: each only lands if the reader already recognizes an outside register (corporate-speak, a courtroom, a sports replay booth) as the thing being satirized, and the actual player is an MLOps novice, not a seasoned practitioner. Generalized into guardrail 17 &mdash; no device may require outside professional/cultural literacy, for any technique, not just garnish.</li>
          </ul>

          <Collapsible label="reusable writer + reviewer prompts">
            <p className="small text-secondary">Two separate pairs below: one for artifacts (single-voice, assigned device from <code>select-humor</code>), one for briefs (garnish, exclusion list, rare). Paste into a fresh session with the item's title, original text, and fact list filled in.</p>
            <div className="small text-uppercase text-secondary font-monospace mb-1">Artifact writer pass</div>
            <pre className="text-bg-dark p-3 rounded small mb-3" style={{ whiteSpace: "pre-wrap" }}>{ARTIFACT_WRITER_PROMPT}</pre>
            <div className="small text-uppercase text-secondary font-monospace mb-1">Artifact reviewer pass</div>
            <pre className="text-bg-dark p-3 rounded small mb-3" style={{ whiteSpace: "pre-wrap" }}>{ARTIFACT_REVIEWER_PROMPT}</pre>
            <div className="small text-uppercase text-secondary font-monospace mb-1">Brief writer pass</div>
            <pre className="text-bg-dark p-3 rounded small mb-3" style={{ whiteSpace: "pre-wrap" }}>{BRIEF_WRITER_PROMPT}</pre>
            <div className="small text-uppercase text-secondary font-monospace mb-1">Brief reviewer pass</div>
            <pre className="text-bg-dark p-3 rounded small mb-0" style={{ whiteSpace: "pre-wrap" }}>{BRIEF_REVIEWER_PROMPT}</pre>
          </Collapsible>
        </div>
      </div>
    </Section>
  );
}
