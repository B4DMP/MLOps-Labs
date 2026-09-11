import styles from "./LoadingScreen.module.css";

interface LoadingScreenProps {
  message?: string;
  submessage?: string;
  isConnected?: boolean;
}

export function LoadingScreen({
  message = "Loading Game...",
  submessage = "Retrieving saved progress and scenario data",
  isConnected,
}: LoadingScreenProps) {
  return (
    <div
      className="container-fluid vh-100 d-flex flex-column justify-content-center align-items-center overflow-hidden position-relative"
      style={{
        backgroundImage: `url("${import.meta.env.BASE_URL}graphics/bg_3.png")`,
        backgroundSize: "cover",
        backgroundPosition: "center",
        backgroundRepeat: "no-repeat",
      }}
    >
      <div className={styles.loadingContainer}>
        <div className={`spinner-border mb-4 ${styles.spinner}`} role="status">
          <span className="visually-hidden">Loading...</span>
        </div>
        <h2 className={styles.title}>{message}</h2>
        <p className={styles.subtitle}>{submessage}</p>
      </div>
    </div>
  );
}

export default LoadingScreen;
