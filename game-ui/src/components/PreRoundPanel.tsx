import styles from "./PreRoundDialog.module.css";
import { useContext, useEffect } from "react";
import { StakeholderContext } from "./StakeholderProvider";
import { MetricsContext } from "./MetricProvider";
import { RadarChart } from "@mui/x-charts";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import HoverTooltip from "./HoverToolTip";
import { Icon } from "@iconify/react";

const darkTheme = createTheme({ palette: { mode: "dark" } });

interface Stakeholder {
  id: string;
  stakeholder_index: string;
  name: string;
  division: string;
  responsibilities: string[];
  priorities: string[];
  constraints: string[];
  division_description: string[];
  is_selected: boolean;
  stakeholder_color: string;
  metric_expertise_values: number[];
  active: boolean[];
}

interface EndRoundDialogProps {
  rount_intro_txt: string;
  challenge_title: string;
  challenge_desc: string;
  metric_changes: Record<string, number>;
  onStakeholderSelectionDone: () => void;
  selectStakeholder: (stakeholder_index: string) => void;
  current_phase: number;
}



function check_if_stakeholders_are_selected(
  stakeholders: Stakeholder[],
  current_phase: number,
) {
  let amount = 0;
  for (let i = 0; i < stakeholders.length; i++) {
    if (
      stakeholders[i].is_selected &&
      stakeholders[i].active[current_phase]
    ) {
      amount++;
    }
  }
  return amount >= 2;
}

