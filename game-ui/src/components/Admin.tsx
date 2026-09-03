
import { useState } from "react";
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

interface Campaign {
  name: string;
  key: string
  users: string[];
}

interface Player {
  name: string;
  campaign_name: string;
  gameProgression: string;
  introPercentage: number;
  outroPercentage: number;
  playTime: string;
}

interface AdminProps {
  adminToken?: string;
  onDashboardUpdate?: (data: any) => void;
  campaigns: Campaign[];
  players: Player[];
  addCampaign: (campaignName: string, campaignKey: string) => void;
  removeCampaign: (campaignKey: string) => void;
  finished_players_amount: number;
  sum_per_challenge: number[];
  sum_per_challenge_increase: number[];
  intro_questionaire_average: number;
  outro_questionaire_average: number;
  questionaire_results: any;
}

export function Admin({
  adminToken = "",
  onDashboardUpdate,
  campaigns,
  players,
  addCampaign,
  removeCampaign,
  finished_players_amount,
  sum_per_challenge,
  sum_per_challenge_increase,
  intro_questionaire_average,
  outro_questionaire_average,
  questionaire_results
}: AdminProps) {

  const [activeSubpage, setActiveSubpage] = useState<"config" | "manager" | "analysis">("config");
  const [campaignName, setCampaignName] = useState("");
  const [campaignKey, setCampaignKey] = useState("");

  const SumchartData = {
    labels: sum_per_challenge.map((_, index) => `Challenge ${index + 1}`),
    datasets: [
      {
        label: 'Average Sum of Metrics',
        data: sum_per_challenge,
        borderColor: 'rgb(38, 102, 130)',
        backgroundColor: 'rgb(38, 102, 130)',
        tension: 0.3,
        fill: true,
      },
    ],
  };

  const SumIncreasechartData = {
    labels: sum_per_challenge_increase.map((_, index) => `Challenge ${index + 1}`),
    datasets: [
      {
        label: 'Average Sum of Metrics Increase',
        data: sum_per_challenge_increase,
        borderColor: 'rgb(38, 102, 130)',
        backgroundColor: 'rgb(38, 102, 130)',
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
      },
    },
    scales: {
      y: {
        beginAtZero: true,
        grid: {
          color: 'rgba(255, 255, 255, 0.1)',
        },
        ticks: {
          color: '#adb5bd',
        }
      },
      x: {
        grid: {
          display: false,
        },
        ticks: {
          color: '#adb5bd',
        }
      }
    },
  };

  return (
    <div
      className={`container-fluid vh-100 d-flex flex-column align-items-center py-4 overflow-y-auto position-relative `}
      style={{
        backgroundImage: `url("${import.meta.env.BASE_URL}graphics/bg_3.png")`,
        backgroundSize: "cover",
        backgroundPosition: "center",
        backgroundRepeat: "no-repeat",
      }}
    >
      <div className={`${styles.adminContainer}`}>
        <div className="position-relative d-flex justify-content-center align-items-center mb-3">
          <h1 className={`${styles.adminTitle} text-center mb-0`}>
            Admin Panel
          </h1>
          <div className="position-absolute end-0">
            <a
              href={import.meta.env.BASE_URL || "/"}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.openGameButton}
              title="Open Login / Register page in a new tab"
            >
              <Icon icon="ph:arrow-square-out-bold" />
              <span>Login / Register</span>
            </a>
          </div>
        </div>

        {/* Top Horizontal Subpage Navigation Bar */}
        <div className="d-flex justify-content-center mb-4 w-100">
          <div className="btn-group p-1 rounded-3 border border-secondary shadow-lg" style={{ backgroundColor: "#1e293b" }} role="group">
            <button
              type="button"
              className={`btn px-4 py-2 fw-bold ${
                activeSubpage === "config"
                  ? "btn-info text-dark shadow"
                  : "btn-outline-light border-0"
              }`}
              onClick={() => setActiveSubpage("config")}
            >
              Config Editor
            </button>
            <button
              type="button"
              className={`btn px-4 py-2 fw-bold ${
                activeSubpage === "manager"
                  ? "btn-info text-dark shadow"
                  : "btn-outline-light border-0"
              }`}
              onClick={() => setActiveSubpage("manager")}
            >
              Campaign & Player Manager
            </button>
            <button
              type="button"
              className={`btn px-4 py-2 fw-bold ${
                activeSubpage === "analysis"
                  ? "btn-info text-dark shadow"
                  : "btn-outline-light border-0"
              }`}
              onClick={() => setActiveSubpage("analysis")}
            >
              Analysis & Statistics
            </button>
          </div>
        </div>

        {/* SUBPAGE 1: CONFIG EDITOR */}
        {activeSubpage === "config" && (
          <div className="card shadow-lg p-4 mb-3 bg-dark text-light border-secondary">
            <h4 className="mb-3 text-info fw-bold">Game Configuration Editor</h4>
            <ConfigEditor
              adminToken={adminToken}
              onDashboardUpdate={onDashboardUpdate}
            />
          </div>
        )}

        {/* SUBPAGE 2: CAMPAIGN & PLAYER MANAGER */}
        {activeSubpage === "manager" && (
          <div className="d-flex flex-column gap-4">
            <div className="card shadow-lg p-4 bg-dark text-light border-secondary">
              <h5 className="mb-3 text-info fw-bold">Manage Campaigns</h5>
              <table className="table table-hover table-dark table-striped rounded-3 overflow-hidden">
                <thead>
                  <tr>
                    <th>Campaign Name</th>
                    <th>Campaign Key</th>
                    <th>Users</th>
                    <th className="text-end">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {campaigns.map((c) => (
                    <tr key={c.name}>
                      <td>{c.name}</td>
                      <td><code>{c.key}</code></td>
                      <td>{c.users.length}</td>
                      <td className="text-end">
                        <button onClick={() => removeCampaign(c.key)} className="btn btn-sm btn-outline-danger">Delete</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="mt-4 p-3 border border-secondary rounded">
                <h6 className="mb-3 text-light">Add New Campaign</h6>
                <div className="row g-2">
                  <div className="col-md-5">
                    <input value={campaignName} onChange={(e) => setCampaignName(e.target.value)} className={`form-control ${styles.adminInput}`} placeholder="Campaign Name" />
                  </div>
                  <div className="col-md-5">
                    <input value={campaignKey} onChange={(e) => setCampaignKey(e.target.value)} className={`form-control ${styles.adminInput}`} placeholder="Campaign Key" />
                  </div>
                  <div className="col-md-2">
                    <button onClick={() => addCampaign(campaignName, campaignKey)} className={`${styles.expandButton} w-100 m-0`}>Add</button>
                  </div>
                </div>
              </div>
            </div>

            <div className="card shadow-lg p-4 bg-dark text-light border-secondary">
              <h5 className="mb-3 text-info fw-bold">Manage Players</h5>
              <table className="table table-hover table-dark table-striped rounded-3 overflow-hidden">
                <thead>
                  <tr>
                    <th>Player Name</th>
                    <th>Campaign Name</th>
                    <th>Progression</th>
                    <th>Intro Score</th>
                    <th>Outro Score</th>
                    <th>Play Time</th>
                  </tr>
                </thead>
                <tbody>
                  {players.map((p) => (
                    <tr key={p.name}>
                      <td>{p.name}</td>
                      <td>{p.campaign_name}</td>
                      <td>{p.gameProgression}</td>
                      <td>{p.introPercentage}%</td>
                      <td>{p.outroPercentage}%</td>
                      <td>{p.playTime}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* SUBPAGE 3: ANALYSIS & STATISTICS */}
        {activeSubpage === "analysis" && (
          <div className="d-flex flex-column gap-4">
            <div className="card shadow-lg p-4 bg-dark text-light border-secondary">
              <h5 className="mb-3 text-info fw-bold">Overall Statistics <small className="text-muted fw-normal fs-6">(Test accounts filtered out)</small></h5>
              <div className="d-flex flex-wrap gap-3">
                <div className="card border-secondary mb-3" style={{ minWidth: "15rem", backgroundColor: "#1e293b" }}>
                  <div className="card-body">
                    <h6 className="card-title text-secondary">Total Player Amount</h6>
                    <p className="card-text fs-4 fw-bold text-light">{players.length}</p>
                  </div>
                </div>
                <div className="card border-secondary mb-3" style={{ minWidth: "15rem", backgroundColor: "#1e293b" }}>
                  <div className="card-body">
                    <h6 className="card-title text-secondary">Finished Player Amount</h6>
                    <p className="card-text fs-4 fw-bold text-light">{finished_players_amount}</p>
                  </div>
                </div>
                <div className="card border-secondary mb-3" style={{ minWidth: "15rem", backgroundColor: "#1e293b" }}>
                  <div className="card-body">
                    <h6 className="card-title text-secondary">Average Intro Questionnaire Score</h6>
                    <p className="card-text fs-4 fw-bold text-light">{intro_questionaire_average}%</p>
                  </div>
                </div>
                <div className="card border-secondary mb-3" style={{ minWidth: "15rem", backgroundColor: "#1e293b" }}>
                  <div className="card-body">
                    <h6 className="card-title text-secondary">Average Outro Questionnaire Score</h6>
                    <p className="card-text fs-4 fw-bold text-light">{outro_questionaire_average}%</p>
                  </div>
                </div>
              </div>

              <div className="mt-4">
                <h6 className="card-title text-secondary mb-3">Average Sum Of Metrics Per Challenge</h6>
                <div style={{ height: '300px' }}>
                  <Line data={SumchartData} options={chartOptions} />
                </div>
                <h6 className="card-title text-secondary mb-3 mt-4">Average Sum Of Metrics Increase Per Challenge</h6>
                <div style={{ height: '300px' }}>
                  <Line data={SumIncreasechartData} options={chartOptions} />
                </div>
              </div>
            </div>

            <div className="card shadow-lg p-4 bg-dark text-light border-secondary">
              <h5 className="mb-3 text-info fw-bold">Questionnaire Detailed Results <small className="text-muted fw-normal fs-6">(Test accounts filtered out)</small></h5>
              
              <h6 className="mb-3 text-secondary">Intro Questionnaire Results</h6>
              <div className="mb-5">
                {questionaire_results["intro"] && questionaire_results["intro"].length > 0 ? (
                  questionaire_results["intro"].map((q: any, qIdx: number) => (
                    <div className="card bg-dark border border-secondary mb-4 shadow-sm rounded-3" key={qIdx}>
                      <div className="card-body">
                        <h6 className="card-title text-info mb-3 fw-bold">{qIdx + 1}. {q["question"]}</h6>
                        <div className="table-responsive rounded-3 overflow-hidden">
                          <table className="table table-dark table-bordered border-secondary mb-0">
                            <thead className="table-active">
                              <tr>
                                <th className="align-middle" style={{ fontSize: '0.85rem', fontWeight: 'bold', width: '15%' }}>Cohort</th>
                                {q["answers"].map((a: any, aIdx: number) => (
                                  <th key={aIdx} className="text-center align-middle" style={{ fontSize: '0.85rem', fontWeight: 'normal' }}>
                                    {a["answer_name"]}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              <tr>
                                <td className="align-middle fw-semibold" style={{ fontSize: '0.9rem' }}>General</td>
                                {q["answers"].map((a: any, aIdx: number) => (
                                  <td key={aIdx} className="text-center align-middle py-3">
                                    <span className="fs-4 fw-bold" style={{ color: 'var(--primary-bg)' }}>{a["amount"]}</span>
                                  </td>
                                ))}
                              </tr>
                              <tr>
                                <td className="align-middle fw-semibold" style={{ fontSize: '0.9rem' }}>Experts</td>
                                {q["answers"].map((a: any, aIdx: number) => (
                                  <td key={aIdx} className="text-center align-middle py-3">
                                    <span className="fs-4 fw-bold text-info">{a["amount_experts"] ?? 0}</span>
                                  </td>
                                ))}
                              </tr>
                            </tbody>
                          </table>
                        </div>
                        {q["answers"].filter((a: any) => a.notes && a.notes.length > 0).length > 0 && (
                          <div className="mt-3 text-white">
                            <div className="fw-bold mb-1 text-info">Notes:</div>
                            <ul className="ps-3 mb-0">
                              {q["answers"]
                                .filter((a: any) => a.notes && a.notes.length > 0)
                                .map((a: any) =>
                                  a.notes.map((note: string, nIdx: number) => (
                                    <li key={`${a.answer_name}-${nIdx}`}>{note}</li>
                                  ))
                                )}
                            </ul>
                          </div>
                        )}
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-muted">No intro results available.</p>
                )}
              </div>

              <h6 className="mb-3 text-secondary">Outro Questionnaire Results</h6>
              <div>
                {questionaire_results["outro"] && questionaire_results["outro"].length > 0 ? (
                  questionaire_results["outro"].map((q: any, qIdx: number) => (
                    <div className="card bg-dark border border-secondary mb-4 shadow-sm rounded-3" key={qIdx}>
                      <div className="card-body">
                        <h6 className="card-title text-info mb-3 fw-bold">{qIdx + 1}. {q["question"]}</h6>
                        <div className="table-responsive rounded-3 overflow-hidden">
                          <table className="table table-dark table-bordered border-secondary mb-0">
                            <thead className="table-active">
                              <tr>
                                <th className="align-middle" style={{ fontSize: '0.85rem', fontWeight: 'bold', width: '15%' }}>Cohort</th>
                                {q["answers"].map((a: any, aIdx: number) => (
                                  <th key={aIdx} className="text-center align-middle" style={{ fontSize: '0.85rem', fontWeight: 'normal' }}>
                                    {a["answer_name"]}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              <tr>
                                <td className="align-middle fw-semibold" style={{ fontSize: '0.9rem' }}>General</td>
                                {q["answers"].map((a: any, aIdx: number) => (
                                  <td key={aIdx} className="text-center align-middle py-3">
                                    <span className="fs-4 fw-bold" style={{ color: 'var(--primary-bg)' }}>{a["amount"]}</span>
                                  </td>
                                ))}
                              </tr>
                              <tr>
                                <td className="align-middle fw-semibold" style={{ fontSize: '0.9rem' }}>Experts</td>
                                {q["answers"].map((a: any, aIdx: number) => (
                                  <td key={aIdx} className="text-center align-middle py-3">
                                    <span className="fs-4 fw-bold text-info">{a["amount_experts"] ?? 0}</span>
                                  </td>
                                ))}
                              </tr>
                            </tbody>
                          </table>
                        </div>
                        {q["answers"].filter((a: any) => a.notes && a.notes.length > 0).length > 0 && (
                          <div className="mt-3 text-white">
                            <div className="fw-bold mb-1 text-info">Notes:</div>
                            <ul className="ps-3 mb-0">
                              {q["answers"]
                                .filter((a: any) => a.notes && a.notes.length > 0)
                                .map((a: any) =>
                                  a.notes.map((note: string, nIdx: number) => (
                                    <li key={`${a.answer_name}-${nIdx}`}>{note}</li>
                                  ))
                                )}
                            </ul>
                          </div>
                        )}
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-muted">No outro results available.</p>
                )}
              </div>
            </div>
          </div>
        )}

      </div>
    </div>

  );
}

