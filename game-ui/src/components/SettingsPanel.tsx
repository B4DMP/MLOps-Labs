import { useEffect, useMemo, useState } from "react";
import { Icon } from "@iconify/react";
import HeaderModal from "./HeaderModal";
import { Accordion, AccordionSection } from "./Accordion";
import { useGameWebSocket } from "../services/websocket/useGameWebSocket";
import { useSettings, type PlayerSettings } from "./SettingsProvider";
import { cancelSpeech, loadVoices, speak, type VoiceSlot } from "../utils/speech";
import PlaytestSection from "./PlaytestSection";
import {
  changeEmail,
  changePassword,
  changeUsername,
  confirmEmailChange,
} from "../services/api/auth";
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

/** Same order the automatic choice uses in `speech.ts`: online (neural) voices first, then
 * en-US, then by name. A player browsing this list should not have to guess which entries are
 * the good ones that "Automatic" would have reached for. */
function englishVoicesSorted(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice[] {
  return voices
    .filter((v) => v.lang?.toLowerCase().startsWith("en"))
    .slice()
    .sort((a, b) => {
      const online = Number(b.localService === false) - Number(a.localService === false);
      if (online !== 0) return online;
      const aUS = a.lang?.toLowerCase() === "en-us" ? 0 : 1;
      const bUS = b.lang?.toLowerCase() === "en-us" ? 0 : 1;
      return aUS - bUS || a.name.localeCompare(b.name);
    });
}

interface ProfileSectionProps {
  username: string;
  onLogout: () => void;
  onUsernameChanged: (newUsername: string) => void;
}

/** Change password/email/username plus Logout (docs/plans/session-persistence-and-url-routing.md,
 * D-profile-ui). Each form manages its own pending/error/success state independently - there is
 * no shared "profile is loading" flag, since submitting one shouldn't disable the others. */
function ProfileSection({ username, onLogout, onUsernameChanged }: ProfileSectionProps) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newPasswordConfirm, setNewPasswordConfirm] = useState("");
  const [passwordStatus, setPasswordStatus] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [isChangingPassword, setIsChangingPassword] = useState(false);

  const [newEmail, setNewEmail] = useState("");
  const [emailCode, setEmailCode] = useState("");
  const [isAwaitingEmailCode, setIsAwaitingEmailCode] = useState(false);
  const [emailStatus, setEmailStatus] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [isChangingEmail, setIsChangingEmail] = useState(false);

  const [newUsername, setNewUsername] = useState("");
  const [usernamePassword, setUsernamePassword] = useState("");
  const [usernameStatus, setUsernameStatus] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [isChangingUsername, setIsChangingUsername] = useState(false);

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsChangingPassword(true);
    setPasswordStatus(null);
    try {
      await changePassword(currentPassword, newPassword, newPasswordConfirm);
      setPasswordStatus({ kind: "success", text: "Password changed." });
      setCurrentPassword("");
      setNewPassword("");
      setNewPasswordConfirm("");
    } catch (err: any) {
      setPasswordStatus({ kind: "error", text: err.message || "Could not change your password." });
    } finally {
      setIsChangingPassword(false);
    }
  };

  const handleRequestEmailChange = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsChangingEmail(true);
    setEmailStatus(null);
    try {
      await changeEmail(newEmail);
      setIsAwaitingEmailCode(true);
      setEmailStatus({ kind: "success", text: "Confirmation code sent to the new address." });
    } catch (err: any) {
      setEmailStatus({ kind: "error", text: err.message || "Could not start the email change." });
    } finally {
      setIsChangingEmail(false);
    }
  };

  const handleConfirmEmailChange = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsChangingEmail(true);
    setEmailStatus(null);
    try {
      await confirmEmailChange(emailCode);
      setEmailStatus({ kind: "success", text: "Email changed." });
      setIsAwaitingEmailCode(false);
      setNewEmail("");
      setEmailCode("");
    } catch (err: any) {
      setEmailStatus({ kind: "error", text: err.message || "Could not confirm the email change." });
    } finally {
      setIsChangingEmail(false);
    }
  };

  const handleChangeUsername = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsChangingUsername(true);
    setUsernameStatus(null);
    try {
      const result = await changeUsername(newUsername, usernamePassword);
      onUsernameChanged(result.username);
      setUsernameStatus({ kind: "success", text: `Username changed to ${result.username}.` });
      setNewUsername("");
      setUsernamePassword("");
    } catch (err: any) {
      setUsernameStatus({ kind: "error", text: err.message || "Could not change your username." });
    } finally {
      setIsChangingUsername(false);
    }
  };

  return (
    <div className={styles.profileGroup}>
      <div className={styles.profileRow}>
        <span className={styles.toggleLabel}>Signed in as {username}</span>
        <button type="button" className={styles.cancelButton} onClick={onLogout}>
          Log out
        </button>
      </div>

      <form className={styles.profileForm} onSubmit={handleChangePassword}>
        <h4 className={styles.profileFormTitle}>Change password</h4>
        <input
          type="password"
          className="form-control form-control-sm"
          placeholder="Current password"
          autoComplete="current-password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          required
        />
        <input
          type="password"
          className="form-control form-control-sm"
          placeholder="New password"
          autoComplete="new-password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          required
        />
        <input
          type="password"
          className="form-control form-control-sm"
          placeholder="Confirm new password"
          autoComplete="new-password"
          value={newPasswordConfirm}
          onChange={(e) => setNewPasswordConfirm(e.target.value)}
          required
        />
        {passwordStatus && (
          <p className={passwordStatus.kind === "error" ? styles.errorText : styles.successText}>
            {passwordStatus.text}
          </p>
        )}
        <button type="submit" className={styles.submitButton} disabled={isChangingPassword}>
          Change password
        </button>
      </form>

      {!isAwaitingEmailCode ? (
        <form className={styles.profileForm} onSubmit={handleRequestEmailChange}>
          <h4 className={styles.profileFormTitle}>Change email</h4>
          <input
            type="email"
            className="form-control form-control-sm"
            placeholder="New email address"
            autoComplete="email"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            required
          />
          {emailStatus && (
            <p className={emailStatus.kind === "error" ? styles.errorText : styles.successText}>{emailStatus.text}</p>
          )}
          <button type="submit" className={styles.submitButton} disabled={isChangingEmail}>
            Send confirmation code
          </button>
        </form>
      ) : (
        <form className={styles.profileForm} onSubmit={handleConfirmEmailChange}>
          <h4 className={styles.profileFormTitle}>Confirm new email</h4>
          <input
            type="text"
            inputMode="numeric"
            className="form-control form-control-sm"
            placeholder="6-digit code"
            value={emailCode}
            onChange={(e) => setEmailCode(e.target.value.replace(/[^0-9]/g, "").slice(0, 6))}
            required
          />
          {emailStatus && (
            <p className={emailStatus.kind === "error" ? styles.errorText : styles.successText}>{emailStatus.text}</p>
          )}
          <div className={styles.confirmActions}>
            <button
              type="button"
              className={styles.cancelButton}
              onClick={() => {
                setIsAwaitingEmailCode(false);
                setEmailStatus(null);
              }}
            >
              Cancel
            </button>
            <button type="submit" className={styles.submitButton} disabled={isChangingEmail}>
              Confirm
            </button>
          </div>
        </form>
      )}

      <form className={styles.profileForm} onSubmit={handleChangeUsername}>
        <h4 className={styles.profileFormTitle}>Change username</h4>
        <input
          type="text"
          className="form-control form-control-sm"
          placeholder="New username"
          autoComplete="username"
          value={newUsername}
          onChange={(e) => setNewUsername(e.target.value)}
          required
        />
        <input
          type="password"
          className="form-control form-control-sm"
          placeholder="Current password"
          autoComplete="current-password"
          value={usernamePassword}
          onChange={(e) => setUsernamePassword(e.target.value)}
          required
        />
        {usernameStatus && (
          <p className={usernameStatus.kind === "error" ? styles.errorText : styles.successText}>
            {usernameStatus.text}
          </p>
        )}
        <button type="submit" className={styles.submitButton} disabled={isChangingUsername}>
          Change username
        </button>
      </form>
    </div>
  );
}

interface SettingsPanelProps {
  isVisible: boolean;
  onClose: () => void;
  onLogout: () => void;
}

export default function SettingsPanel({ isVisible, onClose, onLogout }: SettingsPanelProps) {
  const { username, setUsername } = useGameWebSocket();
  const { settings, updateSettings, canResetAccount, resetAccount, canPlaytest } = useSettings();
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
        <h2 className={styles.title}>Profile & Settings</h2>

        <Accordion defaultOpenId={null}>
          <AccordionSection id="profile" title="Profile">
            <ProfileSection username={username} onLogout={onLogout} onUsernameChanged={setUsername} />
          </AccordionSection>

          <AccordionSection id="conversations" title="Conversations">
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
          </AccordionSection>

          <AccordionSection id="voice" title="Voice">
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
                          {v.localService === false ? `${v.name} (online)` : v.name}
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
          </AccordionSection>

          {canResetAccount && (
            <AccordionSection id="account" title="Account">
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
            </AccordionSection>
          )}
        </Accordion>

        {canPlaytest && <PlaytestSection onSkipped={onClose} />}
      </div>
    </HeaderModal>
  );
}
