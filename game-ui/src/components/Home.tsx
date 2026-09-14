import { Icon } from "@iconify/react";
import { motion } from "motion/react";
import styles from "./Home.module.css";

interface HomeProps {
  onLogin: () => void;
  onRegister: () => void;
}

export function Home({ onLogin, onRegister }: HomeProps) {
  return (
    <div className={styles.homeWrapper}>
      {/* Main Title & Play Menu Section */}
      <motion.div
        className={styles.contentContainer}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.22, ease: "easeOut" }}
      >
        <h1 className={styles.title}>
          <Icon icon="ph:flask-bold" className={styles.titleIcon} />
          <span>MLOps Labs</span>
        </h1>

        <p className={styles.subtitle}>
          A serious game for stakeholder engagement in Machine Learning Operations (MLOps)
        </p>

        <div className={styles.menuSection}>
          <button
            className={`d-flex align-items-center justify-content-center gap-2 ${styles.actionButton}`}
            onClick={onRegister}
          >
            <Icon icon="ph:play-bold" style={{ fontSize: "1.2rem" }} />
            <span>Start a New Game</span>
          </button>

          <button
            className={`d-flex align-items-center justify-content-center gap-2 ${styles.secondaryMenuButton}`}
            onClick={onLogin}
          >
            <Icon icon="ph:sign-in-bold" style={{ fontSize: "1.2rem" }} />
            <span>Resume Game with Username</span>
          </button>
        </div>
      </motion.div>

      {/* Title Screen Footer Credits */}
      <motion.div
        className={styles.footerWrapper}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.22, ease: "easeOut", delay: 0.05 }}
      >
        <div className={styles.creditsCard}>
          <div className="d-flex align-items-center justify-content-center gap-2 text-white-50 text-center small">
            <Icon
              icon="ph:graduation-cap-bold"
              className="flex-shrink-0"
              style={{ color: "rgba(255, 255, 255, 0.75)", fontSize: "1.15rem" }}
            />
            <span style={{ fontSize: "0.82rem", lineHeight: "1.4" }}>
              Developed at the Chair of Databases and Information Systems (i5), RWTH Aachen University
            </span>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

export default Home;
