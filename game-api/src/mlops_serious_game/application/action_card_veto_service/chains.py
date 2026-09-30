from langchain_core.output_parsers import StrOutputParser
from langchain_core.prompts import PromptTemplate
from mlops_serious_game.application.llm import get_chat_model

from mlops_serious_game.domain.prompts import ACTION_CARD_VETO_PROMPT


def get_action_card_veto_chain():
    """Returns a chain to generate a high-power stakeholder's veto message."""
    prompt = PromptTemplate.from_template(
        template=ACTION_CARD_VETO_PROMPT.prompt,
        template_format="jinja2",
    )
    llm = get_chat_model(temperature=0.7, cache_name="veto")
    return prompt | llm | StrOutputParser()
