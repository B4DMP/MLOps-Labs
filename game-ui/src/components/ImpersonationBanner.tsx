import { Icon } from "@iconify/react";
import styles from "./ImpersonationBanner.module.css";

interface ImpersonationBannerProps {
  email: string;
  onExit: () => void;
}

export function ImpersonationBanner({ email, onExit }: ImpersonationBannerProps) {
  return (
    <div className={styles.banner} role="status">
      <Icon icon="ph:eye-bold" aria-hidden="true" />
      <span>
        Viewing as <strong>{email}</strong> (read-only)
      </span>
      <button type="button" className={styles.exit} onClick={onExit}>
        Exit
      </button>
    </div>
  );
}
