import { useState } from "react";
import { Home } from "./components/Home";
import { Login } from "./components/Login";
import { Register } from "./components/Register";
import Game from "./Game";
import ErrorDialog from "./components/ErrorDialog";
import { Admin } from "./components/Admin";
import LoadingScreen from "./components/LoadingScreen";
import { ReadyState } from "./services/websocket/types";

import { loginUser, registerUser } from "./services/api/auth";
import { fetchAdminDashboard, addAdminCampaign, removeAdminCampaign } from "./services/api/admin";
import { WebSocketProvider } from "./services/websocket/WebSocketContext";
import GlossaryProvider from "./components/glossary/GlossaryProvider";
import { motion, AnimatePresence } from "motion/react";
import { FADE_TRANSITION } from "./utils/transitions";

interface Campaign {
  name: string;
  key: string;
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

  const handleAddCampaign = async (newCampaignName: string, newCampaignKey: string) => {
    try {
      const updated = await addAdminCampaign(adminToken, newCampaignName, newCampaignKey);
      updateAdminState(updated);
    } catch (err: any) {
      setLastError(err.message || "Failed to add campaign.");
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
        <AnimatePresence mode="wait">
        {(() => {
          if (isAuthenticating) {
            return (
              <motion.div {...FADE_TRANSITION} key="loading" style={{ width: "100%", height: "100%" }}>
                <LoadingScreen />
              </motion.div>
            );
          } else if (isInLoginUi) {
            return (
              <motion.div {...FADE_TRANSITION} key="login" style={{ width: "100%", height: "100%" }}>
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
              </motion.div>
            );
          } else if (isInRegisterUi) {
            return (
              <motion.div {...FADE_TRANSITION} key="register" style={{ width: "100%", height: "100%" }}>
                <Register
                  readyState={ReadyState.OPEN}
                  onSubmit={handleRegisterSubmit}
                  onBack={() => setIsInRegisterUi(false)}
                  isLoading={isAuthenticating}
                />
              </motion.div>
            );
          } else if (isInGame) {
            return (
              <motion.div {...FADE_TRANSITION} key="game" style={{ width: "100%", height: "100%" }}>
                <WebSocketProvider username={username}>
                  <GlossaryProvider>
                    <Game username={username} />
                  </GlossaryProvider>
                </WebSocketProvider>
              </motion.div>
            );
          } else if (isInAdminUi) {
            return (
              <motion.div {...FADE_TRANSITION} key="admin" style={{ width: "100%", height: "100%" }}>
                <Admin
                  adminToken={adminToken}
                  onDashboardUpdate={updateAdminState}
                  campaigns={campaigns}
                  players={players}
                  sum_per_challenge_increase={sumPerChallengeIncrease}
                  addCampaign={handleAddCampaign}
                  removeCampaign={handleRemoveCampaign}
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
              <motion.div {...FADE_TRANSITION} key="home" style={{ width: "100%", height: "100%" }}>
                <Home
                  onLogin={() => {
                    setLoginError("");
                    setIsInLoginUi(true);
                  }}
                  onRegister={() => setIsInRegisterUi(true)}
                />
              </motion.div>
            );
          }
        })()}
      </AnimatePresence>
      </div>
    </div>
  );
}

export default App;
