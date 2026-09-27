import { Section } from "./shared";

export default function Audit() {
  return (
    <Section id="audit" n="01" title="Two registers already exist" lead="Character intros and the epilogue are already dry and funny. Challenge briefs and intel artifacts go flat." defaultOpen={false}>
      <div className="card mb-3">
        <div className="card-body">
          <span className="badge text-bg-success mb-2">Already working</span>
          <div className="row row-cols-1 row-cols-md-2 g-3">
            <div className="col">
              <blockquote className="text-bg-dark p-3 rounded small mb-0">
                <p className="mb-2">Hey, I'm model_monica. I train and tune models until the numbers stop embarrassing me, then I deploy them and keep watching the numbers anyway.</p>
                <footer className="blockquote-footer text-white-50 small mb-0">GameStakeholders.json:87</footer>
              </blockquote>
            </div>
            <div className="col">
              <blockquote className="text-bg-dark p-3 rounded small mb-0">
                <p className="mb-2">A year on, nobody at Lindenmarkt calls it "the Shelfcast project" any more. They just call it the forecast, and they plan around it.</p>
                <footer className="blockquote-footer text-white-50 small mb-0">EndgameEpilogue.json:4</footer>
              </blockquote>
            </div>
          </div>
        </div>
      </div>

      <div className="card mb-3">
        <div className="card-body">
          <span className="badge text-bg-warning mb-2">Goes flat</span>
          <div className="row row-cols-1 row-cols-md-2 g-3">
            <div className="col">
              <blockquote className="text-bg-dark p-3 rounded small mb-0">
                <p className="mb-2">I will accept losing the manual review step where I currently adjust each metric to fit the broader product strategy. In return, I need the automated output to align perfectly with our organizational roadmap.</p>
                <footer className="blockquote-footer text-white-50 small mb-0">OfflineIntelArtifacts.json:23 &mdash; efficiency_emilia</footer>
              </blockquote>
            </div>
            <div className="col">
              <blockquote className="text-bg-dark p-3 rounded small mb-0">
                <p className="mb-2">A supplier has confirmed a bulk order for a middle aisle promotion that ships next week, leaving no room for model error. requirements_reuben insists the acceptance criteria must be fully governed...</p>
                <footer className="blockquote-footer text-white-50 small mb-0">GameProgression.json:174</footer>
              </blockquote>
            </div>
          </div>
        </div>
      </div>

      <p className="mb-0">Playtesters want the MLOps substance sharper, not softer &mdash; humor should add specificity, never replace it.</p>
    </Section>
  );
}
