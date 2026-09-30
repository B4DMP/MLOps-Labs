from langchain_core.output_parsers import StrOutputParser
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from loguru import logger

from mlops_serious_game.application.message_parser import sanitize_dashes
from mlops_serious_game.application.llm import get_chat_model
from mlops_serious_game.application.pitch_debate_service.prompts import (
    PLAYER_KICKOFF_PROMPT,
    PLAYER_UTTERANCE_PROMPT,
    STAKEHOLDER_ENGAGEMENT_RESPONSE_PROMPT,
)
from mlops_serious_game.application.pitch_debate_service.tools import tools
from mlops_serious_game.domain.prompts import (
    with_setting,
    INTEL_ARTIFACT_PROMPT,
    STAKEHOLDER_CHARACTER_CARD,
    WRONG_INTEL_PROMPT,
)


def get_stakeholder_response_chain():
    model = get_chat_model(cache_name="debate_stakeholder_response")
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
                "Please generate the single-sentence wrong intel description for {{stakeholder_name}} miscategorized as {{categorized_type}}.",
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
                "Write ONLY the body content for this {{artifact_type}} involving {{stakeholder_name}}. "
                "Markdown formatting (bullets, bold) is allowed. "
                "Strictly NO titles, headings, subject lines, author lines, or dashes (strictly ban '—' and '–'). "
                "Start directly with the first sentence of the body text:",
            ),
        ],
        template_format="jinja2",
    )
    return prompt | model | StrOutputParser()


def get_player_utterance_chain():
    """Builds and returns the LCEL chain for dynamically generating the player's spoken utterance upon option selection."""
    model = get_chat_model(temperature=0.7, cache_name="debate_player_utterance")
    return with_setting(PLAYER_UTTERANCE_PROMPT) | model | StrOutputParser()


def get_stakeholder_engagement_response_chain():
    """Builds and returns the LCEL chain for generating a stakeholder's response to an engagement dialogue option."""
    model = get_chat_model(temperature=0.7, cache_name="debate_stakeholder_engagement")
    return with_setting(STAKEHOLDER_ENGAGEMENT_RESPONSE_PROMPT) | model | StrOutputParser()


def get_player_kickoff_chain():
    """Builds and returns the LCEL chain for dynamically generating the player's opening welcome and action card introduction."""
    model = get_chat_model(temperature=0.6, cache_name="debate_kickoff")
    return with_setting(PLAYER_KICKOFF_PROMPT) | model | StrOutputParser()


async def generate_player_utterance(
    challenge: str = "",
    target_stakeholder_name: str = "Stakeholder",
    target_stakeholder_role: str = "",
    dialogue_option_label: str = "",
    dialogue_option_prompt: str = "",
    intel_context: str = "",
    component_name: str = "",
    history: str = "",
    latest_statement: str = "",
    default_prompt: str = "",
    card_title: str = "",
    card_description: str = "",
    is_first_turn: bool = False,
    is_last_turn: bool = False,
) -> str:
    """Generates the player utterance via LLM chain with a safe deterministic fallback."""
    base_inquiry = (
        default_prompt
        or dialogue_option_prompt
        or dialogue_option_label
        or "Could you share your perspective on this?"
    )

    if is_first_turn:
        if target_stakeholder_name in ("Whole Team", "all"):
            fallback = f"Hello everyone, thanks for joining this sync-up. {base_inquiry}"
        else:
            fallback = f"Hi {target_stakeholder_name}, thanks for taking the time to meet today. {base_inquiry}"
    elif is_last_turn:
        fallback = f"Finally, before we wrap up: {base_inquiry}"
    else:
        fallback = base_inquiry

    try:
        chain = get_player_utterance_chain()
        result = await chain.ainvoke(
            {
                "challenge": challenge,
                "target_stakeholder_name": target_stakeholder_name,
                "target_stakeholder_role": target_stakeholder_role,
                "dialogue_option_label": dialogue_option_label,
                "dialogue_option_prompt": dialogue_option_prompt or default_prompt,
                # PLAYER_UTTERANCE_PROMPT declares intel_context (it reads
                # `dialogue_option_prompt or intel_context`), so leaving it out made every
                # invocation raise on a missing variable and fall through to the canned
                # fallback below - the LLM was never actually reached.
                "intel_context": intel_context,
                "component_name": component_name,
                "history": history,
                "latest_statement": latest_statement,
                "card_title": card_title,
                "card_description": card_description,
                "is_first_turn": is_first_turn,
                "is_last_turn": is_last_turn,
            }
        )
        text = str(result).strip().strip('"').strip("'")
        text = sanitize_dashes(text)
        return text if text else sanitize_dashes(fallback)
    except Exception as exc:
        logger.warning(f"generate_player_utterance failed, falling back to default: {exc}")
        return sanitize_dashes(fallback)


async def generate_stakeholder_response(
    stakeholder_name: str = "Stakeholder",
    stakeholder_role: str = "",
    challenge: str = "",
    responsibilities: str = "",
    priorities: str = "",
    emotion: str = "Neutral",
    option_type: str = "generic_query",
    component_name: str = "",
    revealed_intel_description: str = "",
    revealed_intel_tag: str = "",
    is_revealed: bool = True,
    history: str = "",
    player_utterance: str = "",
    default_response: str = "",
) -> str:
    """Generates the stakeholder response via LLM chain with a safe deterministic fallback."""
    if is_revealed:
        fallback = (
            default_response
            or revealed_intel_description
            or f"From my perspective, this is an important area for our team to address."
        )
    else:
        fallback = (
            default_response
            or "I do not have any specific concerns or additional requirements on this topic at the moment."
        )

    try:
        chain = get_stakeholder_engagement_response_chain()
        result = await chain.ainvoke(
            {
                "stakeholder_name": stakeholder_name,
                "stakeholder_role": stakeholder_role,
                "challenge": challenge,
                "responsibilities": responsibilities,
                "stakeholder_responsibilities": responsibilities,
                "priorities": priorities,
                "stakeholder_priorities": priorities,
                "emotion": emotion,
                "current_emotion": emotion,
                "option_type": option_type,
                "dialogue_option_type": option_type,
                "component_name": component_name,
                "revealed_intel": revealed_intel_description,
                "revealed_intel_description": revealed_intel_description,
                "revealed_intel_tag": revealed_intel_tag,
                "is_revealed": is_revealed,
                "history": history,
                "player_utterance": player_utterance,
            }
        )
        text = str(result).strip().strip('"').strip("'")
        text = sanitize_dashes(text)
        return text if text else sanitize_dashes(fallback)
    except Exception as exc:
        logger.warning(f"generate_stakeholder_response failed, falling back to default: {exc}")
        return sanitize_dashes(fallback)


