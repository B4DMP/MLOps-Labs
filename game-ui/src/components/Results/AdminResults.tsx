import { useCallback, useEffect, useState } from "react";
import { Icon } from "@iconify/react";
import {
  fetchAdminPlayerResults,
  fetchAdminResults,
  type AdminResultsRunsMode,
} from "../../services/api/admin";
import { BarRow, Empty, Section, StatTile, TileRow } from "./parts";
import ResultsHero from "./ResultsHero";
import ResultsTabs from "./ResultsTabs";
import type { AdminPlayerResults, AdminResultsData, Stats } from "./adminTypes";
import { prettify } from "./palette";
import { PILLAR_LABEL, type GradeLetter, type PillarId } from "./types";
import type { MetricInfo } from "./tabs/MetricsTab";
import tabStyles from "./tabs.module.css";
import styles from "./AdminResults.module.css";

const GRADES: GradeLetter[] = ["S", "A", "B", "C", "D", "E"];
const PILLARS: PillarId[] = ["pipeline_health", "stakeholder_relations", "intel_accuracy", "decision_quality"];

/** A share, or "n/a" when nothing was measured: absent is not zero. */
const share = (value: number | null | undefined) =>
  value == null ? "n/a" : `${Math.round(value * 100)}%`;

/** A questionnaire percentage, which the API already returns on a 0..100 scale. */
const percentValue = (value: number | null | undefined) => (value == null ? "n/a" : `${Math.round(value)}%`);

const spread = (stats: Stats) =>
  stats.stdev == null ? "n/a" : `±${Math.round(stats.stdev * 100)}`;

export interface AdminResultsProps {
  adminToken: string;
  campaigns: Array<{ name: string; key: string }>;
  /** Names and colours for the metric gauges in a drilled-down run. Falls back to the ids. */
  metricInfo?: Record<string, MetricInfo>;
}

/**
 * The admin Results page: how finished games went across a campaign, and each player's own results.
 *
 * Only each player's first run counts toward the aggregates unless asked otherwise, and accounts
 * that used a playtest tool are left out, with the number left out shown rather than hidden. Those
 * are the defaults a study can stand behind; both can be switched off to look at replays or at the
 * playtest runs themselves.
 */
