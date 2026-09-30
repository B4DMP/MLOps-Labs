from langchain_core.output_parsers import StrOutputParser
from langchain_core.prompts import PromptTemplate
from mlops_serious_game.application.llm import get_chat_model

from mlops_serious_game.domain.prompts import (
    ACTION_CARD_PITCH_PLAYER_PROMPT,
    ACTION_CARD_PITCH_STAKEHOLDER_PROMPT,
)


def get_player_pitch_chain():
    """Returns a chain to generate the player's action card presentation line."""
    prompt = PromptTemplate.from_template(
        template=ACTION_CARD_PITCH_PLAYER_PROMPT.prompt,
        template_format="jinja2",
    )
    llm = get_chat_model(temperature=0.7, cache_name="pitch_player")
    return prompt | llm | StrOutputParser()


def get_stakeholder_pitch_chain():
    """Returns a chain to generate a stakeholder's evaluation and reaction to the pitched card."""
    prompt = PromptTemplate.from_template(
        template=ACTION_CARD_PITCH_STAKEHOLDER_PROMPT.prompt,
        template_format="jinja2",
    )
    llm = get_chat_model(temperature=0.7, cache_name="pitch_stakeholder")
    return prompt | llm | StrOutputParser()
