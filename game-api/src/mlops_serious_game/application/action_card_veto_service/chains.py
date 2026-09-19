from langchain_core.output_parsers import StrOutputParser
from langchain_core.prompts import PromptTemplate
from langchain_groq import ChatGroq
from langchain_openai import ChatOpenAI

from mlops_serious_game.config import settings
from mlops_serious_game.domain.prompts import ACTION_CARD_VETO_PROMPT


def get_llm(temperature: float = 0.7, model_name: str | None = None) -> ChatOpenAI | ChatGroq:
    if settings.MISTRAL_API_KEY:
        return ChatOpenAI(
            api_key=settings.MISTRAL_API_KEY,
            base_url=settings.MISTRAL_API_BASE,
            model_name=model_name or settings.MISTRAL_LLM_MODEL,
            temperature=temperature,
        )
    elif settings.WESTAI_API_KEY:
        return ChatOpenAI(
            api_key=settings.WESTAI_API_KEY,
            base_url=settings.WESTAI_API_BASE,
            model_name=model_name or settings.WESTAI_LLM_MODEL,
            temperature=temperature,
        )
    else:
        return ChatGroq(
            api_key=settings.GROQ_API_KEY,
            model_name=model_name or settings.GROQ_LLM_MODEL,
            temperature=temperature,
        )


def get_action_card_veto_chain():
    """Returns a chain to generate a high-power stakeholder's veto message."""
    prompt = PromptTemplate.from_template(
        template=ACTION_CARD_VETO_PROMPT.prompt,
        template_format="jinja2",
    )
    llm = get_llm(temperature=0.7)
    return prompt | llm | StrOutputParser()
