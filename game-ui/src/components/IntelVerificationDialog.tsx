import { useContext } from "react";
import { Icon } from "@iconify/react";
import styles from "./online_intel_gathering.module.css";
import { StakeholderContext } from "./StakeholderProvider";
import HoverTooltip from "./HoverToolTip";

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

  if (!isOpen || !resultData) return null;

  const wasCorrect = resultData.wasCorrect;
  const formattedOldType = resultData.oldType.replace(/_/g, " ");
  const formattedTrueType = resultData.trueType.replace(/_/g, " ");

  const stakeholder = Object.values(stakeholders || {}).find(
    (s) =>
      s.name?.toLowerCase() === resultData.stakeholderName.toLowerCase() ||
      s.id?.toLowerCase() === resultData.stakeholderName.toLowerCase() ||
      s.name?.toLowerCase().replace(/_/g, " ") === resultData.stakeholderName.toLowerCase().replace(/_/g, " ") ||
      s.id?.toLowerCase().replace(/_/g, " ") === resultData.stakeholderName.toLowerCase().replace(/_/g, " ")
  );

  return (
    <div
      className={styles.modalBackdrop}
      onClick={onClose}
      style={{ zIndex: 1070 }}
    >
      <div
        className={styles.intelModal}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "600px",
          maxWidth: "92vw",
          height: "auto",
          maxHeight: "85vh",
          borderRadius: "16px",
          overflow: "hidden",
        }}
      >
        {/* Header matching OnlineIntelHelpOverlay / PrePhaseDialog modal system */}
        <div
          className={styles.modalHeader}
          style={{
            background: wasCorrect ? "#198754" : "#ffc107",
            color: wasCorrect ? "#ffffff" : "#212529",
            padding: "1.15rem 1.5rem",
          }}
        >
          <h5 className="modal-title mb-0 fw-bold d-flex align-items-center gap-2 fs-5">
            <Icon
              icon={wasCorrect ? "ph:check-circle-bold" : "ph:warning-circle-bold"}
              style={{ fontSize: "2rem" }}
            />
            {wasCorrect ? "Categorized Correctly & Verified!" : "Categorization Corrected & Verified!"}
          </h5>
          <button
            type="button"
            className={`btn-close ${wasCorrect ? "btn-close-white" : ""}`}
            onClick={onClose}
            aria-label="Close"
          />
        </div>

        {/* Modal Body */}
        <div className={styles.modalBody} style={{ padding: "1.5rem", color: "#212529", overflowY: "auto" }}>
          {wasCorrect ? (
            <div className="alert alert-success border-0 shadow-sm d-flex align-items-center gap-3 mb-4 rounded-3 p-3">
              <Icon icon="ph:sparkle-bold" className="fs-2 text-success flex-shrink-0" />
              <div>
                <strong className="d-block mb-1 text-dark fs-6">Excellent Stance Analysis!</strong>
                <span className="text-dark" style={{ fontSize: "0.95rem" }}>
                  You correctly identified this stance as <strong className="text-capitalize">{formattedTrueType}</strong>. The requirement has been officially verified in your dossier.
                </span>
              </div>
            </div>
          ) : (
            <div className="alert alert-warning border-0 shadow-sm d-flex align-items-start gap-3 mb-4 rounded-3 p-3" style={{ background: "#fff9e6", borderLeft: "4px solid #ffc107" }}>
              <Icon icon="ph:info-bold" className="fs-2 text-dark flex-shrink-0 mt-1" />
              <div>
                <strong className="d-block mb-1 text-dark fs-6">Categorization Corrected!</strong>
                <p className="mb-2 text-dark" style={{ fontSize: "0.95rem", lineHeight: "1.5" }}>
                  You originally categorized this intel as{" "}
                  <span className="badge bg-secondary text-decoration-line-through me-1 text-capitalize">
                    {formattedOldType}
                  </span>
                  . The correct categorization is{" "}
                  <span className="badge bg-primary fw-bold ms-1 text-capitalize">
                    {formattedTrueType}
                  </span>
                  .
                </p>
                <small className="text-dark opacity-75">
                  The intel item has now been updated to its true categorization and marked as verified in your dossier.
                </small>
              </div>
            </div>
          )}

          {/* Detailed Verified Requirement Card */}
          <div className="card border-0 bg-light p-3 rounded-3 shadow-sm">
            <div className="d-flex align-items-center justify-content-between mb-2">
              <span className="badge bg-primary text-capitalize fs-6 px-3 py-1">
                {formattedTrueType}
              </span>
              <span className="badge bg-success fs-6 px-3 py-1">
                <Icon icon="ph:seal-check-fill" className="me-1" /> Verified Stance
              </span>
            </div>
            <h6 className="fw-bold text-dark mb-1 fs-6 d-flex align-items-center gap-1">
              <span>Source:</span>
              {stakeholder && stakeholder.role_description ? (
                <HoverTooltip description={stakeholder.role_description}>
                  <span
                    className="text-dark"
                    style={{
                      fontWeight: "bold",
                      cursor: "help",
                    }}
                  >
                    {stakeholder.name}
                  </span>
                </HoverTooltip>
              ) : (
                <span className="fw-bold text-dark">
                  {resultData.stakeholderName}
                </span>
              )}
            </h6>
            <p
              className="text-secondary mb-0"
              style={{
                fontSize: "0.95rem",
                lineHeight: "1.5",
              }}
            >
              {resultData.description}
            </p>
          </div>
        </div>

        {/* Modal Footer */}
        <div className={styles.modalFooter} style={{ padding: "1rem 1.5rem" }}>
          <button
            className="btn btn-primary rounded-pill px-4 fw-bold"
            onClick={onClose}
          >
            Got it, Continue
          </button>
        </div>
      </div>
    </div>
  );
}
