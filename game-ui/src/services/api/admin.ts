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
  requireEmailVerification: boolean = true
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
    require_email_verification?: boolean;
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

export async function fetchGraphDebug(username: string): Promise<GraphDebugPayload> {
  const response = await fetch(
    `${BASE_URL}/api/admin/graph-debug?username=${encodeURIComponent(username)}`,
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
