import sys
import os
import warnings
warnings.filterwarnings("ignore", category=UserWarning, module="pydantic")

sys.path.append(os.path.join(os.path.dirname(__file__), "src"))

from philoagents.application.conversation_service.workflow.nodes import router_node


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
from philoagents.config import settings
from langchain_core.messages import RemoveMessage
from philoagents.application.conversation_service.workflow.tools import tools
from philoagents.domain.exceptions import RoutingStakeholderNotFound,NoStakeholderRoute
from philoagents.domain.stakeholder_factory import StakeholderFactory
from philoagents.domain.stakeholder import Stakeholder
from philoagents.domain.metric_factory import MetricFactory
from philoagents.domain.phase_factory import PhaseFactory
from philoagents.domain.metric import Metric
from philoagents.domain.prompts import __STAKEHOLDER_CHARACTER_CARD, Prompt
from philoagents.application.conversation_service.workflow.chains import get_chat_model
from philoagents.application.conversation_service.workflow.graph import create_workflow_graph
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from langgraph.graph import END, START, StateGraph,MessagesState
from enum import Enum
from pydantic import BaseModel, Field

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



class ChallengeState(MessagesState):
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
    emotion_deltas: dict[str, EmotionDelta]


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
                return f"{st_obj.name} ({st_obj.division}): {text}"
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
                "Target Stakeholder: {{stakeholder_name}} ({{stakeholder_division}})\n"
                "Responsibilities: {{stakeholder_responsibilities}}\n"
                "Priorities: {{stakeholder_priorities}}\n"
                "Challenge Context: {{challenge}}\n\n"
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


