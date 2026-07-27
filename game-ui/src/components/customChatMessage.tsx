import styles from "./customChatMessage.module.css";


interface CustomChatMessageProps {
  message: string;
  onClick: () => void;
  is_active: boolean;
}


export default function CustomChatMessage({ message, onClick, is_active }: CustomChatMessageProps) {
  return is_active && (
    <>
      <div className={`${styles.item} ${styles.itemIn}`} onClick={onClick}>
        <div className={styles.balloon} style={{ backgroundColor: 'white' }}>
          <div style={{ color: 'black' }}>{message}</div>
          <div className={`${styles.arrowContainer} ${styles.arrowLeftContainer}`}>
            <svg className={styles.arrowLeft} width="10" height="10" viewBox="0 0 10 10">
              <path d="M10 0 L0 10 L10 10 Z" fill="white" />
            </svg>
          </div>
        </div>
      </div>
    </>
  );
}