from philoagents.domain.phase_factory import PhaseFactory
from typing import Annotated, Literal

from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from langchain_openai import ChatOpenAI
from langchain_groq import ChatGroq
from langchain_core.messages import HumanMessage, merge_message_runs

from philoagents.application.conversation_service.workflow.tools import tools
from philoagents.config import settings
from philoagents.domain.metric_factory import MetricFactory

from philoagents.domain.prompts import (
    CONTEXT_SUMMARY_PROMPT,
    EXTEND_SUMMARY_PROMPT,
    STAKEHOLDER_CHARACTER_CARD,
    ROGUE_STAKEHOLDER_CHARACTER_CARD,
    SUMMARY_PROMPT,
    STAKEHOLDER_DETERMINATION_PROMPT,
    CARD_GENERATOR_PROMPT,
    CHECK_CARD_GENERATION_PROMPT,
    ANTICHEAT_PROMPT
)
from philoagents.domain.stakeholder_factory import StakeholderFactory
from pydantic import BaseModel, Field, field_validator,create_model

use_rwth_key=True

def get_chat_model(temperature: float = 0.7, model_name: str = settings.RWTH_LLM_MODEL) -> ChatOpenAI | ChatGroq:
    
    if use_rwth_key:
        return ChatOpenAI(
            api_key=settings.RWTH_API_KEY,
            base_url=settings.RWTH_API_BASE,
            model_name=model_name,
            temperature=temperature,
        )
    else:
        return ChatGroq(
            api_key=settings.GROQ_API_KEY,
            model_name=settings.GROQ_LLM_MODEL,
            temperature=temperature,
    )

def get_routing_model(model_name: str = settings.RWTH_LLM_MODEL_ROUTER) -> ChatOpenAI | ChatGroq:
    
    if use_rwth_key:
        return ChatOpenAI(
            api_key=settings.RWTH_API_KEY,
            base_url=settings.RWTH_API_BASE,
            model_name=model_name,
            temperature=0,
            top_p=0.01
        )
    else:
        return ChatGroq(
            api_key=settings.GROQ_API_KEY,
            model_name=settings.GROQ_LLM_MODEL_ROUTER,
            temperature=0,
            top_p=0.01
    )

def get_card_check_model(model_name: str = settings.RWTH_LLM_MODEL_ROUTER)-> ChatOpenAI | ChatGroq:
    if use_rwth_key:
        return ChatOpenAI(
            api_key=settings.RWTH_API_KEY,
            base_url=settings.RWTH_API_BASE,
            model_name=model_name,
            temperature=0,
            top_p=0.01
        )
    else:
        return ChatGroq(
            api_key=settings.GROQ_API_KEY,
            model_name=settings.GROQ_LLM_MODEL_CARD_GEN,
            temperature=0,
            top_p=0.01
    )

def get_card_gen_model( model_name: str = settings.RWTH_LLM_MODEL_CARD_GEN) -> ChatOpenAI | ChatGroq:
    if use_rwth_key:
        return ChatOpenAI(
            api_key=settings.RWTH_API_KEY,
            base_url=settings.RWTH_API_BASE,
            model_name=model_name,
            temperature=0,
        )
    else:
        return ChatGroq(
            api_key=settings.GROQ_API_KEY,
            model_name=settings.GROQ_LLM_MODEL_CARD_GEN,
            temperature=0,
    )

def get_anticheat_model(model_name: str = settings.RWTH_LLM_MODEL_ROUTER)-> ChatOpenAI | ChatGroq:
    if use_rwth_key:
        return ChatOpenAI(
            api_key=settings.RWTH_API_KEY,
            base_url=settings.RWTH_API_BASE,
            model_name=model_name,
            temperature=0,
            top_p=0.01
        )
    else:
        return ChatGroq(
            api_key=settings.GROQ_API_KEY,
            model_name=settings.GROQ_LLM_MODEL_CARD_GEN,
            temperature=0,
            top_p=0.01
    )
