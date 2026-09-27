import { Section } from "./shared";

export default function Scale() {
  return (
    <Section id="scale" n="07" title="Scaling: a human-on-the-loop pipeline" lead="One required human checkpoint.">
      <div className="card">
        <div className="card-body">
          <ol className="mb-0">
            <li className="mb-2"><strong>Inventory</strong> &mdash; briefs plus their intel artifacts together; artifacts are higher priority.</li>
            <li className="mb-2"><strong>Exclusion ledger</strong> &mdash; tracks technique used per challenge; enforces the anti-repetition rule.</li>
            <li className="mb-2"><strong>Sample a humor ratio</strong> &mdash; a random 30&ndash;40% of challenges, per challenge (brief + its artifacts together, never per line, so a brief and both stakeholders' artifacts move as one unit).</li>
            <li className="mb-2"><strong>Batch by phase</strong> &mdash; 2&ndash;4 briefs at a time.</li>
            <li className="mb-2"><strong>Writer pass</strong> per brief &mdash; 5 candidates.</li>
            <li className="mb-2"><strong>Reviewer pass</strong> per brief &mdash; verdict + winner, or "none good enough."</li>
            <li className="mb-2"><strong>Human checkpoint</strong> &mdash; one gate, review only winners. Catches domain errors the reviewer agent can't.</li>
            <li className="mb-2"><strong>Ship + log</strong> the technique used.</li>
            <li className="mb-0"><strong>Playtest spot-check</strong> &mdash; the one thing that can't be automated.</li>
          </ol>
        </div>
      </div>
    </Section>
  );
}
