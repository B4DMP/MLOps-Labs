const API_HOST =
  import.meta.env.VITE_API_HOST ||
  (import.meta.env.MODE === "development"
    ? "localhost:8000"
    : window.location.host);

const PROTOCOL = window.location.protocol === "https:" ? "https:" : "http:";
const BASE_URL = `${PROTOCOL}//${API_HOST}`;

export interface TeacherCampaign {
  name: string;
  key: string;
  is_active: boolean;
  use_questionnaire: boolean;
  users: string[];
}

/** One row of the live monitoring table - same shape whether it came from a teacher's own
 * dashboard or the admin panel's preview of it. */
export interface TeacherPlayerRow {
  name: string;
  email: string;
  gameProgression: string;
  progressIndex: number;
  /** Tiebreakers for ranking "farthest along" within the same progressIndex bucket - not shown
   * directly, only used to sort the Progression column correctly. */
  phaseIndex: number;
  challengeNumber: number;
  introPercentage: number;
  outroPercentage: number;
  /** Whether this player's campaign uses the intro/outro questionnaire at all - when false, the
   * intro/outro scores aren't meaningful and shouldn't be shown. */
  useQuestionnaire: boolean;
  playTime: string;
  playTimeMinutes: number;
  campaign_name: string;
  campaign_key: string;
  runs: number;
  playtestTainted: boolean;
  /** ISO timestamp of the player's most recent recorded activity, or null if they never played. */
  lastActive: string | null;
}

export interface TeacherDashboardData {
  type: "teacher_data_update";
  players: TeacherPlayerRow[];
  campaigns: TeacherCampaign[];
  total_player_amount: number;
  finished_player_amount: number;
}

async function teacherGet<T>(path: string, failure: string): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: "GET",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
  });
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    const error = new Error(errorData.detail || failure) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }
  return response.json();
}

/** Campaigns assigned to the logged-in teacher (httpOnly `mlops_teacher` cookie). */
export function fetchTeacherCampaigns(): Promise<{ campaigns: TeacherCampaign[] }> {
  return teacherGet("/api/teacher/campaigns", "Failed to fetch assigned campaigns.");
}

/** The live monitoring payload, optionally narrowed to one of the teacher's assigned campaigns.
 * Meant to be polled every few seconds while the dashboard is open. */
export function fetchTeacherDashboard(campaign?: string): Promise<TeacherDashboardData> {
  const suffix = campaign && campaign !== "all" ? `?campaign=${encodeURIComponent(campaign)}` : "";
  return teacherGet(`/api/teacher/dashboard${suffix}`, "Failed to fetch the teacher dashboard.");
}
