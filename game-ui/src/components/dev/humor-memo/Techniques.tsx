import { Section } from "./shared";

export default function Techniques() {
  return (
    <Section id="techniques" n="04" title="Six techniques" lead="Mapped to content types. None touch functional UI copy." defaultOpen={false}>
      <div id="technique-1" className="card mb-3">
        <div className="card-header d-flex justify-content-between align-items-center flex-wrap gap-2">
          <span className="fw-semibold">1. Extend the deadpan narrator past the epilogue</span>
          <span className="badge text-bg-light border text-secondary">narration &amp; flavor text only</span>
        </div>
        <div className="card-body">
          <p>Deadpan narration needs no joke construction &mdash; just restraint and specificity.</p>
          <div className="row row-cols-1 row-cols-md-2 g-2 mb-2">
            <div className="col"><div className="small text-uppercase text-secondary mb-1">Scenario transition</div><div className="p-2 bg-body-secondary rounded small">Loading next scenario...</div></div>
            <div className="col"><div className="small text-uppercase text-secondary mb-1">Deadpan</div><div className="p-2 text-bg-dark rounded small">Assembling the next scenario. It will contain a supplier, a deadline, and someone's strong opinion about both.</div></div>
          </div>
          <div className="row row-cols-1 row-cols-md-2 g-2 mb-2">
            <div className="col"><div className="small text-uppercase text-secondary mb-1">Turn-end summary</div><div className="p-2 bg-body-secondary rounded small">You reached agreement with 2 of 3 stakeholders this round.</div></div>
            <div className="col"><div className="small text-uppercase text-secondary mb-1">Deadpan</div><div className="p-2 text-bg-dark rounded small">Two stakeholders agreed. The third is still drafting a strongly worded email.</div></div>
          </div>
          <div className="row row-cols-1 row-cols-md-2 g-2 mb-2">
            <div className="col"><div className="small text-uppercase text-secondary mb-1">Narrated fact</div><div className="p-2 bg-body-secondary rounded small">The dashboard widget still displays the last successful value from three weeks ago, which no longer reflects current store performance.</div></div>
            <div className="col"><div className="small text-uppercase text-secondary mb-1">Deadpan</div><div className="p-2 text-bg-dark rounded small">The dashboard widget has shown the same number for three weeks straight. Nobody has corrected it, and it hasn't corrected itself.</div></div>
          </div>
          <p className="mb-0 small text-secondary">Caveat: confirm the loading screen is actually seen in production before writing more for it.</p>
        </div>
      </div>

      <div id="technique-2" className="card mb-3">
        <div className="card-header d-flex justify-content-between align-items-center flex-wrap gap-2">
          <span className="fw-semibold">2. Let real stakes and petty focus share a scene</span>
          <span className="badge text-bg-light border text-secondary">briefings, scenario intros</span>
        </div>
        <div className="card-body">
          <p>State the real stakes plainly, then let characters keep caring about something smaller &mdash; no comment on the gap.</p>
          <div className="row row-cols-1 row-cols-md-2 g-2">
            <div className="col"><div className="small text-uppercase text-secondary mb-1">Current</div><div className="p-2 bg-body-secondary rounded small">A batch of till scan lines from the northern stores was silently dropped during last night's ingestion, causing the model to forecast zero demand for fresh produce.</div></div>
            <div className="col"><div className="small text-uppercase text-secondary mb-1">Stakes + petty focus</div><div className="p-2 text-bg-dark rounded small">The forecast now expects nobody, anywhere, to buy a single vegetable tomorrow. The scan-line issue is third on today's agenda, after room booking.</div></div>
          </div>
        </div>
      </div>

      <div id="technique-3" className="card mb-3">
        <div className="card-header d-flex justify-content-between align-items-center flex-wrap gap-2">
          <span className="fw-semibold">3. Gallows humor for bad-ending debriefs &mdash; carefully</span>
          <span className="badge text-bg-light border text-secondary">endgame epilogue, incident text</span>
        </div>
        <div className="card-body">
          <p className="mb-0">The worst ending already does this. Aim it at the situation, never a stakeholder's competence or a real-feeling human cost.</p>
        </div>
      </div>

      <div id="technique-4" className="card mb-3">
        <div className="card-header d-flex justify-content-between align-items-center flex-wrap gap-2">
          <span className="fw-semibold">4. Anchor callbacks to persistent state, not to one object</span>
          <span className="badge text-bg-light border text-secondary">cross-cutting callback</span>
        </div>
        <div className="card-body">
          <p>A gag scripted to one object breaks under semi-random challenge scheduling. Build on persistent state instead: <code>fired_grudges</code>, <code>final_emotions</code>, pillar scores, and each component's own automation/governance tier.</p>
          <div className="row row-cols-1 row-cols-md-2 g-2 mb-2">
            <div className="col"><div className="small text-uppercase text-secondary mb-1">"The Ledger" &mdash; fired_grudges</div><div className="p-2 bg-body-secondary rounded small">Grudge count crosses a threshold, anywhere, any run.</div></div>
            <div className="col"><div className="small text-uppercase text-secondary mb-1">Narrator aside</div><div className="p-2 text-bg-dark rounded small">Someone has started keeping a list. It has three entries so far.</div></div>
          </div>
          <div className="row row-cols-1 row-cols-md-2 g-2 mb-2">
            <div className="col"><div className="small text-uppercase text-secondary mb-1">"Coldest relationship" &mdash; final_emotions</div><div className="p-2 bg-body-secondary rounded small">Whichever stakeholder's mood is currently lowest, filled in like the epilogue already fills {"{st}"}.</div></div>
            <div className="col"><div className="small text-uppercase text-secondary mb-1">Narrator aside</div><div className="p-2 text-bg-dark rounded small">{"{st}"} has stopped replying with exclamation points. Someone is treating this as a leading indicator.</div></div>
          </div>
          <div className="row row-cols-1 row-cols-md-2 g-2 mb-2">
            <div className="col"><div className="small text-uppercase text-secondary mb-1">Governance drift &mdash; one component's tier</div><div className="p-2 bg-body-secondary rounded small">Any component reaching "automated" while its governance stays at NONE &mdash; e.g. <code>data.validation</code>.</div></div>
            <div className="col"><div className="small text-uppercase text-secondary mb-1">Narrator aside</div><div className="p-2 text-bg-dark rounded small">Data validation runs on its own now. Nobody has signed off on what it's allowed to reject.</div></div>
          </div>
          <p className="small text-secondary">The governance-drift version needs no new code &mdash; <code>MlopsStoryFragments.json</code> already authors text per component/tier. Rewrite the five generic fallback templates first; those render most often.</p>
          <p className="mb-0 small text-secondary">A one-off stale-widget line is fine locally; don't promise it an epilogue payoff without a dedicated fact.</p>
        </div>
      </div>

      <div id="technique-5" className="card mb-3">
        <div className="card-header d-flex justify-content-between align-items-center flex-wrap gap-2">
          <span className="fw-semibold">5. Give it a real turn</span>
          <span className="badge text-bg-light border text-secondary">single-voice intel artifacts &amp; narration only</span>
        </div>
        <div className="card-body">
          <p>A joke needs a reversal, a loop, or a reveal &mdash; not just dry tone. Restricted to single-voice content: each side gets its own artifact, so any bias is symmetric by construction. Not for two-stakeholder briefs &mdash; see technique 6.</p>
          <ul className="mb-2">
            <li><strong>Recursive bureaucracy</strong> &mdash; a process needs its own meta-process (a form to approve the form).</li>
            <li><strong>Unresolved resolution</strong> &mdash; a full agreement is signed, and nobody checked if the real problem got fixed.</li>
            <li><strong>Retroactively-satisfiable criterion</strong> &mdash; a vague trade-off condition that can always be declared met after the fact.</li>
            <li><strong>Institutional euphemism</strong> &mdash; a refusal dressed in escalating official language.</li>
            <li><strong>Silence mistaken for testimony</strong> &mdash; an absence or non-response gets treated as a deliberate, on-purpose data point (a shrug logged as an answer).</li>
            <li><strong>Undetectable falsehood in a plausible dataset</strong> &mdash; almost everything in a record checks out, and the joke is not knowing which one figure doesn't.</li>
            <li><strong>Institutional metaphor transplant</strong> &mdash; a rigorous outside process (a courtroom, a quarantine, a sports replay booth) gets mapped completely and sustained in the stakeholder's own voice.</li>
          </ul>
          <p className="mb-0">Check if one is already latent in the artifact before reaching for something else.</p>
        </div>
      </div>

      <div id="technique-6" className="card mb-3">
        <div className="card-header d-flex justify-content-between align-items-center flex-wrap gap-2">
          <span className="fw-semibold">6. Garnish, not marinade</span>
          <span className="badge text-bg-light border text-secondary">two-stakeholder challenge briefs</span>
        </div>
        <div className="card-body">
          <p>A brief has two kinds of sentences: situational framing (setup, consequence) and stakeholder-attributed positions (<code>requirements_reuben insists&hellip;</code>). Rewrite the framing freely, in any technique above &mdash; the stakeholder sentences stay character-for-character untouched, tokens included. The voice lives in the existing frame, not a bolted-on closing line; one fixed trailing joke becomes its own tic once used often enough.</p>
          <ul className="mb-2">
            <li>Stakeholder-attributed sentences: zero paraphrase, zero touch &mdash; copy them exactly, including the snake_case token (<code>requirements_reuben</code>, not "Reuben"; a runtime pass substitutes the display name from that token afterward).</li>
            <li>Cap: rewritten frame + untouched stakeholder sentences &le; 1.15x original word count, or 150 words absolute, whichever binds first.</li>
            <li>Framing must not favor either stakeholder, by naming or by resolution logic.</li>
            <li>In-fiction or universally mundane concepts only (trucks, pallets, a sticky note) &mdash; not workplace-culture references (meetings, agendas, coffee) that assume professional literacy some players won't have.</li>
            <li>Needs a real incongruous joke in the frame, not vivider mood.</li>
            <li>The joke's mechanism must be causally consistent with the challenge's own MLOps component &mdash; not an unrelated device bolted on for a laugh.</li>
          </ul>
          <p className="small text-secondary mb-2">
            Confirmed sub-devices: <strong>banal contingency collision</strong> (the huge-stakes safeguard is something absurdly small or wrong-register, like scarves as the heatwave plan), <strong>procedural self-sabotage</strong> (the process is over-engineered specifically in the way that causes its own failure), <strong>representation mistaken for reality</strong> (a decorative stand-in gets treated as the real thing once the real thing is gone), and <strong>neutral magnitude analogy</strong> (a real number compared to a convention with zero real-world moral valence &mdash; prefer one native to the challenge's own component, like an alert threshold, over an outside metaphor).
          </p>
          <div className="row row-cols-1 row-cols-md-2 g-2">
            <div className="col"><div className="small text-uppercase text-secondary mb-1">Original setup sentence</div><div className="p-2 bg-body-secondary rounded small">A supplier has confirmed a bulk order for a middle aisle promotion that ships next week, leaving no room for model error.</div></div>
            <div className="col"><div className="small text-uppercase text-secondary mb-1">Frame rewritten, stakeholder sentences untouched</div><div className="p-2 text-bg-dark rounded small">A supplier has confirmed a bulk order for a middle aisle promotion that ships next week, and the only contingency plan on file is a sticky note that says "don't."</div></div>
          </div>
        </div>
      </div>
    </Section>
  );
}
