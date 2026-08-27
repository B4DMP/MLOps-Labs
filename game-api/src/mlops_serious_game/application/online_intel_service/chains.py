from langchain_core.prompts import PromptTemplate
from langchain_core.output_parsers import StrOutputParser
from langchain_openai import ChatOpenAI
from langchain_groq import ChatGroq

from mlops_serious_game.config import settings
from mlops_serious_game.domain.prompts import (
    ONLINE_INTEL_PLAYER_PROMPT,
    ONLINE_INTEL_STAKEHOLDER_PROMPT,
)

use_rwth_key = True


def get_llm(temperature: float = 0.7, model_name: str = settings.RWTH_LLM_MODEL) -> ChatOpenAI | ChatGroq:
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


def get_player_engagement_chain():
    """Returns a chain to generate the player's message initiating the engagement card."""
    prompt = PromptTemplate.from_template(
        template=ONLINE_INTEL_PLAYER_PROMPT.prompt,
        template_format="jinja2",
    )
    llm = get_llm(temperature=0.7)
    return prompt | llm | StrOutputParser()


def get_stakeholder_engagement_chain():
    """Returns a chain to generate a stakeholder's response to the engagement message."""
    prompt = PromptTemplate.from_template(
        template=ONLINE_INTEL_STAKEHOLDER_PROMPT.prompt,
        template_format="jinja2",
    )
    llm = get_llm(temperature=0.7)
    return prompt | llm | StrOutputParser()
