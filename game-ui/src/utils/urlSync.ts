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
  if (window.location.pathname !== path) {
    window.history.pushState({}, "", path);
  }
}

/** The player-facing name of whatever gameplay phase is currently on screen - deliberately not
 * the raw phase/challenge/loop indices, which are meaningless to look at in an address bar. */
export type GamePhaseLabel =
  | "intro-questionnaire"
  | "briefing"
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
  const path = phase ? `/game/${phase}` : "/game";
  if (window.location.pathname !== path || window.location.search !== "") {
    window.history.replaceState({}, "", path);
  }
}

/** The current screen-level path, ignoring any progression segments below `/game`. */
export function currentScreenPath(): ScreenPath {
  const pathname = window.location.pathname;
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
