from typing import Any, Optional
from opik.integrations.langchain import OpikTracer

from mlops_serious_game.application.dialogue_options_service.graph import (
    create_dialogue_options_graph,
)
from mlops_serious_game.application.dialogue_options_service.state import (
    DialogueOption,
    DialogueOptionsState,
)


async def generate_dialogue_options(
    messages: list[Any],
    challenge: str,
    discovered_intel_items: Optional[list[Any]] = None,
    session_id: Optional[str] = None,
) -> tuple[list[DialogueOption], DialogueOptionsState]:
    """Runs the dedicated Dialogue Options Generation workflow graph.

    Args:
        messages (list[Any]): Conversation messages history.
        challenge (str): Context description of current MLOps challenge.
        discovered_intel_items (Optional[list[Any]]): List of discovered stakeholder intel items.
        session_id (Optional[str]): Optional session identifier for tracing.

    Returns:
        tuple[list[DialogueOption], DialogueOptionsState]: Generated dialogue options and final state.
    """
    graph_builder = create_dialogue_options_graph()
    graph = graph_builder.compile()

    opik_tracer = OpikTracer(
        project_name="MLOps serious game - Dialogue Options",
        metadata={"session_id": session_id or "dialogue_options"},
    )

    config = {
        "callbacks": [opik_tracer],
        "recursion_limit": 50,
    }

    try:
        output_state = await graph.ainvoke(
            input={
                "messages": messages,
                "challenge": challenge,
                "discovered_intel_items": discovered_intel_items or [],
            },
            config=config,
        )

        dialogue_options: list[DialogueOption] = output_state.get(
            "dialogue_options", []
        )
        return dialogue_options, output_state

    except Exception as e:
        raise RuntimeError(
            f"Error generating dialogue options: {e}"
        ) from e
