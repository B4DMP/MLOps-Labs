const API_HOST =
  import.meta.env.VITE_API_HOST ||
  (import.meta.env.MODE === "development"
    ? "localhost:8000"
    : window.location.host);

const PROTOCOL = window.location.protocol === "https:" ? "https:" : "http:";
const BASE_URL = `${PROTOCOL}//${API_HOST}`;

export interface LoginResponse {
  type: "login_success" | "admin_login_success";
  username?: string;
  token?: string;
}

export interface RegisterResponse {
  type: "register_success" | "admin_login_success";
  username?: string;
  token?: string;
}

export async function loginUser(username: string): Promise<LoginResponse> {
  const response = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || "Login failed.");
  }

  return response.json();
}

export async function registerUser(
  username: string,
  campaignKey: string
): Promise<RegisterResponse> {
  const response = await fetch(`${BASE_URL}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, campaign_key: campaignKey }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || "Registration failed.");
  }

  return response.json();
}