def get_stakeholder_response_chain():
    model = get_chat_model()
    model = model.bind_tools(tools)
    system_message = STAKEHOLDER_CHARACTER_CARD

    prompt = ChatPromptTemplate.from_messages(
        [
            ("system", system_message.prompt),
            MessagesPlaceholder(variable_name="messages"),
            ("human", "[GAME MASTER] Stakeholder {{stakeholder_name}}, please provide your response or use tools if necessary."),
        ],
        template_format="jinja2",
    )

    return prompt | model

def get_rogue_stakeholder_response_chain():
    model = get_chat_model()
    model = model.bind_tools(tools)
    system_message = ROGUE_STAKEHOLDER_CHARACTER_CARD

    prompt = ChatPromptTemplate.from_messages(
    [
        ("system", system_message.prompt),
        MessagesPlaceholder(variable_name="messages"),
        ("human", "[GAME MASTER] Stakeholder {{stakeholder_name}}, please provide your response or use tools if necessary."),
    ],
    template_format="jinja2",
    )

    return prompt | model


def get_conversation_summary_chain(summary: str = ""):
    model = get_chat_model(model_name=settings.RWTH_LLM_MODEL_SUMMARY)

    summary_message = EXTEND_SUMMARY_PROMPT if summary else SUMMARY_PROMPT

    prompt = ChatPromptTemplate.from_messages(
        [
            MessagesPlaceholder(variable_name="messages"),
            ("human", summary_message.prompt),
        ],
        template_format="jinja2",
    )

    return prompt | model


def get_context_summary_chain():
    model = get_chat_model(model_name=settings.RWTH_LLM_MODEL_CONTEXT_SUMMARY)
    prompt = ChatPromptTemplate.from_messages(
        [
            ("human", CONTEXT_SUMMARY_PROMPT.prompt),
        ],
        template_format="jinja2",
    )

    return prompt | model

# Dynamically generate routing options from available stakeholders
def _get_routing_options(phase_id: int | None, selectionmask: list[str]|None):
    stakeholders = []
    if phase_id is None or selectionmask is None:
        for st_id in StakeholderFactory.get_available_stakeholders():
            st = StakeholderFactory.get_stakeholder(st_id)
            stakeholders.append(f"{st.division} ({st.name})")
    else:
        for st_id in StakeholderFactory.get_active_stakeholders(phase_id,selectionmask):
            st = StakeholderFactory.get_stakeholder(st_id)
            stakeholders.append(f"{st.division} ({st.name})")
    
    return tuple(stakeholders)

#find stakeholders for card generation from available stakeholders
def _get_action_card_stakeholders(phase_id: int | None, selectionmask: list[str]|None):
    stakeholders = []
    if phase_id is None or selectionmask is None:  
        for st_id in StakeholderFactory.get_available_stakeholders():
            st = StakeholderFactory.get_stakeholder(st_id)
            stakeholders.append(f"{st.name}")
    else: 
        for st_id in StakeholderFactory.get_active_stakeholders(phase_id,selectionmask):
            st = StakeholderFactory.get_stakeholder(st_id)
            stakeholders.append(f"{st.name}")
    return tuple(stakeholders)

# Dynamically build router schema from available stakeholders
def build_stakeholder_router_schema(phase_id: int | None, selectionmask: list[str]|None):
    
    routing_options = _get_routing_options(phase_id,selectionmask)
    if not routing_options:
        raise ValueError("No stakeholders available for routing.")
    StakeholderLiteral = Literal[routing_options]

    RouterSchema = create_model(
        "StakeholderRouterOutput",
        stakeholders=(
            list[StakeholderLiteral],
            Field(
                ...,
                description="The stakeholders that should respond to the query."
            ),
        ),
    )
    return RouterSchema

