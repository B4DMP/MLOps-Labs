import { BarRow, Empty, Section, StatTile, TileRow } from "../parts";
import type { ResultsPayload } from "../types";

/**
 * What the player learned, as numbers only (D3).
 *
 * The screen says *that* they moved, never which questions were answered how. Handing back an
 * answer key would spoil a second run and contaminate the instrument for everyone after them.
 */
export default function KnowledgeTab({ results }: { results: ResultsPayload }) {
  const { knowledge } = results;
  const measured = knowledge.outro_per_run.filter((r) => r.correct !== null);

  // A campaign with the questionnaire off has not measured anyone. That is not the same as the
  // player scoring nothing, so say so instead of showing zeros.
  if (knowledge.intro.correct === null || measured.length === 0) {
    return (
      <Empty>
        Your knowledge was not measured in this run, so there is no before and after to show.
      </Empty>
    );
  }

  const latest = measured[measured.length - 1];
  const delta = knowledge.delta ?? 0;
  const deltaPercent = knowledge.delta_percent ?? 0;
  const signed = (value: number) => `${value > 0 ? "+" : ""}${value}`;

  return (
    <>
      <TileRow>
        <StatTile
          label="Before"
          value={`${knowledge.intro.correct} of ${knowledge.total_questions}`}
          hint="Knowledge questions answered correctly before you played"
        />
        <StatTile
          label="After"
          value={`${latest.correct} of ${knowledge.total_questions}`}
          hint="The same questions, after playing"
        />
        <StatTile
          label="Change"
          value={delta === 0 ? "no change" : `${signed(delta)} (${signed(deltaPercent)}%)`}
        />
      </TileRow>

      <Section
        title="Across your runs"
        note="The same questions each time. Each run you finish adds another point."
      >
        <BarRow
          label="Before playing"
          ratio={(knowledge.intro.percent ?? 0) / 100}
          value={`${knowledge.intro.percent}%`}
        />
        {measured.map((entry) => (
          <BarRow
            key={entry.run}
            label={`After run ${entry.run}`}
            ratio={(entry.percent ?? 0) / 100}
            value={`${entry.percent}%`}
          />
        ))}
      </Section>
    </>
  );
}
