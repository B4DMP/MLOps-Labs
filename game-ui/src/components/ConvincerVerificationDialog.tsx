import { useContext } from "react";
import {
  Dialog,
  DialogPanel,
  DialogTitle,
  DialogBackdrop,
} from "@headlessui/react";
import { Icon } from "@iconify/react";
import styles from "./ConvincerVerificationDialog.module.css";
import { StakeholderContext } from "./StakeholderProvider";
import StakeholderAvatarComponent from "./StakeholderAvatarComponent";

export interface ConvincerVerificationInfo {
  was_correct: boolean;
  stakeholder_id: string;
  stakeholder_name: string;
  categorized_archetype?: string;
  old_archetype?: string;
  true_archetype: string;
  strategy?: string;
  explanation?: string;
}

interface ConvincerVerificationDialogProps {
  info: ConvincerVerificationInfo | null;
  onClose: () => void;
}

export default function ConvincerVerificationDialog({
  info,
  onClose,
}: ConvincerVerificationDialogProps) {
  const { stakeholders, convincerArchetypes } = useContext(StakeholderContext);

  if (!info) return null;

  const isCorrect = info.was_correct;

  const stakeholder = Object.values(stakeholders || {}).find(
    (s) =>
      s.id === info.stakeholder_id ||
      s.name?.toLowerCase() === info.stakeholder_name?.toLowerCase()
  );

  const stakeholderColor = stakeholder?.stakeholder_color || "#2563eb";

  const matchedArchetype = Object.values(convincerArchetypes || {}).find(
    (a) => a.name?.toLowerCase() === info.true_archetype?.toLowerCase()
  );

  const strategyText = info.strategy || matchedArchetype?.strategy || "";

  return (
    <Dialog open={Boolean(info)} onClose={onClose} className={styles.dialogRoot}>
      <DialogBackdrop className={styles.backdrop} />
      <div className={styles.dialogWrapper}>
        <DialogPanel className={`${styles.panel} card shadow-lg border-0`}>
          {/* Header matching Phase Briefing style */}
          <div
            className="p-3 d-flex align-items-center justify-content-between text-white"
            style={{ backgroundColor: "var(--primary-bg)" }}
          >
            <DialogTitle className="h5 mb-0 fw-bold d-flex align-items-center gap-2">
              <Icon
                icon={isCorrect ? "ph:seal-check-bold" : "ph:arrows-clockwise-bold"}
                style={{ color: "var(--secondary-bg)", fontSize: "1.8rem" }}
              />
              <span>
                {isCorrect
                  ? "Convincer Archetype Validated"
                  : "Convincer Archetype Refuted"}
              </span>
            </DialogTitle>
            <span
              className="badge px-3 py-2 rounded-pill fw-semibold"
              style={{
                backgroundColor: "rgba(255, 255, 255, 0.2)",
                color: "#ffffff",
                fontSize: "0.85rem",
                letterSpacing: "0.5px",
              }}
            >
              {isCorrect ? "Confirmed Match" : "Dossier Correction"}
            </span>
          </div>

          {/* Modal Body */}
          <div className={styles.modalBody}>
            {/* 1. Stakeholder & Archetype Card (matching Phase Objectives Card style) */}
            <div
              className="card shadow-sm w-100"
              style={{
                background: "#ffffff",
                border: "1px solid #dee2e6",
                borderRadius: "0.75rem",
                overflow: "hidden",
              }}
            >
              <div
                className="card-header d-flex align-items-center gap-3"
                style={{
                  background: "var(--primary-bg)",
                  color: "white",
                  padding: "0.85rem 1.25rem",
                  borderTopLeftRadius: "0.75rem",
                  borderTopRightRadius: "0.75rem",
                  borderLeft: `6px solid ${stakeholderColor}`,
                }}
              >
                {/* Stakeholder Avatar with stakeholderColor accent border */}
                <div
                  className="d-flex align-items-center justify-content-center flex-shrink-0"
                  style={{
                    width: "56px",
                    height: "56px",
                    borderRadius: "50%",
                    border: `2px solid ${stakeholderColor}`,
                    backgroundColor: "rgba(255, 255, 255, 0.15)",
                    overflow: "hidden",
                  }}
                >
                  <StakeholderAvatarComponent
                    avatar={stakeholder?.avatar}
                    stakeholderColor={stakeholderColor}
                    isFramed={false}
                    size={52}
                    title={info.stakeholder_name}
                  />
                </div>

                <div className="flex-grow-1 min-w-0">
                  <div className="d-flex align-items-center gap-2 flex-wrap">
                    <h5 className="mb-0 fw-bold text-white">
                      {info.stakeholder_name}
                    </h5>

                  </div>
                  {stakeholder?.role_description && (
                    <div
                      className="small text-white-50 text-truncate mt-1"
                      style={{ fontSize: "0.85rem" }}
                      title={stakeholder.role_description}
                    >
                      {stakeholder.role_description}
                    </div>
                  )}
                </div>
              </div>

              <div className="card-body bg-white text-dark p-3">
                {isCorrect ? (
                  <>
                    <p
                      className="card-text text-secondary fst-italic mb-3"
                      style={{ fontSize: "0.95rem" }}
                    >
                      Your persuasion approach matched this stakeholder's actual
                      decision-making style.
                    </p>
                    <div
                      className="d-flex align-items-center justify-content-between p-3 rounded-3"
                      style={{
                        background: "#f1f5f9",
                        border: "1px solid #e2e8f0",
                      }}
                    >
                      <div>
                        <div
                          className="text-muted small mb-1 fw-semibold text-uppercase"
                          style={{ letterSpacing: "0.5px", fontSize: "0.75rem" }}
                        >
                          Confirmed Archetype
                        </div>
                        <div className="fw-bold fs-5 text-dark d-flex align-items-center gap-2">
                          <Icon
                            icon="ph:check-circle-fill"
                            style={{
                              color: "var(--primary-bg)",
                              fontSize: "1.4rem",
                            }}
                          />
                          <span>{info.true_archetype}</span>
                        </div>
                      </div>
                      <span className="badge bg-success px-3 py-2 rounded-pill fw-semibold">
                        Verified
                      </span>
                    </div>
                  </>
                ) : (
                  <>
                    <p
                      className="card-text text-secondary fst-italic mb-3"
                      style={{ fontSize: "0.95rem" }}
                    >
                      During the conversation, this stakeholder's response
                      revealed that your assumed convincer archetype did not align
                      with their true priorities.
                    </p>
                    <div className="row g-2 align-items-stretch">
                      <div className="col-12 col-md-6">
                        <div
                          className="p-3 rounded-3 h-100"
                          style={{
                            background: "#f8fafc",
                            border: "1px solid #e2e8f0",
                          }}
                        >
                          <div
                            className="text-muted small mb-1 fw-semibold text-uppercase"
                            style={{
                              letterSpacing: "0.5px",
                              fontSize: "0.75rem",
                            }}
                          >
                            Assumed Archetype
                          </div>
                          <div
                            className="fw-semibold text-danger d-flex align-items-center gap-1"
                            style={{ fontSize: "1.05rem" }}
                          >
                            <Icon
                              icon="ph:x-circle-bold"
                              className="flex-shrink-0"
                            />
                            <span className="text-decoration-line-through">
                              {info.old_archetype ||
                                info.categorized_archetype ||
                                "Unknown"}
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className="col-12 col-md-6">
                        <div
                          className="p-3 rounded-3 h-100"
                          style={{
                            background: "rgba(37, 99, 235, 0.06)",
                            border: "1px solid var(--secondary-bg)",
                          }}
                        >
                          <div
                            className="small mb-1 fw-bold text-uppercase"
                            style={{
                              color: "var(--primary-bg)",
                              letterSpacing: "0.5px",
                              fontSize: "0.75rem",
                            }}
                          >
                            True Archetype (Revealed)
                          </div>
                          <div
                            className="fw-bold d-flex align-items-center gap-1"
                            style={{
                              color: "var(--primary-bg)",
                              fontSize: "1.05rem",
                            }}
                          >
                            <Icon
                              icon="ph:sparkle-bold"
                              className="flex-shrink-0"
                              style={{ color: "var(--secondary-bg)" }}
                            />
                            <span>{info.true_archetype}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* 2. Persuasion Strategy Section */}
            {strategyText && (
              <div>
                <div className={styles.sectionHeader}>
                  <h6 className={styles.sectionTitle}>
                    <Icon
                      icon="ph:lightbulb-bold"
                      style={{
                        color: "var(--primary-bg)",
                        fontSize: "1.4rem",
                      }}
                    />
                    <span>Persuasion & Communication Strategy</span>
                  </h6>
                </div>
                <div
                  className="card shadow-sm w-100"
                  style={{
                    background: "#ffffff",
                    border: "1px solid #dee2e6",
                    borderRadius: "0.75rem",
                  }}
                >
                  <div className="card-body bg-white text-dark p-3">
                    <p
                      className="card-text text-dark fs-6 mb-2"
                      style={{ lineHeight: "1.5" }}
                    >
                      <strong>Effective Approach: </strong>
                      {strategyText}
                    </p>
                    <div className="d-flex align-items-center gap-2 text-muted small pt-2 border-top">
                      <Icon
                        icon="ph:info-bold"
                        className="flex-shrink-0"
                        style={{
                          color: "var(--primary-bg)",
                          fontSize: "1rem",
                        }}
                      />
                      <span>
                        Your <strong>Stakeholder Dossier</strong> has been
                        automatically updated with this verified profile.
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* 3. Action Button Footer */}
            <div className={styles.actions}>
              <button className={styles.actionButton} onClick={onClose}>
                <span>Acknowledge & Continue</span>
                <Icon icon="ph:arrow-right-bold" />
              </button>
            </div>
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  );
}
