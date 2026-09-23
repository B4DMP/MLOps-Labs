import { csrfHeaders } from "../../utils/csrf";

const API_HOST =
  import.meta.env.VITE_API_HOST ||
  (import.meta.env.MODE === "development"
    ? "localhost:8000"
    : window.location.host);

const PROTOCOL = window.location.protocol === "https:" ? "https:" : "http:";
const BASE_URL = `${PROTOCOL}//${API_HOST}`;

// Identity rides an httpOnly cookie now, never a token the JS holds
// (docs/plans/session-persistence-and-url-routing.md, D-cookies/D-login-response).
export interface LoginResponse {
  type: "login_success" | "admin_login_success" | "verification_required";
  username?: string;
}

export interface RegisterResponse {
  type: "register_pending_verification" | "admin_login_success" | "login_success";
  username?: string;
}

export interface VerifyEmailResponse {
  type: "login_success";
  username: string;
}

export interface ForgotPasswordResponse {
  type: "password_reset_code_sent";
  username: string;
}

export interface ResetPasswordResponse {
  type: "login_success";
  username: string;
}

export interface WhoamiResponse {
  player: { username: string } | null;
  admin: { valid: true } | null;
}

async function postJson<T>(
  path: string,
  body: Record<string, unknown>,
  errorFallback: string,
  extraHeaders: Record<string, string> = {}
): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...extraHeaders },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || errorFallback);
  }

  return response.json();
}

export async function loginUser(username: string, password: string): Promise<LoginResponse> {
  return postJson("/api/auth/login", { username, password }, "Login failed.");
}

export interface RegisterFields {
  username: string;
  email: string;
  emailConfirm: string;
  password: string;
  passwordConfirm: string;
  usersOnMachine: number;
  campaignKey: string;
}

export async function registerUser(fields: RegisterFields): Promise<RegisterResponse> {
  return postJson(
    "/api/auth/register",
    {
      username: fields.username,
      email: fields.email,
      email_confirm: fields.emailConfirm,
      password: fields.password,
      password_confirm: fields.passwordConfirm,
      users_on_machine: fields.usersOnMachine,
      campaign_key: fields.campaignKey,
    },
    "Registration failed."
  );
}

export async function verifyEmailCode(username: string, code: string): Promise<VerifyEmailResponse> {
  return postJson("/api/auth/verify-email", { username, code }, "Verification failed.");
}

export async function forgotPassword(username: string, email: string): Promise<ForgotPasswordResponse> {
  return postJson("/api/auth/forgot-password", { username, email }, "Could not request a password reset.");
}

export async function resetPassword(
  username: string,
  code: string,
  newPassword: string,
  newPasswordConfirm: string
): Promise<ResetPasswordResponse> {
  return postJson(
    "/api/auth/reset-password",
    { username, code, new_password: newPassword, new_password_confirm: newPasswordConfirm },
    "Could not reset your password."
  );
}

/** Always resolves, never throws on "nobody is logged in" - that's a normal `{player: null,
 * admin: null}` response, not an error (docs/plans/session-persistence-and-url-routing.md,
 * D-whoami). Also the sliding-expiration keepalive target - call this periodically while a game
 * or admin tab is open, not just once at mount. */
export async function whoami(): Promise<WhoamiResponse> {
  const response = await fetch(`${BASE_URL}/api/auth/whoami`, { credentials: "include" });
  if (!response.ok) {
    return { player: null, admin: null };
  }
  return response.json();
}

export async function logout(): Promise<void> {
  await fetch(`${BASE_URL}/api/auth/logout`, {
    method: "POST",
    credentials: "include",
    headers: { ...csrfHeaders() },
  });
}

export async function adminLogout(): Promise<void> {
  await fetch(`${BASE_URL}/api/auth/admin-logout`, {
    method: "POST",
    credentials: "include",
    headers: { ...csrfHeaders() },
  });
}

function postJsonWithCsrf<T>(path: string, body: Record<string, unknown>, errorFallback: string): Promise<T> {
  return postJson(path, body, errorFallback, csrfHeaders());
}

export function changePassword(
  currentPassword: string,
  newPassword: string,
  newPasswordConfirm: string
): Promise<{ type: string }> {
  return postJsonWithCsrf(
    "/api/auth/change-password",
    {
      current_password: currentPassword,
      new_password: newPassword,
      new_password_confirm: newPasswordConfirm,
    },
    "Could not change your password."
  );
}

export function changeEmail(newEmail: string): Promise<{ type: string }> {
  return postJsonWithCsrf(
    "/api/auth/change-email",
    { new_email: newEmail },
    "Could not start the email change."
  );
}

export function confirmEmailChange(code: string): Promise<{ type: string }> {
  return postJsonWithCsrf(
    "/api/auth/confirm-email-change",
    { code },
    "Could not confirm the email change."
  );
}

export function changeUsername(
  newUsername: string,
  currentPassword: string
): Promise<{ type: string; username: string }> {
  return postJsonWithCsrf(
    "/api/auth/change-username",
    { new_username: newUsername, current_password: currentPassword },
    "Could not change your username."
  );
}
