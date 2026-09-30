
from mlops_serious_game.application.llm import get_chat_model
from mlops_serious_game.domain.prompts import with_setting
from mlops_serious_game.application.action_card_service.prompts import ACTION_CARD_PROMPT
from mlops_serious_game.application.action_card_service.state import ActionCardGenerationOutput


def get_action_card_generator_chain():
    """Builds and returns the LCEL chain with structured output for generating Action Cards."""
    model = get_chat_model(temperature=0.5, cache_name="action_card")
    structured_model = model.with_structured_output(ActionCardGenerationOutput)
    return with_setting(ACTION_CARD_PROMPT) | structured_model
