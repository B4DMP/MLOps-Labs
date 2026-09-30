import { useEffect, useState } from "react";
import { Icon } from "@iconify/react";
import styles from "./Admin.module.css";
import { fetchLlmCacheStats, type LlmCacheStats } from "../services/api/admin";

export function formatRate(rate: number | null): string {
  return rate === null ? "-" : `${(rate * 100).toFixed(1)}%`;
}

/** Per-chain LLM prompt caches: how many prompts each holds and how often it is hit. Everything
 * is kept across restarts and dropped when a different build starts. */
export default function LlmCacheAdmin() {
  const [stats, setStats] = useState<LlmCacheStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setStats(await fetchLlmCacheStats());
    } catch (err: any) {
      setError(err.message || "Failed to fetch LLM cache statistics.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  return (
    <div className={styles.cardSurface}>
      <div className={styles.sectionHeader}>
        <div>
          <h5 className="fw-bold mb-1">LLM Cache</h5>
          <p className="text-muted small mb-0">
            {stats
              ? stats.enabled
                ? `${stats.total_entries} cached prompts, ${formatRate(stats.total_hit_rate)} hit rate over ${stats.total_requests} requests (build ${stats.version}, up to ${stats.maxsize} per chain)`
                : "Caching is switched off (LLM_CACHE_ENABLED)"
              : "Loading..."}
          </p>
        </div>
        <button
          type="button"
          className="btn btn-sm btn-outline-secondary d-inline-flex align-items-center gap-1"
          onClick={load}
          disabled={loading}
        >
          <Icon icon="ph:arrow-clockwise-bold" />
          Refresh
        </button>
      </div>

      {error && <div className="alert alert-danger py-2 small">{error}</div>}

      {stats && (
        <div className={`table-responsive ${styles.tableContainer}`}>
          <table className={`table align-middle ${styles.customTable}`}>
            <thead>
              <tr>
                <th>Chain</th>
                <th className="text-end">Cached prompts</th>
                <th className="text-end">Hits</th>
                <th className="text-end">Misses</th>
                <th className="text-end">Hit rate</th>
              </tr>
            </thead>
            <tbody>
              {stats.caches.map((row) => (
                <tr key={row.name}>
                  <td>{row.label}</td>
                  <td className="text-end">{row.entries}</td>
                  <td className="text-end">{row.hits}</td>
                  <td className="text-end">{row.misses}</td>
                  <td className="text-end fw-bold">{formatRate(row.hit_rate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
