import {
  Dialog,
  DialogPanel,
  DialogTitle,
  DialogBackdrop,
} from "@headlessui/react";
import { Icon } from "@iconify/react";
import styles from "./ErrorDialog.module.css";

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
      onClose={() => setIsOpen(false)}
      transition
      className="position-relative"
      style={{ zIndex: 10000 }}
    >
      <DialogBackdrop transition className={styles.backdrop} />
      <div className={styles.dialogWrapper}>
        <DialogPanel transition className={styles.panel}>
          {/* Header */}
          <div className={styles.header}>
            <DialogTitle className="h5 mb-0 fw-bold d-flex align-items-center gap-2 text-white">
              <Icon icon="ph:warning-circle-bold" style={{ color: "#ffffffff", fontSize: "1.7rem" }} />
              <span>Error</span>
            </DialogTitle>
          </div>

          {/* Body */}
          <div className="p-4">
            <div
              className="card shadow-sm border-0 rounded-3 p-3 mb-4 bg-white"
              style={{ border: "1px solid #dee2e6" }}
            >
              <div className="d-flex align-items-start gap-2">

                <p className="mb-0 text-dark fw-medium" style={{ fontSize: "0.95rem", lineHeight: "1.5" }}>
                  {errorMsg || "An error occurred. Please try again."}
                </p>
              </div>
            </div>

            <div className="d-flex justify-content-end">
              <button
                className={`d-flex align-items-center justify-content-center gap-2 ${styles.actionButton}`}
                onClick={() => setIsOpen(false)}
              >
                <span>Okay</span>
              </button>
            </div>
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  );
}
