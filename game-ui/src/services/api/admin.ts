import type { GraphDebugPayload } from "../../components/GraphDebug";
import { csrfHeaders } from "../../utils/csrf";

const API_HOST =
  import.meta.env.VITE_API_HOST ||
  (import.meta.env.MODE === "development"
    ? "localhost:8000"
    : window.location.host);

const PROTOCOL = window.location.protocol === "https:" ? "https:" : "http:";
const BASE_URL = `${PROTOCOL}//${API_HOST}`;

import type { AdminResultsData, AdminPlayerResults } from "../../components/Results/adminTypes";
import type { TeacherDashboardData } from "./teacher";

export interface AdminDashboardData {
  type: "admin_data_update";
  campaigns: any[];
  players: any[];
  total_player_amount: number;
  finished_player_amount: number;
  metric_sum_per_challenge: number[];
  metric_sum_per_challenge_increase: number[];
  intro_questionaire_average: number;
  outro_questionaire_average: number;
  questionaire_results: any;
}

// Every call below authenticates via the httpOnly `mlops_admin` cookie (`credentials:
// "include"`), never a token the JS holds - docs/plans/session-persistence-and-url-routing.md,
// D-cookies. Mutating calls (POST/PATCH/DELETE) also attach the CSRF header (D-csrf); plain GETs
// don't need it.

export async function fetchAdminDashboard(campaign?: string): Promise<AdminDashboardData> {
  const queryParam = campaign && campaign !== "all" ? `?campaign=${encodeURIComponent(campaign)}` : "";
  const response = await fetch(`${BASE_URL}/api/admin/dashboard${queryParam}`, {
    method: "GET",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || "Failed to fetch admin dashboard data.");
  }

  return response.json();
}

export async function addAdminCampaign(
  newCampaignName: string,
  newCampaignKey: string,
  isActive: boolean = true,
  useQuestionnaire: boolean = true,
  isTestCampaign: boolean = false,
  requireEmailVerification: boolean = true,
  isBotCampaign: boolean = false
): Promise<AdminDashboardData> {
  const response = await fetch(`${BASE_URL}/api/admin/campaigns`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify({
      new_campaign_name: newCampaignName,
      new_campaign_key: newCampaignKey,
      is_active: isActive,
      use_questionnaire: useQuestionnaire,
      is_test_campaign: isTestCampaign,
      is_bot_campaign: isBotCampaign,
      require_email_verification: requireEmailVerification,
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || "Failed to add campaign.");
  }

  return response.json();
}

export async function updateAdminCampaign(
  campaignKey: string,
  updates: {
    is_active?: boolean;
    use_questionnaire?: boolean;
    allow_replay?: boolean;
    campaign_name?: string;
    is_test_campaign?: boolean;
    is_bot_campaign?: boolean;
    require_email_verification?: boolean;
    intro_phase_enabled?: boolean;
    /** "mistral" | "westai" | "groq" pins the campaign to that provider; "default" clears the
     * override back to the server-wide Mistral -> WestAI -> Groq priority. */
    llm_provider?: string;
  }
): Promise<AdminDashboardData> {
  const response = await fetch(`${BASE_URL}/api/admin/campaigns/${encodeURIComponent(campaignKey)}`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify(updates),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || "Failed to update campaign.");
  }

  return response.json();
}

export type AdminResultsRunsMode = "first" | "all";

export interface AdminResultsQuery {
  campaign?: string;
  /** Include accounts that used the playtest tools. Off by default: they are not research data. */
  includePlaytest?: boolean;
  /** Only each player's first run counts by default; "all" includes replays. */
  runs?: AdminResultsRunsMode;
}

async function adminGet<T>(path: string, failure: string): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: "GET",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
  });
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || failure);
  }
  return response.json();
}

export function fetchAdminResults(query: AdminResultsQuery = {}): Promise<AdminResultsData> {
  const params = new URLSearchParams();
  if (query.campaign && query.campaign !== "all") params.set("campaign", query.campaign);
  if (query.includePlaytest) params.set("include_playtest", "true");
  if (query.runs) params.set("runs", query.runs);
  const suffix = params.toString() ? `?${params}` : "";
  return adminGet(`/api/admin/results${suffix}`, "Failed to fetch results.");
}

export function fetchAdminPlayerResults(
  player: string,
  run?: number,
): Promise<AdminPlayerResults> {
  const suffix = run != null ? `?run=${run}` : "";
  return adminGet(
    `/api/admin/results/player/${encodeURIComponent(player)}${suffix}`,
    "Failed to fetch that player's results.",
  );
}

export async function removeAdminCampaign(campaignKey: string): Promise<AdminDashboardData> {
  const response = await fetch(`${BASE_URL}/api/admin/campaigns/${encodeURIComponent(campaignKey)}`, {
    method: "DELETE",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || "Failed to remove campaign.");
  }

  return response.json();
}

