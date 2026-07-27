import { useState } from "react";
import { ReadyState } from "../services/websocket/types";
import styles from "./Login.module.css";

interface LoginProps {
  onSubmit: (username: string) => void;
  readyState: ReadyState;
}

export function Login({ onSubmit, readyState }: LoginProps) {
  const [username, setUsername] = useState("");
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
      <div className={`${styles.loginContainer}`}>
        <h1 className={`${styles.loginTitle} text-center`}>
          Login
        </h1>
        <p className={`${styles.loginSubtitle} text-center`}>please enter your username to resume playing from your last saved game </p>
        <form
          className={styles.loginForm}
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit(username);
          }}
        >
          <input
            type="text"
            className="form-control"
            placeholder="username"
            onChange={(e) => setUsername(e.target.value)}
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
    </div>

  );
}
