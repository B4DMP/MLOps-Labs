import { Icon } from "@iconify/react";
import { HEALTH_BUCKET_WORD, healthBucket, healthBucketColor } from "../../../utils/systemHealth";
import { Empty, Section, StatTile, TileRow } from "../parts";
import type { PatternRef, PipelineStage, ResultsPayload } from "../types";
import HoverTooltip from "../../HoverToolTip";
import styles from "../tabs.module.css";

const STATUS_CHIP: Record<string, { icon: string; chip: string }> = {
  healthy: { icon: "ph:check-circle-bold", chip: styles.chipGood },
  degraded: { icon: "ph:warning-circle-bold", chip: styles.chipWarn },
  broken: { icon: "ph:x-circle-bold", chip: styles.chipBad },
};

const word = (health?: number | null) =>
  health == null ? "unclear" : HEALTH_BUCKET_WORD[healthBucket(health)];

function StageRow({ stage }: { stage: PipelineStage }) {
  if (stage.locked) {
    return (
      <div className={styles.row}>
        <span />
        <div>
          <div className={styles.rowTitle}>{stage.name}</div>
          <div className={styles.rowSub}>The project never got this far.</div>
        </div>
        <span className={`${styles.chip} ${styles.chipNeutral}`}>
          <Icon icon="ph:lock-simple-bold" aria-hidden />
          Not reached
        </span>
      </div>
    );
  }

  const chip = STATUS_CHIP[stage.status ?? "degraded"] ?? STATUS_CHIP.degraded;
  const anti = (stage.patterns ?? []).filter((p) => p.kind === "anti");
  const design = (stage.patterns ?? []).filter((p) => p.kind === "design");
  const notes = [
    stage.debt ? `${stage.debt} technical debt` : null,
    stage.broken ? `${stage.broken} broken` : null,
    stage.starved ? `${stage.starved} starved` : null,
  ].filter(Boolean);

  return (
    <div className={styles.row}>
      <span />
      <div>
        <div className={styles.rowHead}>
          <span className={styles.rowTitle}>{stage.name}</span>
          <HoverTooltip description={word(stage.health)}>
            <span className={styles.trackInline}>
              <span
                className={styles.trackInlineFill}
                style={{
                  width: `${Math.round(Math.max(0, Math.min(100, stage.health ?? 0)))}%`,
                  background: healthBucketColor(healthBucket(stage.health)),
                }}
              />
            </span>
          </HoverTooltip>
        </div>
        {(notes.length > 0 || anti.length > 0 || design.length > 0) && (
          <div className={styles.rowMeta}>
            {notes.length > 0 && <span className={styles.rowSub}>{notes.join(" · ")}</span>}
            {anti.map((p) => (
              <HoverTooltip key={p.id} description="An anti-pattern left in the system">
                <span className={`${styles.chip} ${styles.chipBad}`}>
                  <Icon icon="ph:warning-bold" aria-hidden />
                  {p.name}
                </span>
              </HoverTooltip>
            ))}
            {design.map((p) => (
              <HoverTooltip key={p.id} description="A good practice you put in place">
                <span className={`${styles.chip} ${styles.chipGood}`}>
                  <Icon icon="ph:seal-check-bold" aria-hidden />
                  {p.name}
                </span>
              </HoverTooltip>
            ))}
          </div>
        )}
      </div>
      <span className={`${styles.chip} ${chip.chip}`}>
        <Icon icon={chip.icon} aria-hidden />
        {word(stage.health)}
      </span>
    </div>
  );
}

/** The Performance Dashboard, frozen at the end of the run and read as a list. */
export default function PipelineTab({ results }: { results: ResultsPayload }) {
  const { pipeline, is_spiral } = results;
  const stages = pipeline.stages;
  const reached = pipeline.stages.filter((s) => !s.locked);

  if (reached.length === 0) {
    return <Empty>The pipeline was never built in this run.</Empty>;
  }

  const antiInStages: Array<PatternRef & { stageName: string }> = reached.flatMap((s) =>
    (s.patterns ?? []).filter((p) => p.kind === "anti").map((p) => ({ ...p, stageName: s.name })),
  );
  const stagesWithAnti = new Set(antiInStages.map((p) => p.stageName)).size;

  return (
    <>
      <TileRow>
        <StatTile label="The system as a whole" value={word(pipeline.system_health)} />
        {is_spiral && (
          <StatTile
            label="When you inherited it"
            value={word(pipeline.inherited_system_health)}
            hint="The state of the system this iteration started from"
          />
        )}
        <StatTile label="Stages reached" value={`${reached.length} of ${pipeline.stages.length}`} />
        <StatTile
          label="Anti-patterns left"
          value={stagesWithAnti ? `in ${stagesWithAnti} stage${stagesWithAnti === 1 ? "" : "s"}` : "none"}
        />
      </TileRow>

      {antiInStages.length > 0 && (
        <Section
          title="Anti-patterns left in the system"
          note="These are still active at the end of the run and will carry into the next iteration."
        >
          <div className={styles.patternList}>
            {antiInStages.map((p) => (
              <span key={`${p.stageName}-${p.id}`} className={`${styles.chip} ${styles.chipBad}`}>
                <Icon icon="ph:warning-bold" aria-hidden />
                {p.name} <span className={styles.chipContext}>· {p.stageName}</span>
              </span>
            ))}
          </div>
        </Section>
      )}

      <Section title="Stage by stage" note="Where each stage of the lifecycle stood at the end.">
        <div className={styles.rowList}>
          {stages.map((stage) => (
            <StageRow key={stage.id} stage={stage} />
          ))}
        </div>
      </Section>
    </>
  );
}
