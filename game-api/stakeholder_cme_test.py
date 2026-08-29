import enum
import sys
import os
import warnings
from typing import Optional
import textwrap
warnings.filterwarnings("ignore", category=UserWarning, module="pydantic")

sys.path.append(os.path.join(os.path.dirname(__file__), "src"))

from mlops_serious_game.application.pitch_debate_service.nodes import router_node


from langchain_core.messages import HumanMessage
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine
import random
import asyncio
import datetime
import re

from langchain_core.messages import AIMessage, HumanMessage

from langchain_core.runnables import RunnableConfig
from langgraph.prebuilt import ToolNode
from mlops_serious_game.config import settings
from langchain_core.messages import RemoveMessage
from mlops_serious_game.application.pitch_debate_service.tools import tools
from mlops_serious_game.domain.exceptions import RoutingStakeholderNotFound,NoStakeholderRoute
from mlops_serious_game.domain.stakeholder_factory import StakeholderFactory
from mlops_serious_game.domain.stakeholder import Stakeholder
from mlops_serious_game.domain.metric_factory import MetricFactory
from mlops_serious_game.domain.phase_factory import PhaseFactory
from mlops_serious_game.domain.metric import Metric
from mlops_serious_game.domain.prompts import __STAKEHOLDER_CHARACTER_CARD, Prompt
from mlops_serious_game.application.pitch_debate_service.chains import get_chat_model
from mlops_serious_game.application.pitch_debate_service.graph import create_workflow_graph
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from langgraph.graph import END, START, StateGraph,MessagesState
from enum import Enum
from pydantic import BaseModel, Field

from mlops_serious_game.application.dialogue_options_service import (
    DialogueOption,
    dialogue_option_node,
    get_dialogue_option_generator_chain,
)

# Override PostgreSQL connection string
settings.POSTGRES_ASYNC_URI = (
    "postgresql+asyncpg://mlops_labs:mlops_labs@localhost:5432/mlops_labs"
)

STAKEHOLDER_CHARACTER_CARD = Prompt(
    name="stakeholder_character_card",
    prompt=__STAKEHOLDER_CHARACTER_CARD,
)

class EmotionValues(BaseModel):
    """Represents a stakeholder's cognitive-emotional state across key psychological dimensions.
    All values are normalized on a continuous scale from 0.0 (minimum/absent) to 1.0 (maximum/intense).
    """

    trust: float = Field(
        default=0.5,
        ge=0.0,
        le=1.0,
        description="Level of trust in team members, leadership, and system integrity (0.0 = total distrust, 1.0 = absolute trust).",
    )
    interest: float = Field(
        default=0.5,
        ge=0.0,
        le=1.0,
        description="Degree of engagement, curiosity, and investment in project outcomes (0.0 = indifferent, 1.0 = highly invested).",
    )
    stress: float = Field(
        default=0.5,
        ge=0.0,
        le=1.0,
        description="Level of psychological pressure, anxiety, or strain experienced (0.0 = completely relaxed, 1.0 = extremely stressed).",
    )
    confidence: float = Field(
        default=0.5,
        ge=0.0,
        le=1.0,
        description="Self-assurance and belief in their own decisions, abilities, and project trajectory (0.0 = completely insecure, 1.0 = fully confident).",
    )
    perceived_risk: float = Field(
        default=0.5,
        ge=0.0,
        le=1.0,
        description="Subjective assessment of threat or vulnerability to project goals or compliance (0.0 = risk-free, 1.0 = critical threat).",
    )
    sense_of_control: float = Field(
        default=0.5,
        ge=0.0,
        le=1.0,
        description="Perceived agency and influence over project processes and decisions (0.0 = helpless/powerless, 1.0 = full agency).",
    )
    fairness: float = Field(
        default=0.5,
        ge=0.0,
        le=1.0,
        description="Perception of equity, transparency, and procedural justice in interactions (0.0 = unfair/biased, 1.0 = completely fair).",
    )


class EmotionDelta(BaseModel):
    """Calculated change/delta to stakeholder emotional dimensions based solely on the latest message."""

    trust_delta: float = Field(default=0.0, ge=-0.5, le=0.5, description="Change in trust (-0.5 to +0.5)")
    interest_delta: float = Field(default=0.0, ge=-0.5, le=0.5, description="Change in interest (-0.5 to +0.5)")
    stress_delta: float = Field(default=0.0, ge=-0.5, le=0.5, description="Change in stress (-0.5 to +0.5)")
    confidence_delta: float = Field(default=0.0, ge=-0.5, le=0.5, description="Change in confidence (-0.5 to +0.5)")
    perceived_risk_delta: float = Field(default=0.0, ge=-0.5, le=0.5, description="Change in perceived risk (-0.5 to +0.5)")
    sense_of_control_delta: float = Field(default=0.0, ge=-0.5, le=0.5, description="Change in sense of control (-0.5 to +0.5)")
    fairness_delta: float = Field(default=0.0, ge=-0.5, le=0.5, description="Change in fairness (-0.5 to +0.5)")


EMOTIONAL_STATE_RULES: dict[str, dict] = {
    "angry": {
        "description": "Triggered by low fairness, low trust, and high stress.",
        "condition": lambda ev: ev.fairness <= 0.35 and ev.trust <= 0.35 and ev.stress >= 0.6,
        "formula": lambda ev: round(max(0.0, min(1.0, (1.0 - ev.fairness) * 0.4 + (1.0 - ev.trust) * 0.3 + ev.stress * 0.3)), 2),
    },
    "anxious": {
        "description": "Triggered by high perceived risk, high stress, and low sense of control.",
        "condition": lambda ev: ev.perceived_risk >= 0.6 and ev.stress >= 0.6 and ev.sense_of_control <= 0.4,
        "formula": lambda ev: round(max(0.0, min(1.0, ev.perceived_risk * 0.4 + ev.stress * 0.3 + (1.0 - ev.sense_of_control) * 0.3)), 2),
    },
    "frustrated": {
        "description": "Triggered when high interest/investment is blocked by low sense of control and low trust.",
        "condition": lambda ev: ev.interest >= 0.6 and ev.sense_of_control <= 0.35 and ev.trust <= 0.4,
        "formula": lambda ev: round(max(0.0, min(1.0, ev.interest * 0.3 + (1.0 - ev.sense_of_control) * 0.4 + ev.stress * 0.3)), 2),
    },
    "enthusiastic": {
        "description": "Triggered by high trust, high interest, high confidence, and low perceived risk.",
        "condition": lambda ev: ev.trust >= 0.6 and ev.interest >= 0.6 and ev.confidence >= 0.6 and ev.perceived_risk <= 0.4,
        "formula": lambda ev: round(max(0.0, min(1.0, ev.trust * 0.3 + ev.interest * 0.3 + ev.confidence * 0.2 + (1.0 - ev.perceived_risk) * 0.2)), 2),
    },
    "skeptical": {
        "description": "Triggered by low trust and low fairness despite high interest.",
        "condition": lambda ev: ev.trust <= 0.4 and ev.fairness <= 0.4 and ev.interest >= 0.5,
        "formula": lambda ev: round(max(0.0, min(1.0, (1.0 - ev.trust) * 0.4 + (1.0 - ev.fairness) * 0.4 + ev.interest * 0.2)), 2),
    },
    "apathetic": {
        "description": "Triggered by low interest and low sense of control.",
        "condition": lambda ev: ev.interest <= 0.3 and ev.sense_of_control <= 0.3,
        "formula": lambda ev: round(max(0.0, min(1.0, (1.0 - ev.interest) * 0.6 + (1.0 - ev.sense_of_control) * 0.4)), 2),
    },
    "relieved": {
        "description": "Triggered by low stress and low perceived risk combined with high trust and fairness.",
        "condition": lambda ev: ev.stress <= 0.35 and ev.perceived_risk <= 0.35 and ev.trust >= 0.6,
        "formula": lambda ev: round(max(0.0, min(1.0, (1.0 - ev.stress) * 0.4 + (1.0 - ev.perceived_risk) * 0.4 + ev.fairness * 0.2)), 2),
    },
    "overwhelmed": {
        "description": "Triggered by critical stress and risk with near-zero sense of control.",
        "condition": lambda ev: ev.stress >= 0.75 and ev.perceived_risk >= 0.7 and ev.sense_of_control <= 0.25,
        "formula": lambda ev: round(max(0.0, min(1.0, ev.stress * 0.4 + ev.perceived_risk * 0.3 + (1.0 - ev.sense_of_control) * 0.3)), 2),
    },
    "neutral": {
        "description": "Default baseline emotional state when no strong appraisal triggers occur.",
        "condition": lambda ev: True,
        "formula": lambda ev: 0.5,
    },
}

