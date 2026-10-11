import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { Icon } from "@iconify/react";
import HoverTooltip from "./HoverToolTip";
import HeaderModal from "./HeaderModal";
import { useGameWebSocket } from "../services/websocket/useGameWebSocket";
import { useSettings, type PlayerSettings } from "./SettingsProvider";
import { cancelSpeech, loadVoices, speak, type VoiceSlot } from "../utils/speech";
import PlaytestSection from "./PlaytestSection";
import {
  changeEmail,
  changePassword,
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

interface CardProps {
  title: string;
  icon: string;
  tone?: "danger";
  children: ReactNode;
}

/** An always-visible settings group; the cards animate in one after another (see the CSS). */
function Card({ title, icon, tone, children }: CardProps) {
  return (
    <section className={`${styles.card} ${tone === "danger" ? styles.cardDanger : ""}`}>
      <h3 className={styles.cardTitle}>
        <Icon icon={icon} aria-hidden /> {title}
      </h3>
      {children}
    </section>
  );
}

/** Collapsed-by-default block for rarely used actions, so they don't crowd the card. */
function Disclosure({ title, icon, children }: Omit<CardProps, "tone">) {
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  return (
    <div className={styles.disclosure}>
      <button
        type="button"
        className={styles.disclosureHeader}
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon icon={icon} aria-hidden />
        <span className={styles.disclosureTitle}>{title}</span>
        <Icon icon="ph:caret-down-bold" className={`${styles.caret} ${open ? styles.caretOpen : ""}`} aria-hidden />
      </button>
      {open && (
        <div id={bodyId} className={styles.disclosureBody}>
          {children}
        </div>
      )}
    </div>
  );
}

interface ProfileSectionProps {
  onEmailChanged: (newEmail: string) => void;
}

/** Change password/email (docs/plans/session-persistence-and-url-routing.md, D-profile-ui). Each
 * form manages its own pending/error/success state independently - there is no shared "profile is
 * loading" flag, since submitting one shouldn't disable the others. */
function ProfileSection({ onEmailChanged }: ProfileSectionProps) {
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
      onEmailChanged(newEmail);
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

  const passwordsMismatch = newPasswordConfirm !== "" && newPassword !== newPasswordConfirm;

  return (
    <div className={styles.profileGroup}>
      <Disclosure title="Change password" icon="ph:lock-key-bold">
      <form className={styles.profileForm} onSubmit={handleChangePassword}>
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
        {passwordsMismatch && <p className={styles.errorText}>The two new passwords don't match.</p>}
        {passwordStatus && (
          <p
            className={passwordStatus.kind === "error" ? styles.errorText : styles.successText}
            role={passwordStatus.kind === "error" ? "alert" : "status"}
          >
            {passwordStatus.text}
          </p>
        )}
        <button
          type="submit"
          className={styles.submitButton}
          disabled={isChangingPassword || passwordsMismatch || !currentPassword || !newPassword || !newPasswordConfirm}
        >
          {isChangingPassword ? "Changing..." : "Update password"}
        </button>
      </form>
      </Disclosure>

      <Disclosure title={isAwaitingEmailCode ? "Confirm new email" : "Change email"} icon="ph:envelope-simple-bold">
      {!isAwaitingEmailCode ? (
        <form className={styles.profileForm} onSubmit={handleRequestEmailChange}>
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
            <p
              className={emailStatus.kind === "error" ? styles.errorText : styles.successText}
              role={emailStatus.kind === "error" ? "alert" : "status"}
            >
              {emailStatus.text}
            </p>
          )}
          <button type="submit" className={styles.submitButton} disabled={isChangingEmail || !newEmail}>
            {isChangingEmail ? "Sending..." : "Send confirmation code"}
          </button>
        </form>
      ) : (
        <form className={styles.profileForm} onSubmit={handleConfirmEmailChange}>
          <p className={styles.formHint}>
            Enter the 6-digit code sent to <strong>{newEmail}</strong>.
          </p>
          <input
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            className={`form-control form-control-sm ${styles.codeInput}`}
            placeholder="6-digit code"
            value={emailCode}
            onChange={(e) => setEmailCode(e.target.value.replace(/[^0-9]/g, "").slice(0, 6))}
            required
          />
          {emailStatus && (
            <p
              className={emailStatus.kind === "error" ? styles.errorText : styles.successText}
              role={emailStatus.kind === "error" ? "alert" : "status"}
            >
              {emailStatus.text}
            </p>
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
            <button type="submit" className={styles.submitButton} disabled={isChangingEmail || emailCode.length < 6}>
              {isChangingEmail ? "Confirming..." : "Confirm"}
            </button>
          </div>
        </form>
      )}
      </Disclosure>
    </div>
  );
}

interface SettingsPanelProps {
  isVisible: boolean;
  onClose: () => void;
  onLogout: () => void;
}

export default function SettingsPanel({ isVisible, onClose, onLogout }: SettingsPanelProps) {
  const { email, setEmail } = useGameWebSocket();
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
    speak(text, {
      slot,
      seed: slot,
      voiceName,
      // "You" is the only slot this affects - previewing it should reflect whichever gender is
      // currently selected (including a change not yet saved), not the ungendered fallback voice.
      playerGender: slot === "player" ? settings.player_voice_gender : undefined,
    });
  };

  const updateVoice = (field: VoiceSlotConfig["field"], value: string) => {
    updateSettings({ [field]: value || null } as Partial<PlayerSettings>);
  };

  return (
    <HeaderModal isVisible={isVisible} onClose={onClose} closeLabel="settings" width="min(960px, 96vw)">
      <div className={styles.panel}>
        <header className={styles.header}>
          <div className={styles.headerText}>
            <h2 className={styles.title}>Profile & Settings</h2>
            <p className={styles.subtitle}>Voice and conversation settings are saved as soon as you change them.</p>
          </div>
          <div className={styles.identityCard}>
            <span className={styles.avatar} aria-hidden>
              {email.charAt(0).toUpperCase() || "?"}
            </span>
            <span className={styles.identityText}>
              <span className={styles.identityCaption}>Signed in as</span>
              <span className={styles.identityEmail} title={email}>
                {email}
              </span>
            </span>
            <button type="button" className={styles.cancelButton} onClick={onLogout}>
              <Icon icon="ph:sign-out-bold" aria-hidden /> Log out
            </button>
          </div>
        </header>

        <div className={styles.columns}>
        <div className={styles.column}>
          <Card title="Voice" icon="ph:speaker-high-bold">
            <label className={styles.toggleRow}>
              <span className={styles.toggleText}>
                <span className={styles.toggleLabel}>Mute narration</span>
                <span className={styles.toggleHint}>
                  Silences every voice. The options below are paused while this is on.
                </span>
              </span>
              <input
                type="checkbox"
                className={styles.switch}
                checked={settings.mute_tts}
                onChange={(e) => updateSettings({ mute_tts: e.target.checked })}
              />
            </label>

            <div className={`${styles.voiceOptions} ${settings.mute_tts ? styles.voiceOptionsMuted : ""}`}>
            <div className={styles.speedRow}>
              <span className={styles.toggleText}>
                <span className={styles.toggleLabel}>Narration speed</span>
                <span className={styles.toggleHint}>
                  How fast stakeholders, the narrator and your own lines are read aloud.
                </span>
              </span>
              <div className={styles.speedControl}>
                <span className={styles.speedEnd} aria-hidden>Slower</span>
                <input
                  type="range"
                  min={0.75}
                  max={1.5}
                  step={0.05}
                  disabled={settings.mute_tts}
                  value={settings.speech_rate}
                  aria-label="Narration speed"
                  onChange={(e) => updateSettings({ speech_rate: parseFloat(e.target.value) })}
                />
                <span className={styles.speedEnd} aria-hidden>Faster</span>
                <span className={styles.speedValue}>{settings.speech_rate.toFixed(2)}x</span>
              </div>
            </div>

            <label className={styles.toggleRow}>
              <span className={styles.toggleText}>
                <span className={styles.toggleLabel}>Server voices (recommended)</span>
                <span className={styles.toggleHint}>
                  Narrates with higher-quality voices from the server. Works the same on any
                  browser or OS, but needs a network connection - turn this off to use only your
                  browser's own voices instead.
                </span>
              </span>
              <input
                type="checkbox"
                className={styles.switch}
                aria-label="Server voices (recommended)"
                disabled={settings.mute_tts}
                checked={settings.tts_backend === "auto"}
                onChange={(e) =>
                  updateSettings({ tts_backend: e.target.checked ? "auto" : "webspeech" })
                }
              />
            </label>

            <div className={styles.voiceGenderRow}>
              <span className={styles.toggleText}>
                <span className={styles.toggleLabel}>Your voice</span>
                <span className={styles.toggleHint}>
                  This is how your own lines will be narrated when you speak in the pitch.
                </span>
              </span>
              <div className={styles.segmentedToggle} role="group" aria-label="Your voice">
                {(["male", "female"] as const).map((gender) => (
                  <button
                    key={gender}
                    type="button"
                    className={`${styles.segmentedOption} ${
                      settings.player_voice_gender === gender ? styles.segmentedOptionActive : ""
                    }`}
                    disabled={settings.mute_tts}
                    aria-pressed={settings.player_voice_gender === gender}
                    onClick={() => updateSettings({ player_voice_gender: gender })}
                  >
                    {gender === "male" ? "Male" : "Female"}
                  </button>
                ))}
              </div>
            </div>

            {/* These per-slot browser-voice pickers only ever apply when Server voices is off
                (or if a server request fails and falls back) - while Server voices is on,
                narration always uses the server's own voice for each speaker, so showing them
                (even disabled) would just be confusing dead controls. Hidden outright instead. */}
            {settings.tts_backend !== "auto" && (
              voices.length === 0 ? (
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
                      <HoverTooltip description="Hear a preview in this voice">
                        <button
                          type="button"
                          className={styles.previewButton}
                          disabled={settings.mute_tts}
                          onClick={() => handlePreview(slot, settings[field], previewText)}
                          aria-label={`Preview the ${label} voice`}
                        >
                          <Icon icon="ph:speaker-high-bold" />
                        </button>
                      </HoverTooltip>
                    </div>
                  ))}
                </div>
              )
            )}
            </div>
          </Card>
        </div>

        <div className={styles.column}>
          <Card title="Conversations" icon="ph:chats-circle-bold">
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
                className={styles.switch}
                checked={settings.auto_skip_conversations}
                onChange={(e) => updateSettings({ auto_skip_conversations: e.target.checked })}
              />
            </label>
          </Card>

          <Card title="Account security" icon="ph:shield-check-bold">
            <ProfileSection onEmailChanged={setEmail} />
          </Card>
        </div>
        </div>

        {(canResetAccount || canPlaytest) && (
        <div className={styles.fullWidth}>
          {canResetAccount && (
            <Card title="Danger zone" icon="ph:warning-bold" tone="danger">
              {!isConfirmingReset ? (
                <button type="button" className={styles.dangerButton} onClick={() => setIsConfirmingReset(true)}>
                  Reset my account
                </button>
              ) : (
                <div className={styles.confirmBox}>
                  <p className={styles.confirmWarning}>
                    This permanently deletes all progress, intel, conversations and these settings
                    for <strong>{email}</strong>. It cannot be recovered.
                  </p>
                  <label className={styles.confirmLabel}>
                    Type your email ({email}) to confirm:
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
                      disabled={confirmText !== email}
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
            </Card>
          )}

          {canPlaytest && <PlaytestSection onSkipped={onClose} />}
        </div>
        )}
      </div>
    </HeaderModal>
  );
}
