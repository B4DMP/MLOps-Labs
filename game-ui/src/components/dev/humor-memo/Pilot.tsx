import { Section } from "./shared";

export default function Pilot() {
  return (
    <Section id="pilot" n="11" title="Suggested pilot">
      <div className="card">
        <div className="card-body">
          <ol className="mb-0">
            <li className="mb-2">Rewrite the five generic templates in <code>MlopsStoryFragments.json</code> &mdash; they render most.</li>
            <li className="mb-2">Add one narrator aside for "The Ledger" (<code>fired_grudges</code>) &mdash; the counter already exists.</li>
            <li className="mb-2">Ship the batch of 11 briefs and 9 artifacts against their real challenges, next to whatever artifacts remain unrewritten.</li>
            <li className="mb-2">Confirm the loading screen is actually seen in production.</li>
            <li className="mb-2">Prototype one emotion-conditioned archetype (e.g. <code>overwhelmed</code> &rarr; recursive bureaucracy) in <code>EmotionValueConfig.json</code>.</li>
            <li className="mb-0">Playtest: does the negotiation logic still read clearly, and does either side feel favored?</li>
          </ol>
        </div>
      </div>
    </Section>
  );
}