export async function removeAllAdminCampaigns(): Promise<AdminDashboardData> {
  const response = await fetch(`${BASE_URL}/api/admin/campaigns`, {
    method: "DELETE",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || "Failed to delete all campaigns.");
  }

  return response.json();
}

export async function removeAdminPlayer(playerName: string): Promise<AdminDashboardData> {
  const response = await fetch(`${BASE_URL}/api/admin/players/${encodeURIComponent(playerName)}`, {
    method: "DELETE",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || "Failed to delete player.");
  }

  return response.json();
}

export async function removeAllAdminPlayers(): Promise<AdminDashboardData> {
  const response = await fetch(`${BASE_URL}/api/admin/players`, {
    method: "DELETE",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || "Failed to delete all players.");
  }

  return response.json();
}


export interface ConfigFileInfo {
  filename: string;
  size: number;
  modified: string;
}

export interface ConfigFileData {
  filename: string;
  data: any;
  schema: any;
  uischema?: any;
}

export interface ConfigUpdateResponse {
  type: string;
  message: string;
  file: ConfigFileData;
  dashboard?: AdminDashboardData;
}

export async function fetchAdminConfigs(): Promise<ConfigFileInfo[]> {
  const response = await fetch(`${BASE_URL}/api/admin/configs`, {
    method: "GET",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || "Failed to fetch config files list.");
  }

  const data = await response.json();
  return data.files || [];
}

export async function fetchAdminConfigFile(filename: string): Promise<ConfigFileData> {
  const response = await fetch(`${BASE_URL}/api/admin/configs/${encodeURIComponent(filename)}`, {
    method: "GET",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || `Failed to fetch config file ${filename}.`);
  }

  return response.json();
}

