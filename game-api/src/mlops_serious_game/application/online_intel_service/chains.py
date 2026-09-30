from langchain_core.prompts import PromptTemplate
from langchain_core.output_parsers import StrOutputParser
from mlops_serious_game.application.llm import get_chat_model

from mlops_serious_game.domain.prompts import (
    ONLINE_INTEL_PLAYER_PROMPT,
    ONLINE_INTEL_STAKEHOLDER_PROMPT,
)


def get_player_engagement_chain():
    """Returns a chain to generate the player's message initiating the engagement card."""
    prompt = PromptTemplate.from_template(
        template=ONLINE_INTEL_PLAYER_PROMPT.prompt,
        template_format="jinja2",
    )
    llm = get_chat_model(temperature=0.7, cache_name="online_intel_player")
    return prompt | llm | StrOutputParser()


def get_stakeholder_engagement_chain():
    """Returns a chain to generate a stakeholder's response to the engagement message."""
    prompt = PromptTemplate.from_template(
        template=ONLINE_INTEL_STAKEHOLDER_PROMPT.prompt,
        template_format="jinja2",
    )
    llm = get_chat_model(temperature=0.7, cache_name="online_intel_stakeholder")
    return prompt | llm | StrOutputParser()
