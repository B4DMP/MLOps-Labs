const API_HOST =
  import.meta.env.VITE_API_HOST ||
  (import.meta.env.MODE === "development"
    ? "localhost:8000"
    : window.location.host);

const PROTOCOL = window.location.protocol === "https:" ? "https:" : "http:";
const BASE_URL = `${PROTOCOL}//${API_HOST}`;

export interface LoginResponse {
  type: "login_success" | "admin_login_success" | "verification_required";
  username?: string;
  token?: string;
}

export interface RegisterResponse {
  type: "register_pending_verification" | "admin_login_success" | "login_success";
  username?: string;
  token?: string;
}

export interface VerifyEmailResponse {
  type: "login_success";
  username: string;
  token: string;
}

export interface ForgotPasswordResponse {
  type: "password_reset_code_sent";
  username: string;
}

export interface ResetPasswordResponse {
  type: "login_success";
  username: string;
  token: string;
}

async function postJson<T>(path: string, body: Record<string, unknown>, errorFallback: string): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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
