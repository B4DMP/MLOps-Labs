/**
 * URL reflection for screen navigation and in-game progression
 * (docs/plans/session-persistence-and-url-routing.md, D-url-tiers).
 *
 * Two tiers, deliberately treated differently:
 * - Screen-level paths are functional both ways: navigating to one calls `pushScreen` (a real
 *   history entry, so Back/Forward work), and a cold load or `popstate` reads the path back to
 *   decide what to render (see App.tsx's guard logic).
 * - Progression-level segments are write-only telemetry via `replaceProgress` (no history entry,
 *   never read back) - the backend's own stored progression is the sole authority on where a
 *   player actually is (D-server-truth, D-no-client-cache), so there is nothing here for a cold
 *   load to restore from.
 */

// Vite's configured `base` (VITE_BASE_PATH at build time, e.g. "/mlops-lab/" in the cluster,
// "/" locally) - without this, pushState/pathname below would write/read root-relative paths
// that drop the deployment's URL prefix entirely, breaking refresh/deep-links in production
// while looking fine in local dev (where the prefix is empty).
const BASE_PATH = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");

// Exported (with an explicit `base` param, defaulted to the real one) so tests can exercise the
// prefixing logic itself under a non-"/" base without having to reload the module with a
// different Vite env.
export function withBase(path: string, base: string = BASE_PATH): string {
  return base + path;
}

export function stripBase(pathname: string, base: string = BASE_PATH): string {
  if (base && pathname.startsWith(base)) {
    const rest = pathname.slice(base.length);
    return rest === "" ? "/" : rest;
  }
  return pathname;
}

export type ScreenPath =
  | "/"
  | "/login"
  | "/register"
  | "/verify"
  | "/forgot-password"
  | "/reset-password"
  | "/game"
  | "/admin"
  | "/teacher";

/** Pushes a new history entry for a screen-level navigation, unless already there. */
export function pushScreen(path: ScreenPath): void {
  const full = withBase(path);
  if (window.location.pathname !== full) {
    window.history.pushState({}, "", full);
  }
}

/** The player-facing name of whatever gameplay phase is currently on screen - deliberately not
 * the raw phase/challenge/loop indices, which are meaningless to look at in an address bar. */
export type GamePhaseLabel =
  | "intro-questionnaire"
  | "demo-briefing"
  | "briefing"
  | "phase-briefing"
  | "offline-intel"
  | "pitch"
  | "simulation"
  | "report"
  | "outro-questionnaire";

/**
 * Reflects the current gameplay phase in the URL without creating history entries or ever being
 * read back - purely so the address bar is informative (and shareable/copyable for support
 * purposes), not a source of truth for anything. `null` just shows plain `/game`.
 */
export function replaceProgress(phase: GamePhaseLabel | null): void {
  const full = withBase(phase ? `/game/${phase}` : "/game");
  if (window.location.pathname !== full || window.location.search !== "") {
    window.history.replaceState({}, "", full);
  }
}

/** The current screen-level path, ignoring any progression segments below `/game`. */
export function currentScreenPath(): ScreenPath {
  const pathname = stripBase(window.location.pathname);
  if (pathname.startsWith("/game")) {
    return "/game";
  }
  const known: ScreenPath[] = [
    "/login",
    "/register",
    "/verify",
    "/forgot-password",
    "/reset-password",
    "/admin",
    "/teacher",
  ];
  return known.find((p) => p === pathname) ?? "/";
}
