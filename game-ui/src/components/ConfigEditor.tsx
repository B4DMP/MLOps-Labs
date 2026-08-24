import { useState, useEffect } from "react";
import { JsonForms, withJsonFormsControlProps } from "@jsonforms/react";
import { scopeEndsWith, rankWith, type ControlProps } from "@jsonforms/core";
import { createTheme, ThemeProvider } from "@mui/material/styles";
import { Button, IconButton } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import { materialRenderers, materialCells } from "@jsonforms/material-renderers";
import { vanillaRenderers, vanillaCells } from "@jsonforms/vanilla-renderers";
import {
  fetchAdminConfigs,
  fetchAdminConfigFile,
  saveAdminConfigFile,
  type ConfigFileInfo
} from "../services/api/admin";
import styles from "./Admin.module.css";

interface ConfigEditorProps {
  adminToken: string;
  onDashboardUpdate?: (data: any) => void;
}

const darkTheme = createTheme({
  palette: {
    mode: "dark",
    background: {
      default: "#181f2a",
      paper: "#1e293b",
    },
    text: {
      primary: "#f8fafc",
      secondary: "#cbd5e1",
    },
  },
  components: {
    MuiInputBase: {
      styleOverrides: {
        root: {
          color: "#f8fafc",
          backgroundColor: "#0f172a",
        },
      },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        notchedOutline: {
          borderColor: "#475569",
        },
      },
    },
    MuiTableCell: {
      styleOverrides: {
        root: {
          color: "#f8fafc",
          borderColor: "#334155",
        },
        head: {
          color: "#38bdf8",
          fontWeight: "bold",
          backgroundColor: "#0f172a",
        },
      },
    },
    MuiAccordionSummary: {
      defaultProps: {
        component: "div",
      },
    },
    MuiTypography: {
      styleOverrides: {
        root: {
          color: "#f8fafc",
        },
      },
    },
  },
});

