import { useEffect, useState } from "react";
import { Icon } from "@iconify/react";
import styles from "./Admin.module.css";
import { fetchLlmTokenUsage, type LlmTokenUsage } from "../services/api/admin";

/** Estimated tokens spent on LLM calls, per campaign. Uses the provider's reported usage and
 * falls back to ~4 characters per token; cached answers are not counted. */
export default function LlmTokenUsageAdmin() {
  const [usage, setUsage] = useState<LlmTokenUsage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setUsage(await fetchLlmTokenUsage());
    } catch (err: any) {
      setError(err.message || "Failed to fetch LLM token usage.");
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
          <h5 className="fw-bold mb-1">LLM Token Usage (est.)</h5>
          <p className="text-muted small mb-0">
            {usage
              ? `${usage.total_tokens.toLocaleString()} tokens over ${usage.total_calls.toLocaleString()} calls, cached answers not counted`
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

      {usage && (
        <div className={`table-responsive ${styles.tableContainer}`}>
          <table className={`table align-middle ${styles.customTable}`}>
            <thead>
              <tr>
                <th>Campaign</th>
                <th className="text-end">Calls</th>
                <th className="text-end">Prompt tokens</th>
                <th className="text-end">Completion tokens</th>
                <th className="text-end">Total tokens</th>
              </tr>
            </thead>
            <tbody>
              {usage.campaigns.map((row) => (
                <tr key={row.campaign_key}>
                  <td>{row.campaign_name}</td>
                  <td className="text-end">{row.calls.toLocaleString()}</td>
                  <td className="text-end">{row.prompt_tokens.toLocaleString()}</td>
                  <td className="text-end">{row.completion_tokens.toLocaleString()}</td>
                  <td className="text-end fw-bold">{row.total_tokens.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
