from langchain_core.output_parsers import StrOutputParser
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from langchain_groq import ChatGroq
from langchain_openai import ChatOpenAI

from mlops_serious_game.application.pitch_debate_service.tools import tools
from mlops_serious_game.config import settings
from mlops_serious_game.domain.prompts import (
    INTEL_ARTIFACT_PROMPT,
    STAKEHOLDER_CHARACTER_CARD,
    WRONG_INTEL_PROMPT,
)

use_rwth_key = True


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


def get_stakeholder_response_chain():
    model = get_chat_model()
    model = model.bind_tools(tools)

    prompt = ChatPromptTemplate.from_messages(
        [
            ("system", STAKEHOLDER_CHARACTER_CARD.prompt),
            MessagesPlaceholder(variable_name="messages"),
        ],
        template_format="jinja2",
    )

    return prompt | model


def get_wrong_intel_chain():
    model = get_chat_model(temperature=0.8)
    prompt = ChatPromptTemplate.from_messages(
        [
            ("system", WRONG_INTEL_PROMPT.prompt),
            (
                "human",
                "Original Requirement: {{original_requirement}}\n"
                "Target Category: {{target_category}}\n"
                "Target Layer: {{target_layer}}\n"
                "Stakeholder: {{stakeholder_name}}\n"
                "Stakeholder Profile: {{stakeholder_profile}}\n"
                "Challenge Context: {{challenge_context}}",
            ),
        ],
        template_format="jinja2",
    )
    return prompt | model | StrOutputParser()


def get_intel_artifact_chain():
    model = get_chat_model(temperature=0.7)
    prompt = ChatPromptTemplate.from_messages(
        [
            ("system", INTEL_ARTIFACT_PROMPT.prompt),
            (
                "human",
                "Artifact Type: {{artifact_type}}\n"
                "Stakeholder: {{stakeholder_name}}\n"
                "Stakeholder Profile: {{stakeholder_profile}}\n"
                "Intel Statement / Requirement: {{intel_statement}}\n"
                "Confidence / Evidence Level: {{evidence_level}}\n"
                "Challenge Context: {{challenge_context}}",
            ),
        ],
        template_format="jinja2",
    )
    return prompt | model | StrOutputParser()