import { useEffect, useState } from "react";
import { Icon } from "@iconify/react";
import styles from "./Admin.module.css";
import HoverTooltip from "./HoverToolTip";
import { TeacherDashboardView } from "./TeacherDashboardView";
import {
  createAdminTeacher,
  deleteAdminTeacher,
  fetchAdminTeacherPreview,
  fetchAdminTeachers,
  updateAdminTeacherCampaigns,
  updateAdminTeacherPassword,
  type AdminTeacher,
} from "../services/api/admin";
import type { Campaign } from "./Admin";

interface TeacherManagerProps {
  campaigns: Campaign[];
}

function CampaignCheckboxes({
  campaigns,
  selected,
  onToggle,
  idPrefix,
}: {
  campaigns: Campaign[];
  selected: Set<string>;
  onToggle: (key: string) => void;
  idPrefix: string;
}) {
  if (campaigns.length === 0) {
    return <p className="text-muted small mb-0">No campaigns exist yet - create one in Campaigns & Players first.</p>;
  }
  return (
    <div className="d-flex flex-wrap gap-3">
      {campaigns.map((c) => (
        <div className="form-check d-flex align-items-center gap-2 m-0" key={c.key}>
          <input
            className="form-check-input mt-0"
            type="checkbox"
            id={`${idPrefix}-${c.key}`}
            checked={selected.has(c.key)}
            onChange={() => onToggle(c.key)}
            style={{ cursor: "pointer" }}
          />
          <label
            className="form-check-label small fw-semibold text-secondary"
            htmlFor={`${idPrefix}-${c.key}`}
            style={{ cursor: "pointer" }}
          >
            {c.name}
          </label>
        </div>
      ))}
    </div>
  );
}

/** Admin-side management of the teacher role: create/delete teacher accounts, assign which
 * campaigns each one may monitor, and open the same live monitoring screen a teacher sees -
 * but with the campaign selection made freely here rather than fixed to one teacher's
 * assignment (docs request: admins pick the campaign set dynamically). */
