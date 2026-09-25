import { useContext, useState, useEffect } from "react";
import { Icon } from "@iconify/react";
import styles from "./IntelVerificationDialog.module.css";
import { StakeholderContext } from "./StakeholderProvider";
import HoverTooltip from "./HoverToolTip";
import { intelTagMeta } from "../types/IntelTag";
import { StakeholderAvatarComponent } from "./StakeholderAvatarComponent";
import OnceIcon from "./Results/OnceIcon";
import PUZZLE_SQUARE_ICON from "./Results/icons/puzzle-square.json";
import WARNING_TRIANGLE_ICON from "./Results/icons/warning-triangle.json";

export interface IntelVerificationResultData {
  wasCorrect: boolean;
  oldType: string;
  trueType: string;
  description: string;
  stakeholderName: string;
}

interface IntelVerificationDialogProps {
  isOpen: boolean;
  onClose: () => void;
  resultData: IntelVerificationResultData | null;
}

export default function IntelVerificationDialog({
  isOpen,
  onClose,
  resultData,
}: IntelVerificationDialogProps) {
  const { stakeholders } = useContext(StakeholderContext);
  const [isClosing, setIsClosing] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setIsClosing(false);
    }
  }, [isOpen]);

  const handleClose = () => {
    if (isClosing) return;
    setIsClosing(true);
    setTimeout(() => {
      setIsClosing(false);
      onClose();
    }, 200);
  };

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, isClosing]);

  if (!isOpen || !resultData) return null;

  const wasCorrect = resultData.wasCorrect;
  const trueMeta = intelTagMeta(resultData.trueType);
  const oldMeta = intelTagMeta(resultData.oldType);

  const stakeholder = Object.values(stakeholders || {}).find(
    (s) =>
      s.name?.toLowerCase() === resultData.stakeholderName.toLowerCase() ||
      s.id?.toLowerCase() === resultData.stakeholderName.toLowerCase() ||
      s.name?.toLowerCase().replace(/_/g, " ") === resultData.stakeholderName.toLowerCase().replace(/_/g, " ") ||
      s.id?.toLowerCase().replace(/_/g, " ") === resultData.stakeholderName.toLowerCase().replace(/_/g, " ")
  );

  return (
    <div
      className={`${styles.backdrop} ${isClosing ? styles.backdropClosing : ""}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      <div
        className={`${styles.panel} ${isClosing ? styles.panelClosing : ""}`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header matching PrePhaseDialog theme */}
        <div className={styles.header}>
          <h1 className={styles.headerTitle}>
            <Icon icon="ph:seal-check-bold" className={styles.headerIcon} />
            <span>Intel Stance Verification</span>
          </h1>
          <button
            type="button"
            className="btn-close btn-close-white"
            onClick={handleClose}
            aria-label="Close"
            title="Close (Esc)"
            style={{ cursor: "pointer" }}
          />
        </div>

        {/* Modal Body */}
        <div className={styles.modalBody}>
          {/* Result Status Banner */}
          <div
            className={`${styles.resultBanner} ${
              wasCorrect ? styles.resultBannerSuccess : styles.resultBannerWarning
            }`}
          >
            <OnceIcon
              icon={wasCorrect ? PUZZLE_SQUARE_ICON : WARNING_TRIANGLE_ICON}
              className={styles.bannerLordicon}
            />
            <div className={styles.bannerContent}>
              <h2 className={styles.bannerHeading}>
                {wasCorrect ? "Correct Stance Identified" : "Categorization Corrected"}
              </h2>
              <p className={styles.bannerText}>
                {wasCorrect ? (
                  <>
                    You correctly identified this stance as{" "}
                    <span
                      className={styles.tagPill}
                      style={{
                        backgroundColor: `${trueMeta.color}18`,
                        color: trueMeta.color,
                        borderColor: `${trueMeta.color}40`,
                      }}
                    >
                      <Icon icon={trueMeta.icon} />
                      {trueMeta.label}
                    </span>
                    . The item is now verified in your dossier.
                  </>
                ) : (
                  <>
                    Originally tagged as{" "}
                    <span className={styles.tagPillOld}>
                      <Icon icon={oldMeta.icon} />
                      <del>{oldMeta.label}</del>
                    </span>{" "}
                    → Corrected to{" "}
                    <span
                      className={styles.tagPill}
                      style={{
                        backgroundColor: `${trueMeta.color}18`,
                        color: trueMeta.color,
                        borderColor: `${trueMeta.color}40`,
                      }}
                    >
                      <Icon icon={trueMeta.icon} />
                      {trueMeta.label}
                    </span>
                    . Updated and verified in your dossier.
                  </>
                )}
              </p>
            </div>
          </div>

          {/* Intel Card */}
          <div className={styles.intelCard}>
            <div className={styles.intelCardHeader}>
              <div className={styles.intelCardHeaderTitle}>
                <Icon icon="ph:file-text-bold" />
                <span>Intel Item</span>
              </div>
              <span className={styles.verifiedStanceBadge}>
                <Icon icon="ph:seal-check-fill" />
                Verified {trueMeta.label}
              </span>
            </div>

            <div className={styles.intelCardBody}>
              <div className={styles.sourceRow}>
                {stakeholder && (
                  <StakeholderAvatarComponent
                    avatar={stakeholder.avatar}
                    stakeholderColor={stakeholder.stakeholder_color}
                    stakeholderId={stakeholder.id}
                    isFramed={false}
                    size={32}
                  />
                )}
                <div className={styles.sourceInfo}>
                  <span className={styles.sourceLabel}>Source:</span>
                  {stakeholder?.role_description ? (
                    <HoverTooltip description={stakeholder.role_description}>
                      <span className={styles.stakeholderName}>
                        {stakeholder.name}
                      </span>
                    </HoverTooltip>
                  ) : (
                    <span className={styles.stakeholderNamePlain}>
                      {stakeholder?.name || resultData.stakeholderName}
                    </span>
                  )}
                </div>
              </div>

              <div className={styles.descriptionBox}>
                <span className={styles.descriptionLabel}>
                  <Icon icon="ph:quotes-bold" />
                  Stance Statement
                </span>
                <p className={styles.descriptionText}>{resultData.description}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Footer matching PrePhaseDialog and design guidelines */}
        <div className={styles.footer}>
          <div className={styles.footerHint}>
            <Icon icon="ph:info-bold" className={styles.footerHintIcon} />
            <span>Updated in your dossier.</span>
          </div>
          <div className={styles.actions}>
            <button className={styles.actionButton} onClick={handleClose}>
              <span>Continue</span>
              <Icon icon="ph:arrow-right-bold" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