export async function saveAdminConfigFile(
  filename: string,
  content: any
): Promise<ConfigUpdateResponse> {
  const response = await fetch(`${BASE_URL}/api/admin/configs/${encodeURIComponent(filename)}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify({ data: content }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || `Failed to save configuration file ${filename}.`);
  }

  return response.json();
}

export async function fetchGraphDebug(email: string): Promise<GraphDebugPayload> {
  const response = await fetch(
    `${BASE_URL}/api/admin/graph-debug?email=${encodeURIComponent(email)}`,
    {
      method: "GET",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
    }
  );

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || "Failed to fetch graph debug data.");
  }

  return response.json();
}

export async function generateOfflineIntelArtifacts(): Promise<{ status: string; count?: number; message: string }> {
  const response = await fetch(`${BASE_URL}/api/admin/generate-offline-intel`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || "Failed to generate offline intel artifacts.");
  }

  return response.json();
}

export interface AdminEmailStatus {
  type: string;
  host: string;
  port: number;
  username: string;
  from_email: string;
  use_tls: boolean;
  is_configured: boolean;
  has_password: boolean;
}

export async function fetchAdminEmailStatus(): Promise<AdminEmailStatus> {
  const response = await fetch(`${BASE_URL}/api/admin/email/status`, {
    method: "GET",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || "Failed to fetch email status.");
  }

  return response.json();
}

export type AdminTestEmailTemplate = "generic" | "verification" | "password_reset";

export async function sendAdminTestEmail(
  recipientEmail: string,
  template: AdminTestEmailTemplate = "generic"
): Promise<{ type: string; message: string }> {
  const response = await fetch(`${BASE_URL}/api/admin/email/test`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify({ recipient_email: recipientEmail, template }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || "Failed to send test email.");
  }

  return response.json();
}

// --- Teacher role management (admin-only) ---
// A teacher account is created here with a name, a password, and a set of campaign keys it may
// monitor; the teacher's own read-only dashboard lives under /api/teacher (services/api/teacher.ts).

export interface AdminTeacher {
  id: number;
  user_name: string;
  campaign_keys: string[];
}

export function fetchAdminTeachers(): Promise<{ teachers: AdminTeacher[] }> {
  return adminGet("/api/admin/teachers", "Failed to fetch teacher accounts.");
}

async function adminMutate<T>(
  path: string,
  method: "POST" | "PATCH" | "DELETE",
  failure: string,
  body?: Record<string, unknown>
): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || failure);
  }
  return response.json();
}

export function createAdminTeacher(
  userName: string,
  password: string,
  campaignKeys: string[]
): Promise<{ teacher: AdminTeacher }> {
  return adminMutate("/api/admin/teachers", "POST", "Failed to create teacher account.", {
    user_name: userName,
    password,
    campaign_keys: campaignKeys,
  });
}

export function updateAdminTeacherCampaigns(
  teacherId: number,
  campaignKeys: string[]
): Promise<{ teacher: AdminTeacher }> {
  return adminMutate(
    `/api/admin/teachers/${teacherId}/campaigns`,
    "PATCH",
    "Failed to update the teacher's assigned campaigns.",
    { campaign_keys: campaignKeys }
  );
}

export function updateAdminTeacherPassword(
  teacherId: number,
  newPassword: string
): Promise<{ success: boolean }> {
  return adminMutate(
    `/api/admin/teachers/${teacherId}/password`,
    "PATCH",
    "Failed to update the teacher's password.",
    { new_password: newPassword }
  );
}

export function deleteAdminTeacher(teacherId: number): Promise<{ teachers: AdminTeacher[] }> {
  return adminMutate(`/api/admin/teachers/${teacherId}`, "DELETE", "Failed to delete teacher account.");
}

/** Same payload as a teacher's own dashboard, but for a campaign set the admin picks freely -
 * backs the Admin panel's "open live view" preview. */
export function fetchAdminTeacherPreview(campaignKeys: string[]): Promise<TeacherDashboardData> {
  const params = new URLSearchParams({ campaigns: campaignKeys.join(",") });
  return adminGet(`/api/admin/teacher-preview?${params}`, "Failed to fetch the live monitoring preview.");
}

export function fetchBugReportRecipients(): Promise<{ recipients: string[] }> {
  return adminGet("/api/admin/bug-reports/recipients", "Failed to fetch bug report recipients.");
}

export interface DeployRestartResult {
  type: string;
  restarted: { deployment: string; restarted_at: string }[];
}

/** Which build the game-api pod is actually running - proves a restart/repull picked up a new
 * image, since this value only changes when the image actually changed. */
export function fetchDeployVersion(): Promise<{ git_sha: string }> {
  return adminGet("/api/admin/deploy/version", "Failed to fetch the running build version.");
}

export type LoggableApp = "mlops-game-api" | "mlops-game-ui" | "mlops-game-postgres";

export interface DeployLogsResult {
  pod: string | null;
  logs: string;
}

/** Tails the current pod's container log - the same thing `kubectl logs` would show, for
 * debugging a live issue (a stuck game, a slow request) without needing cluster access. */
export function fetchDeployLogs(app: LoggableApp, lines: number = 500): Promise<DeployLogsResult> {
  return adminGet(
    `/api/admin/deploy/logs?app=${encodeURIComponent(app)}&lines=${lines}`,
    "Failed to fetch logs."
  );
}

/** Rollout-restarts the game-api and game-ui Deployments in the cluster: re-pulls the latest
 * pushed image and reloads any changed Secret/ConfigMap values. Only works in the deployed
 * cluster, not local dev. */
export function restartDeployment(): Promise<DeployRestartResult> {
  return adminMutate("/api/admin/deploy/restart", "POST", "Failed to restart the deployment.");
}

export async function updateBugReportRecipients(recipients: string[]): Promise<{ recipients: string[] }> {
  const response = await fetch(`${BASE_URL}/api/admin/bug-reports/recipients`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify({ recipients }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || "Failed to update bug report recipients.");
  }

  return response.json();
}

export interface AdminBugReport {
  id: number;
  time_stamp: string;
  email: string;
  campaign_key: string;
  message: string;
  page_url: string | null;
  user_agent: string | null;
  debug_info: Record<string, unknown>;
}

export type BugReportSortKey = "time_stamp" | "email" | "campaign_key" | "phase" | "message";

export interface BugReportQuery {
  search?: string;
  email?: string;
  campaign?: string;
  /** Local `YYYY-MM-DD` dates, inclusive. */
  since?: string;
  until?: string;
  sort?: BugReportSortKey;
  order?: "asc" | "desc";
}

export function fetchAdminBugReports(
  query: BugReportQuery = {},
): Promise<{ total: number; reports: AdminBugReport[] }> {
  const params = new URLSearchParams();
  if (query.search) params.set("search", query.search);
  if (query.email) params.set("email", query.email);
  if (query.campaign) params.set("campaign", query.campaign);
  if (query.since) params.set("since", `${query.since}T00:00:00`);
  if (query.until) params.set("until", `${query.until}T23:59:59`);
  if (query.sort) params.set("sort", query.sort);
  if (query.order) params.set("order", query.order);
  const suffix = params.toString() ? `?${params}` : "";
  return adminGet(`/api/admin/bug-reports${suffix}`, "Failed to fetch bug reports.");
}

export function deleteAdminBugReport(id: number): Promise<{ success: boolean }> {
  return adminMutate(`/api/admin/bug-reports/${id}`, "DELETE", "Failed to delete the bug report.");
}

export interface LlmCacheRow {
  name: string;
  label: string;
  entries: number;
  hits: number;
  misses: number;
  /** null until the cache has been asked something. */
  hit_rate: number | null;
}

export interface LlmCacheStats {
  enabled: boolean;
  /** The build the counts belong to. */
  version: string;
  maxsize: number;
  caches: LlmCacheRow[];
  total_entries: number;
  total_hits: number;
  total_requests: number;
  total_hit_rate: number | null;
}

export function fetchLlmCacheStats(): Promise<LlmCacheStats> {
  return adminGet("/api/admin/llm-cache", "Failed to fetch LLM cache statistics.");
}