def derive_emotional_state(ev: EmotionValues) -> str:
    """Computes resulting emotion intensity scores and returns the highest scoring emotion among triggered conditions, falling back to neutral."""
    triggered_scores = {
        emotion: rule["formula"](ev)
        for emotion, rule in EMOTIONAL_STATE_RULES.items()
        if emotion != "neutral" and rule["condition"](ev)
    }
    if not triggered_scores:
        return "neutral"
    return max(triggered_scores, key=triggered_scores.get)



EMOTION_PROMPT_APPENDIX: dict[str, str] = {
    "angry": (
        "Respond with visible irritation and sharpness regarding the lack of fairness and trust. "
        "Demand immediate accountability, push back forcefully on proposed changes, and express dissatisfaction."
    ),
    "anxious": (
        "Express heightened concern and hesitation about risk and loss of control. "
        "Seek immediate reassurance, ask probing questions about safety measures, and urge caution before proceeding."
    ),
    "frustrated": (
        "Convey annoyance and impatience about blocked progress and lack of agency. "
        "Highlight obstacles sharply and demand clearer pathways or control over decision-making."
    ),
    "enthusiastic": (
        "Respond with high energy, optimism, and strong alignment with the proposed direction. "
        "Actively support the initiative, offer constructive ideas, and encourage swift implementation."
    ),
    "skeptical": (
        "Adopt a guarded, questioning tone and express doubt regarding claims or promises made. "
        "Demand concrete evidence, rigorous validation, and transparent explanations before buying in."
    ),
    "apathetic": (
        "Give a minimal, disinterested, and passive response showing little engagement with the project. "
        "Express reluctance to spend effort on the matter and defer decisions without enthusiasm."
    ),
    "relieved": (
        "Communicate a sense of ease, satisfaction, and renewed confidence in the project's direction. "
        "Acknowledge positive progress warmly and express readiness to move forward smoothly."
    ),
    "overwhelmed": (
        "Express distress and feeling overloaded by high complexity and mounting risks. "
        "Request an immediate pause or simplification of scope to regain stability and clarity."
    ),
    "neutral": (
        "Maintain a professional, objective, and matter-of-fact tone. "
        "Focus purely on factual details and standard operational requirements without emotional bias."
    ),
}



class StakeholderIntelItemLayer(enum.Enum):
    TECHNICAL = "technical"
    BUSINESS = "business"
    POLITICAL = "political"

class StakeholderIntelItemIntent(enum.Enum):
    HARD_CONSTRAINT = "hard_constraint"
    PREFERENCE = "preference"
    PERSONAL_FRICTION = "personal_friction"

class StakeholderIntelItem(BaseModel):
    stakeholder_id: str
    categorized_layer: StakeholderIntelItemLayer
    categorized_intent: StakeholderIntelItemIntent
    correct_layer: StakeholderIntelItemLayer
    correct_intent: StakeholderIntelItemIntent
    correct_description: str
    categorized_description: str

    def is_correct_intel(self) -> bool:
        return self.categorized_layer == self.correct_layer and \
            self.categorized_intent == self.correct_intent


class ConvincerArchetype(BaseModel):
    name: str
    evidence_basis: int   # 0 = rational/data-driven -> 5 = relational/trust-driven
    risk_and_control: int # 0 = autonomy-seeking/risk-tolerant -> 5 = control-seeking/risk-averse
    value_horizon: int    # 0 = short-term practical -> 5 = long-term strategic
    description: str
    strategy: str


CONVINCER_ARCHETYPES: list[ConvincerArchetype] = [
    ConvincerArchetype(
        name="Technical Excellence",
        evidence_basis=0,
        risk_and_control=2,
        value_horizon=3,
        description="Convinced by technical quality, engineering best practices, empirical evidence, innovation, benchmarks, and sound technical reasoning.",
        strategy="Explain how the solution works using technical details, data, trade-offs, and objective evidence rather than promises or business rhetoric."
    ),
    ConvincerArchetype(
        name="Business Value",
        evidence_basis=1,
        risk_and_control=3,
        value_horizon=5,
        description="Convinced by measurable business outcomes such as ROI, cost savings, productivity, customer value, or competitive advantage.",
        strategy="Frame every proposal in terms of business impact, quantifiable benefits, strategic goals, and return on investment."
    ),
    ConvincerArchetype(
        name="Safety & Reliability",
        evidence_basis=0,
        risk_and_control=5,
        value_horizon=4,
        description="Convinced by reducing risk through security, compliance, reliability, resilience, monitoring, and contingency planning.",
        strategy="Emphasize risk mitigation, safeguards, testing, compliance, SLAs, monitoring, and fallback plans to build confidence."
    ),
    ConvincerArchetype(
        name="Control & Governance",
        evidence_basis=2,
        risk_and_control=5,
        value_horizon=3,
        description="Convinced by ownership, decision-making authority, transparency, approval processes, and organizational oversight.",
        strategy="Highlight governance structures, approval gates, reporting mechanisms, and how stakeholders retain visibility and control over the project."
    ),
    ConvincerArchetype(
        name="People & Trust",
        evidence_basis=5,
        risk_and_control=1,
        value_horizon=2,
        description="Convinced through credibility, honest communication, collaboration, and strong professional relationships.",
        strategy="Communicate openly, acknowledge concerns, demonstrate empathy, and build trust through transparency and collaboration rather than hard facts alone."
    ),
    ConvincerArchetype(
        name="Autonomy",
        evidence_basis=3,
        risk_and_control=0,
        value_horizon=2,
        description="Convinced when their team retains independence, flexibility, and freedom to make technical or organizational decisions.",
        strategy="Present the proposal as empowering rather than restricting, emphasizing flexibility, delegated ownership, and local decision-making."
    ),
    ConvincerArchetype(
        name="Pragmatism",
        evidence_basis=1,
        risk_and_control=1,
        value_horizon=0,
        description="Convinced by practical, low-complexity solutions that solve today's problem without unnecessary sophistication.",
        strategy="Focus on simple, actionable solutions with clear implementation steps, avoiding unnecessary complexity or overengineering."
    ),
]

def get_archetype_by_name(name: str) -> Optional[ConvincerArchetype]:
    for arch in CONVINCER_ARCHETYPES:
        if arch.name.lower() == name.lower():
            return arch
    return None

STAKEHOLDER_CONVINCER_ARCHETYPES: dict[str, ConvincerArchetype] = {
    "willis_slif_business_manager": get_archetype_by_name("Business Value"),
    "mathis_berger_operational_engineer": get_archetype_by_name("Safety & Reliability"),
}