export default function PreRoundPanel({
  rount_intro_txt,
  challenge_title,
  challenge_desc,
  current_phase,
  selectStakeholder,
  onStakeholderSelectionDone,
  metric_changes,
}: EndRoundDialogProps) {
  const { stakeholders } = useContext(StakeholderContext);
  const { metrics } = useContext(MetricsContext);

  let challenge_desc_cutted: { type: string; value: string }[] = [];
  const _split = challenge_desc.split("#");
  let locked_stakeholders: string[] = [];
  let available_stakeholder_ids: number[] = [];

  for (let i = 0; i < stakeholders.length; i++) {
    if (stakeholders[i].active[current_phase]) {
      available_stakeholder_ids.push(i);
    }
  }

  for (let i = 0; i < _split.length; i++) {
    if (i % 2 == 0) {
      challenge_desc_cutted.push({ type: "text", value: _split[i] });
    } else {
      challenge_desc_cutted.push({ type: "id", value: _split[i] });
      const st_found = stakeholders.find((s) => s.name === _split[i] && s.active[current_phase]) || stakeholders.find((s) => s.name === _split[i]);
      if (st_found && !locked_stakeholders.includes(st_found.stakeholder_index)) {
        locked_stakeholders.push(st_found.stakeholder_index);
      }
    }
  }

  useEffect(() => {
    locked_stakeholders.forEach((st_idx) => {
      const st = stakeholders.find((s) => s.stakeholder_index === st_idx);
      if (st && !st.is_selected) {
        selectStakeholder(st_idx);
      }
    });
  }, [challenge_desc, stakeholders, selectStakeholder, locked_stakeholders]);

  return (
    <div
      className={`${styles.panel} transparent-div intro3`}
      data-intro-group="intro3"
      data-intro="Every game phase comes with multiple challenges that resemble real issues and conflicts during MLOps and need to be overcome. Your task is to solve them in a resultion meeting with the stakeholders. This panel introduces the new challenge and allows you to choose stakeholders for the meeting."
      data-step="1"
      data-position="bottom"
    >
      <div className="row flex-grow-1 overflow-hidden">
        <div className="col-8 p-3 h-100 d-flex flex-column">
          <div className=" card shadow-lg h-100 d-flex flex-column flex-grow-1 overflow-hidden">
            <h5
              className="card-header"
              style={{
                color: "white",
                textAlign: "center",
                background: "var(--primary-bg)",
              }}
            >
              New Challenge: {challenge_title}
            </h5>

            <div className="card-body d-flex flex-column overflow-hidden">
              <p className="text-muted mb-2">{rount_intro_txt}</p>

              <div
                className="mb-0 intro3"
                data-intro-group="intro3"
                data-intro="Each challange always contains stakeholders that are directly involved. In many cases, there are interest conflicts between multiple stakeholders."
                data-step="2"
                data-position="bottom"
              >
                {challenge_desc_cutted.map((item, index) => {
                  if (item["type"] == "text") {
                    return <span key={index}>{item["value"]} </span>;
                  } else if (item["type"] == "id") {
                    const st = stakeholders.find(
                      (s) => s.name === item["value"],
                    );
                    if (!st) return <span key={index}>{item["value"]}</span>;
                    return (
                      <HoverTooltip
                        key={index}
                        description={st.division_description.join(" ")}
                      >
                        <span
                          style={{
                            color: st.stakeholder_color,
                            fontWeight: "bold",
                          }}
                        >
                          {st.name + " (" + st.division + ")"}
                        </span>
                      </HoverTooltip>
                    );
                  }
                })}
                {metric_changes &&
                  Object.entries(metric_changes).filter(
                    ([_, change]) => change !== 0,
                  ).length > 0 && (
                    <>
                      <br />
                      <span>The challenge impacts the metrics as follows:</span>
                      <ul className="list-group list-group-horizontal mt-2 flex-wrap gap-3">
                        {Object.entries(metric_changes)
                          .filter(([_, change]) => change !== 0)
                          .map(([metricName, change], i) => {
                            const metric = metrics.find(
                              (m) => m.name === metricName,
                            );

                            return (
                              <HoverTooltip
                                key={i}
                                description={"This challenge influenced the development environemt's " + metricName + " metric by " + change + ". \n\n Description of the metric:\n" + metric?.description}
                              >
                                <li
                                  key={i}
                                  className="d-flex align-items-center mb-1 list-group-item bg-transparent border-0 p-0"
                                >
                                  {metric && (
                                    <Icon
                                      icon={metric.metric_icon}
                                      style={{
                                        color: metric.metric_color,

                                      }}
                                    />
                                  )}
                                  <span style={{ fontWeight: "bold" }}>
                                    {metricName}:{" "}
                                  </span>
                                  <span
                                    style={{
                                      color: change > 0 ? "green" : "red",
                                      fontWeight: "bold",
                                      marginLeft: "5px",
                                    }}
                                  >
                                    {change > 0 ? "+" : ""}
                                    {change}
                                  </span>
                                </li></HoverTooltip>
                            );
                          })}
                      </ul>
                      <br />
                    </>
                  )}

                <span style={{ textDecoration: "underline" }}>
                  Please select the stakeholders that you want to include for
                  this round from the list below.
                </span>
              </div>

              <ul className={styles.stakeholderList}>
                {stakeholders.map(
                  (st, index) =>
                    st.active[current_phase] && (
                      <li
                        key={st.name}
                        className={`${styles.stakeholderCard} ${index === available_stakeholder_ids[available_stakeholder_ids.length - 1] && "intro3"}`}
                        style={{
                          backgroundColor: st.is_selected
                            ? "var(--secondary-bg)"
                            : "var(--card-bg-dark)",
                          borderColor: st.stakeholder_color,
                          outline: st.is_selected
                            ? `5px solid var(--primary-bg)`
                            : "none",
                          outlineOffset: "2px",
                          cursor: !locked_stakeholders.includes(st.stakeholder_index)
                            ? "pointer"
                            : "default",
                        }}
                        onClick={() => {
                          if (!locked_stakeholders.includes(st.stakeholder_index)) {
                            selectStakeholder(st.stakeholder_index);
                          }
                        }}
                        {...(index ===
                          available_stakeholder_ids[
                          available_stakeholder_ids.length - 1
                          ]
                          ? {
                            "data-intro-group": "intro3",
                            "data-intro":
                              "This stakeholder is not locked which means you are free to include him to the resolution meeting. Including more stakeholders with different perspectives can broaden the range of possible solutions. However, selecting more than four stakeholders will introduce a malus to the efficiency metric.",
                            "data-step": "6",
                            "data-position": "bottom",
                          }
                          : {})}
                      >
                        <div className="d-flex flex-row align-items-center w-100 mb-2">
                          <div className={styles.compactContent}>
                            <div className="d-flex align-items-baseline gap-2 flex-wrap">
                              <h5 className="card-title m-0">
                                {stakeholders[index].name}
                              </h5>
                              <h6
                                className="m-0"
                                style={{
                                  color: stakeholders[index].stakeholder_color,
                                }}
                              >
                                {stakeholders[index].division}
                              </h6>
                            </div>
                            <ul className={styles.descriptionList}>
                              {stakeholders[index].division_description.map((point, i) => (
                                <li key={i}>{point}</li>
                              ))}
                            </ul>
                          </div>
                        </div>

                        <ul
                          className={`list-group list-group-horizontal ${styles.metricList} w-100 ${index === available_stakeholder_ids[0] && "intro3"}`}
                          {...(index === available_stakeholder_ids[0]
                            ? {
                              "data-intro-group": "intro3",
                              "data-intro":
                                "Stakeholders have different levels of expertise, which are represented by their metric-specific expertise values. The values are indicated by the number of metric symbols.",
                              "data-step": "3",
                              "data-position": "bottom",
                            }
                            : {})}
                        >
                          {metrics.map(
                            (metric, metric_index) =>
                              metric.phases[current_phase] && (
                                <HoverTooltip
                                  description={"Expertise value of " +
                                    stakeholders[index].metric_expertise_values[metric_index] +
                                    " in " +
                                    metric.name + ":\n" + metric.description
                                  }
                                  key={"st_" + index + "_m_" + metric_index}
                                >

                                  <li
                                    className={`list-group-item ${styles.cardItem}`}
                                    key={metric.name}
                                  >
                                    <div
                                      className={`${styles.metricDiv}`}
                                      style={{
                                        borderColor: metric.metric_color,
                                        borderWidth: "2px",
                                        borderStyle: "solid",
                                        borderRadius: "10px",
                                        padding: "2px 8px",
                                      }}
                                    >
                                      <p className="mb-0">
                                        {[
                                          ...Array(
                                            stakeholders[index]
                                              .metric_expertise_values[
                                            metric_index
                                            ],
                                          ),
                                        ].map((_, index) => (


                                          <span
                                            className="fw-bold me-1"
                                            key={index}
                                          >
                                            <Icon
                                              icon={metric.metric_icon}
                                              style={{
                                                fontSize: "20px",
                                                top: "-2px",
                                                position: "relative",
                                                color: metric.metric_color,
                                                flexShrink: 0,
                                              }}
                                            />
                                          </span>

                                        ))}
                                      </p>
                                    </div>
                                  </li>
                                </HoverTooltip>
                              ),
                          )}
                        </ul>

                        <div className={styles.cardActionArea}>
                          {!locked_stakeholders.includes(index) && (
                            <button
                              className={styles.actionButton}
                              style={{
                                minWidth: "100px",
                                width: "auto",
                                padding: "0.5rem 1rem",
                              }}
                            >
                              <div className={styles.compactContent}>
                                {stakeholders[index].is_selected
                                  ? "Deselect"
                                  : "Select"}
                              </div>
                            </button>
                          )}
                          {locked_stakeholders.includes(index) && (
                            <div
                              className={`stat-icon rounded-circle ${index === available_stakeholder_ids[0] && "intro3"}`}
                              {...(index === available_stakeholder_ids[0]
                                ? {
                                  "data-intro-group": "intro3",
                                  "data-intro":
                                    "Every stakeholder that is directly involved in the current challenge is locked and automatically selected.",
                                  "data-step": "5",
                                  "data-position": "bottom",
                                }
                                : {})}
                              style={{
                                width: "50px",
                                height: "50px",
                                flexShrink: 0,
                                backgroundColor: "var(--icon-bg-locked)",
                              }}
                            >
                              {" "}
                              <p className="m-0 fs-4 ">🔒</p>{" "}
                            </div>
                          )}
                        </div>
                      </li>
                    ),
                )}
              </ul>

              {check_if_stakeholders_are_selected(
                stakeholders,
                current_phase,
              ) ? (
                <button
                  className={styles.continueButton}
                  onClick={() => {
                    onStakeholderSelectionDone();
                  }}
                >
                  continue
                </button>
              ) : (
                <div className="d-flex flex-column gap-2 p-3 bg-light rounded border border-danger">
                  <p
                    className="m-0"
                    style={{ color: "red", fontWeight: "bold" }}
                  >
                    select at least 2 stakeholders to start playing. Currently
                    selected:{" "}
                    {stakeholders.filter((st) => st.is_selected).length}.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="col-4 p-3 h-100 d-flex flex-column">
          <div
            className="card shadow-lg h-100 d-flex flex-column flex-grow-1 overflow-hidden intro3"
            data-intro-group="intro3"
            data-intro="This panel displays the combined expertise of every selected stakeholder. Note that expertise values are only an indication for the stakeholders' priorities, their descriptions contain additional information. If two stakeholders' fields overlap or are identical, they prioritize metrics similarly, though one may still be better suited to the challenge than the other."
            data-step="4"
            data-position="bottom"
            style={{ backgroundColor: "var(--card-bg-dark)" }}
          >
            <h5
              className="card-header"
              style={{
                color: "white",
                textAlign: "center",
                background: "var(--card-bg-dark)",
              }}
            >
              Stakeholder Expertise
            </h5>
            <div
              className="card-body d-flex flex-column"
              style={{ overflowY: "auto" }}
            >
              <p className="mb-2" style={{ color: "white" }}>
                Stakeholders propose actions based on their expertise and
                prioritize actions that benefit their interests the most. The
                expertise values for each metric indicate how important the
                metric is to the stakeholder.{" "}
              </p>
              <p className="mb-2" style={{ color: "white" }}>
                The graph below gives a quick overview of each of the selected
                stakeholders' expertise values for each metric.
              </p>
              <p style={{ color: "white", textDecoration: "underline" }}>
                Note that the expertise values only give an indication for the
                stakeholders' priorities, their descriptions contain additional
                information.
              </p>
              <div
                className={`${styles.radarWrapper} d-flex justify-content-center align-items-center`}
              >
                <ThemeProvider theme={darkTheme}>
                  <RadarChart
                    height={350}
                    margin={{ top: 30, right: 150, bottom: 30, left: 150 }}
                    divisions={3}
                    slotProps={{
                      legend: { sx: { display: "none" } },
                      tooltip: { trigger: "none" },
                    }}
                    series={[
                      ...stakeholders
                        .filter((s) => s.is_selected)
                        .map((s) => ({
                          label: s.name,
                          data: s.metric_expertise_values.filter(
                            (_, i) => metrics[i].phases[current_phase],
                          ),
                          color: s.stakeholder_color,
                        })),
                    ]}
                    radar={{
                      max: 3,
                      metrics: metrics
                        .filter((m) => m.phases[current_phase])
                        .map((m) => m.name),
                    }}
                  />
                </ThemeProvider>
              </div>
              {stakeholders.filter((s) => s.is_selected).length > 0 && (
                <>
                  <p style={{ color: "white" }}>Selected stakeholders:</p>
                  <ul
                    className={`list-group list-group-horizontal ${styles.metricList} w-100`}
                  >
                    {stakeholders
                      .filter((s) => s.is_selected)
                      .map((s) => (
                        <li
                          key={s.id}
                          className="list-group-item bg-transparent border-0 p-0"
                          style={{ color: s.stakeholder_color }}
                        >
                          {s.name}
                        </li>
                      ))}
                  </ul>
                </>
              )}
              {stakeholders.filter((s) => s.is_selected).length === 0 && (
                <p style={{ color: "white" }}>No stakeholders selected.</p>
              )}
            </div>
            {stakeholders.filter((s) => s.is_selected).length > 4 && (
              <div className="d-flex flex-column gap-2 p-3 bg-light rounded border border-warning mb-2">
                <p
                  className="m-0"
                  style={{ color: "orange", fontWeight: "bold" }}
                >
                  Warning: You have selected more than 4 stakeholders (
                  {stakeholders.filter((s) => s.is_selected).length}). This will
                  reduce the {metrics[5].name}
                  <Icon
                    icon={metrics[5].metric_icon}
                    style={{ fontSize: "20px", flexShrink: 0 }}
                  />{" "}
                  by {stakeholders.filter((s) => s.is_selected).length - 4}.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
