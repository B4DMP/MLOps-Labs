import { useState, type CSSProperties } from "react";
import { Home } from "./components/Home";
import { Login } from "./components/Login";
import { Register } from "./components/Register";
import { VerifyEmail } from "./components/VerifyEmail";
import { ForgotPassword } from "./components/ForgotPassword";
import { ResetPassword } from "./components/ResetPassword";
import Game from "./Game";
import ErrorDialog from "./components/ErrorDialog";
import { Admin } from "./components/Admin";
import LoadingScreen from "./components/LoadingScreen";
import { ReadyState } from "./services/websocket/types";

import {
  loginUser,
  registerUser,
  verifyEmailCode,
  forgotPassword,
  resetPassword,
} from "./services/api/auth";
import {
  fetchAdminDashboard,
  addAdminCampaign,
  updateAdminCampaign,
  removeAdminCampaign,
  removeAdminPlayer,
  removeAllAdminPlayers,
} from "./services/api/admin";
import { WebSocketProvider } from "./services/websocket/WebSocketContext";
import GlossaryProvider from "./components/glossary/GlossaryProvider";
import SettingsProvider from "./components/SettingsProvider";
import { motion, AnimatePresence } from "motion/react";
import { FADE_TRANSITION } from "./utils/transitions";

interface Campaign {
  name: string;
  key: string;
  is_active: boolean;
  use_questionnaire: boolean;
  is_test_campaign: boolean;
  users: string[];
}

interface Player {
  name: string;
  campaign_name: string;
  gameProgression: string;
  introPercentage: number;
  outroPercentage: number;
  playTime: string;
}