CONVINCER_ITEM_WILLIS_1 = StakeholderIntelItem(
    stakeholder_id="willis_slif_business_manager",
    categorized_layer=StakeholderIntelItemLayer.BUSINESS,
    categorized_intent=StakeholderIntelItemIntent.HARD_CONSTRAINT,
    correct_layer=StakeholderIntelItemLayer.BUSINESS,
    correct_intent=StakeholderIntelItemIntent.HARD_CONSTRAINT,
    correct_description="Willis requires a clear cost-benefit assessment and ROI projection before committing resources to model retraining, refusing unbudgeted rapid retraining cycles.",
    categorized_description="Willis requires a clear cost-benefit assessment and ROI projection before committing resources to model retraining, refusing unbudgeted rapid retraining cycles."
)

CONVINCER_ITEM_WILLIS_2 = StakeholderIntelItem(
    stakeholder_id="willis_slif_business_manager",
    categorized_layer=StakeholderIntelItemLayer.BUSINESS,
    categorized_intent=StakeholderIntelItemIntent.HARD_CONSTRAINT,
    correct_layer=StakeholderIntelItemLayer.BUSINESS,
    correct_intent=StakeholderIntelItemIntent.HARD_CONSTRAINT,
    correct_description="Willis requires automated rollback triggers and real-time SLA uptime dashboards to ensure drift-related accuracy loss does not cause unmonitored business revenue degradation.",
    categorized_description="Willis requires automated rollback triggers and real-time SLA uptime dashboards to ensure drift-related accuracy loss does not cause unmonitored business revenue degradation."
)

CONVINCER_ITEM_MATHIS_1 = StakeholderIntelItem(
    stakeholder_id="mathis_berger_operational_engineer",
    categorized_layer=StakeholderIntelItemLayer.TECHNICAL,
    categorized_intent=StakeholderIntelItemIntent.HARD_CONSTRAINT,
    correct_layer=StakeholderIntelItemLayer.TECHNICAL,
    correct_intent=StakeholderIntelItemIntent.HARD_CONSTRAINT,
    correct_description="Mathis mandates root-cause data drift diagnosis and automated pre-deployment validation checks before any retrained model image is pushed to production.",
    categorized_description="Mathis mandates root-cause data drift diagnosis and automated pre-deployment validation checks before any retrained model image is pushed to production."
)

CONVINCER_ITEM_MATHIS_2 = StakeholderIntelItem(
    stakeholder_id="mathis_berger_operational_engineer",
    categorized_layer=StakeholderIntelItemLayer.TECHNICAL,
    categorized_intent=StakeholderIntelItemIntent.HARD_CONSTRAINT,
    correct_layer=StakeholderIntelItemLayer.TECHNICAL,
    correct_intent=StakeholderIntelItemIntent.HARD_CONSTRAINT,
    correct_description="Mathis mandates sub-200ms inference latency benchmarks and zero-downtime regression testing to ensure retraining does not compromise pipeline stability.",
    categorized_description="Mathis mandates sub-200ms inference latency benchmarks and zero-downtime regression testing to ensure retraining does not compromise pipeline stability."
)

WILLIS_PREFERENCE_1 = StakeholderIntelItem(
    stakeholder_id="willis_slif_business_manager",
    categorized_layer=StakeholderIntelItemLayer.BUSINESS,
    categorized_intent=StakeholderIntelItemIntent.PREFERENCE,
    correct_layer=StakeholderIntelItemLayer.BUSINESS,
    correct_intent=StakeholderIntelItemIntent.PREFERENCE,
    correct_description="Willis prefers bi-weekly executive summaries showing SLA uptime and customer impact metrics over technical data pipeline logs.",
    categorized_description="Willis prefers bi-weekly executive summaries showing SLA uptime and customer impact metrics over technical data pipeline logs."
)

MATHIS_PREFERENCE_1 = StakeholderIntelItem(
    stakeholder_id="mathis_berger_operational_engineer",
    categorized_layer=StakeholderIntelItemLayer.TECHNICAL,
    categorized_intent=StakeholderIntelItemIntent.PREFERENCE,
    correct_layer=StakeholderIntelItemLayer.TECHNICAL,
    correct_intent=StakeholderIntelItemIntent.PREFERENCE,
    correct_description="Mathis prefers open-source Prometheus/Grafana drift monitoring dashboards over proprietary SaaS platforms.",
    categorized_description="Mathis prefers open-source Prometheus/Grafana drift monitoring dashboards over proprietary SaaS platforms."
)

WILLIS_MISCATEGORIZED_1 = StakeholderIntelItem(
    stakeholder_id="willis_slif_business_manager",
    categorized_layer=StakeholderIntelItemLayer.TECHNICAL,
    categorized_intent=StakeholderIntelItemIntent.PREFERENCE,
    correct_layer=StakeholderIntelItemLayer.BUSINESS,
    correct_intent=StakeholderIntelItemIntent.PREFERENCE,
    correct_description="Willis prioritizes financial risk controls and SLA reports over low-level infrastructure code reviews.",
    categorized_description="Willis insists that data engineers manually review memory allocation on model-serving nodes before retraining."
)

WILLIS_MISCATEGORIZED_2 = StakeholderIntelItem(
    stakeholder_id="willis_slif_business_manager",
    categorized_layer=StakeholderIntelItemLayer.BUSINESS,
    categorized_intent=StakeholderIntelItemIntent.PERSONAL_FRICTION,
    correct_layer=StakeholderIntelItemLayer.BUSINESS,
    correct_intent=StakeholderIntelItemIntent.HARD_CONSTRAINT,
    correct_description="Willis requires strict financial audit gates before model redeployment to ensure corporate compliance.",
    categorized_description="Willis holds a deep personal grudge against the data science team and actively tries to block their retraining proposals."
)

MATHIS_MISCATEGORIZED_1 = StakeholderIntelItem(
    stakeholder_id="mathis_berger_operational_engineer",
    categorized_layer=StakeholderIntelItemLayer.POLITICAL,
    categorized_intent=StakeholderIntelItemIntent.PERSONAL_FRICTION,
    correct_layer=StakeholderIntelItemLayer.TECHNICAL,
    correct_intent=StakeholderIntelItemIntent.HARD_CONSTRAINT,
    correct_description="Mathis requires strict container security vulnerability scans before any image is pushed to production.",
    categorized_description="Mathis enforces container security vulnerability scans purely to undermine executive authority."
)

MATHIS_MISCATEGORIZED_2 = StakeholderIntelItem(
    stakeholder_id="mathis_berger_operational_engineer",
    categorized_layer=StakeholderIntelItemLayer.TECHNICAL,
    categorized_intent=StakeholderIntelItemIntent.PERSONAL_FRICTION,
    correct_layer=StakeholderIntelItemLayer.TECHNICAL,
    correct_intent=StakeholderIntelItemIntent.PERSONAL_FRICTION,
    correct_description="Mathis experiences severe frustration when unvalidated hotfixes are deployed directly to production environments.",
    categorized_description="Mathis experiences severe frustration when unvalidated hotfixes are deployed directly to production environments."
)

GENERAL_INTEL_ITEMS: list[StakeholderIntelItem] = [
    CONVINCER_ITEM_WILLIS_1,
    CONVINCER_ITEM_WILLIS_2,
    WILLIS_PREFERENCE_1,
    CONVINCER_ITEM_MATHIS_1,
    CONVINCER_ITEM_MATHIS_2,
    MATHIS_PREFERENCE_1,
    WILLIS_MISCATEGORIZED_1,
    WILLIS_MISCATEGORIZED_2,
    MATHIS_MISCATEGORIZED_1,
    MATHIS_MISCATEGORIZED_2,
]

