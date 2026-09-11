import { useState } from "react";
import { Home } from "./components/Home";
import { Login } from "./components/Login";
import { Register } from "./components/Register";
import Game from "./Game";
import ErrorDialog from "./components/ErrorDialog";
import { Admin } from "./components/Admin";
import { ReadyState } from "./services/websocket/types";

import { loginUser, registerUser } from "./services/api/auth";
import { fetchAdminDashboard, addAdminCampaign, removeAdminCampaign } from "./services/api/admin";
import { WebSocketProvider } from "./services/websocket/WebSocketContext";
import GlossaryProvider from "./components/glossary/GlossaryProvider";

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
  const [isInAdminUi, setIsInAdminUi] = useState(false);
  const [adminToken, setAdminToken] = useState("");

  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [finishedPlayersAmount, setFinishedPlayersAmount] = useState(0);
  const [sumPerChallenge, setSumPerChallenge] = useState<number[]>([]);
  const [sumPerChallengeIncrease, setSumPerChallengeIncrease] = useState<number[]>([]);
  const [introQuestionaireAverage, setIntroQuestionaireAverage] = useState(0);
  const [outroQuestionaireAverage, setOutroQuestionaireAverage] = useState(0);
  const [questionaireResults, setQuestionaireResults] = useState<any>([]);

  const handleLoginSubmit = async (inputUsername: string) => {
    try {
      const data = await loginUser(inputUsername);
      if (data.type === "login_success") {
        setUsername(inputUsername);
        setIsInLoginUi(false);
        setIsInGame(true);
      }
    } catch (err: any) {
      setLastError(err.message || "An unknown error occurred during login.");
      setIsInErrorUi(true);
    }
  };

  const handleRegisterSubmit = async (inputUsername: string, campaignKey: string) => {
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
      setLastError(err.message || "An unknown error occurred during registration.");
      setIsInErrorUi(true);
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
    <>
      <ErrorDialog errorMsg={lastError} setIsOpen={setIsInErrorUi} isOpen={isInErrorUi} />
      {(() => {
        if (isInLoginUi) {
          return (
            <Login
              readyState={ReadyState.OPEN}
              onSubmit={handleLoginSubmit}
              onBack={() => setIsInLoginUi(false)}
            />
          );
        } else if (isInRegisterUi) {
          return (
            <Register
              readyState={ReadyState.OPEN}
              onSubmit={handleRegisterSubmit}
              onBack={() => setIsInRegisterUi(false)}
            />
          );
        } else if (isInGame) {
          return (
            <WebSocketProvider username={username}>
              <GlossaryProvider>
                <Game username={username} />
              </GlossaryProvider>
            </WebSocketProvider>
          );
        } else if (isInAdminUi) {
          return (
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
          );
        } else {
          return (
            <Home
              onLogin={() => setIsInLoginUi(true)}
              onRegister={() => setIsInRegisterUi(true)}
            />
          );
        }
      })()}
    </>
  );
}

export default App;
