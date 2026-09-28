import { Section, Collapsible } from "./shared";

const DIALOGUE_HUMOR_PROMPT = `HUMOR (only if this state/intensity triggered it - most turns should NOT include this):
Add ONE short clause (roughly 8-20 words) inside the point you're already making. Do not add a separate sentence, do not soften or replace the substantive negotiating content - the clause rides inside the existing point.

The joke is about the actual MLOps mechanism you're discussing this turn (validation, registry, monitoring, whatever it is) - NEVER about the negotiation itself, prior rounds, or repetition ("this happened before," "here we go again"). Ground it the way a real technical complaint would: one concrete, specific, absurd-but-plausible detail (a physically impossible number, a check that only confirms the job ran, a registry that can't explain itself) - not a vague escalation.

Never target the other stakeholder in the room. The target is always the system, process, or specific technical gap you're already reacting to.

Devices available for {emotion}: {archetype_menu}
(one-line description of each, from the writer-prompt device list)

Match register to the emotion:
- angry: blunt, short, one sharp idiom at most.
- anxious: escalate via one concrete catastrophic-but-plausible image, never via history/precedent.
- skeptical: dry, deflating.
- relieved / enthusiastic: light, satisfied, doesn't gloat over whoever lost the point.
- overwhelmed: pile-up, not sharpness.
- apathetic / neutral: skip this instruction entirely.

If nothing lands in one clause without forcing it, skip the joke and make the point straight - a flat turn beats a forced one.

Per-state menu (technique-5 devices only - nothing needing the full 150 words to sustain):
- overwhelmed -> recursive bureaucracy
- skeptical -> personification
- frustrated -> a gap left idling with a pet's patience
- anxious -> a health check that asks the wrong question, or undetectable falsehood in a plausible dataset
- angry -> silence mistaken for testimony
- enthusiastic -> retroactively-satisfiable criterion
- relieved -> undetectable falsehood in a plausible dataset, or a label unrevised by the reality it names
- apathetic / neutral -> none, omit this block`;

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
            <li>Real turns run 30&ndash;50 words &mdash; about a third the length of our shortest artifact rewrite, so only devices that compress to a single added clause fit here; none of the confirmed artifact devices need the full ~150 words to sustain themselves.</li>
            <li>Turns split into three categories, matching what we expected: agreement, disagreement/objection, and flat informational statements &mdash; no dedicated classifier field, just free text.</li>
            <li>Add a per-state archetype directive to <code>emotion_prompts</code> &mdash; e.g. <code>overwhelmed</code> &rarr; recursive bureaucracy, <code>skeptical</code> &rarr; personification.</li>
            <li>The intensity scalar (emotion vector's distance from neutral) still doesn't exist in code, but isn't hard to add &mdash; gates humor by it, producing "a few gems, not everywhere" for free.</li>
            <li>Anxious turns can carry a slightly longer clause than the others, but the extra length has to be a concrete image (a specific, absurd-but-plausible failure), not a vague precedent nod ("this happened before") &mdash; that reads as the demo replaying an old objection, not as a joke, and it's exactly the staleness the game already tries to avoid. Same guardrails otherwise: never replaces the substantive point, never targets the other stakeholder in the room.</li>
          </ul>
          <p className="small text-secondary">Four candidates against real turns from a playtest account are in section 05, alongside everything else.</p>

          <Collapsible label="reusable dialogue-humor instruction">
            <p className="small text-secondary">Appended to the per-turn stakeholder prompt only when intensity crosses the threshold; the exact archetype descriptions come from the writer-prompt device list (section 06) so the two stay in sync.</p>
            <pre className="text-bg-dark p-3 rounded small mb-0" style={{ whiteSpace: "pre-wrap" }}>{DIALOGUE_HUMOR_PROMPT}</pre>
          </Collapsible>
        </div>
      </div>
    </Section>
  );
}
