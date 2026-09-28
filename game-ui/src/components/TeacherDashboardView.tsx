import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@iconify/react";
import styles from "./Admin.module.css";
import type { TeacherDashboardData, TeacherPlayerRow } from "../services/api/teacher";

export interface TeacherDashboardViewProps {
  /** "all" means every campaign currently in scope (a teacher's assignment, or whatever the
   * admin preview picked); anything else narrows to that one campaign key. */
  fetchData: (campaignFilter: string) => Promise<TeacherDashboardData>;
  pollMs?: number;
  /** Called when a poll comes back 401 (the session cookie expired) - only meaningful for the
   * standalone teacher page, which needs to bounce back to login. */
  onAuthFailure?: () => void;
}

const DEFAULT_POLL_MS = 5000;

type SortField =
  | "name"
  | "email"
  | "campaign_name"
  | "progression"
  | "introPercentage"
  | "outroPercentage"
  | "playTime"
  | "lastActive"
  | "runs";
type SortDirection = "asc" | "desc";

function formatRelativeTime(iso: string | null): string {
  if (!iso) return "Never";
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/** A single number that ranks "how far along" a player is: the coarse stage (progressIndex)
 * dominates, phase/challenge only break ties within the same stage. */
function progressionRank(p: TeacherPlayerRow): number {
  return p.progressIndex * 1_000_000 + p.phaseIndex * 1_000 + p.challengeNumber;
}

function sortValue(p: TeacherPlayerRow, field: SortField): string | number {
  switch (field) {
    case "name":
      return p.name.toLowerCase();
    case "email":
      return p.email.toLowerCase();
    case "campaign_name":
      return p.campaign_name.toLowerCase();
    case "progression":
      return progressionRank(p);
    case "introPercentage":
      return p.introPercentage;
    case "outroPercentage":
      return p.outroPercentage;
    case "playTime":
      return p.playTimeMinutes;
    case "lastActive":
      return p.lastActive ? new Date(p.lastActive).getTime() : -Infinity;
    case "runs":
      return p.runs;
  }
}

function SortableHeader({
  field,
  label,
  sortField,
  sortDirection,
  onSort,
}: {
  field: SortField;
  label: string;
  sortField: SortField;
  sortDirection: SortDirection;
  onSort: (field: SortField) => void;
}) {
  return (
    <th style={{ cursor: "pointer" }} onClick={() => onSort(field)}>
      <div className="d-flex align-items-center gap-1">
        <span>{label}</span>
        {sortField === field && (
          <Icon icon={sortDirection === "asc" ? "ph:caret-up-bold" : "ph:caret-down-bold"} />
        )}
      </div>
    </th>
  );
}

export function TeacherDashboardView({
  fetchData,
  pollMs = DEFAULT_POLL_MS,
  onAuthFailure,
}: TeacherDashboardViewProps) {
  const [data, setData] = useState<TeacherDashboardData | null>(null);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [campaignFilter, setCampaignFilter] = useState("all");
  // Progression defaults to farthest-along on top; every other column defaults to ascending,
  // same convention as the admin panel's own player table (Admin.tsx's handleSort).
  const [sortField, setSortField] = useState<SortField>("progression");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const intervalRef = useRef<number | null>(null);

  const load = async (showSpinner: boolean) => {
    if (showSpinner) setIsLoading(true);
    try {
      const result = await fetchData(campaignFilter);
      setData(result);
      setError("");
    } catch (err: any) {
      if (err?.status === 401 && onAuthFailure) {
        onAuthFailure();
        return;
      }
      setError(err.message || "Failed to load monitoring data.");
    } finally {
      if (showSpinner) setIsLoading(false);
    }
  };

  useEffect(() => {
    load(true);
    intervalRef.current = window.setInterval(() => load(false), pollMs);
    return () => {
      if (intervalRef.current !== null) window.clearInterval(intervalRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignFilter, pollMs]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDirection(field === "progression" ? "desc" : "asc");
    }
  };

  const players = data?.players ?? [];
  const sortedPlayers = useMemo(() => {
    return [...players].sort((a, b) => {
      const valA = sortValue(a, sortField);
      const valB = sortValue(b, sortField);
      if (typeof valA === "string" && typeof valB === "string") {
        const comp = valA.localeCompare(valB);
        return sortDirection === "asc" ? comp : -comp;
      }
      if (valA < valB) return sortDirection === "asc" ? -1 : 1;
      if (valA > valB) return sortDirection === "asc" ? 1 : -1;
      return 0;
    });
  }, [players, sortField, sortDirection]);

  return (
    <div className="d-flex flex-column gap-4">
      <div className={styles.kpiGrid}>
        <div className={styles.kpiCard}>
          <div className={styles.kpiHeader}>
            <span className={styles.kpiLabel}>Players Monitored</span>
            <Icon icon="ph:users-three-bold" className={styles.kpiIcon} />
          </div>
          <div className={styles.kpiValue}>{data?.total_player_amount ?? 0}</div>
        </div>
        <div className={styles.kpiCard}>
          <div className={styles.kpiHeader}>
            <span className={styles.kpiLabel}>Completed</span>
            <Icon icon="ph:check-circle-bold" className={styles.kpiIcon} />
          </div>
          <div className={styles.kpiValue}>{data?.finished_player_amount ?? 0}</div>
        </div>
        <div className={styles.kpiCard}>
          <div className={styles.kpiHeader}>
            <span className={styles.kpiLabel}>Campaigns</span>
            <Icon icon="ph:flag-banner-bold" className={styles.kpiIcon} />
          </div>
          <div className={styles.kpiValue}>{data?.campaigns.length ?? 0}</div>
        </div>
      </div>

      <div className={styles.cardSurface}>
        <div className={styles.sectionHeader}>
          <div>
            <h2 className={styles.sectionTitle}>
              <Icon icon="ph:eye-bold" />
              <span>Live Player Monitoring</span>
            </h2>
            <p className={styles.sectionSubtitle}>
              Refreshes automatically every {Math.round(pollMs / 1000)}s. Click a column to sort.
            </p>
          </div>
          <div className="d-flex align-items-center gap-2">
            {(data?.campaigns.length ?? 0) > 1 && (
              <select
                className="form-select form-select-sm"
                style={{ width: "auto" }}
                value={campaignFilter}
                onChange={(e) => setCampaignFilter(e.target.value)}
              >
                <option value="all">All monitored campaigns</option>
                {data?.campaigns.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.name}
                  </option>
                ))}
              </select>
            )}
            <button
              type="button"
              className={styles.outlineButton}
              onClick={() => load(true)}
              disabled={isLoading}
              title="Refresh now"
            >
              <Icon
                icon={isLoading ? "ph:spinner-bold" : "ph:arrows-clockwise-bold"}
                className={isLoading ? styles.spinner : ""}
              />
              <span>Refresh</span>
            </button>
          </div>
        </div>

        {error && (
          <div className="alert alert-danger py-2 px-3 mb-3" role="alert">
            {error}
          </div>
        )}

        <div className={`table-responsive ${styles.tableContainer}`}>
          <table className={`table align-middle ${styles.customTable}`}>
            <thead>
              <tr>
                <SortableHeader field="name" label="Player" sortField={sortField} sortDirection={sortDirection} onSort={handleSort} />
                <SortableHeader field="email" label="Email" sortField={sortField} sortDirection={sortDirection} onSort={handleSort} />
                <SortableHeader field="campaign_name" label="Campaign" sortField={sortField} sortDirection={sortDirection} onSort={handleSort} />
                <SortableHeader field="progression" label="Progression" sortField={sortField} sortDirection={sortDirection} onSort={handleSort} />
                <SortableHeader field="introPercentage" label="Intro Score" sortField={sortField} sortDirection={sortDirection} onSort={handleSort} />
                <SortableHeader field="outroPercentage" label="Outro Score" sortField={sortField} sortDirection={sortDirection} onSort={handleSort} />
                <SortableHeader field="playTime" label="Play Time" sortField={sortField} sortDirection={sortDirection} onSort={handleSort} />
                <SortableHeader field="lastActive" label="Last Active" sortField={sortField} sortDirection={sortDirection} onSort={handleSort} />
                <SortableHeader field="runs" label="Runs" sortField={sortField} sortDirection={sortDirection} onSort={handleSort} />
              </tr>
            </thead>
            <tbody>
              {sortedPlayers.length > 0 ? (
                sortedPlayers.map((p) => {
                  const isDone = p.progressIndex >= 4;
                  return (
                    <tr key={p.name}>
                      <td>
                        <div className="d-flex align-items-center gap-2">
                          <Icon icon="ph:user-circle-bold" className="text-secondary fs-5" />
                          <span className="fw-bold">{p.name}</span>
                          {p.playtestTainted && (
                            <span
                              className="badge bg-secondary-subtle text-secondary border border-secondary-subtle px-2 py-1"
                              title="This account used a playtest tool - its data is not research-clean."
                            >
                              Playtest
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="text-muted">{p.email || "—"}</td>
                      <td>
                        <span className={`${styles.pillBadge} ${styles.badgeNeutral}`}>
                          {p.campaign_name || "Unassigned"}
                        </span>
                      </td>
                      <td>
                        <span className={`${styles.pillBadge} ${isDone ? styles.badgeSuccess : styles.badgeNeutral}`}>
                          {isDone && <Icon icon="ph:check-circle-bold" />}
                          {p.gameProgression}
                        </span>
                      </td>
                      <td>
                        <span className="fw-semibold">{p.useQuestionnaire ? `${p.introPercentage}%` : "—"}</span>
                      </td>
                      <td>
                        <span className="fw-semibold">{p.useQuestionnaire ? `${p.outroPercentage}%` : "—"}</span>
                      </td>
                      <td className="text-muted font-monospace small">{p.playTime}</td>
                      <td className="text-muted">{formatRelativeTime(p.lastActive)}</td>
                      <td>{p.runs}</td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={9} className="text-center py-4 text-muted">
                    {isLoading ? "Loading..." : "No players in the monitored campaigns yet."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