def get_router_chain(phase_id: int | None , selectionmask: list[str]|None):
    
    if use_rwth_key:
        model = get_routing_model().with_structured_output(build_stakeholder_router_schema(phase_id,selectionmask))
    else:
        model = get_routing_model().with_structured_output(build_stakeholder_router_schema(phase_id,selectionmask), method="json_schema", strict=True)
    
    prompt = ChatPromptTemplate.from_messages(
        [
            ("system", STAKEHOLDER_DETERMINATION_PROMPT.prompt),
            MessagesPlaceholder(variable_name="messages"),
            ("human", "[GAME MASTER] Based on the conversation, determine the next stakeholders to route to.")
        ],
        template_format="jinja2",
    )

    return prompt | model

class CardCheckResult(BaseModel):
    status: Literal[
        "accept",
        "reject",
    ] = Field(
        ..., description="can an action proposal be derived from the stakeholder chat"
    )

def get_card_gen_checker_chain():
    if use_rwth_key:
        model = get_card_check_model().with_structured_output(CardCheckResult)
    else:
        model = get_card_check_model().with_structured_output(CardCheckResult, method="json_schema", strict=True)

    prompt = ChatPromptTemplate.from_messages(
        [
            ("system", CHECK_CARD_GENERATION_PROMPT.prompt),
            MessagesPlaceholder(variable_name="messages"),
            ("human", "[GAME MASTER] Evaluate the conversation. Should we generate an action card? Return status 'accept' or 'reject'.")
        ],
        template_format="jinja2",
    )
    
    return prompt | model

def build_action_card_schema(phase_id: int| None, selectionmask: list[str]|None):
    
    routing_options = _get_action_card_stakeholders(phase_id,selectionmask)
    StakeholderLiteral = Literal[routing_options]
    ActionCardImage = Literal[tuple(PhaseFactory.action_card_images)]

    value_changes={}
    for m_id, m in enumerate(MetricFactory.get_available_metrics()):

        metric_obj = MetricFactory.get_metric(m)
        if metric_obj.phases[phase_id]:
            value_changes[m] = (int, Field(..., description=metric_obj.metric_prompt, ge=-5, le=5))
        else:
            value_changes[m] = (Literal[0], Field(...))

    
    ActionCard = create_model(
        "ActionCard",
        title = (
            str,
            Field(
        ..., description="title of the action card"
        )),
        short_description = (
            str,
            Field(..., description="one sentence description of the proposed action"
        )),
        ac_image= (ActionCardImage, Field(..., description="the image object selected from the available images list")),
        **value_changes,
        stakeholder_names=(
            list[StakeholderLiteral],
            Field(
                ...,
                description="the stakeholders that participate in the action proposal."
            ),
        ),
    )
    return ActionCard


def get_card_gen_chain(phase_id: int | None, selectionmask: list[str]|None):
    if use_rwth_key:
        model = get_card_gen_model().with_structured_output(build_action_card_schema(phase_id,selectionmask))
    else:
        model = get_card_gen_model().with_structured_output(build_action_card_schema(phase_id,selectionmask), method="json_schema", strict=True)
    
    prompt = ChatPromptTemplate.from_messages(
    [
        ("system", CARD_GENERATOR_PROMPT.prompt),
        ("human", "[GAME MASTER] Generate an action card matching the exact required format.")
    ],template_format="jinja2",)
    
    return prompt | model

class AnticheatResult(BaseModel):
    status: Literal[
        "accept",
        "reject",
    ] = Field(
        ..., description="does the user's input fit into the serious game context"
    )

def get_anticheat_chain():
    model = get_anticheat_model().with_structured_output(AnticheatResult)
    prompt = ChatPromptTemplate.from_messages(
    [
        ("system", ANTICHEAT_PROMPT.prompt),
        MessagesPlaceholder(variable_name="messages"),
        ("human", "[GAME MASTER] Check if the user's input fits into the serious game context. Return status 'accept' or 'reject'.")
    ],template_format="jinja2",)
    
    return prompt | model