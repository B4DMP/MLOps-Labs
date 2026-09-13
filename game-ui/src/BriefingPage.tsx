import { useEffect, useRef, useState } from "react";
import type { Briefing } from "./types/Briefing";
import videojs from "video.js";
import "video.js/dist/video-js.css";
import { Icon } from "@iconify/react";
import { motion, AnimatePresence } from "motion/react";
import styles from "./BriefingPage.module.css";

interface BriefingProps {
  onBriefingCompleted: () => void;
  briefing: Briefing;
}

export default function BriefingPage({
  onBriefingCompleted,
  briefing,
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
    <div className={styles.wrapper}>
      <div className={`card shadow-lg border-0 rounded-4 overflow-hidden ${styles.panel}`}>
        {/* Header */}
        <div className={styles.header}>
          <h2 className={styles.headerTitle}>
            <Icon icon="ph:projector-screen-chart-bold" style={{ color: "var(--secondary-bg)", fontSize: "1.8rem" }} />
            <span>{briefing.briefing_title}</span>
          </h2>
        </div>

        {/* Body */}
        <div className={styles.body}>
          {/* Video Player */}
          <div className={styles.videoWrapper} data-vjs-player>
            <div ref={containerRef} style={{ width: "100%" }} />
          </div>

          {/* Briefing Text from Props */}
          {briefing.briefing_description && (
            <div className={styles.collapsibleCard}>
              <button
                type="button"
                className={styles.collapsibleHeader}
                onClick={() => setIsExpanded(!isExpanded)}
                aria-expanded={isExpanded}
              >
                <div className="d-flex align-items-center gap-2">
                  <Icon icon="ph:book-open-text-bold" style={{ color: "var(--primary-bg)", fontSize: "1.3rem" }} />
                  <span className="fw-bold mb-0">Briefing Text</span>
                </div>
                <div className="d-flex align-items-center gap-1 text-secondary small">
                  <span>{isExpanded ? "Collapse" : "Expand text"}</span>
                  <Icon
                    icon="ph:caret-down-bold"
                    style={{
                      fontSize: "1.1rem",
                      transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)",
                      transition: "transform 0.2s ease",
                    }}
                  />
                </div>
              </button>

              <AnimatePresence initial={false}>
                {isExpanded && (
                  <motion.div
                    key="briefing-description-collapse"
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.25, ease: "easeInOut" }}
                    style={{ overflow: "hidden" }}
                  >
                    <div className={styles.collapsibleContent}>
                      <p className="mb-0" style={{ whiteSpace: "pre-line" }}>
                        {briefing.briefing_description}
                      </p>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}

          {/* Actions */}
          <div className={styles.actionArea}>
            <button
              className={`d-flex align-items-center justify-content-center gap-2 ${styles.actionButton}`}
              onClick={onBriefingCompleted}
            >
              <span>Continue</span>
              <Icon icon="ph:arrow-right-bold" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
