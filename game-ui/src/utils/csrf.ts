const CSRF_COOKIE_NAME = "mlops_csrf";
const CSRF_HEADER_NAME = "X-CSRF-Token";

/** Reads the (deliberately non-httpOnly) CSRF cookie the backend sets alongside the auth
 * cookies, for the double-submit check on mutating requests
 * (docs/plans/session-persistence-and-url-routing.md, D-csrf). */
function readCsrfCookie(): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|; )${CSRF_COOKIE_NAME}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

/** Headers to spread into a mutating (POST/PUT/PATCH/DELETE) fetch call. Empty if no CSRF
 * cookie exists yet (e.g. before any login) - the backend then rejects with 403, which surfaces
 * as a normal error rather than a client-side crash. */
export function csrfHeaders(): Record<string, string> {
  const token = readCsrfCookie();
  return token ? { [CSRF_HEADER_NAME]: token } : {};
}
