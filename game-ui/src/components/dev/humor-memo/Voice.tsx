import { Section } from "./shared";

export default function Voice() {
  return (
    <Section id="voice" n="03" title="A voice model, anchored on Good Omens" lead="Real stakes sit beside petty focus, unremarked. Two relatives sharpen it." defaultOpen={false}>
      <div className="row row-cols-1 row-cols-md-2 g-3">
        <div className="col">
          <div className="card h-100">
            <div className="card-body">
              <h3 className="h6 fw-bold mb-1">
                Monty Python <span className="fw-normal text-secondary small">&mdash; Dead Parrot, Ministry of Silly Walks</span>
              </h3>
              <p className="fw-semibold small mb-2">Deny the problem through escalating euphemism instead of stating it.</p>
              <div className="small text-uppercase text-secondary font-monospace mb-1">Applied to Shelfcast</div>
              <blockquote className="text-bg-dark p-3 rounded small mb-0">
                The widget isn't stale. It's historically stable. It's had the same value for three weeks because that value hasn't finished being current yet.
              </blockquote>
            </div>
          </div>
        </div>
        <div className="col">
          <div className="card h-100">
            <div className="card-body">
              <h3 className="h6 fw-bold mb-1">
                Douglas Adams <span className="fw-normal text-secondary small">&mdash; the Vogons</span>
              </h3>
              <p className="fw-semibold small mb-2">Let the process continue on schedule, annoyed at the inconvenience, not the damage it caused.</p>
              <div className="small text-uppercase text-secondary font-monospace mb-1">Applied to Shelfcast</div>
              <blockquote className="text-bg-dark p-3 rounded small mb-0">
                The nightly batch job dropped the northern stores' scan lines without incident, in the sense that nothing crashed and nobody was told.
              </blockquote>
            </div>
          </div>
        </div>
      </div>
      <p className="mt-3 mb-0">Test: who or what is the joke about? A stake, a process, a euphemism &mdash; never a stakeholder's competence.</p>
    </Section>
  );
}