# Convincer profiles dynamically built from ALL intel items of type HARD_CONSTRAINT
STAKEHOLDER_CONVINCER_PROFILES: dict[str, list[StakeholderIntelItem]] = {}
for _item in GENERAL_INTEL_ITEMS:
    if _item.correct_intent == StakeholderIntelItemIntent.HARD_CONSTRAINT:
        _st_id = _item.stakeholder_id
        if _st_id not in STAKEHOLDER_CONVINCER_PROFILES:
            STAKEHOLDER_CONVINCER_PROFILES[_st_id] = []
        if _item not in STAKEHOLDER_CONVINCER_PROFILES[_st_id]:
            STAKEHOLDER_CONVINCER_PROFILES[_st_id].append(_item)


class PitchDebateState(MessagesState):
    """State class for the LangGraph workflow. It keeps track of the information necessary to maintain a coherent
    conversation between the Stakeholder and the user.

    Attributes:
        challenge (str): The current MLOps challenge.
        summary (str): A summary of the conversation. This is used to reduce the token usage of the model.
        stakeholder_ids (list(str)): The ids of the stakeholders that are adressed.
        generate_card: bool: result of action_card_gen_checker
        action_cards: list of generated action cards
        emotion_values (dict[str, EmotionValues]): Emotional state values mapped by stakeholder ID.
        emotion_deltas (dict[str, EmotionDelta]): Emotional state deltas mapped by stakeholder ID.
    """

    challenge: str
    summary: str
    stakeholder_ids: list[str]
    generate_card: bool
    action_cards: list
    phase_id: int
    cheating_detected: bool
    emotion_values: dict[str, EmotionValues]
    emotion_deltas: dict[str, EmotionDelta] # not actually needed, just for debugging
    intel_items: list[StakeholderIntelItem]
    dialogue_options: list[DialogueOption]
    stakeholder_convincer_profile: dict[str,list[StakeholderIntelItem]]
    last_selected_intel: Optional[StakeholderIntelItem]
    last_selected_option: Optional[DialogueOption]



def format_message_for_eval(m) -> str:
    m_type = type(m).__name__
    m_content = getattr(m, "content", str(m))
    if m_type == "HumanMessage" or getattr(m, "type", "") == "human":
        return f"User: {m_content}"
    elif m_type == "AIMessage" or getattr(m, "type", "") == "ai":
        match = re.match(r"^\[(.*?)\]\s*(.*)$", m_content, re.DOTALL)
        if match:
            st_id_parsed, text = match.groups()
            try:
                st_obj = StakeholderFactory.get_stakeholder(st_id_parsed.strip())
                return f"{st_obj.name}: {text}"
            except Exception:
                return f"{st_id_parsed}: {text}"
        return f"Stakeholder: {m_content}"
    elif m_type == "ToolMessage":
        return f"Tool Output: {m_content}"
    return str(m_content)


def get_emotion_evaluator_chain():
    model = get_chat_model()
    structured_model = model.with_structured_output(EmotionDelta)

    prompt = ChatPromptTemplate.from_messages(
        [
            (
                "system",
                "You are an expert psychological appraisal engine for stakeholders in an MLOps serious game.\n"
                "Analyze all NEW MESSAGES THAT OCCURRED SINCE THIS STAKEHOLDER LAST PARTICIPATED in the conversation (provided below).\n"
                "Use the provided prior conversation history strictly for context to understand the dialogue background.\n"
                "Evaluate the net emotional impact of ONLY the new messages on tone, content, fairness, procedural justice, pressure, and risk.\n"
                "Pay close attention to disrespect, exclusion of team members, broken agreements, or risky decisions in the new messages.\n"
                "Do NOT consider existing numeric emotion values.\n\n"
                "Target Stakeholder: {{stakeholder_name}}\n"
                "Responsibilities: {{stakeholder_responsibilities}}\n"
                "Priorities: {{stakeholder_priorities}}\n"
                "Challenge Context: {{challenge}}\n"
                "{% if intel_eval_context %}\nIntel Assessment Context:\n{{intel_eval_context}}\n{% endif %}\n\n"
                "Output emotional deltas between -0.5 (strong negative impact) and +0.5 (strong positive impact) for each psychological dimension.",
            ),
            (
                "human",
                "Prior Conversation History:\n{{history}}\n\n"
                "New Messages Since Stakeholder Last Participated (Evaluate these for emotional impact):\n{{new_messages}}",
            ),
        ],
        template_format="jinja2",
    )
    return prompt | structured_model


import math

def calculate_system_emotion_deltas(
    st_id: str,
    last_intel: Optional[StakeholderIntelItem],
    selected_option: Optional[DialogueOption],
) -> EmotionDelta:
    trust_d = 0.0
    interest_d = 0.0
    stress_d = 0.0
    confidence_d = 0.0
    risk_d = 0.0
    control_d = 0.0
    fairness_d = 0.0

    st_archetype = STAKEHOLDER_CONVINCER_ARCHETYPES.get(st_id)

    # 1. If an Intel Option was used
    if last_intel:
        if st_id == last_intel.stakeholder_id:
            if not last_intel.is_correct_intel():
                # Misattributed intel penalty
                trust_d -= 0.30
                stress_d += 0.30
                risk_d += 0.25
                control_d -= 0.20
                fairness_d -= 0.20
            else:
                # Correct intel reward
                trust_d += 0.20
                stress_d -= 0.15
                risk_d -= 0.10
                fairness_d += 0.15
                confidence_d += 0.15

    # 2. If a Corporate Noise option with an Archetype was used
    elif selected_option and selected_option.archetype and st_archetype:
        opt_arch = selected_option.archetype

        diff_evidence = abs(opt_arch.evidence_basis - st_archetype.evidence_basis)
        diff_risk = abs(opt_arch.risk_and_control - st_archetype.risk_and_control)
        diff_horizon = abs(opt_arch.value_horizon - st_archetype.value_horizon)

        total_distance = math.sqrt(diff_evidence**2 + diff_risk**2 + diff_horizon**2)

        # Trust delta based on total distance
        if total_distance < 3.5:
            trust_d += round(0.10 + (3.5 - total_distance) * 0.04, 2)
        else:
            trust_d -= round(0.10 + (total_distance - 3.5) * 0.04, 2)

        # Perceived Risk & Stress based on Risk & Control alignment
        if opt_arch.risk_and_control >= 4:
            risk_d -= 0.20
            stress_d -= 0.15
        elif st_archetype.risk_and_control >= 4 and diff_risk >= 3:
            risk_d += 0.25
            stress_d += 0.20
            control_d -= 0.20

        # Interest based on Value Horizon alignment
        if diff_horizon <= 1:
            interest_d += 0.20
        elif diff_horizon >= 3:
            interest_d -= 0.15

        # Fairness & Confidence based on Evidence Basis alignment
        if diff_evidence <= 1:
            fairness_d += 0.15
            confidence_d += 0.15
        elif diff_evidence >= 3:
            fairness_d -= 0.15

    return EmotionDelta(
        trust_delta=round(trust_d, 2),
        interest_delta=round(interest_d, 2),
        stress_delta=round(stress_d, 2),
        confidence_delta=round(confidence_d, 2),
        perceived_risk_delta=round(risk_d, 2),
        sense_of_control_delta=round(control_d, 2),
        fairness_delta=round(fairness_d, 2),
    )


