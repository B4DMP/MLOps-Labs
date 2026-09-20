import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useGameWebSocket } from "../services/websocket/useGameWebSocket";

export interface PlayerSettings {
  auto_skip_conversations: boolean;
  mute_tts: boolean;
  voice_male: string | null;
  voice_female: string | null;
  voice_narrator: string | null;
  voice_player: string | null;
}

export const DEFAULT_SETTINGS: PlayerSettings = {
  auto_skip_conversations: false,
  mute_tts: false,
  voice_male: null,
  voice_female: null,
  voice_narrator: null,
  voice_player: null,
};

interface SettingsContextValue {
  settings: PlayerSettings;
  /** Flips local state immediately and sends the same partial as `settings:update`; the echo
   * back on `settings:data` reconciles it. A player toggling mute mid-sentence should not wait
   * on a round trip. */
  updateSettings: (partial: Partial<PlayerSettings>) => void;
  canResetAccount: boolean;
  resetAccount: () => void;
}

export const SettingsContext = createContext<SettingsContextValue>({
  settings: DEFAULT_SETTINGS,
  updateSettings: () => {},
  canResetAccount: false,
  resetAccount: () => {},
});

export const useSettings = () => useContext(SettingsContext);

const STORAGE_PREFIX = "mlops_player_settings";

function storageKey(username: string): string {
  return `${STORAGE_PREFIX}:${username}`;
}

/** The websocket stays the source of truth; this only avoids one frame of unmuted audio on
 * reload, so any failure here (private window, cleared storage) just means that one frame. */
function readMirror(username: string): PlayerSettings | null {
  try {
    const raw = window.localStorage.getItem(storageKey(username));
    if (!raw) return null;
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return null;
  }
}

function writeMirror(username: string, settings: PlayerSettings): void {
  try {
    window.localStorage.setItem(storageKey(username), JSON.stringify(settings));
  } catch {
    // Best-effort only.
  }
}

function clearMirror(username: string): void {
  try {
    window.localStorage.removeItem(storageKey(username));
  } catch {
    // Best-effort only.
  }
}

function asVoiceName(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function toPlayerSettings(data: Record<string, unknown> | undefined | null): PlayerSettings {
  return {
    auto_skip_conversations: Boolean(data?.auto_skip_conversations),
    mute_tts: Boolean(data?.mute_tts),
    voice_male: asVoiceName(data?.voice_male),
    voice_female: asVoiceName(data?.voice_female),
    voice_narrator: asVoiceName(data?.voice_narrator),
    voice_player: asVoiceName(data?.voice_player),
  };
}

interface SettingsProviderProps {
  children: React.ReactNode;
  username: string;
}

/**
 * Loads and mirrors the per-player settings profile (docs/plans/player-settings-and-tts.md) for
 * the whole game shell - wraps `Game.tsx` outside its `progressionIndex` switch, so the
 * questionnaire, briefing and end screens see the same settings as gameplay.
 *
 * Seeds from `game:init_data` (so the very first paint already knows whether to mute) and stays
 * current off `settings:data`, which both `settings:get`/`settings:update` answer with. On
 * `settings:account_reset` the local mirror is dropped and the page reloads into the fresh
 * account rather than trying to reconcile stale in-memory state.
 */
export default function SettingsProvider({ children, username }: SettingsProviderProps) {
  const { emit, subscribe } = useGameWebSocket();
  const [settings, setSettings] = useState<PlayerSettings>(() => readMirror(username) ?? DEFAULT_SETTINGS);
  const [canResetAccount, setCanResetAccount] = useState(false);

  const applyIncoming = useCallback(
    (data: Record<string, unknown> | undefined | null) => {
      const next = toPlayerSettings(data);
      setSettings(next);
      setCanResetAccount(Boolean(data?.can_reset_account));
      writeMirror(username, next);
    },
    [username],
  );

  useEffect(() => {
    const unsubData = subscribe("settings:data", applyIncoming);
    const unsubInit = subscribe("game:init_data", (data: { settings?: Record<string, unknown> }) => {
      if (data?.settings) applyIncoming(data.settings);
    });
    const unsubReset = subscribe("settings:account_reset", () => {
      clearMirror(username);
      window.location.reload();
    });
    return () => {
      unsubData();
      unsubInit();
      unsubReset();
    };
  }, [subscribe, applyIncoming, username]);

  const updateSettings = useCallback(
    (partial: Partial<PlayerSettings>) => {
      setSettings((prev) => {
        const next = { ...prev, ...partial };
        writeMirror(username, next);
        return next;
      });
      emit("settings:update", partial);
    },
    [emit, username],
  );

  const resetAccount = useCallback(() => {
    emit("settings:reset_account", { confirm: true });
  }, [emit]);

  const value = useMemo<SettingsContextValue>(
    () => ({ settings, updateSettings, canResetAccount, resetAccount }),
    [settings, updateSettings, canResetAccount, resetAccount],
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}
