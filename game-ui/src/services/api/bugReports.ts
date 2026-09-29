import { csrfHeaders } from "../../utils/csrf";

const API_HOST =
  import.meta.env.VITE_API_HOST ||
  (import.meta.env.MODE === "development"
    ? "localhost:8000"
    : window.location.host);

const PROTOCOL = window.location.protocol === "https:" ? "https:" : "http:";
const BASE_URL = `${PROTOCOL}//${API_HOST}`;

export interface BugReportFields {
  message: string;
  debugInfo: Record<string, unknown>;
}

export async function submitBugReport(fields: BugReportFields): Promise<void> {
  const response = await fetch(`${BASE_URL}/api/bug-reports`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify({
      message: fields.message,
      page_url: window.location.href,
      debug_info: fields.debugInfo,
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || "Could not submit your bug report.");
  }
}
