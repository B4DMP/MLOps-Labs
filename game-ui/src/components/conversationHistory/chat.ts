import type { EngagementCard } from "../../types/EngagementCard";

export type RevealedIntel = {
  id?: string;
  requirement_id?: string;
  description: string;
  categorized_type?: string;
  intel_type?: string;
  stakeholder_id?: string;
  stakeholder_name?: string;
  is_corrected?: boolean;
  is_verified?: boolean;
};

export type ChatMsg = {
  id: string;
  message: string;
  ac_id: number;
  emotional_state?: string;
  facial_expression?: string;
  revealed_intel?: RevealedIntel[];
  conversation_id?: string;
  stakeholder_id?: string;
  stakeholder_name?: string;
};

/** What a stakeholder's line said about the proposal, shown as a tag on their last pitch reply. */
export type Stance = "pushback" | "objection";

/** One chip in the proposal band: waiting for a reply, or how they answered. */
export type VerdictState = "waiting" | "backs" | "pushback" | "objection";

export type Verdict = { stakeholderId: string; name: string; state: VerdictState };

export type ProposalSummary = { label: string; count: number };

export const isUserMsg = (m: ChatMsg) => !m.id || m.id === "user";
export const isSystemMsg = (m: ChatMsg) => m.id === "system" || m.id === "__environment__";
export const convIdOf = (m: ChatMsg) => m.conversation_id || "default";

export function getTabInfo(
  conversationId: string,
  engagementCards: EngagementCard[] = []
): { title: string; icon: string } {
  if (!conversationId || conversationId === "default") {
    return { title: "Conversation", icon: "ph:chats-circle-bold" };
  }
  if (conversationId === "conv_legacy") {
    return { title: "Archived Debate", icon: "ph:archive-box-bold" };
  }
  if (conversationId.startsWith("pitch_")) {
    const num = conversationId.replace("pitch_", "");
    return {
      title: num ? `Action Pitch #${num}` : "Action Pitch",
      icon: "ph:presentation-chart-bold",
    };
  }
  if (conversationId.startsWith("eng_")) {
    const lastUnderscore = conversationId.lastIndexOf("_");
    if (lastUnderscore > 4) {
      const cardId = conversationId.substring(4, lastUnderscore);
      const playCount = conversationId.substring(lastUnderscore + 1);
      const card = engagementCards.find((c) => c.id === cardId || c.id === conversationId.slice(4));
      const countNum = parseInt(playCount, 10);
      const suffix = !isNaN(countNum) && countNum > 1 ? ` #${countNum}` : "";
      if (card) {
        return {
          title: `${card.title}${suffix}`,
          icon: card.icon ? `ph:${card.icon}` : "ph:chat-teardrop-text-bold",
        };
      }
      const formattedName = cardId
        .replace(/[_-]/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase());
      return {
        title: `${formattedName}${suffix}`,
        icon: "ph:chat-teardrop-text-bold",
      };
    } else {
      const cardId = conversationId.slice(4);
      const card = engagementCards.find((c) => c.id === cardId);
      return {
        title: card ? card.title : cardId.replace(/[_-]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
        icon: card?.icon ? `ph:${card.icon}` : "ph:chat-teardrop-text-bold",
      };
    }
  }
  if (conversationId.startsWith("verify_")) {
    const num = conversationId.replace("verify_", "");
    return {
      title: num ? `Intel Verification #${num}` : "Intel Verification",
      icon: "ph:shield-check-bold",
    };
  }

  return {
    title: conversationId.replace(/[_-]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
    icon: "ph:chats-bold",
  };
}

/** "Reliability Ruth" with a "Reliability" role shown beside it becomes "Ruth", so the role is not said twice. */
export function shortName(name: string, role?: string): string {
  const [first, ...rest] = name.split(" ");
  return role && rest.length && role.toLowerCase().includes(first.toLowerCase()) ? rest.join(" ") : name;
}
