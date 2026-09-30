import { useEffect, useState } from "react";
import { Icon } from "@iconify/react";
import styles from "./Admin.module.css";
import {
  deleteAdminBugReport,
  fetchAdminBugReports,
  type AdminBugReport,
  type BugReportSortKey,
} from "../services/api/admin";
import type { Campaign } from "./Admin";

const COLUMNS: { key: BugReportSortKey; label: string }[] = [
  { key: "time_stamp", label: "Received" },
  { key: "message", label: "Message" },
  { key: "email", label: "Player" },
  { key: "campaign_key", label: "Campaign" },
  { key: "phase", label: "Position" },
];

const CLAMP_3_LINES = {
  display: "-webkit-box",
  WebkitLineClamp: 3,
  WebkitBoxOrient: "vertical" as const,
  overflow: "hidden",
};

function position(report: AdminBugReport): string {
  const { currentPhase, currentChallenge, challengeTitle } = report.debug_info as Record<string, unknown>;
  if (typeof currentPhase !== "number") return "-";
  const where = `Phase ${currentPhase}${typeof currentChallenge === "number" ? ` / Challenge ${currentChallenge}` : ""}`;
  return typeof challengeTitle === "string" && challengeTitle ? `${where} (${challengeTitle})` : where;
}

/** The submitted "Report a Bug" notes, filterable and sortable. Filtering and ordering happen on
 * the server; every change of a control refetches. */
