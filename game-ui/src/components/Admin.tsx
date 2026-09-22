import { useState, useMemo, useEffect } from "react";
import { Icon } from "@iconify/react";
import styles from "./Admin.module.css";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';
import type { ChartOptions } from 'chart.js';
import { Line } from 'react-chartjs-2';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend
);

import { ConfigEditor } from "./ConfigEditor";
import { GraphDebug } from "./GraphDebug";
import AdminResults from "./Results/AdminResults";
import {
  fetchAdminDashboard,
  fetchAdminEmailStatus,
  sendAdminTestEmail,
  type AdminEmailStatus,
  type AdminTestEmailTemplate,
} from "../services/api/admin";

export interface Campaign {
  name: string;
  key: string;
  users: string[];
  is_active?: boolean;
  use_questionnaire?: boolean;
  allow_replay?: boolean;
  is_test_campaign?: boolean;
  require_email_verification?: boolean;
}

export interface Player {
  name: string;
  campaign_name: string;
  campaign_key?: string;
  gameProgression: string;
  introPercentage: number;
  outroPercentage: number;
  playTime: string;
  /** How many games they have started; more than one means they replayed. */
  runs?: number;
  /** They used a playtest tool, so their data is left out of the research aggregates. */
  playtestTainted?: boolean;
}

interface AdminProps {
  adminToken?: string;
  onDashboardUpdate?: (data: any) => void;
  campaigns: Campaign[];
  players: Player[];
  addCampaign: (
    campaignName: string,
    campaignKey: string,
    isActive?: boolean,
    useQuestionnaire?: boolean,
    isTestCampaign?: boolean,
    requireEmailVerification?: boolean
  ) => void;
  updateCampaign?: (
    campaignKey: string,
    updates: {
      is_active?: boolean;
      use_questionnaire?: boolean;
      allow_replay?: boolean;
      campaign_name?: string;
      is_test_campaign?: boolean;
      require_email_verification?: boolean;
    }
  ) => void;
  removeCampaign: (campaignKey: string) => void;
  removePlayer?: (playerName: string) => void;
  removeAllPlayers?: () => void;
  finished_players_amount: number;
  sum_per_challenge: number[];
  sum_per_challenge_increase: number[];
  intro_questionaire_average: number;
  outro_questionaire_average: number;
  questionaire_results: any;
}

type SortField = "name" | "campaign_name" | "gameProgression" | "introPercentage" | "outroPercentage" | "delta" | "playTime";
type SortDirection = "asc" | "desc";

