from langchain_groq import ChatGroq
from langchain_openai import ChatOpenAI

from mlops_serious_game.domain.prompts import with_setting
from mlops_serious_game.application.action_card_service.prompts import ACTION_CARD_PROMPT
from mlops_serious_game.application.action_card_service.state import ActionCardGenerationOutput
from mlops_serious_game.config import settings


def get_action_card_model(
    temperature: float = 0.5,
    model_name: str | None = None,
) -> ChatOpenAI | ChatGroq:
    """Returns the chat model configured for generating Action Cards."""
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


def get_action_card_generator_chain():
    """Builds and returns the LCEL chain with structured output for generating Action Cards."""
    model = get_action_card_model()
    structured_model = model.with_structured_output(ActionCardGenerationOutput)
    return with_setting(ACTION_CARD_PROMPT) | structured_model