export default function BugReportsAdmin({ campaigns }: { campaigns: Campaign[] }) {
  const [search, setSearch] = useState("");
  const [email, setEmail] = useState("");
  const [campaign, setCampaign] = useState("");
  const [since, setSince] = useState("");
  const [until, setUntil] = useState("");
  const [sort, setSort] = useState<BugReportSortKey>("time_stamp");
  const [order, setOrder] = useState<"asc" | "desc">("desc");

  const [reports, setReports] = useState<AdminBugReport[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  // Typing in the text filters waits a beat, so each keystroke isn't its own request.
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetchAdminBugReports({ search, email, campaign, since, until, sort, order });
        if (!cancelled) {
          setReports(res.reports);
          setTotal(res.total);
        }
      } catch (err: any) {
        if (!cancelled) setError(err.message || "Failed to fetch bug reports.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [search, email, campaign, since, until, sort, order]);

  const handleDelete = async (id: number) => {
    setDeletingId(id);
    setError(null);
    try {
      await deleteAdminBugReport(id);
      setReports((prev) => prev.filter((r) => r.id !== id));
      setTotal((t) => Math.max(0, t - 1));
      setOpenId(null);
    } catch (err: any) {
      setError(err.message || "Failed to delete the bug report.");
    } finally {
      setDeletingId(null);
      setConfirmDeleteId(null);
    }
  };

  const toggleSort = (key: BugReportSortKey) => {
    if (key === sort) {
      setOrder(order === "asc" ? "desc" : "asc");
    } else {
      setSort(key);
      setOrder(key === "time_stamp" ? "desc" : "asc");
    }
  };

  const hasFilters = Boolean(search || email || campaign || since || until);
  const clearFilters = () => {
    setSearch("");
    setEmail("");
    setCampaign("");
    setSince("");
    setUntil("");
  };

  return (
    <div className={styles.cardSurface}>
      <div className={styles.sectionHeader}>
        <div>
          <h5 className="fw-bold mb-1">Bug Reports</h5>
          <p className="text-muted small mb-0">
            {loading ? "Loading..." : `${total} report${total === 1 ? "" : "s"}${hasFilters ? " match the filters" : ""}`}
          </p>
        </div>
      </div>

      <div className="d-flex flex-wrap gap-2 align-items-end mb-3">
        <input
          type="search"
          className="form-control form-control-sm"
          style={{ maxWidth: 240 }}
          placeholder="Search message, URL, player"
          aria-label="Search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <input
          type="search"
          className="form-control form-control-sm"
          style={{ maxWidth: 200 }}
          placeholder="Player email"
          aria-label="Player email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <select
          className="form-select form-select-sm"
          style={{ maxWidth: 200 }}
          aria-label="Campaign"
          value={campaign}
          onChange={(e) => setCampaign(e.target.value)}
        >
          <option value="">All campaigns</option>
          {campaigns.map((c) => (
            <option key={c.key} value={c.key}>{c.name}</option>
          ))}
        </select>
        <label className="small text-muted d-flex align-items-center gap-1">
          From
          <input type="date" className="form-control form-control-sm" value={since} onChange={(e) => setSince(e.target.value)} />
        </label>
        <label className="small text-muted d-flex align-items-center gap-1">
          To
          <input type="date" className="form-control form-control-sm" value={until} onChange={(e) => setUntil(e.target.value)} />
        </label>
        {hasFilters && (
          <button type="button" className="btn btn-sm btn-outline-secondary" onClick={clearFilters}>
            Clear filters
          </button>
        )}
      </div>

      {error && <div className="alert alert-danger py-2 small">{error}</div>}

      <div className="table-responsive">
        <table className="table table-sm align-middle" style={{ tableLayout: "auto" }}>
          <thead>
            <tr>
              {COLUMNS.map((col) => (
                <th key={col.key} scope="col" aria-sort={sort === col.key ? (order === "asc" ? "ascending" : "descending") : "none"}>
                  <button
                    type="button"
                    className="btn btn-link p-0 text-decoration-none fw-bold text-secondary d-inline-flex align-items-center gap-1"
                    onClick={() => toggleSort(col.key)}
                  >
                    {col.label}
                    {sort === col.key && (
                      <Icon icon={order === "asc" ? "ph:caret-up-bold" : "ph:caret-down-bold"} aria-hidden />
                    )}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {reports.length === 0 && !loading && (
              <tr>
                <td colSpan={COLUMNS.length} className="text-muted text-center py-4">
                  {hasFilters ? "No bug reports match these filters." : "No bug reports yet."}
                </td>
              </tr>
            )}
            {reports.flatMap((r) => {
              const isOpen = openId === r.id;
              const rows = [
                <tr key={r.id} style={{ cursor: "pointer" }} onClick={() => setOpenId(isOpen ? null : r.id)}>
                  <td className="text-nowrap">{new Date(r.time_stamp + "Z").toLocaleString()}</td>
                  <td style={{ width: "55%", minWidth: 320 }}>
                    <div style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", ...(isOpen ? {} : CLAMP_3_LINES) }}>
                      {r.message}
                    </div>
                  </td>
                  <td className="small">{r.email}</td>
                  <td className="small">{r.campaign_key}</td>
                  <td className="small">{position(r)}</td>
                </tr>,
              ];
              if (isOpen) {
                rows.push(
                  <tr key={`${r.id}-details`}>
                    <td colSpan={COLUMNS.length} className="bg-light small">
                      <div className="text-muted">Page: {r.page_url || "n/a"}</div>
                      <div className="text-muted">Browser: {r.user_agent || "n/a"}</div>
                      <pre className="mb-2 mt-2">{JSON.stringify(r.debug_info, null, 2)}</pre>
                      {confirmDeleteId === r.id ? (
                        <div className="d-flex align-items-center gap-2">
                          <span className="text-danger fw-semibold">Delete this report permanently?</span>
                          <button
                            type="button"
                            className="btn btn-sm btn-danger"
                            disabled={deletingId === r.id}
                            onClick={() => handleDelete(r.id)}
                          >
                            {deletingId === r.id ? "Deleting..." : "Delete"}
                          </button>
                          <button
                            type="button"
                            className="btn btn-sm btn-outline-secondary"
                            disabled={deletingId === r.id}
                            onClick={() => setConfirmDeleteId(null)}
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="btn btn-sm btn-outline-danger d-inline-flex align-items-center gap-1"
                          onClick={() => setConfirmDeleteId(r.id)}
                        >
                          <Icon icon="ph:trash-bold" aria-hidden />
                          Delete report
                        </button>
                      )}
                    </td>
                  </tr>,
                );
              }
              return rows;
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
