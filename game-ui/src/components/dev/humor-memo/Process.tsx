import { Section, Collapsible } from "./shared";

const WRITER_PROMPT = `I'm writing comedic rewrites of dry scenario briefs for a "serious game" about MLOps. I need genuinely funny candidates, not just tightened prose - the failure mode to avoid is competent wry understatement with no real joke in it.

VOICE MODEL (don't deviate):
- Good Omens (Gaiman/Pratchett): real large stakes sit completely unremarked next to characters' small, petty, in-the-room focus. Never narrated or explained - just placed there.
- Monty Python (Dead Parrot / Ministry of Silly Walks): institutional denial via escalating euphemism; absurd bureaucratic functions treated with total unblinking sincerity.
- Douglas Adams (the Vogons): a bureaucratic process outweighs, in the characters' own minds, the catastrophe the process just caused - irritation about the paperwork inconvenience, not alarm about the disaster.

DEVICES ALREADY IN USE - don't repeat these exact shapes, but anything else, including something new, is fair game:
- Unresolved resolution: a full signed agreement is reached, and nobody checked whether the real problem got fixed.
- Literal scale collision: a real, serious risk sits between two arbitrarily trivial agenda items, no metaphor needed.
- Retroactively-satisfiable criterion: a vague trade-off condition that can always be declared met after the fact.
- Institutional euphemism: a flat refusal dressed in escalating official-sounding language.
- Banal contingency collision: a huge-stakes safeguard turns out to be something absurdly small or wrong-register.
- Procedural self-sabotage: a process is over-engineered in exactly the way that causes its own failure.
- Silence mistaken for testimony: an absence gets treated as a deliberate, on-purpose data point.
- Undetectable falsehood in a plausible dataset: almost everything checks out, and not knowing which one thing doesn't is the joke.
- Representation mistaken for reality: a decorative stand-in gets treated as the real thing once the real thing is gone.
- Institutional metaphor transplant: a rigorous outside process (courtroom, quarantine, sports replay) gets mapped completely and sustained in the stakeholder's own voice.
- Neutral magnitude analogy: a real number is compared to a convention with zero real-world moral valence, so the size lands without tilting toward either side.
[ADD ANY NEWLY SHIPPED DEVICE HERE]

HARD CONSTRAINTS (a strict adversarial reviewer will reject anything that breaks these, no partial credit):
1. Every candidate MUST preserve every negotiation fact from the original. State what you preserved for each.
2. The joke's target must be a process, a form, a deadline, a mismatch of scale - NEVER a specific stakeholder's competence or personality. No caricature, no verbal tics, no mockery of an individual.
3. No AI-writing-tell vocabulary: delve, boasts, testament, tapestry, leverage, crucial, robust, seamless, underscore, "not X but Y" constructions, spaced em dashes, "load-bearing," "table stakes," "north star."
4. Must still function as a clear scenario setup for a player about to negotiate.
5. If a joke touches a technical, legal, or compliance term (consent, audit, governance, ownership, liability), it must preserve who or what that term actually refers to - don't personify or redirect it onto the wrong subject (data cannot consent; only the people it belongs to can).
6. Any metaphor or image used must be understandable on a single read. If it needs to be explained, cut it.
7. The joke's mechanism must arise from the brief's own MLOps component, not an invented, unconnected mechanism bolted on for a laugh (e.g. don't explain a shadow-run/deploy blocker with an unrelated misfiled-paperwork detail). If you have to state a new causal link the brief doesn't already support, find the joke somewhere else.

ORIGINAL BRIEF - "[TITLE]" (preserve: [LIST EVERY FACT FROM THE ORIGINAL]):
"[PASTE ORIGINAL BRIEF TEXT]"

TASK: Write 5 genuinely funny candidate rewrites. Take real swings - some can be too broad, a reviewer will cut the weak ones. After each candidate, note in one line which facts it preserved, which mechanism it used, and confirm it passes rules 5, 6, and 7.`;

const REVIEWER_PROMPT = `You are an adversarial reviewer for comedy writing in a serious game about MLOps. Be genuinely harsh - assume every candidate probably fails, and make it prove otherwise. Do not be diplomatic.

HARD RULES (reject immediately, no partial credit, if violated):
1. Preserves every negotiation fact from the original (list them and check).
2. The joke's target is a process, a form, a deadline, a mismatch of scale - NEVER a specific stakeholder's competence, personality, or a verbal tic assigned to them. Watch closely for small "behavioral tics" given to a stakeholder - these are a rule-2 violation even when framed as "about the process," because they still individuate and lightly caricature a named person rather than the system.
3. No AI-writing-tell vocabulary/constructions: delve, boasts, testament, tapestry, leverage, crucial, robust, seamless, underscore, "not X but Y", spaced em dashes, "load-bearing," "table stakes," "north star."
4. Still functions as a comprehensible scenario setup for a player about to negotiate.
5. Preserves who or what any technical/legal/compliance term actually refers to - flag it if a joke personifies data, a system, or an object as the holder of something (consent, ownership, liability) that only a person can actually hold.
6. Any metaphor or image must be understandable on a single read with no decoding required - if you have to explain it yourself to justify it, fail it.
7. The joke's mechanism must be causally consistent with the brief's own MLOps component. Trace it explicitly: what causes what, and does that link actually follow from the system the brief describes? A joke that's individually funny but requires an invented, unstated causal link fails this rule even if it passes every other one.

ADDITIONAL RULE 8: this project already has these jokes elsewhere: [PASTE THE SAME DEVICES-ALREADY-IN-USE LIST FROM THE WRITER PROMPT]. Mark down (don't auto-reject, but flag clearly) any candidate that repeats one of those exact shapes - a genuinely new device, even an unnamed one, is preferred over a strong instance of something already used twice.

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
            <li>Write 5 candidates per brief, not 1 &mdash; real swings, not safe restatement.</li>
            <li>Review adversarially: assume every candidate fails. Check facts, target, vocabulary, clarity, causal coherence &mdash; then check if it's actually funny.</li>
            <li>Exclude, don't assign: give the writer the list of used devices, not a chosen target.</li>
            <li>Garnish pattern (two-stakeholder briefs): rewrite the framing only, copy stakeholder sentences character-for-character. Turning up the emotional temperature of a fact already stated isn't a joke; it needs a real incongruous layer.</li>
            <li>Bias-clean and length-clean isn't sufficient &mdash; trace the joke's mechanism against the challenge's own component before checking whether it's funny.</li>
          </ul>

          <Collapsible label="reusable writer + reviewer prompts">
            <p className="small text-secondary">Paste into a fresh session with the brief's title, original text, and fact list filled in. The exclusion list should carry forward every technique already shipped.</p>
            <div className="small text-uppercase text-secondary font-monospace mb-1">Writer pass</div>
            <pre className="text-bg-dark p-3 rounded small mb-3" style={{ whiteSpace: "pre-wrap" }}>{WRITER_PROMPT}</pre>
            <div className="small text-uppercase text-secondary font-monospace mb-1">Reviewer pass</div>
            <pre className="text-bg-dark p-3 rounded small mb-0" style={{ whiteSpace: "pre-wrap" }}>{REVIEWER_PROMPT}</pre>
          </Collapsible>
        </div>
      </div>
    </Section>
  );
}