const MetricChangesControl = (props: ControlProps) => {
  const { data, path, handleChange, label } = props;
  const currentMap: Record<string, number> = data && typeof data === "object" ? data : {};

  const handleValueChange = (key: string, val: string) => {
    const numVal = val === "" ? 0 : parseInt(val, 10);
    const newMap = { ...currentMap, [key]: isNaN(numVal) ? 0 : numVal };
    handleChange(path, newMap);
  };

  const handleRemoveKey = (key: string) => {
    const newMap = { ...currentMap };
    delete newMap[key];
    handleChange(path, newMap);
  };

  const handleAddKey = () => {
    const keyName = window.prompt("Enter metric name/ID to add to this challenge (e.g. model, automation, reliability, data, requirements, efficiency):");
    if (keyName && keyName.trim()) {
      const cleanKey = keyName.trim();
      if (!(cleanKey in currentMap)) {
        handleChange(path, { ...currentMap, [cleanKey]: 0 });
      }
    }
  };

  const entries = Object.entries(currentMap);

  return (
    <div className="mb-4 p-3 rounded bg-dark border border-secondary">
      <div className="d-flex justify-content-between align-items-center mb-2">
        <label className="fw-bold text-info m-0 fs-6">{label || "Metric Changes Matrix"}</label>
        <Button
          variant="outlined"
          color="info"
          size="small"
          startIcon={<AddIcon />}
          onClick={handleAddKey}
          sx={{ fontWeight: "bold", textTransform: "none" }}
        >
          Add Metric Change
        </Button>
      </div>

      {entries.length > 0 ? (
        <div className="row g-2 mt-1">
          {entries.map(([key, val]) => (
            <div key={key} className="col-md-6 col-lg-4">
              <div
                className="p-2 rounded border border-secondary d-flex align-items-center justify-content-between gap-2"
                style={{ backgroundColor: "#0f172a" }}
              >
                <span className="fw-bold text-light text-truncate" style={{ fontSize: "0.85rem" }}>
                  {key}:
                </span>
                <div className="d-flex align-items-center gap-1">
                  <input
                    type="number"
                    className="form-control form-control-sm bg-dark text-light border-secondary text-end"
                    value={val}
                    onChange={(e) => handleValueChange(key, e.target.value)}
                    style={{ width: "80px", padding: "4px 8px" }}
                  />
                  <IconButton
                    size="small"
                    color="error"
                    onClick={() => handleRemoveKey(key)}
                    title={`Remove ${key}`}
                  >
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-muted small mb-0 fst-italic">No metric changes configured for this challenge.</p>
      )}
    </div>
  );
};

const metricChangesControlEntry = {
  tester: rankWith(10, scopeEndsWith("metric_changes")),
  renderer: withJsonFormsControlProps(MetricChangesControl),
};

const renderers = [
  metricChangesControlEntry,
  ...(materialRenderers || []),
  ...(vanillaRenderers || [])
];

const cells = [
  ...(materialCells || []),
  ...(vanillaCells || [])
];


export function ConfigEditor({ adminToken, onDashboardUpdate }: ConfigEditorProps) {
  const [configFiles, setConfigFiles] = useState<ConfigFileInfo[]>([]);
  const [selectedFilename, setSelectedFilename] = useState<string>("");
  const [schema, setSchema] = useState<any>(null);
  const [uischema, setUiSchema] = useState<any>(null);
  const [originalData, setOriginalData] = useState<any>(null);
  const [currentData, setCurrentData] = useState<any>(null);
  const [rawJsonText, setRawJsonText] = useState<string>("");
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"form" | "json">("form");
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<{
    text: string;
    type: "success" | "danger" | "info";
  } | null>(null);

  const isModified =
    originalData !== null &&
    JSON.stringify(currentData) !== JSON.stringify(originalData);

  // Load available config files on mount
  useEffect(() => {
    loadConfigFiles();
  }, [adminToken]);

  const loadConfigFiles = async () => {
    setIsLoading(true);
    setStatusMessage(null);
    try {
      const files = await fetchAdminConfigs(adminToken);
      setConfigFiles(files);
      if (files.length > 0 && !selectedFilename) {
        setSelectedFilename(files[0].filename);
        await loadSingleConfig(files[0].filename);
      }
    } catch (err: any) {
      setStatusMessage({
        text: err.message || "Failed to load config files list.",
        type: "danger",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const loadSingleConfig = async (filename: string) => {
    setIsLoading(true);
    setStatusMessage(null);
    setJsonError(null);
    try {
      const res = await fetchAdminConfigFile(adminToken, filename);
      setSchema(res.schema || {});
      setUiSchema(res.uischema || null);
      setOriginalData(res.data);
      setCurrentData(res.data);
      setRawJsonText(JSON.stringify(res.data, null, 2));
    } catch (err: any) {
      setStatusMessage({
        text: err.message || `Failed to load ${filename}`,
        type: "danger",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleSelectFile = async (filename: string) => {
    if (isModified) {
      const confirmDiscard = window.confirm(
        "You have unsaved changes in the current file. Discard them and switch files?"
      );
      if (!confirmDiscard) return;
    }
    setSelectedFilename(filename);
    await loadSingleConfig(filename);
  };

  const handleJsonChange = (text: string) => {
    setRawJsonText(text);
    try {
      const parsed = JSON.parse(text);
      setCurrentData(parsed);
      setJsonError(null);
    } catch (e: any) {
      setJsonError(e.message);
    }
  };

  const handleFormChange = ({ data }: { data: any }) => {
    setCurrentData(data);
    setRawJsonText(JSON.stringify(data, null, 2));
    setJsonError(null);
  };

  const handleDiscard = () => {
    if (!originalData) return;
    setCurrentData(originalData);
    setRawJsonText(JSON.stringify(originalData, null, 2));
    setJsonError(null);
    setStatusMessage({
      text: "Changes discarded. Reset to latest saved version.",
      type: "info",
    });
  };

  const handleApply = async () => {
    if (jsonError) {
      setStatusMessage({
        text: `Cannot apply invalid JSON: ${jsonError}`,
        type: "danger",
      });
      return;
    }

    setIsSaving(true);
    setStatusMessage(null);
    try {
      const res = await saveAdminConfigFile(adminToken, selectedFilename, currentData);
      setOriginalData(res.file.data);
      setCurrentData(res.file.data);
      setSchema(res.file.schema || schema);
      setUiSchema(res.file.uischema || uischema);
      setRawJsonText(JSON.stringify(res.file.data, null, 2));
      setStatusMessage({
        text: res.message || "Successfully saved changes and reloaded runtime configuration!",
        type: "success",
      });
      if (res.dashboard && onDashboardUpdate) {
        onDashboardUpdate(res.dashboard);
      }
    } catch (err: any) {
      setStatusMessage({
        text: err.message || "Failed to apply configuration changes.",
        type: "danger",
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="mt-3">
      {/* Header & Controls Bar */}
      <div className="row g-3 align-items-center mb-3">
        <div className="col-md-5 d-flex align-items-center gap-2">
          <label className="fw-bold me-2 text-nowrap">Select Config File:</label>
          <select
            className="form-select form-select-sm bg-dark text-light border-secondary"
            value={selectedFilename}
            onChange={(e) => handleSelectFile(e.target.value)}
            disabled={isLoading || isSaving}
          >
            {configFiles.map((file) => (
              <option key={file.filename} value={file.filename}>
                {file.filename} ({(file.size / 1024).toFixed(1)} KB)
              </option>
            ))}
          </select>
        </div>

        <div className="col-md-3 d-flex align-items-center justify-content-center gap-2">
          <span className="fw-semibold">Status:</span>
          {isModified ? (
            <span className="badge bg-warning text-dark px-2 py-1">
              Unsaved Changes
            </span>
          ) : (
            <span className="badge bg-success px-2 py-1">All Changes Saved</span>
          )}
        </div>

        <div className="col-md-4 d-flex align-items-center justify-content-end gap-2">
          <div className="btn-group btn-group-sm" role="group">
            <button
              type="button"
              className={`btn ${viewMode === "form" ? "btn-info" : "btn-outline-info"}`}
              onClick={() => setViewMode("form")}
            >
              Form View (JSONForms)
            </button>
            <button
              type="button"
              className={`btn ${viewMode === "json" ? "btn-info" : "btn-outline-info"}`}
              onClick={() => setViewMode("json")}
            >
              Raw JSON
            </button>
          </div>
        </div>
      </div>

      {/* Alert Notification */}
      {statusMessage && (
        <div
          className={`alert alert-${statusMessage.type} alert-dismissible fade show d-flex align-items-center justify-content-between py-2 px-3 mb-3`}
          role="alert"
        >
          <span>{statusMessage.text}</span>
          <button
            type="button"
            className="btn-close"
            onClick={() => setStatusMessage(null)}
          ></button>
        </div>
      )}

      {/* Main Content Area */}
      {isLoading ? (
        <div className="text-center py-5">
          <div className="spinner-border text-info" role="status">
            <span className="visually-hidden">Loading configuration...</span>
          </div>
          <p className="mt-2 text-muted">Loading configuration data...</p>
        </div>
      ) : (
        <div className="card bg-dark text-light border-secondary p-3 mb-3 shadow-sm">
          {viewMode === "form" ? (
            <div
              className="jsonforms-container p-2"
              style={{
                maxHeight: "750px",
                overflowY: "auto",
                color: "#f8fafc",
              }}
            >
              <style>{`
                .jsonforms-container label,
                .jsonforms-container p,
                .jsonforms-container h1,
                .jsonforms-container h2,
                .jsonforms-container h3,
                .jsonforms-container h4,
                .jsonforms-container h5,
                .jsonforms-container h6,
                .jsonforms-container span,
                .jsonforms-container th,
                .jsonforms-container td,
                .jsonforms-container div {
                  color: #f8fafc !important;
                }
                .jsonforms-container input,
                .jsonforms-container textarea,
                .jsonforms-container select {
                  background-color: #0f172a !important;
                  color: #ffffff !important;
                  border: 1px solid #475569 !important;
                  border-radius: 6px !important;
                  padding: 8px 12px !important;
                }
                .jsonforms-container input:focus,
                .jsonforms-container textarea:focus,
                .jsonforms-container select:focus {
                  border-color: #38bdf8 !important;
                  outline: none !important;
                  box-shadow: 0 0 0 2px rgba(56, 189, 248, 0.3) !important;
                }
                .jsonforms-container table {
                  border-collapse: separate !important;
                  border-spacing: 0 6px !important;
                  width: 100% !important;
                }
                .jsonforms-container th {
                  background-color: #1e293b !important;
                  color: #38bdf8 !important;
                  font-weight: 700 !important;
                  padding: 10px !important;
                  border-bottom: 2px solid #334155 !important;
                }
                .jsonforms-container td {
                  background-color: #111827 !important;
                  padding: 10px !important;
                  border-top: 1px solid #1f2937 !important;
                  border-bottom: 1px solid #1f2937 !important;
                }
                .jsonforms-container svg {
                  fill: #94a3b8 !important;
                  color: #94a3b8 !important;
                }
                .jsonforms-container button svg {
                  fill: #38bdf8 !important;
                  color: #38bdf8 !important;
                }
              `}</style>
              {schema && currentData !== null ? (
                <ThemeProvider theme={darkTheme}>
                  <JsonForms
                    schema={schema}
                    uischema={uischema || undefined}
                    data={currentData}
                    renderers={renderers}
                    cells={cells}
                    onChange={handleFormChange}
                  />
                </ThemeProvider>
              ) : (
                <p className="text-muted">No data loaded.</p>
              )}
            </div>
          ) : (
            <div>
              {jsonError && (
                <div className="text-danger small mb-2">
                  <strong>JSON Syntax Error:</strong> {jsonError}
                </div>
              )}
              <textarea
                className="form-control font-monospace bg-black text-light border-secondary"
                rows={20}
                value={rawJsonText}
                onChange={(e) => handleJsonChange(e.target.value)}
                style={{ fontSize: "0.875rem" }}
              />
            </div>
          )}
        </div>
      )}

      {/* Action Footer */}
      <div className="d-flex justify-content-end align-items-center gap-3 mt-3">
        <button
          className="btn btn-outline-secondary"
          onClick={handleDiscard}
          disabled={!isModified || isSaving || isLoading}
        >
          Discard Changes
        </button>
        <button
          className={`${styles.expandButton} m-0 px-4 py-2`}
          onClick={handleApply}
          disabled={!isModified || isSaving || isLoading || !!jsonError}
          style={{ backgroundColor: "var(--primary-bg, #266682)" }}
        >
          {isSaving ? "Applying & Reloading..." : "Apply Changes"}
        </button>
      </div>
    </div>
  );
}