export function TeacherManager({ campaigns }: TeacherManagerProps) {
  const [teachers, setTeachers] = useState<AdminTeacher[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  const [newName, setNewName] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newCampaignKeys, setNewCampaignKeys] = useState<Set<string>>(new Set());
  const [isCreating, setIsCreating] = useState(false);

  const [editingCampaignsFor, setEditingCampaignsFor] = useState<number | null>(null);
  const [editingKeys, setEditingKeys] = useState<Set<string>>(new Set());
  const [passwordResetFor, setPasswordResetFor] = useState<number | null>(null);
  const [passwordResetValue, setPasswordResetValue] = useState("");
  const [teacherToDelete, setTeacherToDelete] = useState<AdminTeacher | null>(null);

  const [previewKeys, setPreviewKeys] = useState<Set<string>>(new Set());
  const [activePreviewKeys, setActivePreviewKeys] = useState<string[] | null>(null);

  const loadTeachers = async () => {
    setIsLoading(true);
    try {
      const { teachers: fetched } = await fetchAdminTeachers();
      setTeachers(fetched);
      setError("");
    } catch (err: any) {
      setError(err.message || "Failed to load teacher accounts.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadTeachers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const campaignName = (key: string) => campaigns.find((c) => c.key === key)?.name || key;

  const toggleInSet = (set: Set<string>, key: string): Set<string> => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim() || !newPassword) return;
    if (newPassword.length < 8) {
      setError("Password must be at least 8 characters long.");
      return;
    }
    setIsCreating(true);
    setError("");
    try {
      await createAdminTeacher(newName.trim(), newPassword, Array.from(newCampaignKeys));
      setNewName("");
      setNewPassword("");
      setNewCampaignKeys(new Set());
      await loadTeachers();
    } catch (err: any) {
      setError(err.message || "Failed to create teacher account.");
    } finally {
      setIsCreating(false);
    }
  };

  const startEditingCampaigns = (teacher: AdminTeacher) => {
    setEditingCampaignsFor(teacher.id);
    setEditingKeys(new Set(teacher.campaign_keys));
  };

  const saveEditingCampaigns = async (teacherId: number) => {
    try {
      await updateAdminTeacherCampaigns(teacherId, Array.from(editingKeys));
      setEditingCampaignsFor(null);
      await loadTeachers();
    } catch (err: any) {
      setError(err.message || "Failed to update assigned campaigns.");
    }
  };

  const savePasswordReset = async (teacherId: number) => {
    if (!passwordResetValue) return;
    try {
      await updateAdminTeacherPassword(teacherId, passwordResetValue);
      setPasswordResetFor(null);
      setPasswordResetValue("");
    } catch (err: any) {
      setError(err.message || "Failed to reset the teacher's password.");
    }
  };

  const handleDelete = async (teacher: AdminTeacher) => {
    try {
      await deleteAdminTeacher(teacher.id);
      setTeacherToDelete(null);
      await loadTeachers();
    } catch (err: any) {
      setError(err.message || "Failed to delete teacher account.");
    }
  };

  return (
    <div className="d-flex flex-column gap-4">
      <div className={styles.cardSurface}>
        <div className={styles.sectionHeader}>
          <div>
            <h2 className={styles.sectionTitle}>
              <Icon icon="ph:chalkboard-teacher-bold" />
              <span>Teacher Accounts</span>
            </h2>
            <p className={styles.sectionSubtitle}>
              Create a login for each supervising teacher and assign the campaigns (e.g. one per
              classroom/room) they may watch in real time. Teachers can only monitor - they never
              get admin editing rights.
            </p>
          </div>
          <span className={`${styles.pillBadge} ${styles.badgePrimary}`}>
            {teachers.length} {teachers.length === 1 ? "Teacher" : "Teachers"}
          </span>
        </div>

        {error && (
          <div className="alert alert-danger py-2 px-3 mb-3" role="alert">
            {error}
          </div>
        )}

        <div className={`table-responsive ${styles.tableContainer}`}>
          <table className={`table align-middle ${styles.customTable}`}>
            <thead>
              <tr>
                <th>Name</th>
                <th>Assigned Campaigns</th>
                <th className="text-end">Actions</th>
              </tr>
            </thead>
            <tbody>
              {teachers.length > 0 ? (
                teachers.map((t) => (
                  <tr key={t.id}>
                    <td className="fw-bold">{t.user_name}</td>
                    <td>
                      {editingCampaignsFor === t.id ? (
                        <div className="d-flex flex-column gap-2">
                          <CampaignCheckboxes
                            campaigns={campaigns}
                            selected={editingKeys}
                            onToggle={(key) => setEditingKeys((prev) => toggleInSet(prev, key))}
                            idPrefix={`edit-${t.id}`}
                          />
                          <div className="d-flex gap-2">
                            <button
                              type="button"
                              className={styles.smallActionButton}
                              onClick={() => saveEditingCampaigns(t.id)}
                            >
                              <Icon icon="ph:check-bold" />
                              <span>Save</span>
                            </button>
                            <button
                              type="button"
                              className="btn btn-sm btn-outline-secondary"
                              onClick={() => setEditingCampaignsFor(null)}
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : t.campaign_keys.length > 0 ? (
                        <div className="d-flex flex-wrap gap-1">
                          {t.campaign_keys.map((key) => (
                            <span key={key} className={`${styles.pillBadge} ${styles.badgeNeutral}`}>
                              {campaignName(key)}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-muted small">No campaigns assigned</span>
                      )}
                    </td>
                    <td className="text-end">
                      {passwordResetFor === t.id ? (
                        <div className="d-inline-flex align-items-center gap-2">
                          <input
                            type="password"
                            className="form-control form-control-sm"
                            style={{ width: "160px" }}
                            placeholder="New password"
                            value={passwordResetValue}
                            onChange={(e) => setPasswordResetValue(e.target.value)}
                          />
                          <button
                            type="button"
                            className={styles.smallActionButton}
                            onClick={() => savePasswordReset(t.id)}
                          >
                            <Icon icon="ph:check-bold" />
                          </button>
                          <button
                            type="button"
                            className="btn btn-sm btn-outline-secondary"
                            onClick={() => {
                              setPasswordResetFor(null);
                              setPasswordResetValue("");
                            }}
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <div className="d-inline-flex align-items-center gap-2">
                          {editingCampaignsFor !== t.id && (
                            <HoverTooltip description="Change assigned campaigns">
                              <button
                                type="button"
                                className={styles.outlineButton}
                                style={{ padding: "0.35rem 0.75rem", fontSize: "0.8rem" }}
                                onClick={() => startEditingCampaigns(t)}
                              >
                                <Icon icon="ph:flag-banner-bold" />
                                <span>Campaigns</span>
                              </button>
                            </HoverTooltip>
                          )}
                          <HoverTooltip description="Set a new password">
                            <button
                              type="button"
                              className={styles.outlineButton}
                              style={{ padding: "0.35rem 0.75rem", fontSize: "0.8rem" }}
                              onClick={() => setPasswordResetFor(t.id)}
                            >
                              <Icon icon="ph:key-bold" />
                              <span>Password</span>
                            </button>
                          </HoverTooltip>
                          <HoverTooltip description="Delete teacher account" labelsChild>
                            <button
                              type="button"
                              className="btn btn-sm btn-outline-danger"
                              style={{ fontSize: "0.8rem" }}
                              onClick={() => setTeacherToDelete(t)}
                            >
                              <Icon icon="ph:trash-bold" />
                            </button>
                          </HoverTooltip>
                        </div>
                      )}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={3} className="text-center py-4 text-muted">
                    {isLoading ? "Loading..." : "No teacher accounts yet. Use the form below to create one."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className={styles.addCampaignBox}>
          <h6 className="fw-bold mb-2 text-dark d-flex align-items-center gap-1">
            <Icon icon="ph:plus-circle-bold" style={{ color: "var(--primary-bg)" }} />
            <span>Create New Teacher</span>
          </h6>
          <form onSubmit={handleCreate} className="d-flex flex-column gap-3">
            <div className="row g-2">
              <div className="col-md-5">
                <label className="form-label small fw-semibold text-secondary mb-1">Name</label>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="form-control form-control-sm"
                  placeholder="e.g. Prof. Schmidt"
                />
              </div>
              <div className="col-md-5">
                <label className="form-label small fw-semibold text-secondary mb-1">Password</label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="form-control form-control-sm"
                  placeholder="At least 8 characters"
                />
              </div>
              <div className="col-md-2 d-flex align-items-end">
                <button
                  type="submit"
                  disabled={!newName.trim() || !newPassword || isCreating}
                  className={styles.actionButton}
                  style={{ padding: "0.45rem 1rem", fontSize: "0.85rem" }}
                >
                  <Icon icon="ph:plus-bold" />
                  <span className="ms-1">Add</span>
                </button>
              </div>
            </div>
            <div>
              <label className="form-label small fw-semibold text-secondary mb-1 d-block">
                Assigned Campaigns
              </label>
              <CampaignCheckboxes
                campaigns={campaigns}
                selected={newCampaignKeys}
                onToggle={(key) => setNewCampaignKeys((prev) => toggleInSet(prev, key))}
                idPrefix="new-teacher"
              />
            </div>
          </form>
        </div>
      </div>

      <div className={styles.cardSurface}>
        <div className={styles.sectionHeader}>
          <div>
            <h2 className={styles.sectionTitle}>
              <Icon icon="ph:eye-bold" />
              <span>Live Monitoring Preview</span>
            </h2>
            <p className={styles.sectionSubtitle}>
              Open the same real-time dashboard a teacher would see, for any campaign selection
              you pick here - independent of any teacher's fixed assignment above.
            </p>
          </div>
        </div>

        <div className="d-flex flex-column gap-3">
          <CampaignCheckboxes
            campaigns={campaigns}
            selected={previewKeys}
            onToggle={(key) => setPreviewKeys((prev) => toggleInSet(prev, key))}
            idPrefix="preview"
          />
          <div>
            <button
              type="button"
              className={styles.actionButton}
              style={{ padding: "0.5rem 1.1rem", fontSize: "0.85rem" }}
              disabled={previewKeys.size === 0}
              onClick={() => setActivePreviewKeys(Array.from(previewKeys))}
            >
              <Icon icon="ph:play-bold" />
              <span className="ms-1">Open Live View</span>
            </button>
            {activePreviewKeys && (
              <button
                type="button"
                className="btn btn-sm btn-outline-secondary ms-2"
                onClick={() => setActivePreviewKeys(null)}
              >
                Close
              </button>
            )}
          </div>
        </div>
      </div>

      {activePreviewKeys && (
        <TeacherDashboardView
          key={activePreviewKeys.join(",")}
          fetchData={(campaignFilter) =>
            fetchAdminTeacherPreview(campaignFilter === "all" ? activePreviewKeys : [campaignFilter])
          }
        />
      )}

      {teacherToDelete && (
        <div className="modal d-block" style={{ background: "rgba(0,0,0,0.5)" }} tabIndex={-1}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">Delete teacher account?</h5>
              </div>
              <div className="modal-body">
                <p className="mb-0">
                  This removes <strong>{teacherToDelete.user_name}</strong>'s login. Their assigned
                  campaigns and player data are not affected.
                </p>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-outline-secondary" onClick={() => setTeacherToDelete(null)}>
                  Cancel
                </button>
                <button type="button" className="btn btn-danger" onClick={() => handleDelete(teacherToDelete)}>
                  Delete
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default TeacherManager;