async def emotion_node(state: PitchDebateState, config: RunnableConfig):
    messages = state.get("messages", [])
    if not messages:
        return {}

    stakeholder_ids = state.get("stakeholder_ids", [])
    stakeholder_id = stakeholder_ids[-1] if stakeholder_ids else "willis_slif_business_manager"
    st = StakeholderFactory.get_stakeholder(stakeholder_id)

    last_selected_intel = state.get("last_selected_intel")
    last_selected_option = state.get("last_selected_option")

    # 100% System-based emotion updates calculated via vector distance & deterministic rules
    delta = calculate_system_emotion_deltas(
        st_id=st.id,
        last_intel=last_selected_intel,
        selected_option=last_selected_option,
    )

    # Retrieve current emotion values from state or initialize baseline
    emotion_values_map = dict(state.get("emotion_values", {}) or {})
    emotion_deltas_map = dict(state.get("emotion_deltas", {}) or {})
    curr_ev = emotion_values_map.get(st.id, EmotionValues())

    # Algorithmic updates with strict guardrails [0.0, 1.0]
    updated_ev = EmotionValues(
        trust=max(0.0, min(1.0, round(curr_ev.trust + delta.trust_delta, 2))),
        interest=max(0.0, min(1.0, round(curr_ev.interest + delta.interest_delta, 2))),
        stress=max(0.0, min(1.0, round(curr_ev.stress + delta.stress_delta, 2))),
        confidence=max(0.0, min(1.0, round(curr_ev.confidence + delta.confidence_delta, 2))),
        perceived_risk=max(0.0, min(1.0, round(curr_ev.perceived_risk + delta.perceived_risk_delta, 2))),
        sense_of_control=max(0.0, min(1.0, round(curr_ev.sense_of_control + delta.sense_of_control_delta, 2))),
        fairness=max(0.0, min(1.0, round(curr_ev.fairness + delta.fairness_delta, 2))),
    )

    emotion_values_map[st.id] = updated_ev
    emotion_deltas_map[st.id] = delta

    convincer_profile_map = dict(state.get("stakeholder_convincer_profile", {}) or {})
    if last_selected_intel and last_selected_intel.is_correct_intel() and convincer_profile_map:
        st_id = last_selected_intel.stakeholder_id
        if st_id in convincer_profile_map:
            reqs = list(convincer_profile_map[st_id])
            updated_reqs = [
                r for r in reqs
                if r.categorized_description != last_selected_intel.categorized_description
                and r.correct_description != last_selected_intel.correct_description
            ]
            convincer_profile_map[st_id] = updated_reqs

    return {
        "emotion_values": emotion_values_map,
        "emotion_deltas": emotion_deltas_map,
        "stakeholder_convincer_profile": convincer_profile_map,
    }


STAKEHOLDER_CHARACTER_CARD_APPENDIX = """
ADDITIONAL GAME RULES & SECRECY DIRECTIVES:
1. USER IDENTITY: The Human user sending messages in the chat is the MLOps Project Manager leading the meeting. Other names in the conversation history (e.g. Willis, Mathis) are your fellow colleagues participating in the meeting. Always respond to the Human user as the Project Manager, and refer to your colleagues in the 3rd person. NEVER call or address the Human user by a colleague's name!
2. INTEL & REQUIREMENT SECRECY RULE: You know your underlying priorities and requirements. However, DO NOT directly state, list, or blurt out what your specific requirements/solutions are unless:
   (a) The Project Manager has just played a dialogue option that satisfies your requirement (in which case you confirm and praise it), OR
   (b) The Project Manager stated a false assumption about you (in which case you correct them and reveal your true requirement).
   Otherwise, discuss your general concerns, risks, and feelings about the situation without giving away the exact solution.
"""

def get_stakeholder_response_chain():
    model = get_chat_model()
    model = model.bind_tools(tools)
    system_prompt_text = STAKEHOLDER_CHARACTER_CARD.prompt + "\n\n" + STAKEHOLDER_CHARACTER_CARD_APPENDIX

    prompt = ChatPromptTemplate.from_messages(
        [
            ("system", system_prompt_text),
            MessagesPlaceholder(variable_name="messages"),
            (
                "human",
                "[GAME MASTER] Stakeholder {{stakeholder_name}} (Current Emotional State: {{current_emotion}}. Guidance: {{emotion_instruction}}).\n"
                "You are responding directly to the MLOps Project Manager leading the meeting. Respond to the Project Manager and refer to your colleagues (e.g. Willis, Mathis) in the 3rd person if mentioning them. NEVER call the Project Manager by a colleague's name!\n"
                "{% if intel_instruction %}\n{{intel_instruction}}\n{% endif %} DO NOT USE TOOLS!",
            ),
        ],
        template_format="jinja2",
    )

    return prompt | model

async def conversation_node(state: PitchDebateState, config: RunnableConfig):

    summary = state.get("summary", "")
    
    # Get active stakeholder ID from state
    stakeholder_ids = state.get("stakeholder_ids", [])
    stakeholder_id = stakeholder_ids[-1] if stakeholder_ids else "jimmy_everick_data_scientist"
    st = StakeholderFactory.get_stakeholder(stakeholder_id)

    # Calculate current emotional state & prompt guidance from EmotionValues
    emotion_values_map = state.get("emotion_values", {})
    emotion_deltas_map = state.get("emotion_deltas", {})
    st_emotion_values = emotion_values_map.get(st.id, EmotionValues())
    st_emotion_delta = emotion_deltas_map.get(st.id, EmotionDelta())
    current_emotion = derive_emotional_state(st_emotion_values)
    emotion_instruction = EMOTION_PROMPT_APPENDIX.get(current_emotion, "")
    
    # Gather all intel items belonging to this stakeholder for private context (correct_intent + correct_description)
    all_intel_items = list(state.get("intel_items", []) or GENERAL_INTEL_ITEMS)
    st_intel_items = [item for item in all_intel_items if item.stakeholder_id == st.id]
    private_intel_lines = []
    for item in st_intel_items:
        private_intel_lines.append(f"- [{item.correct_intent.value}]: {item.correct_description}")
    private_intel_context = "\n".join(private_intel_lines) if private_intel_lines else "None"

    last_selected_intel = state.get("last_selected_intel")
    intel_instruction = ""
    if last_selected_intel and st.id == last_selected_intel.stakeholder_id:
        if not last_selected_intel.is_correct_intel():
            intel_instruction = (
                f"[GAME MASTER SPECIAL INSTRUCTION - MISCONCEPTION DETECTED]: The player's latest response expressed a MISCATEGORIZED intel assumption!\n"
                f"The player falsely assumed: '{last_selected_intel.categorized_description}'\n"
                f"Your ACTUAL requirement is: [{last_selected_intel.correct_intent.value}] '{last_selected_intel.correct_description}'\n"
                f"You MUST react negatively! Express frustration or irritation at their false claim, "
                f"explicitly correct their misunderstanding, and EXPLICITLY REVEAL your actual requirement to demand that it is met."
            )
        else:
            intel_instruction = (
                f"[GAME MASTER SPECIAL INSTRUCTION - REQUIREMENT SATISFIED]: The player's dialogue option correctly satisfied your requirement: "
                f"[{last_selected_intel.correct_intent.value}] '{last_selected_intel.correct_description}'.\n"
                f"Acknowledge their understanding positively, express satisfaction/relief, and confirm that your requirement has been addressed!"
            )
    else:
        intel_instruction = (
            f"[GAME MASTER SPECIAL INSTRUCTION - SECRECY RULE ACTIVE]:\n"
            f"Your private underlying requirements and preferences are:\n{private_intel_context}\n"
            f"DO NOT directly state, list, or blurt out what your specific requirements/solutions are yet! "
            f"Voice your general concerns, emotional anxieties, or technical skepticism regarding the situation, but keep your specific requirements hidden "
            f"until the Project Manager plays a dialogue option that satisfies them or addresses a misconception."
        )

    conversation_chain = get_stakeholder_response_chain()
    input_messages = state["messages"]
    
    _split = state["challenge"].split("#")
    challenge_text = ""
    for i in range(len(_split)):
        challenge_text += _split[i]

    # Combine static requirements with dynamic private_intel_context
    combined_requirements = f"{st.requirements}\n\nPrivate Intel Requirements:\n{private_intel_context}"

    response = await conversation_chain.ainvoke(
        {
            "messages": input_messages,
            "summary": summary,
            "challenge": challenge_text,
            "stakeholder_name": st.name,
            "stakeholder_responsibilities": st.responsibilities,
            "stakeholder_priorities": st.priorities,
            "stakeholder_requirements": combined_requirements,
            "current_emotion": current_emotion,
            "emotion_instruction": emotion_instruction,
            "intel_instruction": intel_instruction,
        },
        config,
    )

    named_response = AIMessage(
        content=f"[{st.id}] {response.content}",
        additional_kwargs={
            **response.additional_kwargs,
            "emotion_values": st_emotion_values.model_dump(),
            "emotion_delta": st_emotion_delta.model_dump(),
        },
        response_metadata=response.response_metadata,
        id=response.id,
        name="Stakeholder",
        tool_calls=response.tool_calls,
    )
    if named_response.tool_calls:
        return {"messages": named_response}
    # Remove the last stakeholder_id after processing
    new_stakeholder_ids = state["stakeholder_ids"][:-1]
    return {"messages": named_response, "stakeholder_ids": new_stakeholder_ids}


