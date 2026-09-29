import { Section } from "./shared";

const GUARDRAILS = [
  "Content-relevant first — a joke that drops a driver/boundary/trade-off fact fails.",
  "Never obscure a functional hint with a joke.",
  "One register per surface; don't mix mid-line.",
  "Target is always a form or process — never a stakeholder's competence or real human cost.",
  "Protect the technical signal — check \"does this still teach the concept.\"",
  "Screen every line against the words-to-avoid list.",
  "Rewrite what actually renders before writing for rare edge cases.",
  "Exclude, don't assign — cap one technique per phase.",
  "Preserve who a technical/legal term refers to; every metaphor must land in one read.",
  "Cap total rewritten length at whichever is smaller: 1.15x the original's word count, or 150 words absolute. Applies to briefs and single-voice artifacts alike.",
  "Check the line's own resolution logic, not just whether it names a stakeholder.",
  "Mood is not a joke — a line that only turns up the emotional temperature of an existing fact needs a second, incongruous layer to earn its place.",
  "Stakeholder sentences in a brief stay character-for-character untouched, snake_case tokens included — a runtime pass substitutes the display name afterward.",
  "A magnitude comparison must be checked for connotation, not just for naming a stakeholder. Prefer a comparison native to the challenge's own component over an outside metaphor.",
  "The joke's own mechanism must be causally consistent with the challenge's actual MLOps component, not an invented link bolted on for a laugh.",
  "A gap, shallow check, or missing safeguard needs one concrete illustrative instance of what it would actually miss or let through — naming the category of failure (\"only checks if it ran, not if it's correct\") is still just an accurate description of the mechanism, not a joke yet. (\"...would pass a coin flip too\" is the joke.)",
  "No device may require the player to already recognize an outside professional or cultural register (corporate jargon, legal procedure, a sport's officiating rules) to decode the joke. The player is an MLOps novice, not a seasoned practitioner — a joke that needs that literacy obscures the fact instead of sharpening it. This killed \"institutional euphemism\" outright; applies to every technique, not just garnish (it was previously scoped to technique 6 only, as \"no workplace-culture references\" — too narrow, since technique 5 devices can carry the exact same risk).",
  "A device must supply its own comic mechanism — irony, absurd anthropomorphism, structural collapse, infinite regress — not just describe an epistemic or risk problem accurately. \"There's an error and you'll never find it\" is unease, not a joke, unless something else about it is inherently funny. This killed \"undetectable falsehood in a plausible dataset\": every other device in the catalog has the joke built into its own definition; this one only landed when a separate, genuinely comic detail got bolted on, and read as a dry risk statement when it didn't.",
];

export default function Guardrails() {
  return (
    <Section id="guardrails" n="09" title="Guardrails">
      <ol className="list-group list-group-numbered">
        {GUARDRAILS.map((g) => (
          <li key={g} className="list-group-item">{g}</li>
        ))}
      </ol>
    </Section>
  );
}