async def emotion_node(state: ChallengeState, config: RunnableConfig):
    messages = state.get("messages", [])
    if not messages:
        return {}

    stakeholder_ids = state.get("stakeholder_ids", [])
    stakeholder_id = stakeholder_ids[-1] if stakeholder_ids else "willis_slif_business_manager"
    st = StakeholderFactory.get_stakeholder(stakeholder_id)

    # Find the index of the last message produced by this specific stakeholder
    last_st_index = -1
    for i, m in enumerate(messages):
        m_content = getattr(m, "content", "")
        if isinstance(m_content, str) and m_content.startswith(f"[{st.id}]"):
            last_st_index = i

    # Messages up to last_st_index serve as prior history context
    history_msgs = messages[: last_st_index + 1] if last_st_index != -1 else []
    # Messages after last_st_index are the new messages to evaluate
    new_msgs = messages[last_st_index + 1 :] if last_st_index != -1 else messages

    if not new_msgs:
        return {}

    history_str = "\n".join([format_message_for_eval(m) for m in history_msgs]) if history_msgs else "(No prior conversation history)"
    new_msgs_str = "\n".join([format_message_for_eval(m) for m in new_msgs])

    _split = state["challenge"].split("#")
    challenge_text = "".join(_split)

    chain = get_emotion_evaluator_chain()
    delta: EmotionDelta = await chain.ainvoke(
        {
            "history": history_str,
            "new_messages": new_msgs_str,
            "stakeholder_name": st.name,
            "stakeholder_division": st.division,
            "stakeholder_responsibilities": st.responsibilities,
            "stakeholder_priorities": st.priorities,
            "challenge": challenge_text,
        },
        config,
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
    return {"emotion_values": emotion_values_map, "emotion_deltas": emotion_deltas_map}


def get_stakeholder_response_chain():
    model = get_chat_model()
    model = model.bind_tools(tools)
    system_message = STAKEHOLDER_CHARACTER_CARD

    prompt = ChatPromptTemplate.from_messages(
        [
            ("system", system_message.prompt),
            MessagesPlaceholder(variable_name="messages"),
            (
                "human",
                "[GAME MASTER] Stakeholder {{stakeholder_name}} (Current Emotional State: {{current_emotion}}. Guidance: {{emotion_instruction}}). DO NOT USE TOOLS!",
            ),
        ],
        template_format="jinja2",
    )

    return prompt | model

async def conversation_node(state: ChallengeState, config: RunnableConfig):

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
    
    conversation_chain = get_stakeholder_response_chain()
    input_messages = state["messages"]
    
    _split = state["challenge"].split("#")
    challenge_text = ""
    for i in range(len(_split)):
        challenge_text += _split[i]

    response = await conversation_chain.ainvoke(
        {
            "messages": input_messages,
            "summary": summary,
            "challenge": challenge_text,
            "stakeholder_name": st.name,
            "stakeholder_division": st.division,
            "stakeholder_responsibilities": st.responsibilities,
            "stakeholder_priorities": st.priorities,
            "stakeholder_requirements": st.requirements,
            "current_emotion": current_emotion,
            "emotion_instruction": emotion_instruction,
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


def has_more_stakeholders(state: ChallengeState):
    if len(state.get("stakeholder_ids", [])) > 0:
        return "emotion_node"
    return END


def create_workflow_graph():
    graph_builder = StateGraph(ChallengeState)

    # Add all nodes
    graph_builder.add_node("router", router_node)
    graph_builder.add_node("emotion_node", emotion_node)
    graph_builder.add_node("conversation_node", conversation_node)

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
            END: END,
        },
    )
    
    return graph_builder



graph_builder = create_workflow_graph()

async def generate_response_with_memory(
    messages: list,
    challenge: str,
    phase_id: int,
    _thread_id: str,
    selectionmask: list[bool],
    emotion_values: dict[str, EmotionValues] = None,
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
    from philoagents.domain.stakeholder_factory import StakeholderFactory
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

    
    # Selectionmask contains the two stakeholders involved in "Model Accuracy Drops"
    selectionmask = [
        "willis_slif_business_manager",
        "mathis_berger_operational_engineer",
    ]
    
    # Manually set initial emotion values for involved stakeholders to reflect challenge context ("Model Accuracy Drops")
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
    print("Initial Stakeholder Emotional States:")
    for st_id, ev in initial_emotion_values.items():
        try:
            st_obj = StakeholderFactory.get_stakeholder(st_id)
            st_name = st_obj.name
            st_div = st_obj.division
        except Exception:
            st_name = st_id
            st_div = "Stakeholder"
        emo = derive_emotional_state(ev)
        color = determine_stakeholder_color(st_id)
        print(f"  • {color}{st_name}{RESET} ({st_div}): Initial Emotion -> {BRIGHT_MAGENTA}{emo}{RESET}")
    print()

    while True:
        msg = input('Enter message to stakeholder chat:\n')
        if msg.lower() == "exit":
            break
        
        # Erase prompt & user input lines from terminal when message is sent
        lines_to_clear = 1 + max(1, len(msg.splitlines()))
        for _ in range(lines_to_clear):
            sys.stdout.write("\033[A\033[2K")
        sys.stdout.flush()
        
        new_messages = [HumanMessage(content=msg)]
        output_state = await generate_response_with_memory(
            messages=new_messages,
            challenge=test_challenge,
            phase_id=phase_index,
            _thread_id=thread_id,
            selectionmask=selectionmask,
            emotion_values=initial_emotion_values,
        )
        
        all_messages = output_state.get("messages", [])
        if len(all_messages) < cursor:
            cursor = 0
        new_responses = all_messages[cursor:]
        cursor = len(all_messages)
        
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
                    division = st_obj.division
                    name = st_obj.name
                except Exception:
                    name = st_id_parsed
                    division = "Stakeholder"
                
                add_kwargs = getattr(m, "additional_kwargs", {}) or {}
                ev_dict = add_kwargs.get("emotion_values")
                delta_dict = add_kwargs.get("emotion_delta")
                
                if ev_dict and delta_dict:
                    st_ev = EmotionValues(**ev_dict)
                    current_emotion = derive_emotional_state(st_ev)
                    color = determine_stakeholder_color(st_id_parsed)
                    
                    print(f"{DARK_GRAY}────────────────────────────────────────────────────────────{RESET}")
                    print(f"{BRIGHT_CYAN}📊 Emotion State & Changes for {color}{name}{RESET}{BRIGHT_CYAN} ({division}):{RESET}")
                    
                    dimensions = [
                        ("trust", "trust_delta"),
                        ("interest", "interest_delta"),
                        ("stress", "stress_delta"),
                        ("confidence", "confidence_delta"),
                        ("perceived_risk", "perceived_risk_delta"),
                        ("sense_of_control", "sense_of_control_delta"),
                        ("fairness", "fairness_delta"),
                    ]
                    
                    for dim, delta_key in dimensions:
                        val = ev_dict.get(dim, 0.5)
                        d_val = delta_dict.get(delta_key, 0.0)
                        d_str = f"+{d_val:.2f}" if d_val > 0 else f"{d_val:.2f}"
                        d_color = BRIGHT_GREEN if d_val > 0 else (BRIGHT_RED if d_val < 0 else DARK_GRAY)
                        dim_name = dim.replace('_', ' ').title().ljust(18)
                        print(f"  {LIGHT_GRAY}{dim_name}:{RESET} {val:.2f} ({d_color}{d_str}{RESET})")
                        
                    print(f"  {LIGHT_GRAY}Resulting Emotion :{RESET} {BRIGHT_MAGENTA}{current_emotion}{RESET}")
                    print(f"{DARK_GRAY}────────────────────────────────────────────────────────────{RESET}")
                    print(f"{color}{name} ({division} [{current_emotion}]){RESET} {message}\n")
                else:
                    emotion_values_map = output_state.get("emotion_values", {})
                    st_emotion_values = emotion_values_map.get(st_id_parsed, EmotionValues())
                    current_emotion = derive_emotional_state(st_emotion_values)
                    color = determine_stakeholder_color(st_id_parsed)
                    print(f"\n{color}{name} ({division} [{current_emotion}]){RESET} {message}\n")

            elif m_content_safe.strip():
                print(f"\n{m_content_safe}\n")
        
        if "action_cards" in output_state:
            if len(output_state["action_cards"]) != action_card_count:
                for i in range(action_card_count, len(output_state["action_cards"])):
                    print_action_card(output_state["action_cards"][i])
                    action_card_count += 1

if __name__ == "__main__":
    asyncio.run(stakeholder_cme_test())