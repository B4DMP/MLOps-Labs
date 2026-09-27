import { Section } from "./shared";

export default function Correction() {
  return (
    <Section id="correction" n="10" title="Playtest lessons" lead="Four problems, traced to two causes: full in-voice rewrites on two-stakeholder briefs, and jokes whose mechanism didn't hold up on inspection.">
      <div className="card mb-3">
        <div className="card-body">
          <ol className="mb-0">
            <li className="mb-2"><strong>Biased players toward a side.</strong> A device that mocks one stakeholder's reasoning leaves the other's stance looking more sensible by comparison. Fix: technique 5 (voice rewrites) restricted to single-voice artifacts; two-stakeholder briefs use technique 6 (garnish) instead.</li>
            <li className="mb-2"><strong>Rewrites were longer than the originals.</strong> Fix: cap total length at 1.15x original or 150 words, whichever binds (guardrail 10).</li>
            <li className="mb-2"><strong>Players had to decode the joke's reference and the MLOps fact at the same time.</strong> Fix: the joke lives only in the framing, never in the sentences stating a position &mdash; those stay exactly as written.</li>
            <li className="mb-0"><strong>Bias-clean and length-clean isn't sufficient.</strong> A joke can still fail to make causal sense (guardrail 15) &mdash; checked as its own review step, not folded into the funny/not-funny call.</li>
          </ol>
        </div>
      </div>

      <div className="card mb-3">
        <div className="card-body">
          <h3 className="h6 fw-bold mb-2">Emotion-conditioned humor in the pitch debate</h3>
          <p>Pitch-debate dialogue (<code>pitch_debate.tsx</code>) is LLM-generated per turn, already conditioned on a discrete emotional state recomputed from a 7-dimension emotion vector (<code>emotion_node</code>, <code>nodes.py:327-408</code>) and injected as a tone instruction (<code>emotion_prompts</code>, <code>EmotionValueConfig.json</code>). <code>emotional_state</code> is already persisted per turn in production (<code>game_challenge_data.messages</code>), confirmed against a real playtest account: neutral, relieved, apathetic, angry, anxious all occur.</p>
          <ul className="mb-2">
            <li>Real turns run 30&ndash;50 words &mdash; about a third the length of our shortest artifact rewrite. Rules out institutional metaphor transplant for this surface (needed the full ~150 words to sustain itself); the rest compress to a single added clause.</li>
            <li>Turns split into three categories, matching what we expected: agreement, disagreement/objection, and flat informational statements &mdash; no dedicated classifier field, just free text.</li>
            <li>Add a per-state archetype directive to <code>emotion_prompts</code> &mdash; e.g. <code>overwhelmed</code> &rarr; recursive bureaucracy, <code>skeptical</code> &rarr; institutional euphemism.</li>
            <li>The intensity scalar (emotion vector's distance from neutral) still doesn't exist in code, but isn't hard to add &mdash; gates humor by it, producing "a few gems, not everywhere" for free.</li>
            <li>Anxious turns can carry more than the others &mdash; a short precedent nod ("the same as last time"), not a single restrained clause; real anxious speech escalates rather than understates. Same guardrails otherwise: never replaces the substantive point, never targets the other stakeholder in the room.</li>
          </ul>
          <p className="mb-0 small text-secondary">Four candidates against real turns from a playtest account are in section 05, alongside everything else.</p>
        </div>
      </div>
    </Section>
  );
}