async def custom_router_node(state: PitchDebateState, config: RunnableConfig):
    last_selected_option = state.get("last_selected_option")
    last_selected_intel = state.get("last_selected_intel")
    messages = state.get("messages", [])

    convincer_profiles = state.get("stakeholder_convincer_profile") or STAKEHOLDER_CONVINCER_PROFILES
    all_stakeholders = list(convincer_profiles.keys()) if convincer_profiles else ["willis_slif_business_manager", "mathis_berger_operational_engineer"]

    # Rule 1: At the beginning of the discussion (no dialogue option chosen yet), route to everyone
    if not last_selected_option and len(messages) <= 1:
        return {"stakeholder_ids": all_stakeholders}

    # Rule 2: When an intel item-based dialogue option is chosen, route ONLY to the target stakeholder
    if last_selected_intel:
        target_id = last_selected_intel.stakeholder_id
        return {"stakeholder_ids": [target_id]}

    # Rule 3: Corporate noise should be routed to 1) the stakeholder that wrote the last message and 2) a random different stakeholder
    last_speaker_id = None
    for msg in reversed(messages):
        # Skip the current human message and find the most recent stakeholder message
        if isinstance(msg, AIMessage) or getattr(msg, "type", "") == "ai":
            content_str = getattr(msg, "content", str(msg))
            match = re.match(r"^\[(.*?)\]", content_str)
            if match:
                last_speaker_id = match.group(1).strip()
                break

    if not last_speaker_id and len(messages) >= 2:
        prev_msg = messages[-2]
        content_str = getattr(prev_msg, "content", str(prev_msg))
        match = re.match(r"^\[(.*?)\]", content_str)
        if match:
            last_speaker_id = match.group(1).strip()

    if not last_speaker_id:
        last_speaker_id = all_stakeholders[0] if all_stakeholders else "willis_slif_business_manager"

    other_stakeholders = [st_id for st_id in all_stakeholders if st_id != last_speaker_id]
    if other_stakeholders:
        random_other_id = random.choice(other_stakeholders)
        # Processed in LIFO stack order in graph: [random_other_id, last_speaker_id]
        # pops last_speaker_id first (1), then random_other_id second (2)
        routed_stakeholders = [random_other_id, last_speaker_id]
    else:
        routed_stakeholders = [last_speaker_id]

    return {"stakeholder_ids": routed_stakeholders}


def has_more_stakeholders(state: PitchDebateState):
    if len(state.get("stakeholder_ids", [])) > 0:
        return "emotion_node"
    return "dialogue_option_node"


def create_workflow_graph():
    graph_builder = StateGraph(PitchDebateState)

    # Add all nodes
    graph_builder.add_node("router", custom_router_node)
    graph_builder.add_node("emotion_node", emotion_node)
    graph_builder.add_node("conversation_node", conversation_node)
    graph_builder.add_node("dialogue_option_node", dialogue_option_node)

    # Define the flow
    graph_builder.add_edge(START, "router")
    
    # After router, go to emotion_node before conversation_node
    graph_builder.add_edge("router", "emotion_node")
    graph_builder.add_edge("emotion_node", "conversation_node")
    
    graph_builder.add_conditional_edges(
        "conversation_node",
        has_more_stakeholders,
        {
            "emotion_node": "emotion_node",
            "dialogue_option_node": "dialogue_option_node",
        },
    )
    graph_builder.add_edge("dialogue_option_node", END)
    
    return graph_builder



graph_builder = create_workflow_graph()

async def generate_response_with_memory(
    messages: list,
    challenge: str,
    phase_id: int,
    _thread_id: str,
    selectionmask: list[bool],
    emotion_values: dict[str, EmotionValues] = None,
    intel_items: list[StakeholderIntelItem] = None,
    stakeholder_convincer_profile: dict[str, list[StakeholderIntelItem]] = None,
    last_selected_intel: Optional[StakeholderIntelItem] = None,
    last_selected_option: Optional[DialogueOption] = None,
):
    async with AsyncPostgresSaver.from_conn_string(settings.POSTGRES_CHECKPOINTER_URI) as checkpointer:
        await checkpointer.setup()
        graph = graph_builder.compile(checkpointer=checkpointer)
       
        config = {
            "configurable": {
                "thread_id": _thread_id,
                "selectionmask": selectionmask,
            },
            "callbacks": [],
            "recursion_limit": 150,
        }

        checkpoint = await checkpointer.aget(config)
        
        input_data = {
            "messages": messages,
            "challenge": challenge,
            "phase_id": phase_id,
        }
        
        if not checkpoint or not checkpoint.get("channel_values", {}).get("emotion_values"):
            if emotion_values:
                input_data["emotion_values"] = emotion_values
        
        if intel_items is not None:
            input_data["intel_items"] = intel_items
        if stakeholder_convincer_profile is not None:
            input_data["stakeholder_convincer_profile"] = stakeholder_convincer_profile
        
        # Always set last_selected_intel and last_selected_option so previous turn selections are cleared when corporate noise is played
        input_data["last_selected_intel"] = last_selected_intel
        input_data["last_selected_option"] = last_selected_option

        output_state = await graph.ainvoke(
            input=input_data,
            config=config,
        )
        return output_state

async def reset_thread(thread_id: str):
    async_engine = create_async_engine(settings.POSTGRES_ASYNC_URI)
    async with async_engine.begin() as conn:
        await conn.execute(text("DELETE FROM checkpoints WHERE thread_id = :thread_id"), {"thread_id": thread_id})
        await conn.execute(text("DELETE FROM checkpoint_writes WHERE thread_id = :thread_id"), {"thread_id": thread_id})
        await conn.execute(text("DELETE FROM checkpoint_blobs WHERE thread_id = :thread_id"), {"thread_id": thread_id})
    await async_engine.dispose()


BLACK = '\033[30m'
RED = '\033[31m'
GREEN = '\033[32m'
YELLOW = '\033[33m' 
BLUE = '\033[34m'
MAGENTA = '\033[35m'
CYAN = '\033[36m'
LIGHT_GRAY = '\033[37m'
DARK_GRAY = '\033[90m'
BRIGHT_RED = '\033[91m'
BRIGHT_GREEN = '\033[92m'
BRIGHT_YELLOW = '\033[93m'
BRIGHT_BLUE = '\033[94m'
BRIGHT_MAGENTA = '\033[95m'
BRIGHT_CYAN = '\033[96m'
WHITE = '\033[97m'
BRIGHT_WHITE = '\033[97m'


RESET = '\033[0m' 

stakeholder_colors = [
    BRIGHT_CYAN,
    BRIGHT_YELLOW,
    BRIGHT_MAGENTA,
    BRIGHT_GREEN,
    BRIGHT_RED,
    BRIGHT_BLUE,
    CYAN,
    YELLOW,
    MAGENTA,
    GREEN,
]

