import { Section } from "./shared";

export default function Slop() {
  return (
    <Section id="slop" n="08" title="Words to avoid" lead="Tells that make writing read as machine-generated.">
      <div className="card">
        <div className="card-body">
          <p className="font-monospace small text-secondary mb-3" style={{ lineHeight: 2 }}>
            delve &middot; boasts &middot; testament &middot; tapestry &middot; vibrant &middot; underscore(s) &middot; crucial &middot; robust &middot; seamless &middot; leverage &middot; fostering &middot; intricate &middot; nuanced &middot; realm &middot; garnered &middot; notably &middot; multifaceted &middot; streamline &middot; showcase &middot; highlight &middot; pivotal &middot; landscape &middot; navigate &middot; journey &middot; unlock &middot; elevate &middot; resonate &middot; ecosystem
          </p>
          <p className="mb-2 small">Also: grandiose "stands as a testament to"; unearned "not X, but Y"; spaced em dashes; "Certainly!" / "in conclusion"; padded rule-of-three lists; opening on a participial phrase ("Nestled among...").</p>
          <p className="mb-0 small">Bonus, not on Wikipedia's list: "load-bearing," "table stakes," "north star," "circle back." Read new lines aloud; cut anything that could sit in a LinkedIn post.</p>
        </div>
      </div>
    </Section>
  );
}
