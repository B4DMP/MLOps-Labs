const API_HOST =
  import.meta.env.VITE_API_HOST ||
  (import.meta.env.MODE === "development"
    ? "localhost:8000"
    : window.location.host);

const PROTOCOL = window.location.protocol === "https:" ? "https:" : "http:";
const BASE_URL = `${PROTOCOL}//${API_HOST}`;

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

export async function fetchAdminDashboard(token: string): Promise<AdminDashboardData> {
  const response = await fetch(`${BASE_URL}/api/admin/dashboard`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || "Failed to fetch admin dashboard data.");
  }

  return response.json();
}

export async function addAdminCampaign(
  token: string,
  newCampaignName: string,
  newCampaignKey: string
): Promise<AdminDashboardData> {
  const response = await fetch(`${BASE_URL}/api/admin/campaigns`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      new_campaign_name: newCampaignName,
      new_campaign_key: newCampaignKey,
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || "Failed to add campaign.");
  }

  return response.json();
}

export async function removeAdminCampaign(
  token: string,
  campaignKey: string
): Promise<AdminDashboardData> {
  const response = await fetch(`${BASE_URL}/api/admin/campaigns/${campaignKey}`, {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || "Failed to remove campaign.");
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

export async function fetchAdminConfigs(token: string): Promise<ConfigFileInfo[]> {
  const response = await fetch(`${BASE_URL}/api/admin/configs`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || "Failed to fetch config files list.");
  }

  const data = await response.json();
  return data.files || [];
}

export async function fetchAdminConfigFile(
  token: string,
  filename: string
): Promise<ConfigFileData> {
  const response = await fetch(`${BASE_URL}/api/admin/configs/${encodeURIComponent(filename)}`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || `Failed to fetch config file ${filename}.`);
  }

  return response.json();
}

export async function saveAdminConfigFile(
  token: string,
  filename: string,
  content: any
): Promise<ConfigUpdateResponse> {
  const response = await fetch(`${BASE_URL}/api/admin/configs/${encodeURIComponent(filename)}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ data: content }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || `Failed to save configuration file ${filename}.`);
  }

  return response.json();
}

