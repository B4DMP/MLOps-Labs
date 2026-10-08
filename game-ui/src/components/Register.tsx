import { useState } from "react";
import { Icon } from "@iconify/react";
import { motion } from "motion/react";
import { ReadyState } from "../services/websocket/types";
import styles from "./Register.module.css";

interface RegisterProps {
  onSubmit: (
    email: string,
    emailConfirm: string,
    password: string,
    passwordConfirm: string,
    usersOnMachine: number,
    campaignKey: string,
    startMuted: boolean,
    playerVoiceGender: "male" | "female"
  ) => void;
  readyState: ReadyState;
  onBack: () => void;
  isLoading?: boolean;
  errorMessage?: string;
  onClearError?: () => void;
}

export function Register({
  onSubmit,
  readyState,
  onBack,
  isLoading = false,
  errorMessage,
  onClearError,
}: RegisterProps) {
  const [email, setEmail] = useState("");
  const [emailConfirm, setEmailConfirm] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [usersOnMachine, setUsersOnMachine] = useState("1");
  const [campaignKey, setCampaignKey] = useState("");
  const [startMuted, setStartMuted] = useState(false);
  const [playerVoiceGender, setPlayerVoiceGender] = useState<"male" | "female">("female");

  // register_user re-validates everything server-side regardless of what's sent here.
  const isFormFilled =
    email.trim() &&
    emailConfirm.trim() &&
    password &&
    passwordConfirm &&
    usersOnMachine.trim() &&
    campaignKey.trim();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isFormFilled && !isLoading) {
      onSubmit(
        email.trim(),
        emailConfirm.trim(),
        password,
        passwordConfirm,
        parseInt(usersOnMachine, 10),
        campaignKey.trim(),
        startMuted,
        playerVoiceGender
      );
    }
  };

  const handleInputChange = (setter: (val: string) => void, val: string) => {
    setter(val);
    if (errorMessage && onClearError) {
      onClearError();
    }
  };

  return (
    <div className={styles.registerWrapper}>
      <motion.div
        className={styles.registerCard}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.22, ease: "easeOut" }}
      >

        <div className={styles.titleRow}>
          <div>
            <h2 className={styles.cardTitle}>Register</h2>
            <p className={styles.cardSubtitle}>
              Join a study campaign and begin your MLOps Labs session.
            </p>
          </div>
          <span className={styles.requiredLegend}>
            <span className={styles.requiredMark} aria-hidden>*</span> required
          </span>
        </div>

        {/* Inline Error Alert */}
        {errorMessage && (
          <div className={styles.errorAlert} role="alert">
            <Icon
              icon="ph:warning-circle-bold"
              className="flex-shrink-0"
              style={{ fontSize: "1.25rem", color: "#f87171" }}
            />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* Callouts (Stacked by default, 2-column on small screens) */}
        <div className={styles.calloutsRow}>
          <div className={styles.infoBox}>
            <Icon
              icon="ph:info-bold"
              className="flex-shrink-0 mt-1"
              style={{ color: "#7dd3fc", fontSize: "1.2rem" }}
            />
            <span>
              Please sign up with your <strong>email</strong> and enter the <strong>campaign key</strong> provided with your study invitation.
            </span>
          </div>

          <div className={styles.consentBox}>
            <Icon
              icon="ph:shield-check-bold"
              className="flex-shrink-0 mt-1"
              style={{ color: "#38bdf8", fontSize: "1.25rem" }}
            />
            <div>
              <strong>Research Consent:</strong> By playing, you agree that your in-game actions will be logged and analyzed for scientific research. All published results are strictly anonymized. 
            </div>
          </div>
        </div>

        {/* Form (Stacked by default, 2-column on small screens) */}
        <form onSubmit={handleSubmit}>
          <div className={styles.inputGrid}>
            <div className={styles.formGroup}>
              <label htmlFor="register-email-input" className={styles.formLabel}>
                <Icon icon="ph:envelope-bold" style={{ fontSize: "1rem" }} />
                <span>Email</span>
                <span className={styles.requiredMark} aria-hidden>*</span>
              </label>
              <input
                id="register-email-input"
                type="email"
                autoComplete="username"
                className={styles.formInput}
                placeholder="Enter your email"
                value={email}
                autoFocus
                required
                disabled={isLoading}
                onChange={(e) => handleInputChange(setEmail, e.target.value)}
              />
            </div>

            <div className={styles.formGroup}>
              <label htmlFor="register-email-confirm-input" className={styles.formLabel}>
                <Icon icon="ph:envelope-bold" style={{ fontSize: "1rem" }} />
                <span>Confirm Email</span>
                <span className={styles.requiredMark} aria-hidden>*</span>
              </label>
              <input
                id="register-email-confirm-input"
                type="email"
                className={styles.formInput}
                placeholder="Re-enter your email"
                value={emailConfirm}
                required
                disabled={isLoading}
                onChange={(e) => handleInputChange(setEmailConfirm, e.target.value)}
              />
            </div>

            <div className={styles.formGroup}>
              <label htmlFor="register-password-input" className={styles.formLabel}>
                <Icon icon="ph:lock-key-bold" style={{ fontSize: "1rem" }} />
                <span>Password</span>
                <span className={styles.requiredMark} aria-hidden>*</span>
              </label>
              <input
                id="register-password-input"
                type="password"
                className={styles.formInput}
                placeholder="Choose a password"
                value={password}
                required
                disabled={isLoading}
                onChange={(e) => handleInputChange(setPassword, e.target.value)}
              />
            </div>

            <div className={styles.formGroup}>
              <label htmlFor="register-password-confirm-input" className={styles.formLabel}>
                <Icon icon="ph:lock-key-bold" style={{ fontSize: "1rem" }} />
                <span>Confirm Password</span>
                <span className={styles.requiredMark} aria-hidden>*</span>
              </label>
              <input
                id="register-password-confirm-input"
                type="password"
                className={styles.formInput}
                placeholder="Re-enter your password"
                value={passwordConfirm}
                required
                disabled={isLoading}
                onChange={(e) => handleInputChange(setPasswordConfirm, e.target.value)}
              />
            </div>

            <div className={styles.formGroup}>
              <label htmlFor="register-campaign-key-input" className={styles.formLabel}>
                <Icon icon="ph:key-bold" style={{ fontSize: "1rem" }} />
                <span>Campaign Key</span>
                <span className={styles.requiredMark} aria-hidden>*</span>
              </label>
              <input
                id="register-campaign-key-input"
                type="text"
                className={styles.formInput}
                placeholder="Enter invitation campaign key"
                value={campaignKey}
                required
                disabled={isLoading}
                onChange={(e) => handleInputChange(setCampaignKey, e.target.value)}
              />
            </div>

          </div>

          <div className={`${styles.narrationCard} ${startMuted ? styles.narrationCardMuted : ""}`}>
            <div className={styles.narrationHeader}>
              <Icon
                icon={startMuted ? "ph:speaker-slash-bold" : "ph:speaker-high-bold"}
                className={styles.narrationIcon}
              />
              <div>
                <div className={styles.narrationTitle}>Voice narration (text-to-speech)</div>
                <p className={styles.narrationText}>
                  Stakeholders and the guide speak their lines aloud with synthetic voices. Turn it
                  off if you're in a quiet place or prefer to read.
                </p>
              </div>
            </div>
            <div className={styles.narrationToggle} role="group" aria-label="Narration">
              {([false, true] as const).map((muted) => (
                <button
                  key={String(muted)}
                  type="button"
                  className={`${styles.narrationOption} ${
                    startMuted === muted ? styles.narrationOptionActive : ""
                  }`}
                  disabled={isLoading}
                  aria-pressed={startMuted === muted}
                  onClick={() => setStartMuted(muted)}
                >
                  <Icon icon={muted ? "ph:speaker-slash-bold" : "ph:speaker-high-bold"} style={{ fontSize: "1.2rem" }} />
                  <span>{muted ? "Mute voices" : "Play voices"}</span>
                </button>
              ))}
            </div>
            <p className={styles.narrationFootnote}>
              <Icon icon="ph:gear-six-bold" /> You can change this at any time in Settings, under Voice → Mute narration.
            </p>
          </div>

          <div className={styles.compactRow}>
            <div className={styles.compactCard}>
              <label htmlFor="register-users-on-machine-input" className={styles.formLabel} style={{ marginBottom: 0 }}>
                <Icon icon="ph:users-bold" style={{ fontSize: "1rem" }} />
                <span>Players On This Device</span>
                <span className={styles.requiredMark} aria-hidden>*</span>
              </label>
              <input
                id="register-users-on-machine-input"
                type="number"
                min={1}
                max={10}
                className={`${styles.formInput} ${styles.usersInput}`}
                value={usersOnMachine}
                required
                disabled={isLoading}
                onChange={(e) => handleInputChange(setUsersOnMachine, e.target.value)}
              />
              <p className={styles.compactHint}>
                Just so we know how many people played together. This has no effect on gameplay.
              </p>
            </div>

            <div className={styles.compactCard}>
              <div className="d-flex align-items-center gap-2">
                <Icon icon="ph:microphone-bold" style={{ fontSize: "1rem", color: "rgba(255, 255, 255, 0.9)" }} />
                <span className={styles.formLabel} style={{ marginBottom: 0 }}>
                  Your voice
                </span>
              </div>
              <div className={`${styles.segmentedToggle} ${styles.compactCardControl}`} role="group" aria-label="Your voice">
                {(["male", "female"] as const).map((gender) => (
                  <button
                    key={gender}
                    type="button"
                    className={`${styles.segmentedOption} ${
                      playerVoiceGender === gender ? styles.segmentedOptionActive : ""
                    }`}
                    disabled={isLoading}
                    aria-pressed={playerVoiceGender === gender}
                    onClick={() => setPlayerVoiceGender(gender)}
                  >
                    <Icon icon={gender === "male" ? "ph:gender-male-duotone" : "ph:gender-female-duotone"} style={{ fontSize: "1rem" }} />
                    <span>{gender === "male" ? "Male" : "Female"}</span>
                  </button>
                ))}
              </div>
              <p className={styles.compactHint}>
                Your lines will be narrated by a synthetic voice during the game.
              </p>
            </div>
          </div>

          <div className={styles.buttonRow}>
            <button
              type="submit"
              className={`d-flex align-items-center justify-content-center gap-2 ${styles.actionButton}`}
              disabled={isLoading || readyState !== ReadyState.OPEN || !isFormFilled}
            >
              <span>{isLoading ? "Starting Game..." : readyState === ReadyState.OPEN ? "Start New Game" : "Connecting..."}</span>
              <Icon icon="ph:arrow-right-bold" />
            </button>

            <button
              type="button"
              className={`d-flex align-items-center justify-content-center gap-2 ${styles.secondaryButton}`}
              onClick={onBack}
              disabled={isLoading}
            >
              <Icon icon="ph:arrow-left-bold" />
              <span>Back to Title Screen</span>
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}

export default Register;
