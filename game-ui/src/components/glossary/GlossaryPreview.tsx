import { useMemo, useState } from "react";
import { Icon } from "@iconify/react";
import styles from "./Glossary.module.css";
import GlossaryProvider from "./GlossaryProvider";
import GlossaryText from "./GlossaryText";
import type { GlossaryConfig } from "../../services/api/glossary";

/** A line of game text with enough MLOps vocabulary in it to exercise most categories. */
const DEFAULT_SAMPLE =
  "Data drift in the live feature distribution is degrading model accuracy, so the team wants " +
  "continuous training wired into the CI/CD pipeline. Reliability warns that retraining without " +
  "root cause analysis locks in whatever went wrong, and that the latency SLA is a hard constraint.";

interface GlossaryPreviewProps {
  /** The draft being edited, including unsaved changes. */
  config: any;
}

interface PreviewIssue {
  text: string;
}

/**
 * Live preview of the glossary inside the admin config editor.
 *
 * Two jobs: show the editor what a highlighted sentence actually looks like before they save,
 * and surface the mistakes JSON Schema cannot catch, such as two terms claiming the same
 * surface form, where whichever one sorts first silently wins every match.
 */
export default function GlossaryPreview({ config }: GlossaryPreviewProps) {
  const [sample, setSample] = useState(DEFAULT_SAMPLE);

  const terms = Array.isArray(config?.terms) ? config.terms : [];
  const categories = Array.isArray(config?.categories) ? config.categories : [];

  const { issues, formCount, activeCount } = useMemo(() => {
    const found: PreviewIssue[] = [];
    const categoryIds = new Set(categories.map((c: any) => c?.id));
    const seenIds = new Map<string, number>();
    const seenForms = new Map<string, string[]>();
    let forms = 0;
    let active = 0;

    for (const term of terms) {
      if (!term) continue;
      seenIds.set(term.id, (seenIds.get(term.id) ?? 0) + 1);
      if (!term.disabled) active += 1;

      if (!term.definition) {
        found.push({ text: `"${term.term || term.id}" has no definition, so its hover card would be empty.` });
      }
      if (categoryIds.size > 0 && !categoryIds.has(term.category)) {
        found.push({ text: `"${term.term || term.id}" uses category "${term.category}", which is not defined.` });
      }

      for (const form of [term.term, ...(term.aliases || [])]) {
        const key = String(form || "").trim().toLowerCase();
        if (!key) continue;
        forms += 1;
        seenForms.set(key, [...(seenForms.get(key) ?? []), term.id]);
      }
    }

    for (const [id, count] of seenIds) {
      if (count > 1) found.push({ text: `Term id "${id}" is used ${count} times; only the first is kept.` });
    }
    for (const [form, owners] of seenForms) {
      if (owners.length > 1) {
        found.push({ text: `"${form}" is claimed by ${owners.join(", ")}; only one of them will ever match.` });
      }
    }

    return { issues: found, formCount: forms, activeCount: active };
  }, [terms, categories]);

  const enabledSurfaces = Object.entries(config?.settings?.surfaces || {})
    .filter(([, on]) => on)
    .map(([name]) => name);

  return (
    <div className={styles.previewPanel}>
      <div className={styles.previewHeader}>
        <span className={styles.previewTitle}>
          <Icon icon="ph:highlighter-circle-bold" /> Glossary Highlighting Preview
        </span>
        <div className={styles.previewStats}>
          <span className={styles.previewStat}>{activeCount} active terms</span>
          <span className={styles.previewStat}>{formCount} spellings matched</span>
          <span className={styles.previewStat}>{categories.length} categories</span>
          <span className={styles.previewStat}>{enabledSurfaces.length} surfaces on</span>
          {config?.settings?.enabled === false && (
            <span className={`${styles.previewStat} ${styles.previewStatWarn}`}>highlighting disabled</span>
          )}
          {issues.length > 0 && (
            <span className={`${styles.previewStat} ${styles.previewStatWarn}`}>{issues.length} issues</span>
          )}
        </div>
      </div>

      <div className={styles.previewSampleLabel}>Sample game text</div>
      <textarea
        className={styles.previewSample}
        value={sample}
        onChange={(e) => setSample(e.target.value)}
        spellCheck={false}
      />

      {/* The preview provider takes the draft directly, so unsaved edits show up immediately.
          intel_notes is forced on here regardless of the surface toggles: this panel is about
          the terms themselves, and it would be confusing for the preview to go blank because
          one unrelated surface was switched off. */}
      <GlossaryProvider
        overrideConfig={
          {
            ...config,
            settings: {
              ...(config?.settings || {}),
              enabled: true,
              surfaces: { ...(config?.settings?.surfaces || {}), intel_notes: true },
            },
          } as GlossaryConfig
        }
      >
        <div className={styles.previewRendered}>
          <GlossaryText text={sample} surface="intel_notes" />
        </div>
      </GlossaryProvider>

      <div className={styles.previewHint}>
        Hover a highlighted term to see the card players will see. The preview always renders as
        if highlighting were on; the surface switches above decide where it actually appears in game.
      </div>

      {issues.length > 0 && (
        <div className={styles.previewIssues}>
          <strong>Problems that would silently change behaviour:</strong>
          <ul>
            {issues.slice(0, 12).map((issue, idx) => (
              <li key={idx}>{issue.text}</li>
            ))}
          </ul>
          {issues.length > 12 && <div>…and {issues.length - 12} more.</div>}
        </div>
      )}
    </div>
  );
}
