import { Icon } from "@iconify/react";
import styles from "./Admin.module.css";
import { TeacherDashboardView } from "./TeacherDashboardView";
import { fetchTeacherDashboard, resetPlayerTokens } from "../services/api/teacher";

interface TeacherProps {
  userName: string;
  onLogout: () => void;
  /** Called instead of onLogout when a poll finds the session cookie has expired, so the app
   * can show "your session expired" rather than a silent, unexplained logout. */
  onSessionExpired: () => void;
}

/** The dedicated monitoring UI for the teacher role: read-only, scoped to whichever campaigns
 * an admin assigned this teacher (docs/plans - see TeacherManager.tsx for the admin side of the
 * assignment). Everything else here delegates to TeacherDashboardView, shared with the admin
 * panel's own free-campaign-choice preview of the same screen. */
export function Teacher({ userName, onLogout, onSessionExpired }: TeacherProps) {
  return (
    <div className={styles.wrapper}>
      <div className={styles.panel}>
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            <div className={styles.headerIcon}>
              <Icon icon="ph:chalkboard-teacher-bold" />
            </div>
            <div>
              <h1 className={styles.headerTitle}>Teacher Dashboard</h1>
            </div>
          </div>

          <div className={styles.headerActions}>
            <span className={styles.headerBadge}>
              <Icon icon="ph:user-circle-bold" />
              <span>{userName}</span>
            </span>
            <button
              type="button"
              className={styles.openGameButton}
              onClick={onLogout}
              title="Log out of the teacher session"
            >
              <Icon icon="ph:sign-out-bold" />
              <span>Logout</span>
            </button>
          </div>
        </div>

        <div className={styles.body}>
          <TeacherDashboardView
            fetchData={(campaignFilter) =>
              fetchTeacherDashboard(campaignFilter === "all" ? undefined : campaignFilter)
            }
            onAuthFailure={onSessionExpired}
            onResetTokens={async (email) => {
              await resetPlayerTokens(email);
            }}
          />
        </div>
      </div>
    </div>
  );
}

export default Teacher;
