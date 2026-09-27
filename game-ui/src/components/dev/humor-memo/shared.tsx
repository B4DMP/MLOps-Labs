import type { ReactNode } from "react";
import { slug } from "./slug";
import { highlightStakeholders } from "./highlightStakeholders";

/**
 * Content rule for every file in this folder: a caption is one sentence,
 * the joke's mechanism, not its drafting history. Git log already has the history
 * of what changed and why; repeating it here is what bloated this doc last time.
 *
 * All collapsing here is native <details>/<summary> - no JS, no state.
 */

export function Section({
  id,
  n,
  title,
  lead,
  children,
  defaultOpen = true,
}: {
  id: string;
  n: string;
  title: string;
  lead?: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details id={id} className="mb-5" open={defaultOpen}>
      <summary className="h4 fw-bold mb-2" style={{ cursor: "pointer" }}>
        <span className="badge text-bg-secondary me-2">{n}</span>
        {title}
      </summary>
      {lead && <p className="text-secondary">{lead}</p>}
      {children}
    </details>
  );
}

export function Example({
  kind,
  archetype,
  title,
  source,
  originalLabel = "Original",
  original,
  rewriteLabel = "Rewrite",
  rewrite,
}: {
  kind: "brief" | "artifact";
  archetype: string;
  title: string;
  source: string;
  originalLabel?: string;
  original: string;
  rewriteLabel?: string;
  rewrite: string;
}) {
  const badgeClass = kind === "brief" ? "bg-info" : "bg-success";
  const kindLabel = kind === "brief" ? "Challenge brief" : "Intel artifact";
  return (
    <div className="card mb-3">
      <div className="card-body">
        <a href={`#archetype-${slug(archetype)}`} className={`badge ${badgeClass} mb-2 text-decoration-none`}>
          {kindLabel} &middot; {archetype}
        </a>
        <p className="fw-semibold mb-2">
          {title} <span className="fw-normal text-secondary">&mdash; <code>{source}</code></span>
        </p>
        <div className="row row-cols-1 row-cols-md-2 g-2">
          <div className="col">
            <div className="small text-uppercase text-secondary mb-1">{originalLabel}</div>
            <div className="p-2 bg-body-secondary rounded small text-muted opacity-75">{highlightStakeholders(original)}</div>
          </div>
          <div className="col">
            <div className="small text-uppercase text-secondary mb-1">{rewriteLabel}</div>
            <div className="p-2 bg-body-secondary bg-gradient rounded small ">{highlightStakeholders(rewrite)}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function DialogueExample({
  speaker,
  emotion,
  archetype,
  original,
  rewrite,
}: {
  speaker: string;
  emotion: string;
  archetype: string;
  original: string;
  rewrite: string;
}) {
  return (
    <div className="card mb-3">
      <div className="card-body">
        <a href={`#archetype-${slug(archetype)}`} className="badge bg-warning text-dark mb-2 text-decoration-none">
          Pitch dialogue &middot; {emotion} &middot; {archetype}
        </a>
        <p className="fw-semibold mb-2">{speaker}</p>
        <div className="row row-cols-1 row-cols-md-2 g-2">
          <div className="col">
            <div className="small text-uppercase text-secondary mb-1">Real turn (test-talk session)</div>
            <div className="p-2 bg-body-secondary rounded small text-muted opacity-75">{highlightStakeholders(original)}</div>
          </div>
          <div className="col">
            <div className="small text-uppercase text-secondary mb-1">Candidate</div>
            <div className="p-2 bg-body-secondary bg-gradient rounded small">{highlightStakeholders(rewrite)}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function Collapsible({ label, children }: { label: string; children: ReactNode }) {
  return (
    <details>
      <summary className="btn btn-outline-secondary btn-sm" style={{ cursor: "pointer" }}>{label}</summary>
      <div className="mt-3">{children}</div>
    </details>
  );
}

export function Accordion({ items }: { items: { title: string; body: ReactNode }[] }) {
  return (
    <div className="list-group">
      {items.map((item) => (
        <details key={item.title} className="list-group-item">
          <summary className="fw-bold" style={{ cursor: "pointer" }}>{item.title}</summary>
          <div className="mt-2">{item.body}</div>
        </details>
      ))}
    </div>
  );
}
