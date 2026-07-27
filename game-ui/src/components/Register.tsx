import { useState } from "react";
import { ReadyState } from "../services/websocket/types";
import styles from "./Register.module.css";

interface RegisterProps {
  onSubmit: (username: string, campaignKey: string) => void;
  readyState: ReadyState;
}

export function Register({ onSubmit, readyState }: RegisterProps) {
  const [username, setUsername] = useState("");
  const [campaignKey, setCampaignKey] = useState("");
  return (
    <div
      className={`container-fluid vh-100 d-flex flex-column justify-content-center overflow-hidden position-relative `}
      style={{
        backgroundImage: `url("${import.meta.env.BASE_URL}graphics/bg_3.png")`,
        backgroundSize: "cover",
        backgroundPosition: "center",
        backgroundRepeat: "no-repeat",
      }}
    >
      <div className={`${styles.registerContainer}`}>
        <h1 className={`${styles.registerTitle} text-center`}>
          Register new user
        </h1>
        <p className={`${styles.registerSubtitle} text-center`}>To start a new game, please enter your username below. Additionally, please enter your campaign key below, which was provided when you received the invitation to participate in this study. </p>
        <p className={`${styles.registerSubtitle} text-center`}>
          <span style={{ textDecoration: "underline", color: "#ffffffff" }}>By playing the game, you agree that your actions within the game will be tracked and analyzed for research purposes, and that the results may be published in anonymized form.</span></p>
        <form
          className={styles.registerForm}
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit(username, campaignKey);
          }}
        >
          <input
            type="text"
            className="form-control"
            placeholder="username"
            onChange={(e) => setUsername(e.target.value)}
          />
          <input
            type="text"
            className="form-control"
            placeholder="campaign key"
            onChange={(e) => setCampaignKey(e.target.value)}
          />
          <button
            type="submit"
            className={styles.actionButton}
            disabled={readyState !== ReadyState.OPEN}
          >
            {readyState === ReadyState.OPEN ? "Start Game" : "Connecting..."}
          </button>
        </form>
      </div>
    </div >

  );
}
