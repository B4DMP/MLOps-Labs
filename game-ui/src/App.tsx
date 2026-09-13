import { useState, type CSSProperties } from "react";
import { Home } from "./components/Home";
import { Login } from "./components/Login";
import { Register } from "./components/Register";
import Game from "./Game";
import ErrorDialog from "./components/ErrorDialog";
import { Admin } from "./components/Admin";
import LoadingScreen from "./components/LoadingScreen";
import { ReadyState } from "./services/websocket/types";

import { loginUser, registerUser } from "./services/api/auth";
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
import { motion, AnimatePresence } from "motion/react";
import { FADE_TRANSITION } from "./utils/transitions";

interface Campaign {
  name: string;
  key: string;
  is_active: boolean;
  use_questionnaire: boolean;
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
  const [isInGame, setIsInGame] = useState(false);
  const [username, setUsername] = useState("");
  const [isInErrorUi, setIsInErrorUi] = useState(false);
  const [lastError, setLastError] = useState("");
  const [loginError, setLoginError] = useState("");
  const [registerError, setRegisterError] = useState("");
  const [isInAdminUi, setIsInAdminUi] = useState(false);
  const [adminToken, setAdminToken] = useState("");

  const [isAuthenticating, setIsAuthenticating] = useState(false);

  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [finishedPlayersAmount, setFinishedPlayersAmount] = useState(0);
  const [sumPerChallenge, setSumPerChallenge] = useState<number[]>([]);
  const [sumPerChallengeIncrease, setSumPerChallengeIncrease] = useState<number[]>([]);
  const [introQuestionaireAverage, setIntroQuestionaireAverage] = useState(0);
  const [outroQuestionaireAverage, setOutroQuestionaireAverage] = useState(0);
  const [questionaireResults, setQuestionaireResults] = useState<any>([]);

  const handleLoginSubmit = async (inputUsername: string) => {
    setIsAuthenticating(true);
    setLoginError("");
    try {
      const data = await loginUser(inputUsername);
      if (data.type === "login_success") {
        setUsername(inputUsername);
        setIsInLoginUi(false);
        setIsInGame(true);
      } else if (data.type === "admin_login_success" && data.token) {
        setAdminToken(data.token);
        setIsInLoginUi(false);
        setIsInAdminUi(true);
        const dashData = await fetchAdminDashboard(data.token);
        updateAdminState(dashData);
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

  const handleRegisterSubmit = async (inputUsername: string, campaignKey: string) => {
    setIsAuthenticating(true);
    setRegisterError("");
    try {
      const data = await registerUser(inputUsername, campaignKey);
      if (data.type === "admin_login_success" && data.token) {
        setAdminToken(data.token);
        setIsInRegisterUi(false);
        setIsInAdminUi(true);
        const dashData = await fetchAdminDashboard(data.token);
        updateAdminState(dashData);
      } else if (data.type === "register_success") {
        setUsername(inputUsername);
        setIsInRegisterUi(false);
        setIsInGame(true);
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
    useQuestionnaire: boolean = true
  ) => {
    try {
      const updated = await addAdminCampaign(adminToken, newCampaignName, newCampaignKey, isActive, useQuestionnaire);
      updateAdminState(updated);
    } catch (err: any) {
      setLastError(err.message || "Failed to add campaign.");
      setIsInErrorUi(true);
    }
  };

  const handleUpdateCampaign = async (
    campaignKey: string,
    updates: { is_active?: boolean; use_questionnaire?: boolean; campaign_name?: string }
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
          if (isAuthenticating) {
            return (
              <div key="loading" style={screenStyle}>
                <LoadingScreen />
              </div>
            );
          } else if (isInLoginUi) {
            return (
              <div key="login" style={screenStyle}>
                <Login
                  readyState={ReadyState.OPEN}
                  onSubmit={handleLoginSubmit}
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
          } else if (isInGame) {
            return (
              <motion.div {...FADE_TRANSITION} key="game" style={screenStyle}>
                <WebSocketProvider username={username}>
                  <GlossaryProvider>
                    <Game username={username} />
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