export default function AdminResults({ adminToken, campaigns, metricInfo = {} }: AdminResultsProps) {
  const [campaign, setCampaign] = useState("all");
  const [runs, setRuns] = useState<AdminResultsRunsMode>("first");
  const [includePlaytest, setIncludePlaytest] = useState(false);
  const [data, setData] = useState<AdminResultsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [selected, setSelected] = useState<{ player: string; run: number } | null>(null);
  const [detail, setDetail] = useState<AdminPlayerResults | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await fetchAdminResults(adminToken, { campaign, runs, includePlaytest }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch results.");
    } finally {
      setLoading(false);
    }
  }, [adminToken, campaign, runs, includePlaytest]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    setDetailError(null);
    fetchAdminPlayerResults(adminToken, selected.player, selected.run)
      .then((result) => {
        if (!cancelled) setDetail(result);
      })
      .catch((e) => {
        if (!cancelled) setDetailError(e instanceof Error ? e.message : "Failed to fetch that player's results.");
      });
    return () => {
      cancelled = true;
    };
  }, [adminToken, selected]);

  const agg = data?.aggregates;

  return (
    <div className={styles.page}>
      <div className={styles.filters}>
        <label className={styles.filter}>
          <span>Campaign</span>
          <select value={campaign} onChange={(e) => setCampaign(e.target.value)} className="form-select form-select-sm">
            <option value="all">All campaigns</option>
            {campaigns.map((c) => (
              <option key={c.key} value={c.key}>
                {c.name}
              </option>
            ))}
          </select>
        </label>

        <div className={styles.filter} role="group" aria-label="Which runs count">
          <span>Runs counted</span>
          <div className={styles.segment}>
            <button type="button" aria-pressed={runs === "first"} onClick={() => setRuns("first")}>
              First runs only
            </button>
            <button type="button" aria-pressed={runs === "all"} onClick={() => setRuns("all")}>
              All runs
            </button>
          </div>
        </div>

        <label className={styles.check}>
          <input
            type="checkbox"
            checked={includePlaytest}
            onChange={(e) => setIncludePlaytest(e.target.checked)}
          />
          Include playtest accounts
        </label>
      </div>

      {data && !includePlaytest && data.excluded_playtest_accounts > 0 && (
        <p className={styles.notice} role="note">
          <Icon icon="ph:flask-bold" aria-hidden />
          {data.excluded_playtest_accounts} playtest account{data.excluded_playtest_accounts === 1 ? "" : "s"} left
          out of every number below.
        </p>
      )}
      {data && data.unreadable_runs > 0 && (
        <p className={styles.notice} role="alert">
          <Icon icon="ph:warning-circle-bold" aria-hidden />
          {data.unreadable_runs} run{data.unreadable_runs === 1 ? "" : "s"} could not be read and{" "}
          {data.unreadable_runs === 1 ? "is" : "are"} missing from these numbers.
        </p>
      )}
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {loading && !data && <Empty>Loading results...</Empty>}

      {agg && agg.runs === 0 && !loading && (
        <Empty>No finished games yet for these filters. Results appear once a player completes a run.</Empty>
      )}

      {agg && agg.runs > 0 && (
        <>
          <TileRow>
            <StatTile label="Finished runs" value={agg.runs} />
            <StatTile label="Mean overall" value={share(agg.overall.mean)} hint={`Spread ${spread(agg.overall)} points`} />
            <StatTile label="Next iterations" value={agg.spiral_runs} hint="Runs that continued a previous system" />
            <StatTile
              label="Knowledge change"
              value={agg.knowledge.delta_percent.mean == null ? "n/a" : `${agg.knowledge.delta_percent.mean > 0 ? "+" : ""}${Math.round(agg.knowledge.delta_percent.mean)}%`}
              hint={`Measured for ${agg.knowledge.delta.n} run${agg.knowledge.delta.n === 1 ? "" : "s"}`}
            />
          </TileRow>

          <Section title="Grades" note="How many finished runs earned each grade.">
            {GRADES.map((grade) => (
              <BarRow
                key={grade}
                label={`Grade ${grade}`}
                ratio={agg.runs ? agg.grades[grade] / agg.runs : 0}
                value={agg.grades[grade]}
              />
            ))}
          </Section>

          <Section title="The four pillars" note="Mean score with its spread across runs. A blank spread means only one run.">
            <div className={tabStyles.tableWrap}>
              <table className={tabStyles.dataTable}>
                <thead>
                  <tr>
                    <th scope="col">Pillar</th>
                    <th scope="col">Runs</th>
                    <th scope="col">Mean</th>
                    <th scope="col">Spread</th>
                    <th scope="col">Range</th>
                  </tr>
                </thead>
                <tbody>
                  {PILLARS.map((id) => {
                    const s = agg.pillars[id];
                    return (
                      <tr key={id}>
                        <td>{PILLAR_LABEL[id]}</td>
                        <td>{s.n}</td>
                        <td>{share(s.mean)}</td>
                        <td>{spread(s)}</td>
                        <td>{s.min == null ? "n/a" : `${share(s.min)} to ${share(s.max)}`}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Section>

          <Section title="How proposals fared">
            <TileRow>
              <StatTile label="Passed" value={agg.outcomes.PASS} />
              <StatTile label="With reservations" value={agg.outcomes.SOFT_PASS} />
              <StatTile label="Vetoed" value={agg.outcomes.VETO} />
              <StatTile label="Unfinished" value={agg.outcomes.unfinished} hint="Challenges that never reached a commit" />
            </TileRow>
            {agg.hardest_challenges.length > 0 ? (
              <div className={tabStyles.tableWrap}>
                <table className={tabStyles.dataTable}>
                  <thead>
                    <tr>
                      <th scope="col">Most vetoed challenge</th>
                      <th scope="col">Played</th>
                      <th scope="col">Vetoed</th>
                      <th scope="col">Veto rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {agg.hardest_challenges.map((row) => (
                      <tr key={row.name}>
                        <td>{row.name}</td>
                        <td>{row.played}</td>
                        <td>{row.vetoes}</td>
                        <td>{share(row.veto_rate)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty>No proposal was vetoed.</Empty>
            )}
          </Section>

          <Section title="Intel" note="How much players found and how often they read it right.">
            <TileRow>
              <StatTile label="Mean accuracy" value={share(agg.intel.accuracy.mean)} hint="Of the notes tagged, how many were right" />
              <StatTile label="Mean coverage" value={share(agg.intel.coverage.mean)} hint="Of the notes available, how many were found" />
            </TileRow>
            {Object.entries(agg.intel.coverage_by_stakeholder).map(([id, stats]) => (
              <BarRow key={id} label={prettify(id)} ratio={stats.mean ?? 0} value={share(stats.mean)} />
            ))}
            <div className={styles.itemColumns}>
              <ItemList title="Most often found" items={data?.intel_items.most_gathered ?? []} />
              <ItemList title="Most often missed" items={data?.intel_items.least_gathered ?? []} />
            </div>
          </Section>

          <Section title="Knowledge" note="The same questions before and after, as percentages of correct answers.">
            <TileRow>
              <StatTile label="Before" value={percentValue(agg.knowledge.intro_percent.mean)} />
              <StatTile label="After (latest run)" value={percentValue(agg.knowledge.latest_outro_percent.mean)} />
            </TileRow>
            {Object.entries(agg.knowledge.outro_percent_by_run).map(([run, stats]) => (
              <BarRow
                key={run}
                label={`After run ${run}`}
                ratio={(stats.mean ?? 0) / 100}
                value={`${percentValue(stats.mean)} (${stats.n})`}
              />
            ))}
          </Section>
        </>
      )}

      {data && data.players.length > 0 && (
        <Section title="Players" note="Pick a run to see exactly what that player saw.">
          <div className={tabStyles.tableWrap}>
            <table className={tabStyles.dataTable}>
              <thead>
                <tr>
                  <th scope="col">Player</th>
                  <th scope="col">Campaign</th>
                  <th scope="col">Runs</th>
                </tr>
              </thead>
              <tbody>
                {data.players.map((player) => (
                  <tr key={player.name}>
                    <td>
                      {player.name}
                      {player.playtest_tainted && (
                        <span className={`${tabStyles.chip} ${tabStyles.chipWarn} ${styles.inlineChip}`}>
                          <Icon icon="ph:flask-bold" aria-hidden />
                          Playtest
                        </span>
                      )}
                    </td>
                    <td>{player.campaign_key}</td>
                    <td>
                      <div className={styles.runButtons}>
                        {player.runs.map((run) => {
                          const active = selected?.player === player.name && selected.run === run.run_index;
                          return (
                            <button
                              key={run.run_index}
                              type="button"
                              aria-pressed={active}
                              className={`${styles.runButton} ${active ? styles.runButtonActive : ""}`}
                              onClick={() => setSelected({ player: player.name, run: run.run_index })}
                              title={`Run ${run.run_index}${run.is_spiral ? " (next iteration)" : ""}: ${share(run.overall)} overall`}
                            >
                              Run {run.run_index}: {run.grade}
                              {run.is_spiral && <Icon icon="ph:arrows-clockwise-bold" aria-label="next iteration" />}
                            </button>
                          );
                        })}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {detailError && (
        <p className={styles.error} role="alert">
          {detailError}
        </p>
      )}
      {detail && selected && (
        <div className={styles.detail} aria-live="polite">
          <h3 className={styles.detailTitle}>
            {detail.player}, run {detail.run_index}
          </h3>
          <ResultsHero results={detail.results} playtest={detail.playtest_tainted} />
          <ResultsTabs
            key={`${detail.player}-${detail.run_index}`}
            results={detail.results}
            metricInfo={metricInfo}
          />
        </div>
      )}
    </div>
  );
}

function ItemList({ title, items }: { title: string; items: AdminResultsData["intel_items"]["most_gathered"] }) {
  return (
    <div>
      <h4 className={tabStyles.chartTitle}>{title}</h4>
      {items.length === 0 ? (
        <Empty>Nothing to rank yet.</Empty>
      ) : (
        <ol className={styles.itemList}>
          {items.map((item) => (
            <li key={item.id}>
              <span className={styles.itemText}>{item.text}</span>
              <span className={styles.itemMeta}>
                {item.stakeholder}, {item.challenge}: found in {item.gathered} of {item.dealt} ({share(item.rate)})
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