def print_action_card(action_card):
    authors = ""
    for a in action_card.get("stakeholder_names", []):
        authors += f"{determine_stakeholder_color(a)}{a}{RESET},"

    print(f"""
-------------------
{action_card.get('title', 'Unknown Title')}
by {authors}
{action_card.get('short_description', 'No description')}

Model: {action_card.get('Model', 0)}
Automation: {action_card.get('Automation', 0)}
Reliability: {action_card.get('Reliability', 0)}
Data: {action_card.get('Data', 0)}
Requirements: {action_card.get('Requirements', 0)}
Efficiency: {action_card.get('Efficiency', 0)}
-------------------
          """)

def determine_stakeholder_color(stakeholder: str):
    if not stakeholder:
        return RESET
    from mlops_serious_game.domain.stakeholder_factory import StakeholderFactory
    available_ids = StakeholderFactory.get_available_stakeholders()
    index = 0
    for i in range(len(available_ids)):
        if available_ids[i] == stakeholder:
            index = i
            break

    return stakeholder_colors[index % len(stakeholder_colors)]

async def stakeholder_cme_test():
    action_card_count = 0
    await reset_thread("stakeholder_cme_test")

    thread_id = "CME_Convo_" + str(datetime.datetime.now())

    phase_index = 5
    challenge_index = 0
    curr_challenge = PhaseFactory.get_challenge_by_index(phase_index, challenge_index)
    test_challenge = (
        curr_challenge.name
        + ": "
        + curr_challenge.roundIntroduction
        + curr_challenge.description
    )

    selectionmask = [
        "willis_slif_business_manager",
        "mathis_berger_operational_engineer",
    ]

    initial_emotion_values = {
        "willis_slif_business_manager": EmotionValues(
            trust=0.45,
            interest=0.85,
            stress=0.75,
            confidence=0.35,
            perceived_risk=0.70,
            sense_of_control=0.35,
            fairness=0.50,
        ),
        "mathis_berger_operational_engineer": EmotionValues(
            trust=0.35,
            interest=0.75,
            stress=0.65,
            confidence=0.50,
            perceived_risk=0.65,
            sense_of_control=0.40,
            fairness=0.35,
        ),
    }

    cursor = 0
    print('\n Starting Stakeholder CME Chat Live Test. Write "exit" to stop. \n')

    # Print the Challenge at the beginning
    print(f"\n{BRIGHT_YELLOW}════════════════════════════════════════════════════════════{RESET}")
    print(f"{BRIGHT_YELLOW}📌 CURRENT CHALLENGE: {curr_challenge.name}{RESET}")
    print(f"{LIGHT_GRAY}{test_challenge}{RESET}")
    print(f"{BRIGHT_YELLOW}════════════════════════════════════════════════════════════{RESET}\n")

    print("Initial Stakeholder Emotional States:")
    for st_id, ev in initial_emotion_values.items():
        try:
            st_obj = StakeholderFactory.get_stakeholder(st_id)
            st_name = st_obj.name
        except Exception:
            st_name = st_id
        emo = derive_emotional_state(ev)
        color = determine_stakeholder_color(st_id)
        print(f"  • {color}{st_name}{RESET}: Initial Emotion -> {BRIGHT_MAGENTA}{emo}{RESET}")
    print()

    # Automatically start the meeting with welcome message
    current_intel_items = list(GENERAL_INTEL_ITEMS)
    current_convincer_profiles = {
        st_id: list(items) for st_id, items in STAKEHOLDER_CONVINCER_PROFILES.items()
    }
    initial_msg = "Welcome to the meeting everybody"
    print(f"{BRIGHT_GREEN}[User]{RESET} {initial_msg}\n")

    output_state = await generate_response_with_memory(
        messages=[HumanMessage(content=initial_msg)],
        challenge=test_challenge,
        phase_id=phase_index,
        _thread_id=thread_id,
        selectionmask=selectionmask,
        emotion_values=initial_emotion_values,
        intel_items=current_intel_items,
        stakeholder_convincer_profile=current_convincer_profiles,
    )

    def print_stakeholder_emotion_box(name, color, ev_dict, delta_dict, current_emotion):
        dimensions = [
            ("Trust", "trust", "trust_delta"),
            ("Interest", "interest", "interest_delta"),
            ("Stress", "stress", "stress_delta"),
            ("Confidence", "confidence", "confidence_delta"),
            ("Perceived Risk", "perceived_risk", "perceived_risk_delta"),
            ("Sense Of Control", "sense_of_control", "sense_of_control_delta"),
            ("Fairness", "fairness", "fairness_delta"),
        ]

        parts = []
        for label, dim, delta_key in dimensions:
            val = ev_dict.get(dim, 0.5) if ev_dict else 0.5
            d_val = delta_dict.get(delta_key, 0.0) if delta_dict else 0.0
            d_str = f"+{d_val:.2f}" if d_val > 0 else f"{d_val:.2f}"
            d_color = BRIGHT_GREEN if d_val > 0 else (BRIGHT_RED if d_val < 0 else DARK_GRAY)
            part = f"{LIGHT_GRAY}{label}:{RESET} {val:.2f} ({d_color}{d_str}{RESET})"
            parts.append(part)

        dims_line = f"  {DARK_GRAY}│{RESET} ".join(parts)
        sep_line = f"{DARK_GRAY}" + ("─" * 125) + f"{RESET}"

        print(sep_line)
        print(f"{BRIGHT_CYAN}📊 Emotion State & Changes for {color}{name}{RESET} {DARK_GRAY}──>{RESET} {LIGHT_GRAY}Resulting Emotion:{RESET} {BRIGHT_MAGENTA}{current_emotion}{RESET}")
        print(f"  {dims_line}")
        print(sep_line)

    def print_new_responses(state, curr_cursor):
        nonlocal action_card_count
        all_messages = state.get("messages", [])
        if len(all_messages) < curr_cursor:
            curr_cursor = 0
        new_responses = all_messages[curr_cursor:]
        curr_cursor = len(all_messages)

        for m in new_responses:
            m_type = type(m).__name__
            tool_calls = getattr(m, "tool_calls", None)

            if tool_calls:
                print(f"\n{YELLOW}[TOOL CALL] {m_type} requested tool: {[tc['name'] for tc in tool_calls]} with args: {[tc['args'] for tc in tool_calls]}{RESET}\n")

            if m_type == 'ToolMessage':
                m_content = getattr(m, "content", "")
                m_content_safe = m_content.encode('ascii', errors='replace').decode('ascii')
                print(f"\n{GREEN}[TOOL RESPONSE] Tool '{getattr(m, 'name', 'unknown')}' output: {m_content_safe}{RESET}\n")
                continue

            if m_type == 'HumanMessage':
                m_content = getattr(m, "content", "")
                m_content_safe = m_content.encode('ascii', errors='replace').decode('ascii')
                print(f"\n{BRIGHT_GREEN}[User]{RESET} {m_content_safe}\n")
                continue

            m_content = m.get("content", "") if isinstance(m, dict) else getattr(m, "content", "")
            m_content_safe = m_content.encode('ascii', errors='replace').decode('ascii')

            match = re.match(r"^\[(.*?)\]\s*(.*)$", m_content_safe, re.DOTALL)
            if match:
                st_id_parsed, message = match.groups()
                st_id_parsed = st_id_parsed.strip()
                try:
                    st_obj = StakeholderFactory.get_stakeholder(st_id_parsed)
                    name = st_obj.name
                except Exception:
                    name = st_id_parsed

                add_kwargs = getattr(m, "additional_kwargs", {}) or {}
                ev_dict = add_kwargs.get("emotion_values")
                delta_dict = add_kwargs.get("emotion_delta")

                if ev_dict and delta_dict:
                    st_ev = EmotionValues(**ev_dict)
                    current_emotion = derive_emotional_state(st_ev)
                    color = determine_stakeholder_color(st_id_parsed)
                    print_stakeholder_emotion_box(name, color, ev_dict, delta_dict, current_emotion)
                    print(f"{color}{name} ([{current_emotion}]){RESET} {message}\n")
                else:
                    emotion_values_map = state.get("emotion_values", {})
                    st_emotion_values = emotion_values_map.get(st_id_parsed, EmotionValues())
                    current_emotion = derive_emotional_state(st_emotion_values)
                    color = determine_stakeholder_color(st_id_parsed)
                    print_stakeholder_emotion_box(name, color, st_emotion_values.model_dump(), {}, current_emotion)
                    print(f"{color}{name} ([{current_emotion}]){RESET} {message}\n")

            elif m_content_safe.strip():
                print(f"\n{m_content_safe}\n")

        if "action_cards" in state:
            if len(state["action_cards"]) != action_card_count:
                for i in range(action_card_count, len(state["action_cards"])):
                    print_action_card(state["action_cards"][i])
                    action_card_count += 1

        return curr_cursor

    cursor = print_new_responses(output_state, cursor)

    while True:
        dialogue_options = output_state.get("dialogue_options", [])
        if not dialogue_options:
            print(f"{RED}No dialogue options available.{RESET}")
            break

        lines_printed = print_formatted_dialogue_options(dialogue_options)

        prompt_str = f'Enter option number (1-{len(dialogue_options)}) or "exit":\n'
        raw_input = input(f'{BRIGHT_YELLOW}{prompt_str}{RESET}').strip()
        input_lines = 2
        total_lines_to_erase = lines_printed + input_lines

        if raw_input.lower() == "exit":
            break

        if not raw_input.isdigit() or not (1 <= int(raw_input) <= len(dialogue_options)):
            for _ in range(total_lines_to_erase):
                sys.stdout.write("\033[A\033[2K")
            sys.stdout.flush()
            print(f"{RED}Invalid selection '{raw_input}'. Please enter a number between 1 and {len(dialogue_options)}.{RESET}\n")
            continue

        selected_opt = dialogue_options[int(raw_input) - 1]

        # Erase entire dialogue options menu and prompt from screen
        for _ in range(total_lines_to_erase):
            sys.stdout.write("\033[A\033[2K")
        sys.stdout.flush()

        # If an intel item option was selected, find and remove it from the intel_items list
        matched_intel = None
        if selected_opt.intel_item_id:
            for item in current_intel_items:
                if str(getattr(item, "id", None)) == str(selected_opt.intel_item_id):
                    matched_intel = item
                    break
            if not matched_intel:
                for item in current_intel_items:
                    if getattr(item, "categorized_description", "") in selected_opt.text:
                        matched_intel = item
                        break

        if matched_intel:
            current_intel_items = [
                item for item in current_intel_items
                if item.categorized_description != matched_intel.categorized_description
            ]
            print(f"{YELLOW}[INTEL USED] Used intel item for {matched_intel.stakeholder_id}. Remaining intel items: {len(current_intel_items)}{RESET}")
            last_selected_intel = matched_intel

            st_id = matched_intel.stakeholder_id
            try:
                st_obj = StakeholderFactory.get_stakeholder(st_id)
                st_name = st_obj.name
            except Exception:
                st_name = st_id

            if matched_intel.is_correct_intel() and st_id in current_convincer_profiles:
                reqs = current_convincer_profiles[st_id]
                matching = [
                    r for r in reqs
                    if r.categorized_description == matched_intel.categorized_description
                    or r.correct_description == matched_intel.correct_description
                ]
                if matching:
                    matched_item = matching[0]
                    current_convincer_profiles[st_id] = [
                        r for r in reqs
                        if r.categorized_description != matched_intel.categorized_description
                        and r.correct_description != matched_intel.correct_description
                    ]
                    rem_reqs = len(current_convincer_profiles[st_id])
                    print(f"{BRIGHT_CYAN}🎯 [CONVINCER REQUIREMENT MATCHED] Played intel matches {st_name}'s convincer profile!{RESET}")
                    print(f"   {LIGHT_GRAY}Requirement satisfied:{RESET} \"{matched_item.correct_description}\"")
                    if rem_reqs == 0:
                        print(f"{BRIGHT_GREEN}🎉 [STAKEHOLDER FULLY CONVINCED] All convincer profile requirements for {st_name} have been satisfied!{RESET}\n")
                    else:
                        print(f"{DARK_GRAY}   Remaining convincer requirements for {st_name}: {rem_reqs}{RESET}\n")
        else:
            last_selected_intel = None

        print(f"\n{BRIGHT_GREEN}[User]{RESET} {selected_opt.text}\n")

        new_messages = [HumanMessage(content=selected_opt.text)]
        output_state = await generate_response_with_memory(
            messages=new_messages,
            challenge=test_challenge,
            phase_id=phase_index,
            _thread_id=thread_id,
            selectionmask=selectionmask,
            emotion_values=initial_emotion_values,
            intel_items=current_intel_items,
            stakeholder_convincer_profile=current_convincer_profiles,
            last_selected_intel=last_selected_intel,
            last_selected_option=selected_opt,
        )

        cursor = print_new_responses(output_state, cursor)

        # If a miscategorized (wrong) intel item was played, reveal and add the correct intel item!
        if matched_intel and not matched_intel.is_correct_intel():
            corrected_intel = StakeholderIntelItem(
                stakeholder_id=matched_intel.stakeholder_id,
                categorized_layer=matched_intel.correct_layer,
                categorized_intent=matched_intel.correct_intent,
                correct_layer=matched_intel.correct_layer,
                correct_intent=matched_intel.correct_intent,
                correct_description=matched_intel.correct_description,
                categorized_description=matched_intel.correct_description,
            )

            if not any(item.categorized_description == corrected_intel.categorized_description for item in current_intel_items):
                current_intel_items.append(corrected_intel)

            try:
                st_obj = StakeholderFactory.get_stakeholder(matched_intel.stakeholder_id)
                st_name = st_obj.name
            except Exception:
                st_name = matched_intel.stakeholder_id

            print(f"{BRIGHT_YELLOW}💡 [NEW INTEL DISCOVERED] After refuting your false assumption, {st_name} revealed their actual priority:{RESET}")
            print(f"   {BRIGHT_WHITE}\"{corrected_intel.correct_description}\"{RESET}\n")


def print_formatted_dialogue_options(dialogue_options: list[DialogueOption]) -> int:
    lines_count = 0
    header = f"\n{BRIGHT_CYAN}💬 Select a dialogue option to respond:{RESET}\n"
    sys.stdout.write(header)
    lines_count += 2

    for idx, opt in enumerate(dialogue_options, 1):
        if opt.intel_item_id:
            tag = f"{DARK_GRAY}(Intel ID: {opt.intel_item_id}){RESET}"
        elif opt.archetype:
            tag = f"{DARK_GRAY}(Corporate Noise - {opt.archetype.name}){RESET}"
        else:
            tag = f"{DARK_GRAY}(Corporate Noise){RESET}"

        prefix = f"  [{idx}] "
        subsequent = "      "
        wrapped = textwrap.wrap(opt.text, width=95, initial_indent=prefix, subsequent_indent=subsequent)
        for w_line in wrapped:
            print(f"{WHITE}{w_line}{RESET}")
            lines_count += 1
        print(f"{subsequent}🏷️  {tag}")
        lines_count += 1
        print()
        lines_count += 1

    sys.stdout.flush()
    return lines_count


if __name__ == "__main__":
    action_card_count = 0
    asyncio.run(stakeholder_cme_test())