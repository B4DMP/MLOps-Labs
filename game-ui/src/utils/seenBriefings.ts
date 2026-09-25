/**
 * Best-effort, per-player memory of which challenge briefings (PrePhaseDialog) have already been
 * dismissed, so a reload mid-challenge doesn't force the player back through a dialog they already
 * clicked through. The server's own stored progression stays the sole authority on which
 * phase/challenge the player is actually in (docs/plans/session-persistence-and-url-routing.md,
 * D-server-truth/D-no-client-cache) - this only suppresses a UI dialog, never changes what phase or
 * challenge is loaded, so it doesn't reopen the trust question those decisions closed. Worst case
 * on tampered/cleared storage: the briefing shows again (or is skipped once more) - never a
 * gameplay-state or auth consequence. Mirrors the read/write-mirror pattern already used for
 * per-player settings in SettingsProvider.tsx.
 */

const STORAGE_PREFIX = "mlops_seen_briefings";

function storageKey(username: string): string {
  return `${STORAGE_PREFIX}:${username}`;
}

function readSeenKeys(username: string): string[] {
  try {
    const raw = window.localStorage.getItem(storageKey(username));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((k) => typeof k === "string") : [];
  } catch {
    return [];
  }
}

export function hasSeenBriefing(username: string, challengeKey: string): boolean {
  return readSeenKeys(username).includes(challengeKey);
}

export function markBriefingSeen(username: string, challengeKey: string): void {
  try {
    const seen = readSeenKeys(username);
    if (!seen.includes(challengeKey)) {
      seen.push(challengeKey);
      window.localStorage.setItem(storageKey(username), JSON.stringify(seen));
    }
  } catch {
    // Best-effort only - worst case, the briefing just shows again next time.
  }
}

/**
 * Drops this username's whole seen-briefings mirror. `reset_player` deals the same
 * deterministic first challenge to a reset account (`select_first_challenge` is seeded by
 * username, not by run), so without this a reset account looks "already briefed" for a
 * phase/challenge pair the browser marked seen before the reset - the dialog silently never
 * reopens and a skip/proceed reads as no screen change at all. Call this wherever a reset is
 * confirmed for the current user (`settings:account_reset`), mirroring `clearMirror` in
 * `SettingsProvider.tsx`.
 */
export function clearSeenBriefings(username: string): void {
  try {
    window.localStorage.removeItem(storageKey(username));
  } catch {
    // Best-effort only - worst case, a stale entry lingers and the briefing stays suppressed.
  }
}