function App() {
  const [isInLoginUi, setIsInLoginUi] = useState(false);
  const [isInRegisterUi, setIsInRegisterUi] = useState(false);
  const [isInVerifyUi, setIsInVerifyUi] = useState(false);
  const [isInForgotPasswordUi, setIsInForgotPasswordUi] = useState(false);
  const [isInResetPasswordUi, setIsInResetPasswordUi] = useState(false);
  const [isInGame, setIsInGame] = useState(false);
  const [username, setUsername] = useState("");
  const [startMuted, setStartMuted] = useState(false);
  const [isInErrorUi, setIsInErrorUi] = useState(false);
  const [lastError, setLastError] = useState("");
  const [loginError, setLoginError] = useState("");
  const [registerError, setRegisterError] = useState("");
  const [isInAdminUi, setIsInAdminUi] = useState(false);
  const [adminToken, setAdminToken] = useState("");

  // Held only in memory so "Resend code" on the verify screen can re-trigger a login (which
  // regenerates the code for an unverified account) without asking the user to retype it.
  const [pendingPassword, setPendingPassword] = useState("");
  const [pendingStartMuted, setPendingStartMuted] = useState(false);
  const [verifyError, setVerifyError] = useState("");
  const [isResendingCode, setIsResendingCode] = useState(false);

  const [forgotPasswordError, setForgotPasswordError] = useState("");
  const [resetPasswordError, setResetPasswordError] = useState("");

  const [isAuthenticating, setIsAuthenticating] = useState(false);

  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [finishedPlayersAmount, setFinishedPlayersAmount] = useState(0);
  const [sumPerChallenge, setSumPerChallenge] = useState<number[]>([]);
  const [sumPerChallengeIncrease, setSumPerChallengeIncrease] = useState<number[]>([]);
  const [introQuestionaireAverage, setIntroQuestionaireAverage] = useState(0);
  const [outroQuestionaireAverage, setOutroQuestionaireAverage] = useState(0);
  const [questionaireResults, setQuestionaireResults] = useState<any>([]);

  // `token` isn't persisted or sent anywhere yet - no player-authenticated REST endpoint exists
  // for it to gate. It's accepted here so the call sites read naturally and it's available to
  // wire up once one does.
  const enterGameAsPlayer = (loggedInUsername: string, _token: string, muted: boolean) => {
    setUsername(loggedInUsername);
    setStartMuted(muted);
    setIsInLoginUi(false);
    setIsInRegisterUi(false);
    setIsInVerifyUi(false);
    setIsInForgotPasswordUi(false);
    setIsInResetPasswordUi(false);
    setPendingPassword("");
    setIsInGame(true);
  };

  const handleLoginSubmit = async (inputUsername: string, password: string, loginStartMuted: boolean) => {
    setIsAuthenticating(true);
    setLoginError("");
    try {
      const data = await loginUser(inputUsername, password);
      if (data.type === "login_success" && data.token) {
        enterGameAsPlayer(inputUsername, data.token, loginStartMuted);
      } else if (data.type === "admin_login_success" && data.token) {
        setAdminToken(data.token);
        setIsInLoginUi(false);
        setIsInAdminUi(true);
        const dashData = await fetchAdminDashboard(data.token);
        updateAdminState(dashData);
      } else if (data.type === "verification_required") {
        setUsername(inputUsername);
        setPendingPassword(password);
        setPendingStartMuted(loginStartMuted);
        setVerifyError("");
        setIsInLoginUi(false);
        setIsInVerifyUi(true);
      }
    } catch (err: any) {
      const msg = err.message || "An unknown error occurred during login.";
      setLastError(msg);
      setLoginError(msg);
      setIsInErrorUi(true);
    } finally {
      setIsAuthenticating(false);
    }
  };

  const handleRegisterSubmit = async (
    inputUsername: string,
    email: string,
    emailConfirm: string,
    password: string,
    passwordConfirm: string,
    usersOnMachine: number,
    campaignKey: string,
    registerStartMuted: boolean
  ) => {
    setIsAuthenticating(true);
    setRegisterError("");
    try {
      const data = await registerUser({
        username: inputUsername,
        email,
        emailConfirm,
        password,
        passwordConfirm,
        usersOnMachine,
        campaignKey,
      });
      if (data.type === "admin_login_success" && data.token) {
        setAdminToken(data.token);
        setIsInRegisterUi(false);
        setIsInAdminUi(true);
        const dashData = await fetchAdminDashboard(data.token);
        updateAdminState(dashData);
      } else if (data.type === "register_pending_verification") {
        setUsername(inputUsername);
        setPendingPassword(password);
        setPendingStartMuted(registerStartMuted);
        setVerifyError("");
        setIsInRegisterUi(false);
        setIsInVerifyUi(true);
      } else if (data.type === "login_success" && data.token) {
        // Test campaigns skip verification entirely - registration logs straight into the game.
        enterGameAsPlayer(inputUsername, data.token, registerStartMuted);
      }
    } catch (err: any) {
      const msg = err.message || "An unknown error occurred during registration.";
      setLastError(msg);
      setRegisterError(msg);
      setIsInErrorUi(true);
    } finally {
      setIsAuthenticating(false);
    }
  };

  const handleVerifySubmit = async (code: string) => {
    setIsAuthenticating(true);
    setVerifyError("");
    try {
      const data = await verifyEmailCode(username, code);
      enterGameAsPlayer(username, data.token, pendingStartMuted);
    } catch (err: any) {
      setVerifyError(err.message || "Verification failed.");
    } finally {
      setIsAuthenticating(false);
    }
  };

  const handleResendCode = async () => {
    setIsResendingCode(true);
    setVerifyError("");
    try {
      const data = await loginUser(username, pendingPassword);
      if (data.type === "verification_required") {
        // A fresh code has been emailed - nothing else to do here.
      } else if (data.type === "login_success" && data.token) {
        // Already got verified in the meantime (e.g. via another tab) - just log in.
        enterGameAsPlayer(username, data.token, pendingStartMuted);
      }
    } catch (err: any) {
      setVerifyError(err.message || "Could not resend the code.");
    } finally {
      setIsResendingCode(false);
    }
  };

  const handleForgotPasswordSubmit = async (forgotUsername: string, email: string) => {
    setIsAuthenticating(true);
    setForgotPasswordError("");
    try {
      await forgotPassword(forgotUsername, email);
      setUsername(forgotUsername);
      setResetPasswordError("");
      setIsInForgotPasswordUi(false);
      setIsInResetPasswordUi(true);
    } catch (err: any) {
      setForgotPasswordError(err.message || "Could not request a password reset.");
    } finally {
      setIsAuthenticating(false);
    }
  };

  const handleResetPasswordSubmit = async (code: string, newPassword: string, newPasswordConfirm: string) => {
    setIsAuthenticating(true);
    setResetPasswordError("");
    try {
      const data = await resetPassword(username, code, newPassword, newPasswordConfirm);
      enterGameAsPlayer(username, data.token, false);
    } catch (err: any) {
      setResetPasswordError(err.message || "Could not reset your password.");
    } finally {
      setIsAuthenticating(false);
    }
  };

  const updateAdminState = (data: any) => {
    setCampaigns(data.campaigns || []);
    setPlayers(data.players || []);
    setFinishedPlayersAmount(data.finished_player_amount || 0);
    setSumPerChallenge(data.metric_sum_per_challenge || []);
    setSumPerChallengeIncrease(data.metric_sum_per_challenge_increase || []);
    setIntroQuestionaireAverage(data.intro_questionaire_average || 0);
    setOutroQuestionaireAverage(data.outro_questionaire_average || 0);
    setQuestionaireResults(data.questionaire_results || []);
  };

  const handleAddCampaign = async (
    newCampaignName: string,
    newCampaignKey: string,
    isActive: boolean = true,
    useQuestionnaire: boolean = true,
    isTestCampaign: boolean = false
  ) => {
    try {
      const updated = await addAdminCampaign(
        adminToken, newCampaignName, newCampaignKey, isActive, useQuestionnaire, isTestCampaign
      );
      updateAdminState(updated);
    } catch (err: any) {
      setLastError(err.message || "Failed to add campaign.");
      setIsInErrorUi(true);
    }
  };

  const handleUpdateCampaign = async (
    campaignKey: string,
    updates: {
      is_active?: boolean;
      use_questionnaire?: boolean;
      allow_replay?: boolean;
      campaign_name?: string;
      is_test_campaign?: boolean;
    }
  ) => {
    try {
      const updated = await updateAdminCampaign(adminToken, campaignKey, updates);
      updateAdminState(updated);
    } catch (err: any) {
      setLastError(err.message || "Failed to update campaign.");
      setIsInErrorUi(true);
    }
  };

  const handleRemoveCampaign = async (removeCampaignKey: string) => {
    try {
      const updated = await removeAdminCampaign(adminToken, removeCampaignKey);
      updateAdminState(updated);
    } catch (err: any) {
      setLastError(err.message || "Failed to remove campaign.");
      setIsInErrorUi(true);
    }
  };

  const handleRemovePlayer = async (playerName: string) => {
    try {
      const updated = await removeAdminPlayer(adminToken, playerName);
      updateAdminState(updated);
    } catch (err: any) {
      setLastError(err.message || "Failed to remove player.");
      setIsInErrorUi(true);
    }
  };

  const handleRemoveAllPlayers = async () => {
    try {
      const updated = await removeAllAdminPlayers(adminToken);
      updateAdminState(updated);
    } catch (err: any) {
      setLastError(err.message || "Failed to delete all players.");
      setIsInErrorUi(true);
    }
  };

  return (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        overflow: "hidden",
        position: "relative",
        backgroundImage: `url("${import.meta.env.BASE_URL}graphics/bg_3.png")`,
        backgroundSize: "cover",
        backgroundPosition: "center",
        backgroundRepeat: "no-repeat",
        transform: "translateZ(0)",
        willChange: "transform",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "radial-gradient(circle at center, rgba(17, 48, 62, 0.55) 0%, rgba(10, 25, 34, 0.8) 100%)",
          pointerEvents: "none",
          zIndex: 1,
        }}
      />
      <div style={{ position: "relative", zIndex: 2, width: "100%", height: "100%" }}>
        <ErrorDialog errorMsg={lastError} setIsOpen={setIsInErrorUi} isOpen={isInErrorUi} />
        <AnimatePresence mode="wait" initial={false}>
        {(() => {
          const screenStyle: CSSProperties = {
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
          };
          // Home/Login/Register/Loading are just a small card centered on a
          // static background - there's nothing to gain from cross-fading the
          // whole (transparent, full-viewport) screen behind them, and doing so
          // is exactly what triggered the Chromium compositing flicker. So these
          // just swap instantly; each card animates its own small entrance
          // instead (see the `motion.div` around the card in each component).
          // isAuthenticating is checked after every form screen below, not before, so a
          // register/login/verify/forgot/reset submission that fails doesn't unmount its form
          // (and lose whatever the player typed) - each of those screens already shows its own
          // inline loading state via the `isLoading` prop. It still applies as a fallback for
          // transitions that have no form of their own to stay on (entering the game, entering
          // the admin dashboard while its data loads).
          if (isInLoginUi) {
            return (
              <div key="login" style={screenStyle}>
                <Login
                  readyState={ReadyState.OPEN}
                  onSubmit={handleLoginSubmit}
                  onForgotPassword={() => {
                    setLoginError("");
                    setForgotPasswordError("");
                    setIsInLoginUi(false);
                    setIsInForgotPasswordUi(true);
                  }}
                  onBack={() => {
                    setLoginError("");
                    setIsInLoginUi(false);
                  }}
                  isLoading={isAuthenticating}
                  errorMessage={loginError}
                  onClearError={() => setLoginError("")}
                />
              </div>
            );
          } else if (isInRegisterUi) {
            return (
              <div key="register" style={screenStyle}>
                <Register
                  readyState={ReadyState.OPEN}
                  onSubmit={handleRegisterSubmit}
                  onBack={() => {
                    setRegisterError("");
                    setIsInRegisterUi(false);
                  }}
                  isLoading={isAuthenticating}
                  errorMessage={registerError}
                  onClearError={() => setRegisterError("")}
                />
              </div>
            );
          } else if (isInVerifyUi) {
            return (
              <div key="verify" style={screenStyle}>
                <VerifyEmail
                  username={username}
                  onSubmit={handleVerifySubmit}
                  onResend={handleResendCode}
                  onBack={() => {
                    setVerifyError("");
                    setPendingPassword("");
                    setIsInVerifyUi(false);
                  }}
                  isLoading={isAuthenticating}
                  isResending={isResendingCode}
                  errorMessage={verifyError}
                  onClearError={() => setVerifyError("")}
                />
              </div>
            );
          } else if (isInForgotPasswordUi) {
            return (
              <div key="forgot-password" style={screenStyle}>
                <ForgotPassword
                  onSubmit={handleForgotPasswordSubmit}
                  onBack={() => {
                    setForgotPasswordError("");
                    setIsInForgotPasswordUi(false);
                    setIsInLoginUi(true);
                  }}
                  isLoading={isAuthenticating}
                  errorMessage={forgotPasswordError}
                  onClearError={() => setForgotPasswordError("")}
                />
              </div>
            );
          } else if (isInResetPasswordUi) {
            return (
              <div key="reset-password" style={screenStyle}>
                <ResetPassword
                  username={username}
                  onSubmit={handleResetPasswordSubmit}
                  onBack={() => {
                    setResetPasswordError("");
                    setIsInResetPasswordUi(false);
                  }}
                  isLoading={isAuthenticating}
                  errorMessage={resetPasswordError}
                  onClearError={() => setResetPasswordError("")}
                />
              </div>
            );
          } else if (isAuthenticating) {
            return (
              <div key="loading" style={screenStyle}>
                <LoadingScreen />
              </div>
            );
          } else if (isInGame) {
            return (
              <motion.div {...FADE_TRANSITION} key="game" style={screenStyle}>
                <WebSocketProvider username={username}>
                  <GlossaryProvider>
                    <SettingsProvider username={username} startMuted={startMuted}>
                      <Game username={username} />
                    </SettingsProvider>
                  </GlossaryProvider>
                </WebSocketProvider>
              </motion.div>
            );
          } else if (isInAdminUi) {
            return (
              <motion.div {...FADE_TRANSITION} key="admin" style={screenStyle}>
                <Admin
                  adminToken={adminToken}
                  onDashboardUpdate={updateAdminState}
                  campaigns={campaigns}
                  players={players}
                  sum_per_challenge_increase={sumPerChallengeIncrease}
                  addCampaign={handleAddCampaign}
                  updateCampaign={handleUpdateCampaign}
                  removeCampaign={handleRemoveCampaign}
                  removePlayer={handleRemovePlayer}
                  removeAllPlayers={handleRemoveAllPlayers}
                  finished_players_amount={finishedPlayersAmount}
                  sum_per_challenge={sumPerChallenge}
                  intro_questionaire_average={introQuestionaireAverage}
                  outro_questionaire_average={outroQuestionaireAverage}
                  questionaire_results={questionaireResults}
                />
              </motion.div>
            );
          } else {
            return (
              <div key="home" style={screenStyle}>
                <Home
                  onLogin={() => {
                    setLoginError("");
                    setIsInLoginUi(true);
                  }}
                  onRegister={() => {
                    setRegisterError("");
                    setIsInRegisterUi(true);
                  }}
                />
              </div>
            );
          }
        })()}
      </AnimatePresence>
      </div>
    </div>
  );
}

export default App;
