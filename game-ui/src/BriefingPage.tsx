import { useEffect, useRef, useState } from "react";
import type { Briefing } from "./types/Briefing";
import videojs from "video.js";
import "video.js/dist/video-js.css";
import styles from "./BriefingPage.module.css";

interface BriefingProps {
  onBriefingCompleted: () => void;
  briefing: Briefing;
}

export default function BriefingPage({
  onBriefingCompleted,
}: BriefingProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<any>(null);
  const [isExpanded, setIsExpanded] = useState(false);

  useEffect(() => {
    if (!playerRef.current && containerRef.current) {
      const videoElement = document.createElement("video");
      videoElement.classList.add("video-js");
      videoElement.classList.add("vjs-big-play-centered");
      videoElement.setAttribute("preload", "auto");
      containerRef.current.appendChild(videoElement);

      playerRef.current = videojs(videoElement, {
        fluid: true,
        aspectRatio: "16:9",
        controls: true,
        sources: [{ src: import.meta.env.BASE_URL + "prebriefing_video.mp4", type: "video/mp4" }],
      });
    }

    return () => {
      if (playerRef.current && !playerRef.current.isDisposed()) {
        playerRef.current.dispose();
        playerRef.current = null;
      }
    };
  }, []);

  return (
    <div
      className="container py-5"
      style={{ overflowY: "auto", height: "100vh" }}
    >
      <div className="card shadow-sm p-4">
        <h2>Serious Game Prebriefing</h2>
        <p>
          This prebriefing introduces MLOps and our serious game as an
          experimental learning concept. It covers the following topics:
        </p>
        <ul>
          <li>Short Motivation</li>
          <li>Introduction to Machine Learning and Operations</li>
          <li>Structure and Function of the Serious Game</li>
          <li>Learning Goals</li>
        </ul>
        <p>
          We ask you to either watch the video below or read the prebriefing
          text at the bottom, before progressing to the briefing.
        </p>
        <div className="mt-4" data-vjs-player>
          <div
            ref={containerRef}
            style={{ width: "100%", maxWidth: "800px", margin: "0 auto" }}
          />
        </div>
      </div>


      <div className="card shadow-sm p-4 mb-3">
        <div
          className="d-flex justify-content-between align-items-center"
          style={{ cursor: "pointer" }}
          onClick={() => setIsExpanded(!isExpanded)}
        >
          <h4 className="mb-0">Prebriefing Text</h4>
          <button className={styles.linkButton} onClick={() => setIsExpanded(!isExpanded)}>
            {isExpanded ? "click to collapse" : "click to expand"}
          </button>
        </div>

        {isExpanded && (
          <p className="mt-3">Welcome to the MLOps Serious Game!<br></br>

            Before you start playing, we would like to introduce you to the serious game environment and set the stage for your session today.<br></br> This serious game uses experiment based learning to immerse you in the complex, multidisciplinary world of Machine Learning Operations.<br></br><br></br>

            In comparision to traditional software engineering, machine learning introduces new complexity to the development process. Development teams need different capabilities to manage novel technologies, tools, infrastructure, and challenges.<br></br>
            It is estimated that the failure rate of corporate AI projects is double the size of regular IT projects that do not involve AI, with many projects not reaching production, not because they are not technically feasible, but due to miscommunication or general mismanagement.<br></br>
            The new stakeholders introduced by ML projects demand a higher degree of collaboration and a more serious approach to stakeholder engagement.<br></br><br></br>

            The Machine Learning Operations paradigm is a set of guidelines and practices aimed at managing the ML lifecycle. It includes CI/CD, monitoring, version control, and pipeline automation, while emphasizing collaboration between all involved stakeholders.<br></br><br></br>

            You will be entering a fictional environment of a company that is developing an ML application using MLOps workflows.<br></br>
            Here you will encounter realistic MLOps challenges, interact with AI-driven stakeholder personas with their own priorities, expertise, and inherent biases.<br></br>
            Your task is to negotiate with these stakeholders to evaluate and form cooperative action plans to resolve the challenges. You will have the freedom to test out negotiation strategies and action plans as a fictional decision maker, needing to balance stakeholder interests, technical requirements, and business goals.<br></br>
            Every action you take will impact the environment, reflected in six core metrics: Model, Automation, Reliability, Data, Requirements, and Efficiency. Because resources are limited and interests conflict, improving one metric will likely require a trade-off in another.<br></br>
            We encourage you to embrace your role as a learner today. Be open-minded, stay positive, and don't be afraid to make mistakes.<br></br><br></br>

            By participating in this simulation, you will aquire a better understanding of the MLOps lifecycle and the stakeholder dynamics within it, learn to identify and resolve MLOps challenges, and develop negotiation skills to balance conflicting interests and integrate technical requirements with organizational and business goals in MLOps environments.</p>
        )}
      </div>

      <button
        className={`${styles.actionButton} mt-4 w-100`}
        onClick={onBriefingCompleted}
      >
        Continue
      </button>
    </div>
  );
}
