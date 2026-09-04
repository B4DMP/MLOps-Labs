from typing import Any, Optional
from opik.integrations.langchain import OpikTracer

from mlops_serious_game.application.action_card_service.graph import (
    create_action_card_graph,
)
from mlops_serious_game.application.action_card_service.state import (
    ActionCard,
    ActionCardState,
)


async def generate_action_card(
    challenge_context: str,
    intel_items: list[dict[str, Any]],
    intel_ids: list[str],
    phase_id: int = 0,
    challenge_id: int = 0,
    session_id: Optional[str] = None,
) -> dict[str, Any]:
    """Runs the Action Card Generation workflow graph to synthesize an Action Card from merged intel items.

    Args:
        challenge_context (str): Context description of the current challenge.
        intel_items (list[dict[str, Any]]): List of intel items merged by the player.
        intel_ids (list[str]): List of intel item IDs merged.
        phase_id (int): Phase index.
        challenge_id (int): Challenge index.
        session_id (Optional[str]): Optional session ID for tracing.

    Returns:
        dict[str, Any]: The generated Action Card dictionary.
    """
    graph_builder = create_action_card_graph()
    graph = graph_builder.compile()

    opik_tracer = OpikTracer(
        project_name="MLOps serious game - Action Card",
        metadata={"session_id": session_id or "action_card_generation"},
    )

    config = {
        "callbacks": [opik_tracer],
        "recursion_limit": 10,
    }

    try:
        output_state: ActionCardState = await graph.ainvoke(
            input={
                "phase_id": phase_id,
                "challenge_id": challenge_id,
                "challenge_context": challenge_context,
                "intel_items": intel_items,
                "intel_ids": intel_ids,
            },
            config=config,
        )

        action_card = output_state.get("action_card")
        if not action_card:
            raise RuntimeError("Action card generation produced an empty card result.")

        return action_card

    except Exception as e:
        raise RuntimeError(f"Error generating action card: {e}") from e
