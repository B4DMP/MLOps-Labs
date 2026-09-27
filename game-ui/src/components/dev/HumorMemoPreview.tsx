import Audit from "./humor-memo/Audit";
import Research from "./humor-memo/Research";
import Voice from "./humor-memo/Voice";
import Techniques from "./humor-memo/Techniques";
import WorkedExamples from "./humor-memo/WorkedExamples";
import Process from "./humor-memo/Process";
import Scale from "./humor-memo/Scale";
import Slop from "./humor-memo/Slop";
import Guardrails from "./humor-memo/Guardrails";
import Correction from "./humor-memo/Correction";
import Pilot from "./humor-memo/Pilot";
import Sources from "./humor-memo/Sources";

/**
 * Design memo: where Shelfcast's prose could be funnier, at `?dev=humor-memo`.
 * Lives in-app (not a static file) so it stays next to the code it's about,
 * hot-reloads on edit, and uses the app's own Bootswatch styling for free.
 *
 * Content rule: every caption/note is one sentence on the joke's mechanism.
 * Git history is where "what changed and why" belongs - don't re-narrate
 * prior drafts here, that's what bloated this doc before it moved in-app.
 */
const NAV: { href: string; label: string }[] = [
  { href: "#audit", label: "01 · Audit" },
  { href: "#research", label: "02 · Research" },
  { href: "#voice", label: "03 · Voice model" },
  { href: "#techniques", label: "04 · Techniques" },
  { href: "#worked", label: "05 · Worked examples" },
  { href: "#process", label: "06 · Production process" },
  { href: "#scale", label: "07 · Scaling pipeline" },
  { href: "#slop", label: "08 · Words to avoid" },
  { href: "#guardrails", label: "09 · Guardrails" },
  { href: "#correction", label: "10 · Playtest lessons" },
  { href: "#pilot", label: "11 · Pilot" },
];

export default function HumorMemoPreview() {
  return (
    <div data-bs-theme="dark" className="min-vh-100 bg-body text-body">
      <div className="container py-5">
        <header className="pb-4 mb-4 border-bottom">
          <div className="text-uppercase small text-secondary fw-semibold mb-2">Design Brainstorm &mdash; Tone &amp; Voice</div>
          <h1 className="fw-bold">Where Shelfcast could be funnier</h1>
          <p className="lead">A short audit, a voice model, six techniques, and tested rewrites.</p>
        </header>

        <nav className="d-flex flex-wrap gap-2 mb-5">
          {NAV.map((item) => (
            <a key={item.href} className="btn btn-outline-secondary btn-sm" href={item.href}>{item.label}</a>
          ))}
        </nav>

        <Audit />
        <Research />
        <Voice />
        <Techniques />
        <WorkedExamples />
        <Process />
        <Scale />
        <Slop />
        <Guardrails />
        <Correction />
        <Pilot />
        <Sources />
      </div>
    </div>
  );
}
