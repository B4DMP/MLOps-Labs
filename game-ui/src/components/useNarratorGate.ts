import { useCallback, useRef, useSyncExternalStore } from "react";
import { useSettings } from "./SettingsProvider";
import {
  confirmNarratorGate,
  declineNarratorGate,
  getNarratorGateState,
  requestNarratorGate,
  subscribeNarratorGate,
  type NarratorGateRequest,
} from "../utils/narratorGate";

/**
 * Ask before a screen auto-narrates: `await request()` resolves `true` when it may speak (audio
 * is already open, or the player clicked through the gate) and `false` when it must not (muted,
 * skipped, or "Read it myself"). Needs a mounted `<NarratorGateHost />`; without one it resolves
 * `true` at once. `confirm` is the gate's primary button, for custom UIs.
 */
export function useNarratorGate() {
  const { settings } = useSettings();
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const state = useSyncExternalStore(subscribeNarratorGate, getNarratorGateState);

  const request = useCallback(
    (opts: Omit<NarratorGateRequest, "muted"> = {}) =>
      requestNarratorGate({ ...opts, muted: settingsRef.current.mute_tts }),
    [],
  );

  return { gateOpen: state.open, request, confirm: confirmNarratorGate, decline: declineNarratorGate };
}
