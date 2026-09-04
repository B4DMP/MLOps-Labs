import uuid
from typing import Any

from mlops_serious_game.application.action_card_service.chains import (
    get_action_card_generator_chain,
)
from mlops_serious_game.application.action_card_service.state import (
    ActionCard,
    ActionCardGenerationOutput,
    ActionCardState,
)


def format_intel_items_for_prompt(intel_items: list[dict[str, Any]]) -> str:
    """Formats a list of intel items into a readable markdown bulleted list for the prompt."""
    if not intel_items:
        return "No specific intel items provided."

    formatted_lines = []
    for idx, item in enumerate(intel_items, 1):
        desc = item["description"]
        st_name = item["stakeholder_name"]
        cat_type = item["categorized_type"]
        formatted_lines.append(f"{idx}. [{st_name}] ({cat_type}): {desc}")

    return "\n".join(formatted_lines)


async def generate_action_card_node(state: ActionCardState) -> dict[str, Any]:
    """Node that synthesizes merged intel items into a structured Action Card."""
    challenge_context = state.get("challenge_context", "")
    intel_items = state.get("intel_items", [])
    intel_ids = state.get("intel_ids", [])

    intel_items_text = format_intel_items_for_prompt(intel_items)

    chain = get_action_card_generator_chain()
    output: ActionCardGenerationOutput = await chain.ainvoke(
        {
            "challenge_context": challenge_context,
            "intel_items_text": intel_items_text,
        }
    )

    card_id = f"ac_{uuid.uuid4().hex[:8]}"
    action_card = ActionCard(
        id=card_id,
        title=output.title.strip(),
        description=output.description.strip(),
        intel_ids=list(intel_ids),
        addendum_intel_item_ids=[],
    )

    return {"action_card": action_card.model_dump()}