export function Admin({
  adminToken = "",
  onDashboardUpdate,
  campaigns,
  players,
  addCampaign,
  updateCampaign,
  removeCampaign,
  removePlayer,
  removeAllPlayers,
  finished_players_amount,
  sum_per_challenge,
  sum_per_challenge_increase,
  intro_questionaire_average,
  outro_questionaire_average,
  questionaire_results,
}: AdminProps) {
  // Navigation
  const [activeSubpage, setActiveSubpage] = useState<"config" | "manager" | "analysis" | "results" | "graph_debug" | "email">("config");

  // Email / SMTP state
  const [emailStatus, setEmailStatus] = useState<AdminEmailStatus | null>(null);
  const [emailLoading, setEmailLoading] = useState(false);
  const [recipientEmail, setRecipientEmail] = useState("");
  const [emailTemplate, setEmailTemplate] = useState<AdminTestEmailTemplate>("generic");
  const [emailSending, setEmailSending] = useState(false);
  const [emailSuccessMessage, setEmailSuccessMessage] = useState<string | null>(null);
  const [emailErrorMessage, setEmailErrorMessage] = useState<string | null>(null);

  const loadEmailStatus = async () => {
    if (!adminToken) return;
    setEmailLoading(true);
    setEmailErrorMessage(null);
    try {
      const status = await fetchAdminEmailStatus(adminToken);
      setEmailStatus(status);
    } catch (err: any) {
      setEmailErrorMessage(err.message || "Failed to load SMTP status.");
    } finally {
      setEmailLoading(false);
    }
  };

  useEffect(() => {
    if (activeSubpage === "email" && !emailStatus && !emailLoading) {
      loadEmailStatus();
    }
  }, [activeSubpage, adminToken]);

  const handleSendTestEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adminToken || !recipientEmail) return;
    setEmailSending(true);
    setEmailSuccessMessage(null);
    setEmailErrorMessage(null);
    try {
      const res = await sendAdminTestEmail(adminToken, recipientEmail, emailTemplate);
      setEmailSuccessMessage(res.message);
    } catch (err: any) {
      setEmailErrorMessage(err.message || "Failed to send test email.");
    } finally {
      setEmailSending(false);
    }
  };

  // Campaign management state
  const [campaignName, setCampaignName] = useState("");
  const [campaignKey, setCampaignKey] = useState("");
  const [campaignIsActive, setCampaignIsActive] = useState(true);
  const [campaignUseQuestionnaire, setCampaignUseQuestionnaire] = useState(true);
  const [campaignIsTestCampaign, setCampaignIsTestCampaign] = useState(false);
  const [campaignRequireEmailVerification, setCampaignRequireEmailVerification] = useState(true);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [campaignToDelete, setCampaignToDelete] = useState<Campaign | null>(null);
  const [confirmDeletePlayer, setConfirmDeletePlayer] = useState<string | null>(null);
  const [showDeleteAllWarning, setShowDeleteAllWarning] = useState(false);

  // Player filtering and sorting state
  const [selectedCampaignFilter, setSelectedCampaignFilter] = useState<string>("all");
  const [playerSearchQuery, setPlayerSearchQuery] = useState("");
  const [playerStatusFilter, setPlayerStatusFilter] = useState<"all" | "finished" | "in_progress">("all");
  const [sortField, setSortField] = useState<SortField>("name");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");

  // Analysis / Questionnaire state
  const [analysisCampaignFilter, setAnalysisCampaignFilter] = useState<string>("all");
  const [questionSearchQuery, setQuestionSearchQuery] = useState("");
  const [questionFilterType, setQuestionFilterType] = useState<"all" | "intro" | "outro" | "notes">("all");
  const [displayPercentages, setDisplayPercentages] = useState(false);
  const [expandedQuestions, setExpandedQuestions] = useState<Record<string, boolean>>({});

  const handleAnalysisCampaignChange = async (newFilter: string) => {
    setAnalysisCampaignFilter(newFilter);
    if (adminToken && onDashboardUpdate) {
      try {
        const data = await fetchAdminDashboard(adminToken, newFilter);
        onDashboardUpdate(data);
      } catch (err) {
        console.error("Failed to fetch campaign dashboard data:", err);
      }
    }
  };

  // Quick helper to copy campaign key to clipboard
  const handleCopyKey = (key: string) => {
    navigator.clipboard.writeText(key);
    setCopiedKey(key);
    setTimeout(() => {
      setCopiedKey((curr) => (curr === key ? null : curr));
    }, 2000);
  };

  // Generate random campaign key helper (10 random letters and numbers without constant prefix)
  const handleGenerateRandomKey = () => {
    const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    const array = new Uint8Array(10);
    crypto.getRandomValues(array);
    const randomKey = Array.from(array, (byte) => chars[byte % chars.length]).join("");
    setCampaignKey(randomKey);
  };

  // Submit Add Campaign
  const handleAddCampaignSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (campaignName.trim() && campaignKey.trim()) {
      addCampaign(
        campaignName.trim(), campaignKey.trim(), campaignIsActive, campaignUseQuestionnaire,
        campaignIsTestCampaign, campaignRequireEmailVerification
      );
      setCampaignName("");
      setCampaignKey("");
      setCampaignIsActive(true);
      setCampaignUseQuestionnaire(true);
      setCampaignIsTestCampaign(false);
      setCampaignRequireEmailVerification(true);
    }
  };

  // Filter and sort players
  const filteredPlayers = useMemo(() => {
    return players
      .filter((p) => {
        // Campaign filter
        if (selectedCampaignFilter !== "all") {
          const selectedCampaign = campaigns.find(
            (c) => c.name === selectedCampaignFilter || c.key === selectedCampaignFilter
          );
          const matchName = p.campaign_name === selectedCampaignFilter;
          const matchKey =
            (p.campaign_key && p.campaign_key === selectedCampaignFilter) ||
            (selectedCampaign && p.campaign_key && p.campaign_key === selectedCampaign.key);
          if (!matchName && !matchKey) return false;
        }
        // Status filter
        const isFinished = p.gameProgression.toLowerCase().includes("finish") || p.gameProgression.toLowerCase() === "100%" || p.gameProgression.toLowerCase().includes("done");
        if (playerStatusFilter === "finished" && !isFinished) return false;
        if (playerStatusFilter === "in_progress" && isFinished) return false;
        // Search query
        if (playerSearchQuery.trim()) {
          const q = playerSearchQuery.toLowerCase();
          const matchName = p.name.toLowerCase().includes(q);
          const matchCampaign = p.campaign_name.toLowerCase().includes(q);
          const matchCampaignKey = p.campaign_key ? p.campaign_key.toLowerCase().includes(q) : false;
          if (!matchName && !matchCampaign && !matchCampaignKey) return false;
        }
        return true;
      })
      .sort((a, b) => {
        let valA: any = a[sortField as keyof Player];
        let valB: any = b[sortField as keyof Player];

        if (sortField === "delta") {
          valA = a.outroPercentage - a.introPercentage;
          valB = b.outroPercentage - b.introPercentage;
        }

        if (typeof valA === "string") {
          const comp = valA.localeCompare(valB);
          return sortDirection === "asc" ? comp : -comp;
        }
        if (valA < valB) return sortDirection === "asc" ? -1 : 1;
        if (valA > valB) return sortDirection === "asc" ? 1 : -1;
        return 0;
      });
  }, [players, campaigns, selectedCampaignFilter, playerStatusFilter, playerSearchQuery, sortField, sortDirection]);

  // Toggle sort direction
  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDirection("asc");
    }
  };

  // Export filtered players to CSV
  const handleExportCSV = () => {
    const headers = ["Player Name", "Campaign Name", "Progression", "Intro Score (%)", "Outro Score (%)", "Score Delta (%)", "Play Time"];
    const rows = filteredPlayers.map((p) => [
      `"${p.name.replace(/"/g, '""')}"`,
      `"${p.campaign_name.replace(/"/g, '""')}"`,
      `"${p.gameProgression.replace(/"/g, '""')}"`,
      p.introPercentage,
      p.outroPercentage,
      p.outroPercentage - p.introPercentage,
      `"${p.playTime.replace(/"/g, '""')}"`,
    ]);

    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `mlops_players_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Selected analysis campaign object
  const selectedAnalysisCampaign = useMemo(() => {
    if (analysisCampaignFilter === "all") return null;
    return campaigns.find((c) => c.name === analysisCampaignFilter || c.key === analysisCampaignFilter) || null;
  }, [campaigns, analysisCampaignFilter]);

  const isQuestionnaireActiveForAnalysis = selectedAnalysisCampaign
    ? selectedAnalysisCampaign.use_questionnaire !== false
    : true;

  // Filter players for analysis view
  const analysisFilteredPlayers = useMemo(() => {
    if (analysisCampaignFilter === "all") return players;
    return players.filter((p) => {
      const matchKey = p.campaign_key && p.campaign_key === analysisCampaignFilter;
      const matchName = p.campaign_name === analysisCampaignFilter;
      const matchKeyWithCampaign = selectedAnalysisCampaign && p.campaign_key === selectedAnalysisCampaign.key;
      return matchKey || matchName || matchKeyWithCampaign;
    });
  }, [players, analysisCampaignFilter, selectedAnalysisCampaign]);

  const analysisTotalPlayers = analysisCampaignFilter === "all" ? players.length : analysisFilteredPlayers.length;
  const analysisFinishedPlayers = analysisCampaignFilter === "all"
    ? finished_players_amount
    : analysisFilteredPlayers.filter((p) => {
      const prog = p.gameProgression.toLowerCase();
      return prog.includes("finish") || prog === "100%" || prog.includes("done");
    }).length;

  // Questionaire averages
  const localFinishedWithIntro = analysisFilteredPlayers.filter((p) => p.introPercentage > 0 || p.gameProgression.toLowerCase().includes("finish"));
  const localAvgIntro = localFinishedWithIntro.length > 0
    ? Math.round(localFinishedWithIntro.reduce((acc, p) => acc + p.introPercentage, 0) / localFinishedWithIntro.length)
    : intro_questionaire_average;
  const localFinishedWithOutro = analysisFilteredPlayers.filter((p) => p.gameProgression.toLowerCase().includes("finish"));
  const localAvgOutro = localFinishedWithOutro.length > 0
    ? Math.round(localFinishedWithOutro.reduce((acc, p) => acc + p.outroPercentage, 0) / localFinishedWithOutro.length)
    : outro_questionaire_average;

  const effectiveIntroAvg = analysisCampaignFilter === "all" ? intro_questionaire_average : localAvgIntro;
  const effectiveOutroAvg = analysisCampaignFilter === "all" ? outro_questionaire_average : localAvgOutro;
  const effectiveDeltaAverage = Math.round((effectiveOutroAvg - effectiveIntroAvg) * 10) / 10;

  // Chart datasets
  const sumChartData = {
    labels: (sum_per_challenge.length > 0 ? sum_per_challenge : [0, 0, 0, 0, 0]).map((_, index) => `Challenge ${index + 1}`),
    datasets: [
      {
        label: 'Avg Metric Sum',
        data: sum_per_challenge.length > 0 ? sum_per_challenge : [0, 0, 0, 0, 0],
        borderColor: 'rgb(38, 102, 130)',
        backgroundColor: 'rgba(38, 102, 130, 0.15)',
        borderWidth: 2.5,
        pointBackgroundColor: 'rgb(17, 48, 62)',
        pointBorderColor: '#ffffff',
        pointHoverBackgroundColor: '#ffffff',
        pointHoverBorderColor: 'rgb(38, 102, 130)',
        pointRadius: 4,
        tension: 0.3,
        fill: true,
      },
    ],
  };

  const sumIncreaseChartData = {
    labels: (sum_per_challenge_increase.length > 0 ? sum_per_challenge_increase : [0, 0, 0, 0, 0]).map((_, index) => `Challenge ${index + 1}`),
    datasets: [
      {
        label: 'Avg Metric Increase',
        data: sum_per_challenge_increase.length > 0 ? sum_per_challenge_increase : [0, 0, 0, 0, 0],
        borderColor: 'rgb(38, 102, 130)',
        backgroundColor: 'rgba(38, 102, 130, 0.15)',
        borderWidth: 2.5,
        pointBackgroundColor: 'rgb(17, 48, 62)',
        pointBorderColor: '#ffffff',
        pointHoverBackgroundColor: '#ffffff',
        pointHoverBorderColor: 'rgb(38, 102, 130)',
        pointRadius: 4,
        tension: 0.3,
        fill: true,
      },
    ],
  };

  const chartOptions: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: false,
      },
      tooltip: {
        mode: 'index',
        intersect: false,
        backgroundColor: 'rgba(17, 48, 62, 0.95)',
        titleColor: '#ffffff',
        bodyColor: '#ffffff',
        borderColor: 'rgba(38, 102, 130, 0.5)',
        borderWidth: 1,
        padding: 10,
        cornerRadius: 8,
      },
    },
    scales: {
      y: {
        beginAtZero: true,
        grid: {
          color: 'rgba(0, 0, 0, 0.06)',
        },
        ticks: {
          color: '#64748b',
          font: { weight: 500 },
        },
      },
      x: {
        grid: {
          display: false,
        },
        ticks: {
          color: '#64748b',
          font: { weight: 500 },
        },
      },
    },
  };

  // Questionnaire questions preparation
  const introQuestions = useMemo(() => {
    const list = questionaire_results["intro"] || [];
    return list.map((q: any, i: number) => ({ ...q, source: "intro", originalIndex: i }));
  }, [questionaire_results]);

  const outroQuestions = useMemo(() => {
    const list = questionaire_results["outro"] || [];
    return list.map((q: any, i: number) => ({ ...q, source: "outro", originalIndex: i }));
  }, [questionaire_results]);

  const filteredQuestions = useMemo(() => {
    let combined: any[] = [];
    if (questionFilterType === "all" || questionFilterType === "intro" || questionFilterType === "notes") {
      combined = [...combined, ...introQuestions];
    }
    if (questionFilterType === "all" || questionFilterType === "outro" || questionFilterType === "notes") {
      combined = [...combined, ...outroQuestions];
    }

    if (questionFilterType === "notes") {
      combined = combined.filter((q) =>
        q.answers.some((a: any) => a.notes && a.notes.length > 0)
      );
    }

    if (questionSearchQuery.trim()) {
      const q = questionSearchQuery.toLowerCase();
      combined = combined.filter((item) => item.question.toLowerCase().includes(q));
    }

    return combined;
  }, [introQuestions, outroQuestions, questionFilterType, questionSearchQuery]);

  const toggleQuestionExpanded = (id: string) => {
    setExpandedQuestions((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  const handleToggleAllQuestions = (expand: boolean) => {
    const next: Record<string, boolean> = {};
    filteredQuestions.forEach((q, idx) => {
      const key = `${q.source}-${q.originalIndex ?? idx}`;
      next[key] = expand;
    });
    setExpandedQuestions(next);
  };

  return (
    <div className={styles.wrapper}>
      <div className={styles.panel}>
        {/* Header - Oriented at BriefingPage theme */}
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            <div className={styles.headerIcon}>
              <Icon icon="ph:shield-chevron-bold" />
            </div>
            <div>
              <h1 className={styles.headerTitle}>Admin & Research Dashboard</h1>
            </div>
          </div>

          <div className={styles.headerActions}>
            <span className={styles.headerBadge}>
              <Icon icon="ph:users-bold" />
              <span>{players.length} Players</span>
            </span>
            <span className={styles.headerBadge}>
              <Icon icon="ph:folder-user-bold" />
              <span>{campaigns.length} Campaigns</span>
            </span>
            <a
              href={import.meta.env.BASE_URL || "/"}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.openGameButton}
              title="Open Login / Register page in a new tab"
            >
              <Icon icon="ph:arrow-square-out-bold" />
              <span>Game Login</span>
            </a>
          </div>
        </div>

        {/* Subpage Navigation Bar */}
        <div className={styles.navBar}>
          <div className={styles.navTabs}>
            <button
              type="button"
              className={`${styles.navTab} ${activeSubpage === "config" ? styles.navTabActive : ""}`}
              onClick={() => setActiveSubpage("config")}
            >
              <Icon icon="ph:sliders-horizontal-bold" />
              <span>Game Configuration</span>
            </button>
            <button
              type="button"
              className={`${styles.navTab} ${activeSubpage === "manager" ? styles.navTabActive : ""}`}
              onClick={() => setActiveSubpage("manager")}
            >
              <Icon icon="ph:users-three-bold" />
              <span>Campaigns & Players</span>
            </button>
            <button
              type="button"
              className={`${styles.navTab} ${activeSubpage === "analysis" ? styles.navTabActive : ""}`}
              onClick={() => setActiveSubpage("analysis")}
            >
              <Icon icon="ph:chart-line-up-bold" />
              <span>Analysis & Statistics</span>
            </button>
            <button
              type="button"
              className={`${styles.navTab} ${activeSubpage === "results" ? styles.navTabActive : ""}`}
              onClick={() => setActiveSubpage("results")}
            >
              <Icon icon="ph:trophy-bold" />
              <span>Results</span>
            </button>
            <button
              type="button"
              className={`${styles.navTab} ${activeSubpage === "graph_debug" ? styles.navTabActive : ""}`}
              onClick={() => setActiveSubpage("graph_debug")}
            >
              <Icon icon="ph:graph-bold" />
              <span>Graph Debug</span>
            </button>
            <button
              type="button"
              className={`${styles.navTab} ${activeSubpage === "email" ? styles.navTabActive : ""}`}
              onClick={() => setActiveSubpage("email")}
            >
              <Icon icon="ph:envelope-simple-bold" />
              <span>SMTP Email</span>
            </button>
          </div>

          <div className="text-muted small d-none d-md-block">
            {activeSubpage === "config" && "Modify challenges, intel facts, and stakeholder configs"}
            {activeSubpage === "manager" && `Managing ${campaigns.length} campaigns and ${players.length} players`}
            {activeSubpage === "analysis" && "Research metrics and questionnaire evaluations"}
            {activeSubpage === "results" && "How finished games went: grades, pillars, and each player's own results"}
            {activeSubpage === "graph_debug" && "Inspect the MLOps pipeline graph state per player"}
            {activeSubpage === "email" && "Inspect SMTP configuration and send test emails"}
          </div>
        </div>


        {/* Body Content */}
        <div className={styles.body}>
          {/* ======================================================== */}
          {/* SUBPAGE 1: CONFIG EDITOR                                 */}
          {/* ======================================================== */}
          {activeSubpage === "config" && (
            <div className={styles.cardSurface}>
              <div className={styles.sectionHeader}>
                <div>
                  <h2 className={styles.sectionTitle}>
                    <Icon icon="ph:gear-six-bold" />
                    <span>Scenario Configuration Editor</span>
                  </h2>
                  <p className={styles.sectionSubtitle}>
                    Configure scenario challenges, parameters, intel assets, and schema-driven definitions.
                  </p>
                </div>
              </div>
              <ConfigEditor
                adminToken={adminToken}
                onDashboardUpdate={onDashboardUpdate}
              />
            </div>
          )}

          {/* ======================================================== */}
          {/* SUBPAGE 2: CAMPAIGN & PLAYER MANAGER                     */}
          {/* ======================================================== */}
          {activeSubpage === "manager" && (
            <div className="d-flex flex-column gap-4">
              {/* Campaign Management Card */}
              <div className={styles.cardSurface}>
                <div className={styles.sectionHeader}>
                  <div>
                    <h2 className={styles.sectionTitle}>
                      <Icon icon="ph:flag-banner-bold" />
                      <span>Campaign Management</span>
                    </h2>
                    <p className={styles.sectionSubtitle}>
                      Create and distribute campaign access keys for workshops, courses, or experiment cohorts.
                    </p>
                  </div>
                  <span className={`${styles.pillBadge} ${styles.badgePrimary}`}>
                    {campaigns.length} Active {campaigns.length === 1 ? "Campaign" : "Campaigns"}
                  </span>
                </div>

                {/* Campaigns Table */}
                <div className={`table-responsive ${styles.tableContainer}`}>
                  <table className={`table align-middle ${styles.customTable}`}>
                    <thead>
                      <tr>
                        <th>Campaign Name</th>
                        <th>Access Key</th>
                        <th>Status</th>
                        <th>Questionnaire</th>
                        <th>Replay</th>
                        <th>Test Campaign</th>
                        <th>Email Verification</th>
                        <th>Enrolled Players</th>
                        <th className="text-end">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {campaigns.length > 0 ? (
                        campaigns.map((c) => (
                          <tr key={c.name}>
                            <td className="fw-bold">{c.name}</td>
                            <td>
                              <div className="d-flex align-items-center gap-2">
                                <code className="px-2 py-1 bg-light border rounded text-dark font-monospace">
                                  {c.key}
                                </code>
                                <button
                                  type="button"
                                  className={styles.copyKeyButton}
                                  onClick={() => handleCopyKey(c.key)}
                                  title="Copy access key to clipboard"
                                >
                                  <Icon icon={copiedKey === c.key ? "ph:check-bold" : "ph:copy-bold"} />
                                  <span style={{ fontSize: "0.75rem" }}>
                                    {copiedKey === c.key ? "Copied!" : "Copy"}
                                  </span>
                                </button>
                              </div>
                            </td>
                            <td>
                              <button
                                type="button"
                                onClick={() => updateCampaign && updateCampaign(c.key, { is_active: c.is_active === false ? true : false })}
                                className="btn btn-sm p-0 border-0"
                                style={{ background: "none", cursor: updateCampaign ? "pointer" : "default" }}
                                title={c.is_active !== false ? "Active: Click to deactivate (declines logins & registrations)" : "Inactive: Click to activate"}
                                disabled={!updateCampaign}
                              >
                                {c.is_active !== false ? (
                                  <span className="badge bg-success-subtle text-success border border-success-subtle px-2 py-1 d-inline-flex align-items-center gap-1">
                                    <Icon icon="ph:check-circle-bold" />
                                    <span>Active</span>
                                  </span>
                                ) : (
                                  <span className="badge bg-danger-subtle text-danger border border-danger-subtle px-2 py-1 d-inline-flex align-items-center gap-1">
                                    <Icon icon="ph:x-circle-bold" />
                                    <span>Inactive</span>
                                  </span>
                                )}
                              </button>
                            </td>
                            <td>
                              <button
                                type="button"
                                onClick={() => updateCampaign && updateCampaign(c.key, { use_questionnaire: c.use_questionnaire === false ? true : false })}
                                className="btn btn-sm p-0 border-0"
                                style={{ background: "none", cursor: updateCampaign ? "pointer" : "default" }}
                                title={c.use_questionnaire !== false ? "Questionnaire Enabled: Click to disable intro/outro surveys" : "Questionnaire Disabled: Click to enable"}
                                disabled={!updateCampaign}
                              >
                                {c.use_questionnaire !== false ? (
                                  <span className="badge bg-primary-subtle text-primary border border-primary-subtle px-2 py-1 d-inline-flex align-items-center gap-1">
                                    <Icon icon="ph:clipboard-text-bold" />
                                    <span>Enabled</span>
                                  </span>
                                ) : (
                                  <span className="badge bg-secondary-subtle text-secondary border border-secondary-subtle px-2 py-1 d-inline-flex align-items-center gap-1">
                                    <Icon icon="ph:prohibit-bold" />
                                    <span>Disabled</span>
                                  </span>
                                )}
                              </button>
                            </td>
                            <td>
                              <button
                                type="button"
                                onClick={() => updateCampaign && updateCampaign(c.key, { allow_replay: !c.allow_replay })}
                                className="btn btn-sm p-0 border-0"
                                style={{ background: "none", cursor: updateCampaign ? "pointer" : "default" }}
                                title={
                                  c.allow_replay
                                    ? "Replay allowed: players can start another game from the results screen. Click to disallow."
                                    : "Replay off: one run per player, as a research campaign wants. Click to allow."
                                }
                                disabled={!updateCampaign}
                              >
                                {c.allow_replay ? (
                                  <span className="badge bg-primary-subtle text-primary border border-primary-subtle px-2 py-1 d-inline-flex align-items-center gap-1">
                                    <Icon icon="ph:arrows-clockwise-bold" />
                                    <span>Allowed</span>
                                  </span>
                                ) : (
                                  <span className="badge bg-secondary-subtle text-secondary border border-secondary-subtle px-2 py-1 d-inline-flex align-items-center gap-1">
                                    <Icon icon="ph:prohibit-bold" />
                                    <span>Off</span>
                                  </span>
                                )}
                              </button>
                            </td>
                            <td>
                              <button
                                type="button"
                                onClick={() => updateCampaign && updateCampaign(c.key, { is_test_campaign: !c.is_test_campaign })}
                                className="btn btn-sm p-0 border-0"
                                style={{ background: "none", cursor: updateCampaign ? "pointer" : "default" }}
                                title={c.is_test_campaign ? "Test campaign: players skip email & verification. Click to make it a real campaign" : "Real campaign: click to make it a test campaign (players skip email & verification)"}
                                disabled={!updateCampaign}
                              >
                                {c.is_test_campaign ? (
                                  <span className="badge bg-warning-subtle text-warning-emphasis border border-warning-subtle px-2 py-1 d-inline-flex align-items-center gap-1">
                                    <Icon icon="ph:flask-bold" />
                                    <span>Test</span>
                                  </span>
                                ) : (
                                  <span className="badge bg-secondary-subtle text-secondary border border-secondary-subtle px-2 py-1 d-inline-flex align-items-center gap-1">
                                    <Icon icon="ph:minus-circle-bold" />
                                    <span>No</span>
                                  </span>
                                )}
                              </button>
                            </td>
                            <td>
                              <button
                                type="button"
                                onClick={() => updateCampaign && updateCampaign(c.key, { require_email_verification: c.require_email_verification === false ? true : false })}
                                className="btn btn-sm p-0 border-0"
                                style={{ background: "none", cursor: updateCampaign ? "pointer" : "default" }}
                                title={
                                  c.require_email_verification !== false
                                    ? "Verification required: players confirm a code sent to their email. Click to auto-verify instead."
                                    : "Verification skipped: players are auto-verified on registration (still requires a real email). Click to require a code."
                                }
                                disabled={!updateCampaign || c.is_test_campaign}
                              >
                                {c.is_test_campaign ? (
                                  <span className="badge bg-secondary-subtle text-secondary border border-secondary-subtle px-2 py-1 d-inline-flex align-items-center gap-1">
                                    <Icon icon="ph:minus-circle-bold" />
                                    <span>N/A</span>
                                  </span>
                                ) : c.require_email_verification !== false ? (
                                  <span className="badge bg-primary-subtle text-primary border border-primary-subtle px-2 py-1 d-inline-flex align-items-center gap-1">
                                    <Icon icon="ph:shield-check-bold" />
                                    <span>Required</span>
                                  </span>
                                ) : (
                                  <span className="badge bg-secondary-subtle text-secondary border border-secondary-subtle px-2 py-1 d-inline-flex align-items-center gap-1">
                                    <Icon icon="ph:prohibit-bold" />
                                    <span>Skipped</span>
                                  </span>
                                )}
                              </button>
                            </td>
                            <td>
                              <span className={`${styles.pillBadge} ${styles.badgeNeutral}`}>
                                <Icon icon="ph:user-bold" />
                                {c.users.length} {c.users.length === 1 ? "player" : "players"}
                              </span>
                            </td>
                            <td className="text-end">
                              <div className="d-inline-flex align-items-center gap-2">
                                <button
                                  type="button"
                                  className={styles.outlineButton}
                                  style={{ padding: "0.35rem 0.75rem", fontSize: "0.8rem" }}
                                  onClick={() => {
                                    setSelectedCampaignFilter(c.name);
                                    setPlayerStatusFilter("all");
                                    setPlayerSearchQuery("");
                                    // Scroll to players section smoothly
                                    const el = document.getElementById("players-section");
                                    if (el) el.scrollIntoView({ behavior: "smooth" });
                                  }}
                                  title={`Filter player table below to ${c.name}`}
                                >
                                  <Icon icon="ph:funnel-bold" />
                                  <span>View All Players</span>
                                </button>

                                <button
                                  type="button"
                                  className="btn btn-sm btn-outline-danger"
                                  style={{ fontSize: "0.8rem" }}
                                  onClick={() => setCampaignToDelete(c)}
                                  title="Delete Campaign"
                                >
                                  <Icon icon="ph:trash-bold" />
                                  <span className="ms-1">Delete</span>
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={6} className="text-center py-4 text-muted">
                            No campaigns created yet. Use the form below to add a campaign.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Add Campaign Box */}
                <div className={styles.addCampaignBox}>
                  <h6 className="fw-bold mb-2 text-dark d-flex align-items-center gap-1">
                    <Icon icon="ph:plus-circle-bold" style={{ color: "var(--primary-bg)" }} />
                    <span>Create New Campaign</span>
                  </h6>
                  <form onSubmit={handleAddCampaignSubmit} className="row g-2 align-items-end">
                    <div className="col-md-5">
                      <label className="form-label small fw-semibold text-secondary mb-1">
                        Campaign Name
                      </label>
                      <input
                        type="text"
                        value={campaignName}
                        onChange={(e) => setCampaignName(e.target.value)}
                        className="form-control form-control-sm"
                        placeholder="e.g. Master Class Spring 2026"
                      />
                    </div>
                    <div className="col-md-5">
                      <div className="d-flex justify-content-between align-items-center mb-1">
                        <label className="form-label small fw-semibold text-secondary mb-0">
                          Campaign Key
                        </label>
                        <button
                          type="button"
                          className="btn btn-link p-0 text-decoration-none small text-muted"
                          style={{ fontSize: "0.75rem" }}
                          onClick={handleGenerateRandomKey}
                        >
                          Generate Key
                        </button>
                      </div>
                      <input
                        type="text"
                        value={campaignKey}
                        onChange={(e) => setCampaignKey(e.target.value)}
                        className="form-control form-control-sm font-monospace"
                        placeholder="e.g. 8xK2p9Nm4W"
                      />
                    </div>
                    <div className="col-md-2">
                      <button
                        type="submit"
                        disabled={!campaignName.trim() || !campaignKey.trim()}
                        className={styles.actionButton}
                        style={{ padding: "0.45rem 1rem", fontSize: "0.85rem" }}
                      >
                        <Icon icon="ph:plus-bold" />
                        <span className="ms-1">Add</span>
                      </button>
                    </div>
                    <div className="col-12 d-flex flex-wrap gap-4 mt-2 pt-2 border-top">
                      <div className="form-check form-switch d-flex align-items-center gap-2 m-0">
                        <input
                          className="form-check-input mt-0"
                          type="checkbox"
                          role="switch"
                          id="campaignIsActiveSwitch"
                          checked={campaignIsActive}
                          onChange={(e) => setCampaignIsActive(e.target.checked)}
                          style={{ cursor: "pointer" }}
                        />
                        <label className="form-check-label small fw-semibold text-secondary" htmlFor="campaignIsActiveSwitch" style={{ cursor: "pointer" }}>
                          Active <span className="text-muted fw-normal">(Allow player login & registration)</span>
                        </label>
                      </div>
                      <div className="form-check form-switch d-flex align-items-center gap-2 m-0">
                        <input
                          className="form-check-input mt-0"
                          type="checkbox"
                          role="switch"
                          id="campaignUseQuestionnaireSwitch"
                          checked={campaignUseQuestionnaire}
                          onChange={(e) => setCampaignUseQuestionnaire(e.target.checked)}
                          style={{ cursor: "pointer" }}
                        />
                        <label className="form-check-label small fw-semibold text-secondary" htmlFor="campaignUseQuestionnaireSwitch" style={{ cursor: "pointer" }}>
                          Include intro & outro questionnaire
                        </label>
                      </div>
                      <div className="form-check form-switch d-flex align-items-center gap-2 m-0">
                        <input
                          className="form-check-input mt-0"
                          type="checkbox"
                          role="switch"
                          id="campaignIsTestCampaignSwitch"
                          checked={campaignIsTestCampaign}
                          onChange={(e) => setCampaignIsTestCampaign(e.target.checked)}
                          style={{ cursor: "pointer" }}
                        />
                        <label className="form-check-label small fw-semibold text-secondary" htmlFor="campaignIsTestCampaignSwitch" style={{ cursor: "pointer" }}>
                          Test campaign <span className="text-muted fw-normal">(players skip email & verification entirely)</span>
                        </label>
                      </div>
                      <div className="form-check form-switch d-flex align-items-center gap-2 m-0">
                        <input
                          className="form-check-input mt-0"
                          type="checkbox"
                          role="switch"
                          id="campaignRequireEmailVerificationSwitch"
                          checked={campaignRequireEmailVerification}
                          disabled={campaignIsTestCampaign}
                          onChange={(e) => setCampaignRequireEmailVerification(e.target.checked)}
                          style={{ cursor: campaignIsTestCampaign ? "default" : "pointer" }}
                        />
                        <label className="form-check-label small fw-semibold text-secondary" htmlFor="campaignRequireEmailVerificationSwitch" style={{ cursor: campaignIsTestCampaign ? "default" : "pointer" }}>
                          Require email verification <span className="text-muted fw-normal">(off: still needs a real email, but skips the code)</span>
                        </label>
                      </div>
                    </div>
                  </form>
                </div>
              </div>

              {/* Player Management Card */}
              <div className={styles.cardSurface} id="players-section">
                <div className={styles.sectionHeader}>
                  <div>
                    <h2 className={styles.sectionTitle}>
                      <Icon icon="ph:users-three-bold" />
                      <span>Player Progression & Performance</span>
                    </h2>
                    <p className={styles.sectionSubtitle}>
                      Monitor individual progression, intro/outro evaluations, and export research records.
                    </p>
                  </div>
                  <div className="d-flex align-items-center gap-2">
                    <button
                      type="button"
                      className={styles.smallActionButton}
                      onClick={handleExportCSV}
                      disabled={filteredPlayers.length === 0}
                      title="Export table records as CSV"
                    >
                      <Icon icon="ph:download-simple-bold" />
                      <span>Export to CSV</span>
                    </button>
                    {removeAllPlayers && (
                      <button
                        type="button"
                        className="btn btn-sm btn-outline-danger d-inline-flex align-items-center gap-1"
                        style={{ padding: "0.35rem 0.85rem", fontSize: "0.82rem", fontWeight: 600, borderRadius: "0.5rem" }}
                        onClick={() => setShowDeleteAllWarning(true)}
                        disabled={players.length === 0}
                        title="Delete all players across all campaigns"
                      >
                        <Icon icon="ph:trash-bold" />
                        <span>Delete All Players</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Filter & Search Bar */}
                <div className={styles.filterBar}>
                  <div className={styles.searchInputGroup}>
                    <Icon icon="ph:magnifying-glass-bold" className={styles.searchIcon} />
                    <input
                      type="text"
                      value={playerSearchQuery}
                      onChange={(e) => setPlayerSearchQuery(e.target.value)}
                      placeholder="Search by player or campaign name..."
                      className={`form-control ${styles.searchInput}`}
                    />
                  </div>

                  <div className="d-flex align-items-center gap-2 flex-wrap">
                    {/* Campaign filter */}
                    <div className="d-flex align-items-center gap-1">
                      <label className="small text-muted mb-0 fw-semibold">Campaign:</label>
                      <select
                        className="form-select form-select-sm"
                        value={selectedCampaignFilter}
                        onChange={(e) => setSelectedCampaignFilter(e.target.value)}
                        style={{ minWidth: "160px" }}
                      >
                        <option value="all">All Campaigns</option>
                        {campaigns.map((c) => (
                          <option key={c.name} value={c.name}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Status filter */}
                    <div className="d-flex align-items-center gap-1">
                      <label className="small text-muted mb-0 fw-semibold">Status:</label>
                      <select
                        className="form-select form-select-sm"
                        value={playerStatusFilter}
                        onChange={(e) => setPlayerStatusFilter(e.target.value as any)}
                        style={{ minWidth: "130px" }}
                      >
                        <option value="all">All Statuses</option>
                        <option value="finished">Completed Only</option>
                        <option value="in_progress">In Progress</option>
                      </select>
                    </div>

                    {(selectedCampaignFilter !== "all" || playerStatusFilter !== "all" || playerSearchQuery.trim()) && (
                      <button
                        type="button"
                        className={styles.outlineButton}
                        style={{ padding: "0.35rem 0.65rem", fontSize: "0.8rem" }}
                        onClick={() => {
                          setSelectedCampaignFilter("all");
                          setPlayerStatusFilter("all");
                          setPlayerSearchQuery("");
                        }}
                      >
                        <Icon icon="ph:x-bold" />
                        <span>Reset Filters</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Player count summary */}
                <div className="d-flex justify-content-between align-items-center mb-2 text-muted small">
                  <span>
                    Showing <strong>{filteredPlayers.length}</strong> of <strong>{players.length}</strong> players
                  </span>
                  {selectedCampaignFilter !== "all" && (
                    <span
                      className={`${styles.pillBadge} ${styles.badgePrimary}`}
                      style={{ cursor: "pointer", display: "inline-flex", alignItems: "center", gap: "0.25rem" }}
                      onClick={() => setSelectedCampaignFilter("all")}
                      title="Clear campaign filter and show all players"
                    >
                      <span>Filtered by: {selectedCampaignFilter}</span>
                      <Icon icon="ph:x-bold" />
                    </span>
                  )}
                </div>

                {/* Players Table */}
                <div className={`table-responsive ${styles.tableContainer}`}>
                  <table className={`table align-middle ${styles.customTable}`}>
                    <thead>
                      <tr>
                        <th style={{ cursor: "pointer" }} onClick={() => handleSort("name")}>
                          <div className="d-flex align-items-center gap-1">
                            <span>Player Name</span>
                            {sortField === "name" && (
                              <Icon icon={sortDirection === "asc" ? "ph:caret-up-bold" : "ph:caret-down-bold"} />
                            )}
                          </div>
                        </th>
                        <th style={{ cursor: "pointer" }} onClick={() => handleSort("campaign_name")}>
                          <div className="d-flex align-items-center gap-1">
                            <span>Campaign</span>
                            {sortField === "campaign_name" && (
                              <Icon icon={sortDirection === "asc" ? "ph:caret-up-bold" : "ph:caret-down-bold"} />
                            )}
                          </div>
                        </th>
                        <th style={{ cursor: "pointer" }} onClick={() => handleSort("gameProgression")}>
                          <div className="d-flex align-items-center gap-1">
                            <span>Progression</span>
                            {sortField === "gameProgression" && (
                              <Icon icon={sortDirection === "asc" ? "ph:caret-up-bold" : "ph:caret-down-bold"} />
                            )}
                          </div>
                        </th>
                        <th style={{ cursor: "pointer" }} onClick={() => handleSort("introPercentage")}>
                          <div className="d-flex align-items-center gap-1">
                            <span>Intro Score</span>
                            {sortField === "introPercentage" && (
                              <Icon icon={sortDirection === "asc" ? "ph:caret-up-bold" : "ph:caret-down-bold"} />
                            )}
                          </div>
                        </th>
                        <th style={{ cursor: "pointer" }} onClick={() => handleSort("outroPercentage")}>
                          <div className="d-flex align-items-center gap-1">
                            <span>Outro Score</span>
                            {sortField === "outroPercentage" && (
                              <Icon icon={sortDirection === "asc" ? "ph:caret-up-bold" : "ph:caret-down-bold"} />
                            )}
                          </div>
                        </th>
                        <th style={{ cursor: "pointer" }} onClick={() => handleSort("delta")}>
                          <div className="d-flex align-items-center gap-1">
                            <span>Score Delta</span>
                            {sortField === "delta" && (
                              <Icon icon={sortDirection === "asc" ? "ph:caret-up-bold" : "ph:caret-down-bold"} />
                            )}
                          </div>
                        </th>
                        <th style={{ cursor: "pointer" }} onClick={() => handleSort("playTime")}>
                          <div className="d-flex align-items-center gap-1">
                            <span>Play Time</span>
                            {sortField === "playTime" && (
                              <Icon icon={sortDirection === "asc" ? "ph:caret-up-bold" : "ph:caret-down-bold"} />
                            )}
                          </div>
                        </th>
                        <th className="text-end">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredPlayers.length > 0 ? (
                        filteredPlayers.map((p) => {
                          const delta = p.outroPercentage - p.introPercentage;
                          const isDone =
                            p.gameProgression.toLowerCase().includes("finish") ||
                            p.gameProgression.toLowerCase() === "100%" ||
                            p.gameProgression.toLowerCase().includes("done");

                          return (
                            <tr key={p.name}>
                              <td>
                                <div className="d-flex align-items-center gap-2">
                                  <Icon icon="ph:user-circle-bold" className="text-secondary fs-5" />
                                  <span className="fw-bold">{p.name}</span>
                                </div>
                              </td>
                              <td>
                                <span className={`${styles.pillBadge} ${styles.badgeNeutral}`}>
                                  {p.campaign_name || "Unassigned"}
                                </span>
                              </td>
                              <td>
                                <span
                                  className={`${styles.pillBadge} ${isDone ? styles.badgeSuccess : styles.badgeNeutral
                                    }`}
                                >
                                  {isDone && <Icon icon="ph:check-circle-bold" />}
                                  {p.gameProgression}
                                </span>
                              </td>
                              <td>
                                <span className="fw-semibold">{p.introPercentage}%</span>
                              </td>
                              <td>
                                <span className="fw-semibold">{p.outroPercentage}%</span>
                              </td>
                              <td>
                                <span
                                  className={`${styles.pillBadge} ${delta > 0
                                    ? styles.badgeSuccess
                                    : delta < 0
                                      ? styles.badgeWarning
                                      : styles.badgeNeutral
                                    }`}
                                >
                                  {delta > 0 ? `+${delta}%` : `${delta}%`}
                                </span>
                              </td>
                              <td className="text-muted font-monospace small">{p.playTime}</td>
                              <td className="text-end">
                                {removePlayer && (
                                  confirmDeletePlayer === p.name ? (
                                    <div className="d-inline-flex align-items-center gap-1">
                                      <button
                                        type="button"
                                        className="btn btn-sm btn-danger"
                                        style={{ fontSize: "0.78rem" }}
                                        onClick={() => {
                                          removePlayer(p.name);
                                          setConfirmDeletePlayer(null);
                                        }}
                                        title="Permanently remove player across all tables"
                                      >
                                        Confirm Delete
                                      </button>
                                      <button
                                        type="button"
                                        className="btn btn-sm btn-outline-secondary"
                                        style={{ fontSize: "0.78rem" }}
                                        onClick={() => setConfirmDeletePlayer(null)}
                                      >
                                        Cancel
                                      </button>
                                    </div>
                                  ) : (
                                    <button
                                      type="button"
                                      className="btn btn-sm btn-outline-danger"
                                      style={{ fontSize: "0.8rem" }}
                                      onClick={() => setConfirmDeletePlayer(p.name)}
                                      title={`Delete player ${p.name}`}
                                    >
                                      <Icon icon="ph:trash-bold" />
                                      <span className="ms-1">Delete</span>
                                    </button>
                                  )
                                )}
                              </td>
                            </tr>
                          );
                        })
                      ) : (
                        <tr>
                          <td colSpan={8} className="text-center py-4 text-muted">
                            No players found matching the current filters.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* ======================================================== */}
          {/* SUBPAGE 3: ANALYSIS & STATISTICS                         */}
          {/* ======================================================== */}
          {activeSubpage === "analysis" && (
            <div className="d-flex flex-column gap-4">
              {/* Campaign Filter Control */}
              <div className={styles.cardSurface} style={{ padding: "0.85rem 1.25rem" }}>
                <div className="d-flex align-items-center justify-content-between flex-wrap gap-2">
                  <div className="d-flex align-items-center gap-2 flex-wrap">
                    <Icon icon="ph:funnel-bold" className="text-secondary fs-5" />
                    <span className="fw-bold text-dark">Filter Analysis by Campaign:</span>
                    <select
                      className="form-select form-select-sm"
                      value={analysisCampaignFilter}
                      onChange={(e) => handleAnalysisCampaignChange(e.target.value)}
                      style={{ minWidth: "220px" }}
                    >
                      <option value="all">All Campaigns (Global Aggregate)</option>
                      {campaigns.map((c) => (
                        <option key={c.key || c.name} value={c.name}>
                          {c.name} {c.use_questionnaire === false ? "(No Questionnaire)" : ""}
                        </option>
                      ))}
                    </select>
                  </div>

                  {analysisCampaignFilter !== "all" && (
                    <div className="d-flex align-items-center gap-2 flex-wrap">
                      <span className={`${styles.pillBadge} ${styles.badgePrimary}`}>
                        Campaign: {selectedAnalysisCampaign?.name || analysisCampaignFilter}
                      </span>
                      {!isQuestionnaireActiveForAnalysis && (
                        <span className={`${styles.pillBadge} ${styles.badgeNeutral}`}>
                          <Icon icon="ph:prohibit-bold" /> Questionnaire Inactive
                        </span>
                      )}
                      <button
                        type="button"
                        className={styles.outlineButton}
                        style={{ padding: "0.3rem 0.65rem", fontSize: "0.8rem" }}
                        onClick={() => handleAnalysisCampaignChange("all")}
                      >
                        <Icon icon="ph:x-bold" />
                        <span>Show All Campaigns</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Overall KPI Metrics Cards */}
              <div className={styles.kpiGrid}>
                <div className={styles.kpiCard}>
                  <div className={styles.kpiHeader}>
                    <span className={styles.kpiLabel}>Total Players</span>
                    <Icon icon="ph:users-three-bold" className={styles.kpiIcon} />
                  </div>
                  <div className={styles.kpiValue}>{analysisTotalPlayers}</div>
                </div>

                <div className={styles.kpiCard}>
                  <div className={styles.kpiHeader}>
                    <span className={styles.kpiLabel}>Completed Sessions</span>
                    <Icon icon="ph:check-circle-bold" className={styles.kpiIcon} />
                  </div>
                  <div className={styles.kpiValue}>{analysisFinishedPlayers}</div>
                </div>

                {isQuestionnaireActiveForAnalysis && (
                  <>
                    <div className={styles.kpiCard}>
                      <div className={styles.kpiHeader}>
                        <span className={styles.kpiLabel}>Avg Intro Score</span>
                        <Icon icon="ph:clipboard-text-bold" className={styles.kpiIcon} />
                      </div>
                      <div className={styles.kpiValue}>{effectiveIntroAvg}%</div>
                    </div>

                    <div className={styles.kpiCard}>
                      <div className={styles.kpiHeader}>
                        <span className={styles.kpiLabel}>Avg Outro Score</span>
                        <Icon icon="ph:graduation-cap-bold" className={styles.kpiIcon} />
                      </div>
                      <div className={styles.kpiValue}>{effectiveOutroAvg}%</div>
                    </div>

                    <div className={styles.kpiCard}>
                      <div className={styles.kpiHeader}>
                        <span className={styles.kpiLabel}>Knowledge Gain Delta</span>
                        <Icon icon="ph:trend-up-bold" className={styles.kpiIcon} />
                      </div>
                      <div
                        className={styles.kpiValue}
                        style={{
                          color: effectiveDeltaAverage >= 0 ? "var(--badge-new-text)" : "var(--badge-shifted-text)",
                        }}
                      >
                        {effectiveDeltaAverage >= 0 ? `+${effectiveDeltaAverage}%` : `${effectiveDeltaAverage}%`}
                      </div>
                    </div>
                  </>
                )}
              </div>

              {/* Longitudinal Metric Line Charts */}
              <div className={styles.cardSurface}>
                <div className={styles.sectionHeader}>
                  <div>
                    <h2 className={styles.sectionTitle}>
                      <Icon icon="ph:chart-line-up-bold" />
                      <span>Progression Metrics Per Challenge</span>
                    </h2>
                    <p className={styles.sectionSubtitle}>
                      Longitudinal stakeholder engagement metric sums and increments across sequential challenges.
                    </p>
                  </div>
                </div>

                <div className="row g-3">
                  <div className="col-lg-6">
                    <div className="p-3 bg-light border rounded-3">
                      <h6 className="fw-bold text-secondary mb-3 d-flex align-items-center gap-1">
                        <Icon icon="ph:chart-line-bold" style={{ color: "var(--primary-bg)" }} />
                        <span>Average Sum of Metrics</span>
                      </h6>
                      <div className={styles.chartWrapper}>
                        <Line data={sumChartData} options={chartOptions} />
                      </div>
                    </div>
                  </div>

                  <div className="col-lg-6">
                    <div className="p-3 bg-light border rounded-3">
                      <h6 className="fw-bold text-secondary mb-3 d-flex align-items-center gap-1">
                        <Icon icon="ph:trend-up-bold" style={{ color: "var(--primary-bg)" }} />
                        <span>Average Sum of Metrics Increase</span>
                      </h6>
                      <div className={styles.chartWrapper}>
                        <Line data={sumIncreaseChartData} options={chartOptions} />
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Detailed Questionnaire Evaluation */}
              {isQuestionnaireActiveForAnalysis ? (
                <div className={styles.cardSurface}>
                  <div className={styles.sectionHeader}>
                    <div>
                      <h2 className={styles.sectionTitle}>
                        <Icon icon="ph:clipboard-text-bold" />
                        <span>Questionnaire Evaluations & Cohort Distribution</span>
                      </h2>
                      <p className={styles.sectionSubtitle}>
                        Answer breakdown comparing general cohorts vs experts, including qualitative participant notes.
                      </p>
                    </div>
                    <div className="d-flex align-items-center gap-2 flex-wrap">
                      <button
                        type="button"
                        className={styles.outlineButton}
                        onClick={() => setDisplayPercentages((prev) => !prev)}
                      >
                        <Icon icon={displayPercentages ? "ph:number-circle-seven-bold" : "ph:percent-bold"} />
                        <span>{displayPercentages ? "Show Raw Counts" : "Show Percentages"}</span>
                      </button>
                      <button
                        type="button"
                        className={styles.outlineButton}
                        onClick={() => handleToggleAllQuestions(true)}
                      >
                        <Icon icon="ph:arrows-out-bold" />
                        <span>Expand All</span>
                      </button>
                      <button
                        type="button"
                        className={styles.outlineButton}
                        onClick={() => handleToggleAllQuestions(false)}
                      >
                        <Icon icon="ph:arrows-in-bold" />
                        <span>Collapse All</span>
                      </button>
                    </div>
                  </div>

                  {/* Filter and search toolbar */}
                  <div className={styles.filterBar}>
                    <div className={styles.searchInputGroup}>
                      <Icon icon="ph:magnifying-glass-bold" className={styles.searchIcon} />
                      <input
                        type="text"
                        value={questionSearchQuery}
                        onChange={(e) => setQuestionSearchQuery(e.target.value)}
                        placeholder="Search question text or keywords..."
                        className={`form-control ${styles.searchInput}`}
                      />
                    </div>

                    <div className="btn-group btn-group-sm" role="group">
                      <button
                        type="button"
                        className={`btn ${questionFilterType === "all" ? "btn-secondary active" : "btn-outline-secondary"}`}
                        onClick={() => setQuestionFilterType("all")}
                      >
                        All ({introQuestions.length + outroQuestions.length})
                      </button>
                      <button
                        type="button"
                        className={`btn ${questionFilterType === "intro" ? "btn-secondary active" : "btn-outline-secondary"}`}
                        onClick={() => setQuestionFilterType("intro")}
                      >
                        Intro ({introQuestions.length})
                      </button>
                      <button
                        type="button"
                        className={`btn ${questionFilterType === "outro" ? "btn-secondary active" : "btn-outline-secondary"}`}
                        onClick={() => setQuestionFilterType("outro")}
                      >
                        Outro ({outroQuestions.length})
                      </button>
                      <button
                        type="button"
                        className={`btn ${questionFilterType === "notes" ? "btn-secondary active" : "btn-outline-secondary"}`}
                        onClick={() => setQuestionFilterType("notes")}
                      >
                        With Notes
                      </button>
                    </div>
                  </div>

                  {/* Question Cards List */}
                  {filteredQuestions.length > 0 ? (
                    filteredQuestions.map((q, idx) => {
                      const questionId = `${q.source}-${q.originalIndex ?? idx}`;
                      const isExpanded = expandedQuestions[questionId] ?? true;

                      // Calculate totals for percentages
                      const totalGeneral = q.answers.reduce((acc: number, a: any) => acc + (a.amount || 0), 0);
                      const totalExperts = q.answers.reduce((acc: number, a: any) => acc + (a.amount_experts || 0), 0);
                      const notesList = q.answers.flatMap((a: any) => (a.notes || []).map((n: string) => ({ answer: a.answer_name, note: n })));

                      return (
                        <div key={questionId} className={styles.questionCard}>
                          <div
                            className={styles.questionHeader}
                            onClick={() => toggleQuestionExpanded(questionId)}
                          >
                            <div className={styles.questionTitle}>
                              <span className={`${styles.pillBadge} ${q.source === "intro" ? styles.badgePrimary : styles.badgeNeutral}`}>
                                {q.source.toUpperCase()} Q{(q.originalIndex ?? idx) + 1}
                              </span>
                              <span>{q.question}</span>
                            </div>

                            <div className="d-flex align-items-center gap-2">
                              {notesList.length > 0 && (
                                <span className={`${styles.pillBadge} ${styles.badgeWarning}`}>
                                  <Icon icon="ph:chat-circle-text-bold" />
                                  <span>{notesList.length} Notes</span>
                                </span>
                              )}
                              <Icon
                                icon={isExpanded ? "ph:caret-up-bold" : "ph:caret-down-bold"}
                                className="text-muted"
                              />
                            </div>
                          </div>

                          {isExpanded && (
                            <div className={styles.questionBody}>
                              <div className={`table-responsive ${styles.tableContainer} mb-3`}>
                                <table className={`table table-sm align-middle ${styles.customTable} mb-0`}>
                                  <thead>
                                    <tr>
                                      <th style={{ width: "18%" }}>Cohort</th>
                                      {q.answers.map((a: any, aIdx: number) => (
                                        <th key={aIdx} className="text-center">
                                          {a.answer_name}
                                        </th>
                                      ))}
                                    </tr>
                                  </thead>
                                  <tbody>
                                    <tr>
                                      <td className="fw-semibold">
                                        <div className="d-flex align-items-center gap-1">
                                          <Icon icon="ph:users-bold" style={{ color: "var(--primary-bg)" }} />
                                          <span>General</span>
                                          <small className="text-muted">({totalGeneral})</small>
                                        </div>
                                      </td>
                                      {q.answers.map((a: any, aIdx: number) => {
                                        const count = a.amount || 0;
                                        const pct = totalGeneral > 0 ? Math.round((count / totalGeneral) * 100) : 0;
                                        return (
                                          <td key={aIdx} className="text-center py-2">
                                            <span className="fw-bold" style={{ color: "var(--primary-bg)", fontSize: "1.1rem" }}>
                                              {displayPercentages ? `${pct}%` : count}
                                            </span>
                                            {displayPercentages && (
                                              <div className="text-muted" style={{ fontSize: "0.75rem" }}>
                                                {count} responses
                                              </div>
                                            )}
                                          </td>
                                        );
                                      })}
                                    </tr>
                                    <tr>
                                      <td className="fw-semibold">
                                        <div className="d-flex align-items-center gap-1">
                                          <Icon icon="ph:certificate-bold" style={{ color: "var(--secondary-bg)" }} />
                                          <span>Experts</span>
                                          <small className="text-muted">({totalExperts})</small>
                                        </div>
                                      </td>
                                      {q.answers.map((a: any, aIdx: number) => {
                                        const count = a.amount_experts || 0;
                                        const pct = totalExperts > 0 ? Math.round((count / totalExperts) * 100) : 0;
                                        return (
                                          <td key={aIdx} className="text-center py-2">
                                            <span className="fw-bold text-info" style={{ fontSize: "1.1rem" }}>
                                              {displayPercentages ? `${pct}%` : count}
                                            </span>
                                            {displayPercentages && (
                                              <div className="text-muted" style={{ fontSize: "0.75rem" }}>
                                                {count} responses
                                              </div>
                                            )}
                                          </td>
                                        );
                                      })}
                                    </tr>
                                  </tbody>
                                </table>
                              </div>

                              {/* Qualitative Participant Notes */}
                              {notesList.length > 0 && (
                                <div className="mt-2">
                                  <h6 className="fw-bold text-secondary mb-2 small d-flex align-items-center gap-1">
                                    <Icon icon="ph:chat-centered-text-bold" />
                                    <span>Participant Feedback & Notes ({notesList.length})</span>
                                  </h6>
                                  <div className="d-flex flex-column gap-1">
                                    {notesList.map((item: any, nIdx: number) => (
                                      <div key={nIdx} className={styles.noteBubble}>
                                        <span className="fw-bold me-2 text-primary" style={{ fontSize: "0.78rem" }}>
                                          [{item.answer}]:
                                        </span>
                                        <span>{item.note}</span>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })
                  ) : (
                    <div className="text-center py-5 text-muted">
                      <Icon icon="ph:question-bold" className="fs-1 mb-2 text-secondary" />
                      <p className="mb-0">No questionnaire questions found matching the selected filter.</p>
                    </div>
                  )}
                </div>
              ) : (
                <div className={styles.cardSurface}>
                  <div className="text-center py-5 text-muted">
                    <Icon icon="ph:prohibit-bold" className="fs-1 mb-2 text-secondary" />
                    <h5 className="fw-bold text-dark">Questionnaire Disabled for this Campaign</h5>
                    <p className="small mb-0">
                      The questionnaire is disabled for <strong>{selectedAnalysisCampaign?.name}</strong>. Intro and outro evaluations are not collected for this cohort.
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}
          {/* ======================================================== */}
          {/* SUBPAGE 4: GRAPH DEBUG                                   */}
          {/* ======================================================== */}
          {activeSubpage === "results" && (
            <div className={styles.cardSurface}>
              <AdminResults adminToken={adminToken} campaigns={campaigns} />
            </div>
          )}

          {activeSubpage === "graph_debug" && (
            <div className={styles.cardSurface}>
              <GraphDebug adminToken={adminToken} campaigns={campaigns} players={players} />
            </div>
          )}

          {/* ======================================================== */}
          {/* SUBPAGE 5: SMTP EMAIL CONFIGURATION & TEST               */}
          {/* ======================================================== */}
          {activeSubpage === "email" && (
            <div className="d-flex flex-column gap-4">
              {/* Configuration Status Card */}
              <div className={styles.cardSurface}>
                <div className={styles.sectionHeader}>
                  <div>
                    <h2 className={styles.sectionTitle}>
                      <Icon icon="ph:envelope-simple-bold" />
                      <span>Gmail SMTP Configuration</span>
                    </h2>
                    <p className={styles.sectionSubtitle}>
                      Inspect environment SMTP connection settings and verify live email delivery.
                    </p>
                  </div>
                  <button
                    type="button"
                    className={styles.outlineButton}
                    onClick={loadEmailStatus}
                    disabled={emailLoading}
                  >
                    <Icon
                      icon={emailLoading ? "ph:spinner-bold" : "ph:arrows-clockwise-bold"}
                      className={emailLoading ? styles.spinner : ""}
                    />
                    <span>Refresh Status</span>
                  </button>
                </div>

                {emailLoading && !emailStatus && (
                  <div className="text-center py-4 text-muted">
                    <Icon icon="ph:spinner-bold" className={`fs-2 mb-2 ${styles.spinner}`} />
                    <p className="small mb-0">Loading SMTP configuration...</p>
                  </div>
                )}

                {emailStatus && (
                  <div className={styles.kpiGrid}>
                    <div className={styles.kpiCard}>
                      <div className={styles.kpiHeader}>
                        <span className={styles.kpiLabel}>SMTP Host</span>
                        <Icon icon="ph:hard-drives-bold" className={styles.kpiIcon} />
                      </div>
                      <div className="fs-6 fw-bold text-dark">{emailStatus.host || "Not set"}</div>
                      <small className="text-muted mt-1">Default: smtp.gmail.com</small>
                    </div>

                    <div className={styles.kpiCard}>
                      <div className={styles.kpiHeader}>
                        <span className={styles.kpiLabel}>Port & TLS</span>
                        <Icon icon="ph:shield-check-bold" className={styles.kpiIcon} />
                      </div>
                      <div className="fs-6 fw-bold text-dark">
                        Port {emailStatus.port} {emailStatus.use_tls ? "(STARTTLS)" : "(No TLS)"}
                      </div>
                      <small className="text-muted mt-1">Standard STARTTLS Port</small>
                    </div>

                    <div className={styles.kpiCard}>
                      <div className={styles.kpiHeader}>
                        <span className={styles.kpiLabel}>Sender / Username</span>
                        <Icon icon="ph:user-bold" className={styles.kpiIcon} />
                      </div>
                      <div className="fs-6 fw-bold text-dark text-truncate" title={emailStatus.username}>
                        {emailStatus.username || <span className="text-danger">Not configured</span>}
                      </div>
                      <small className="text-muted mt-1">{emailStatus.from_email || "No from address"}</small>
                    </div>

                    <div className={styles.kpiCard}>
                      <div className={styles.kpiHeader}>
                        <span className={styles.kpiLabel}>Credentials Status</span>
                        <Icon icon="ph:lock-key-bold" className={styles.kpiIcon} />
                      </div>
                      <div className="fs-6 fw-bold">
                        {emailStatus.is_configured ? (
                          <span className="badge bg-success-subtle text-success border border-success-subtle px-2 py-1">
                            <Icon icon="ph:check-circle-bold" className="me-1" />
                            Ready to Send
                          </span>
                        ) : (
                          <span className="badge bg-warning-subtle text-warning-emphasis border border-warning-subtle px-2 py-1">
                            <Icon icon="ph:warning-circle-bold" className="me-1" />
                            Missing in .env
                          </span>
                        )}
                      </div>
                      <small className="text-muted mt-1">
                        {emailStatus.has_password ? "Password / App Password set" : "Password missing"}
                      </small>
                    </div>
                  </div>
                )}
              </div>

              {/* Send Test Email Card */}
              <div className={styles.cardSurface}>
                <div className={styles.sectionHeader}>
                  <div>
                    <h2 className={styles.sectionTitle}>
                      <Icon icon="ph:paper-plane-tilt-bold" />
                      <span>Send Test Email</span>
                    </h2>
                    <p className={styles.sectionSubtitle}>
                      Verify your SMTP connection, or preview the login/verification and password-reset
                      emails with a placeholder code, sent to any address for testing.
                    </p>
                  </div>
                </div>

                <form onSubmit={handleSendTestEmail} style={{ maxWidth: "560px" }}>
                  <div className="mb-3">
                    <label htmlFor="testEmailTemplate" className="form-label fw-bold small text-secondary">
                      Email Type
                    </label>
                    <select
                      id="testEmailTemplate"
                      className="form-select"
                      value={emailTemplate}
                      onChange={(e) => {
                        setEmailTemplate(e.target.value as AdminTestEmailTemplate);
                        setEmailSuccessMessage(null);
                        setEmailErrorMessage(null);
                      }}
                    >
                      <option value="generic">Generic SMTP connectivity test</option>
                      <option value="verification">Login / registration verification code</option>
                      <option value="password_reset">Password reset code</option>
                    </select>
                    {emailTemplate !== "generic" && (
                      <div className="form-text small text-muted">
                        Sends the real code-email template with a placeholder code (123456) - no player
                        account is touched.
                      </div>
                    )}
                  </div>

                  <div className="mb-3">
                    <label htmlFor="testRecipientEmail" className="form-label fw-bold small text-secondary">
                      Recipient Email Address
                    </label>
                    <input
                      id="testRecipientEmail"
                      type="email"
                      required
                      className="form-control"
                      placeholder="e.g. your-name@example.com"
                      value={recipientEmail}
                      onChange={(e) => {
                        setRecipientEmail(e.target.value);
                        setEmailSuccessMessage(null);
                        setEmailErrorMessage(null);
                      }}
                    />
                    <div className="form-text small text-muted">
                      A test message will be sent through the configured SMTP server.
                    </div>
                  </div>

                  {emailSuccessMessage && (
                    <div className="alert alert-success d-flex align-items-center gap-2 mb-3" role="alert">
                      <Icon icon="ph:check-circle-bold" className="fs-5 flex-shrink-0" />
                      <div>{emailSuccessMessage}</div>
                    </div>
                  )}

                  {emailErrorMessage && (
                    <div className="alert alert-danger d-flex align-items-start gap-2 mb-3" role="alert">
                      <Icon icon="ph:warning-octagon-bold" className="fs-5 flex-shrink-0 mt-1" />
                      <div className="small">{emailErrorMessage}</div>
                    </div>
                  )}

                  <div>
                    <button
                      type="submit"
                      disabled={emailSending || !recipientEmail.trim()}
                      className={styles.actionButton}
                      style={{ maxWidth: "260px" }}
                    >
                      {emailSending ? (
                        <span className="d-flex align-items-center justify-content-center gap-2">
                          <Icon icon="ph:spinner-bold" className={styles.spinner} />
                          <span>Sending...</span>
                        </span>
                      ) : (
                        <span className="d-flex align-items-center justify-content-center gap-2">
                          <Icon icon="ph:paper-plane-tilt-bold" />
                          <span>Send Test Email</span>
                        </span>
                      )}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </div>
      </div>


      {/* Delete Campaign Confirmation Modal */}
      {campaignToDelete && (
        <div
          className="position-fixed top-0 start-0 w-100 h-100 d-flex align-items-center justify-content-center p-3"
          style={{
            backgroundColor: "rgba(10, 25, 34, 0.75)",
            backdropFilter: "blur(4px)",
            zIndex: 9999,
          }}
          onClick={() => setCampaignToDelete(null)}
        >
          <div
            className="card border-0 rounded-4 shadow-lg overflow-hidden"
            style={{ maxWidth: "500px", width: "100%", background: "#ffffff" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="p-3 d-flex align-items-center gap-2 text-white"
              style={{ backgroundColor: "#dc2626" }}
            >
              <Icon icon="ph:warning-octagon-bold" style={{ fontSize: "1.75rem" }} />
              <h5 className="mb-0 fw-bold">Delete Campaign: {campaignToDelete.name}?</h5>
            </div>
            <div className="p-4">
              <div className="alert alert-danger d-flex align-items-start gap-2 mb-3">
                <Icon icon="ph:warning-bold" style={{ fontSize: "1.4rem", flexShrink: 0, marginTop: "2px" }} />
                <div className="small">
                  <strong>Warning: Deleting a campaign will delete all associated players and their data.</strong>
                </div>
              </div>
              <p className="text-secondary small mb-2">
                You are about to delete campaign <strong>&quot;{campaignToDelete.name}&quot;</strong> (<code>{campaignToDelete.key}</code>).
              </p>
              {campaignToDelete.users.length > 0 ? (
                <div className="p-3 rounded mb-3 bg-light border">
                  <div className="d-flex align-items-center gap-2 text-danger fw-bold small mb-1">
                    <Icon icon="ph:users-bold" />
                    <span>{campaignToDelete.users.length} enrolled {campaignToDelete.users.length === 1 ? "player" : "players"} will be deleted:</span>
                  </div>
                  <div className="small text-muted" style={{ maxHeight: "100px", overflowY: "auto" }}>
                    {campaignToDelete.users.join(", ")}
                  </div>
                </div>
              ) : (
                <p className="text-muted small mb-3">
                  This campaign currently has no enrolled players.
                </p>
              )}
              <p className="text-muted small mb-4">
                All game progressions, session data, chat messages, intel records, and questionnaire evaluations belonging to these players will be permanently removed across all tables. This action cannot be undone.
              </p>
              <div className="d-flex justify-content-end gap-2">
                <button
                  type="button"
                  className="btn btn-outline-secondary btn-sm px-3"
                  onClick={() => setCampaignToDelete(null)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-danger btn-sm px-3 fw-bold d-inline-flex align-items-center gap-1"
                  onClick={() => {
                    removeCampaign(campaignToDelete.key);
                    setCampaignToDelete(null);
                  }}
                >
                  <Icon icon="ph:trash-bold" />
                  <span>
                    {campaignToDelete.users.length > 0
                      ? `Yes, Delete Campaign & ${campaignToDelete.users.length} ${campaignToDelete.users.length === 1 ? "Player" : "Players"}`
                      : "Yes, Delete Campaign"}
                  </span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete All Players Confirmation Modal */}
      {showDeleteAllWarning && (
        <div
          className="position-fixed top-0 start-0 w-100 h-100 d-flex align-items-center justify-content-center p-3"
          style={{
            backgroundColor: "rgba(10, 25, 34, 0.75)",
            backdropFilter: "blur(4px)",
            zIndex: 9999,
          }}
          onClick={() => setShowDeleteAllWarning(false)}
        >
          <div
            className="card border-0 rounded-4 shadow-lg overflow-hidden"
            style={{ maxWidth: "480px", width: "100%", background: "#ffffff" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="p-3 d-flex align-items-center gap-2 text-white"
              style={{ backgroundColor: "#dc2626" }}
            >
              <Icon icon="ph:warning-octagon-bold" style={{ fontSize: "1.75rem" }} />
              <h5 className="mb-0 fw-bold">Delete All Players?</h5>
            </div>
            <div className="p-4">
              <div className="alert alert-danger d-flex align-items-start gap-2 mb-3">
                <Icon icon="ph:warning-bold" style={{ fontSize: "1.4rem", flexShrink: 0, marginTop: "2px" }} />
                <div className="small">
                  <strong>Warning: This action is permanent and cannot be undone.</strong>
                </div>
              </div>
              <p className="text-secondary small mb-2">
                You are about to delete all <strong>{players.length}</strong> player records.
              </p>
              <p className="text-muted small mb-3">
                This will permanently erase all associated data across the entire database, including:
              </p>
              <ul className="small text-secondary mb-4 ps-3">
                <li>Player accounts and credentials</li>
                <li>Game progression and challenge records</li>
                <li>Session states and dialogue history</li>
                <li>Revealed intel items and action card pitches</li>
                <li>Intro and outro questionnaire evaluation responses</li>
              </ul>
              <div className="d-flex justify-content-end gap-2">
                <button
                  type="button"
                  className="btn btn-outline-secondary btn-sm px-3"
                  onClick={() => setShowDeleteAllWarning(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-danger btn-sm px-3 fw-bold d-inline-flex align-items-center gap-1"
                  onClick={() => {
                    if (removeAllPlayers) {
                      removeAllPlayers();
                    }
                    setShowDeleteAllWarning(false);
                  }}
                >
                  <Icon icon="ph:trash-bold" />
                  <span>Yes, Delete All {players.length} Players</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
export default Admin;
