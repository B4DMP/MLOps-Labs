import { Section } from "./shared";

export default function Scale() {
  return (
    <Section id="scale" n="07" title="Scaling: a human-on-the-loop pipeline" lead="One required human checkpoint. All 11 briefs are done; from here this is entirely about the 106 artifacts.">
      <div className="card mb-3">
        <div className="card-body">
          <h3 className="h6 fw-bold mb-2">The numbers</h3>
          <p className="mb-2">Applicable items: 11 briefs + 106 artifacts = <strong>117</strong>. Done: 11 briefs (100%) + 9 artifacts = <strong>20</strong> (17%). Remaining: <strong>97 artifacts</strong>, 0 briefs.</p>
          <p className="mb-2">Artifact-level target, at the guardrail's 30&ndash;40% ratio: <strong>32&ndash;42 of 106</strong> should eventually carry a joke. 9 done already &rarr; <strong>23&ndash;33 more</strong> to select over time.</p>
          <p className="mb-0 small text-secondary">The ratio budgets artifacts only, not challenges &mdash; 7 of 11 challenges (64%) already have at least one artifact done, well past 30&ndash;40%, and that's fine; challenge spread was never the thing being bounded, only how much total content carries a joke. It does mean <code>--per-challenge-cap</code> (currently 1, max 11 reachable per pass across all challenges) needs raising in later passes to actually reach the 32&ndash;42 artifact target, rather than adding more challenges to the spread.</p>
        </div>
      </div>

      <div className="card mb-3">
        <div className="card-body">
          <h3 className="h6 fw-bold mb-2">Pipeline, end to end</h3>
          <pre className="text-bg-dark p-3 rounded small mb-0" style={{ whiteSpace: "pre", overflowX: "auto" }}>{`content_gen select-humor --ratio --per-challenge-cap
   |  deterministic: challenge-level ratio gate, then
   |  seeded round-robin device assignment (humor_selection.py)
   v
artifact: humor_status "selected" + humor_archetype: <device>
   |
   v
content_gen run --stage humor  <------------------------+
   |  call 1: write the rewrite (assigned device only)   |
   |  call 2: adversarial verdict (strong/weak/reject)   |
   v                                                      |
check(): facts / slop-vocab / 150-word cap /              |
         stakeholder-token intact / verdict --------------+
   |  (reject or wrong-device used -> retry, reviewer's own reason as feedback)
   v  (pass)
content_gen review --stage humor
content_gen approve --stage humor   <- the one required human checkpoint
   |
   v
content_gen assemble
   |  approved humor content replaces the plain artifact's
   |  content for that requirement id; untouched ones pass through
   v
gameConfig/OfflineIntelArtifacts.json`}</pre>
        </div>
      </div>

      <div className="card">
        <div className="card-body">
          <ol className="mb-0">
            <li className="mb-2"><strong>Inventory</strong> &mdash; 106 artifacts, grouped by challenge.</li>
            <li className="mb-2"><strong>Select + assign</strong> &mdash; <code>content_gen select-humor --ratio --per-challenge-cap</code>: deterministic challenge-level sampling, then a deterministic round-robin device assignment per selected artifact (humor_selection.py). Never re-selects anything already <code>humor_status: "done"</code> or <code>"selected"</code>.</li>
            <li className="mb-2"><strong>Batch by phase</strong> &mdash; 2&ndash;4 artifacts at a time.</li>
            <li className="mb-2"><strong>Write + review</strong> per artifact &mdash; one candidate, one adversarial verdict (<code>stages/humor.py</code>). A reject/weak verdict is a <code>check()</code> error, so the framework's existing per-item retry loop regenerates with the reviewer's own reason as feedback &mdash; no fixed 5-candidates batch, the retry loop is the write/review cycle.</li>
            <li className="mb-2"><strong>Human checkpoint</strong> &mdash; one gate, review only winners. Catches domain errors the reviewer agent can't.</li>
            <li className="mb-2"><strong>Ship + log</strong> &mdash; flip <code>humor_status</code> to <code>"done"</code>.</li>
            <li className="mb-0"><strong>Playtest spot-check</strong> &mdash; the one thing that can't be automated.</li>
          </ol>
        </div>
      </div>
    </Section>
  );
}
