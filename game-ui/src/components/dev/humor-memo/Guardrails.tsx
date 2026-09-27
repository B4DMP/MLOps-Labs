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
