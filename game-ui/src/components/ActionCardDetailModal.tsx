import { useState, useEffect } from "react";
import {
  Dialog,
  DialogPanel,
  DialogBackdrop,
} from "@headlessui/react";
import styles from "./ActionCardDetailModal.module.css";
import type { ActionCard } from "../types/ActionCard";
import type { Stakeholder } from "./StakeholderProvider";

import ActionCardCardComponent from "./ActionCardCardComponent";

export interface IntelItem {
  id: string;
  requirement_id?: string;
  intel_type?: string;
  categorized_type?: string;
  description?: string;
  stakeholder_id?: string;
  stakeholder_name?: string;
}

import type { ActionCardAddendum } from "./ActionCardCardComponent";

export interface ActionCardDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  actionCard: ActionCard | null;
  intelItems?: IntelItem[];
  addendums?: ActionCardAddendum[];
  stakeholders?: Record<string, Stakeholder>;
  getStakeholderColor?: (st: any) => string;
}

export default function ActionCardDetailModal({
  isOpen,
  onClose,
  actionCard,
  intelItems = [],
  addendums,
  stakeholders = {},
  getStakeholderColor = () => "var(--primary-bg)",
}: ActionCardDetailModalProps) {
  const [isClosing, setIsClosing] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setIsClosing(false);
    }
  }, [isOpen]);

  const handleRequestClose = () => {
    if (isClosing) return;
    setIsClosing(true);
    setTimeout(() => {
      setIsClosing(false);
      onClose();
    }, 200);
  };

  if (!isOpen || !actionCard) return null;

  return (
    <Dialog open={isOpen} onClose={handleRequestClose} className="position-relative z-50">
      <DialogBackdrop className={`${styles.backdrop} ${isClosing ? styles.backdropClosing : ""}`} />

      <div className={styles.dialogWrapper} onClick={handleRequestClose}>
        <DialogPanel
          className={`${styles.panel} ${isClosing ? styles.panelClosing : ""}`}
          onClick={(e) => e.stopPropagation()}
        >
          <ActionCardCardComponent
            card={actionCard}
            intelItems={intelItems}
            addendums={addendums}
            showAddendums={true}
            stakeholders={stakeholders}
            getStakeholderColor={getStakeholderColor}
            className={styles.cardExpanded}
            isInteractive={false}
            onClose={handleRequestClose}
          />
        </DialogPanel>
      </div>
    </Dialog>
  );
}
