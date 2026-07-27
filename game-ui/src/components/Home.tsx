
import styles from "./Home.module.css";


interface HomeProps {
  onLogin: () => void;
  onRegister: () => void;
}

export function Home({ onLogin, onRegister }: HomeProps) {
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


      <div className={styles.homeContainer}>
        <h1 className={`${styles.homeTitle} text-center`}>
          Welcome to MLOps Labs
        </h1>
        <h2 className={`${styles.homeSubtitle} text-center`}>
          a serious game for MLOps stakeholder engagement
        </h2>

        <p className={`${styles.homeSubSubtitle} text-center`}>
          This prototype was developed in the context of the bachelor's thesis "CHALLENGE: Collaborative Human-Agent Learning for Leveraging Engagement in Negotiated Governance of MLOps" at the Chair of Databases and Information Systems (i5) at RWTH Aachen University.
        </p>

        <div className={styles.buttonGroup}>
          <button
            className={styles.actionButton}
            onClick={onRegister}
          >
            Start a New Game
          </button>

          <button
            className={styles.actionButton}
            onClick={onLogin}
          >
            Login with Username
          </button>
        </div>
      </div></div>
  );
}
