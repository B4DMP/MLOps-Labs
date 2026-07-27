import {
  Description,
  Dialog,
  DialogPanel,
  DialogTitle,
  DialogBackdrop,
} from "@headlessui/react";
import styles from "./PrePhaseDialog.module.css";

interface ErrorDialogProps {
  isOpen: boolean;
  errorMsg: string;
  setIsOpen: (open: boolean) => void;
}

export default function ErrorDialog({
  isOpen,
  errorMsg,
  setIsOpen,

}: ErrorDialogProps) {
  return (
    <Dialog
      open={isOpen}
      onClose={() => {
        setIsOpen(false);
      }}
      className={styles.dialogWrapper}
    >
      <DialogBackdrop className={styles.backdrop} />
      <div
        className={`${styles.dialogWrapper}`}
      >
        <DialogPanel className={`${styles.panel} card shadow-lg`}>
          <div className="card-body">
            <DialogTitle className="h4 mb-3">
              <span>Error</span>
            </DialogTitle>
            <Description as="div" className="text-muted mb-3">
              {errorMsg}
            </Description>

            <div className={styles.actions}>
              <button
                className={`${styles.actionButton}`}
                onClick={() => {
                  setIsOpen(false);
                }}
              >
                Okay
              </button>
            </div>
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  );
}
