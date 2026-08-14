import React from "react";
import styles from "./IntelArtifactViewer.module.css";

interface IntelArtifactViewerProps {
  content: string;
  artifactType: string;
  stakeholderName: string;
  stakeholderRole: string;
}

export default function IntelArtifactViewer({
  content,
  artifactType,
  stakeholderName,
  stakeholderRole,
}: IntelArtifactViewerProps) {
  // Clean raw markdown, game master tags, and quotes
  let cleanText = content ? content.trim() : "";
  if (cleanText.includes("[GAME MASTER]")) {
    cleanText = cleanText.split("[GAME MASTER]")[0].trim();
  }
  cleanText = cleanText
    .replace(/^["']+|["']+$|^\*\*Meeting Notes\*\*\s*/gi, "")
    .trim();

  const type = (artifactType || "").toLowerCase();
  const name = stakeholderName || "Stakeholder";
  const role = stakeholderRole || "Project Stakeholder";
  const emailAddr = `${name.toLowerCase().replace(/\s+/g, ".")}@enterprise.internal`;
  const initial = name.charAt(0).toUpperCase();

  // ==========================================================================
  // 1. WORKMAIL PRO (Corporate Webmail Client)
  // ==========================================================================
  if (type === "email") {
    return (
      <div className={`${styles.artifactContainer} ${styles.mailWindow}`}>
        {/* Webmail Client Toolbar */}
        <div className={styles.mailToolbar}>
          <div className={styles.mailActions}>
            <button className={styles.actionBtn}>↩ Reply</button>
            <button className={styles.actionBtn}>👥 Reply All</button>
            <button className={styles.actionBtn}>➔ Forward</button>
            <button className={styles.actionBtn}>📁 Archive</button>
          </div>
          <div className={styles.securityTag}>
            <span>🔒</span> TLS 1.3 Encrypted
          </div>
        </div>

        {/* Webmail Sender & Meta */}
        <div className={styles.mailHeader}>
          <div className={styles.mailSubjectRow}>
            <h3 className={styles.mailSubject}>
              [MLOps Review] Stakeholder Stance & System Requirements
            </h3>
            <span className={styles.priorityTag}>HIGH PRIORITY</span>
          </div>

          <div className={styles.mailSenderRow}>
            <div className={styles.senderAvatar}>{initial}</div>
            <div className={styles.senderMeta}>
              <div className={styles.senderNameLine}>
                {name} <span className={styles.senderEmail}>&lt;{emailAddr}&gt;</span>
              </div>
              <div className={styles.recipientLine}>
                <strong>To:</strong> MLOps Engineering Team &lt;mlops-team@enterprise.internal&gt;, <strong>Cc:</strong> Architecture Board
              </div>
            </div>
            <div className={styles.mailDate}>Today, 09:14 AM</div>
          </div>
        </div>

        {/* Email Body */}
        <div className={styles.mailBody}>{cleanText}</div>

        {/* Corporate Email Signature */}
        <div className={styles.mailHeader} style={{ borderBottom: "none" }}>
          <div className={styles.mailSignature}>
            Regards,
            <br />
            <div className={styles.sigName}>{name}</div>
            <div className={styles.sigTitle}>{role}</div>
            <div className={styles.sigCompany}>Enterprise AI & Data Operations Division</div>
            <div className={styles.disclaimer}>
              This communication is intended solely for internal enterprise deployment teams. Containment of proprietary infrastructure constraints apply.
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ==========================================================================
  // 2. TEAMCHAT WORKSPACE (Modern Team Collaboration App)
  // ==========================================================================
  if (type === "slack_message") {
    return (
      <div className={`${styles.artifactContainer} ${styles.chatWindow}`}>
        {/* Channel Header */}
        <div className={styles.chatChannelHeader}>
          <div className={styles.channelTitle}>
            <span>💬</span> #mlops-architecture-sync
            <span className={styles.channelTopic}>| Model Monitoring & System SLA</span>
          </div>
          <div className={styles.channelMembers}>👥 42 Members</div>
        </div>

        {/* Message Container */}
        <div className={styles.chatMessageBody}>
          <div className={styles.chatUserRow}>
            <div className={styles.chatAvatarWrapper}>
              <div className={styles.chatAvatar}>{initial}</div>
              <div className={styles.onlineStatusDot} />
            </div>
            <div>
              <div className={styles.chatUserMeta}>
                <span className={styles.chatUserName}>{name}</span>
                <span className={styles.roleBadge}>{role}</span>
                <span className={styles.chatTime}>Today at 10:42 AM</span>
              </div>
            </div>
          </div>

          <div className={styles.chatBubble}>{cleanText}</div>

          {/* Emoji Reactions & Thread Bar */}
          <div className={styles.reactionBar}>
            <div className={styles.reactionChip}>👍 4</div>
            <div className={styles.reactionChip}>👀 2</div>
            <div className={styles.reactionChip}>🚀 1</div>
            <div className={styles.threadIndicator}>💬 3 replies from team</div>
          </div>
        </div>
      </div>
    );
  }

  // ==========================================================================
  // 3. CORPWIKI DOCS (Confluence / Notion Meeting Minutes)
  // ==========================================================================
  if (type === "meeting_notes") {
    return (
      <div className={`${styles.artifactContainer} ${styles.wikiWindow}`}>
        {/* Wiki Breadcrumb Bar */}
        <div className={styles.wikiBreadcrumbBar}>
          <div className={styles.breadcrumbs}>
            <span>📚 Enterprise Wiki</span> / <span>MLOps Governance</span> / <span>Meeting Minutes</span>
          </div>
          <span className={styles.wikiStatusTag}>APPROVED MINUTES</span>
        </div>

        {/* Body */}
        <div className={styles.wikiBody}>
          <h3 className={styles.wikiTitle}>
            📌 Executive Alignment & Stakeholder Minutes
          </h3>

          <div className={styles.metaRow}>
            <span className={styles.metaChip}>👤 Key Contributor: {name}</span>
            <span className={styles.metaChip}>💼 Role: {role}</span>
            <span className={styles.metaChip}>📅 Date: Q3 Alignment Sync</span>
          </div>

          <div className={styles.executiveCallout}>
            <strong>Executive Takeaway / Stance:</strong>
            <br />
            {cleanText}
          </div>

          <div className={styles.actionChecklist}>
            <div className={styles.checklistTitle}>📋 Mandatory Action Items:</div>
            <div>☑ Audit system constraints & latency targets</div>
            <div>☐ Incorporate stakeholder stance into Sprint 1 backlog</div>
          </div>
        </div>
      </div>
    );
  }

  // ==========================================================================
  // 4. TECHSPEC MEMO (Enterprise Specification & Architecture Document)
  // ==========================================================================
  return (
    <div className={`${styles.artifactContainer} ${styles.specWindow}`}>
      <div className={styles.watermark}>INTERNAL</div>

      {/* Header Bar */}
      <div className={styles.specHeaderBar}>
        <div className={styles.specDocId}>DOC-MLOPS-2026-08</div>
        <span className={styles.classificationBadge}>INTERNAL USE ONLY</span>
      </div>

      {/* Document Content */}
      <div className={styles.specBody}>
        <h3 className={styles.specDocTitle}>
          Technical Architecture Specification & Requirement Memo
        </h3>
        <div className={styles.specAuthorLine}>
          Author: <strong>{name}</strong> ({role}) | Department: MLOps Infrastructure
        </div>

        <div className={styles.specContentBox}>{cleanText}</div>
      </div>
    </div>
  );
}
