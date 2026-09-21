import { useEffect, useMemo, useState } from "react";
import { Icon } from "@iconify/react";
import HeaderModal from "./HeaderModal";
import { useGameWebSocket } from "../services/websocket/useGameWebSocket";
import { useSettings, type PlayerSettings } from "./SettingsProvider";
import { cancelSpeech, loadVoices, speak, type VoiceSlot } from "../utils/speech";
import styles from "./SettingsPanel.module.css";

interface VoiceSlotConfig {
  slot: VoiceSlot;
  label: string;
  field: "voice_male" | "voice_female" | "voice_narrator" | "voice_player";
  previewText: string;
}

/** Each preview says something slot-appropriate rather than the literal string "hello world",
 * so the player hears what they are actually choosing. */
const VOICE_SLOTS: VoiceSlotConfig[] = [
  {
    slot: "male",
    label: "Male stakeholders",
    field: "voice_male",
    previewText: "Hello world. This is how the male stakeholders will sound when they speak.",
  },
  {
    slot: "female",
    label: "Female stakeholders",
    field: "voice_female",
    previewText: "Hello world. This is how the female stakeholders will sound when they speak.",
  },
  {
    slot: "narrator",
    label: "Narrator",
    field: "voice_narrator",
    previewText:
      "Incident report: the nightly retraining job failed silently for six days before anyone noticed the drift.",
  },
  {
    slot: "player",
    label: "You",
    field: "voice_player",
    previewText: "Hello world. This is how your own lines will sound when you speak in the pitch.",
  },
];

function englishVoicesSorted(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice[] {
  return voices
    .filter((v) => v.lang?.toLowerCase().startsWith("en"))
    .slice()
    .sort((a, b) => {
      const aUS = a.lang?.toLowerCase() === "en-us" ? 0 : 1;
      const bUS = b.lang?.toLowerCase() === "en-us" ? 0 : 1;
      return aUS - bUS || a.name.localeCompare(b.name);
    });
}

interface SettingsPanelProps {
  isVisible: boolean;
  onClose: () => void;
}

export default function SettingsPanel({ isVisible, onClose }: SettingsPanelProps) {
  const { username } = useGameWebSocket();
  const { settings, updateSettings, canResetAccount, resetAccount } = useSettings();
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [isConfirmingReset, setIsConfirmingReset] = useState(false);
  const [confirmText, setConfirmText] = useState("");

  useEffect(() => {
    if (!isVisible) return;
    let cancelled = false;
    loadVoices().then((loaded) => {
      if (!cancelled) setVoices(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [isVisible]);

  // Closing the panel mid-preview must not leave a voice talking over the game underneath, and
  // reopening it should start the destructive confirmation step over rather than remember it.
  useEffect(() => {
    if (!isVisible) {
      cancelSpeech();
      setIsConfirmingReset(false);
      setConfirmText("");
    }
  }, [isVisible]);

  useEffect(() => () => cancelSpeech(), []);

  const englishVoices = useMemo(() => englishVoicesSorted(voices), [voices]);

  const handlePreview = (slot: VoiceSlot, voiceName: string | null, text: string) => {
    cancelSpeech();
    speak(text, { slot, seed: slot, voiceName });
  };

  const updateVoice = (field: VoiceSlotConfig["field"], value: string) => {
    updateSettings({ [field]: value || null } as Partial<PlayerSettings>);
  };

  return (
    <HeaderModal isVisible={isVisible} onClose={onClose} closeLabel="settings" width="min(480px, 94vw)">
      <div className={styles.panel}>
        <h2 className={styles.title}>Settings</h2>

        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>Conversations</h3>
          <label className={styles.toggleRow}>
            <span className={styles.toggleText}>
              <span className={styles.toggleLabel}>Auto-skip conversations</span>
              <span className={styles.toggleHint}>
                Hides speech bubbles and their audio, including the stakeholder introductions.
                Nothing is lost - every line still lands in the chat transcript.
              </span>
            </span>
            <input
              type="checkbox"
              className="form-check-input"
              checked={settings.auto_skip_conversations}
              onChange={(e) => updateSettings({ auto_skip_conversations: e.target.checked })}
            />
          </label>
        </section>

        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>Voice</h3>
          <label className={styles.toggleRow}>
            <span className={styles.toggleText}>
              <span className={styles.toggleLabel}>Mute narration</span>
            </span>
            <input
              type="checkbox"
              className="form-check-input"
              checked={settings.mute_tts}
              onChange={(e) => updateSettings({ mute_tts: e.target.checked })}
            />
          </label>

          {voices.length === 0 ? (
            <p className={styles.diagnostic}>
              {typeof navigator !== "undefined" && navigator.userAgent.toLowerCase().includes("linux")
                ? "No speech voices found. On Linux, this usually means speech-dispatcher is not installed."
                : "Your browser reports no speech voices available."}
            </p>
          ) : (
            <div className={styles.voiceGrid}>
              {VOICE_SLOTS.map(({ slot, label, field, previewText }) => (
                <div key={slot} className={styles.voiceRow}>
                  <span className={styles.voiceLabel}>{label}</span>
                  <select
                    className="form-select form-select-sm"
                    disabled={settings.mute_tts}
                    value={settings[field] ?? ""}
                    onChange={(e) => updateVoice(field, e.target.value)}
                  >
                    <option value="">Automatic</option>
                    {englishVoices.map((v) => (
                      <option key={v.name} value={v.name}>
                        {v.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className={styles.previewButton}
                    disabled={settings.mute_tts}
                    onClick={() => handlePreview(slot, settings[field], previewText)}
                    title="Hear a preview in this voice"
                    aria-label={`Preview the ${label} voice`}
                  >
                    <Icon icon="ph:speaker-high-bold" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        {canResetAccount && (
          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>Account</h3>
            {!isConfirmingReset ? (
              <button type="button" className={styles.dangerButton} onClick={() => setIsConfirmingReset(true)}>
                Reset my account
              </button>
            ) : (
              <div className={styles.confirmBox}>
                <p className={styles.confirmWarning}>
                  This permanently deletes all progress, intel, conversations and these settings
                  for <strong>{username}</strong>. It cannot be recovered.
                </p>
                <label className={styles.confirmLabel}>
                  Type your username ({username}) to confirm:
                  <input
                    type="text"
                    className="form-control form-control-sm mt-1"
                    value={confirmText}
                    onChange={(e) => setConfirmText(e.target.value)}
                    autoComplete="off"
                  />
                </label>
                <div className={styles.confirmActions}>
                  <button
                    type="button"
                    className={styles.cancelButton}
                    onClick={() => {
                      setIsConfirmingReset(false);
                      setConfirmText("");
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className={styles.dangerButton}
                    disabled={confirmText !== username}
                    onClick={() => {
                      resetAccount();
                      setIsConfirmingReset(false);
                      setConfirmText("");
                    }}
                  >
                    Permanently reset my account
                  </button>
                </div>
              </div>
            )}
          </section>
        )}
      </div>
    </HeaderModal>
  );
}
