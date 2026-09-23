from typing import Any
from fastapi import WebSocket
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
from opik.integrations.langchain import OpikTracer

from mlops_serious_game.application.online_intel_service.graph import (
    create_online_intel_workflow_graph,
)
from mlops_serious_game.application.online_intel_service.state import OnlineIntelState
from mlops_serious_game.config import settings
from mlops_serious_game.domain.Challenge import Challenge
from mlops_serious_game.domain.persona_resolver import personalize
from mlops_serious_game.infrastructure.database import get_session, get_user_id


async def run_engagement_card_workflow(
    username: str,
    curr_challenge: Challenge,
    card_id: str,
    stakeholder_ids: list[str],
    phase_id: int = 0,
    challenge_id: int = 0,
    ws: WebSocket | None = None,
    session_id: str | None = None,
    callback: Any | None = None,
) -> tuple[str, list[dict[str, Any]], OnlineIntelState]:
    """Runs the dedicated Online Intel Gathering workflow for a played engagement card.

    Args:
        username (str): Username of the player.
        curr_challenge (Challenge): Current MLOps challenge object.
        card_id (str): ID of the engagement card played (e.g. 'eng_1').
        stakeholder_ids (list[str]): List of target stakeholder IDs.
        phase_id (int): Current phase index.
        challenge_id (int): Current challenge index.
        ws (WebSocket | None): Active WebSocket connection.
        session_id (str | None): Optional session ID for thread isolation.
        callback (Any | None): Async callback function for streaming responses.

    Returns:
        tuple[str, list[dict], OnlineIntelState]: Player message, stakeholder responses, and final state.
    """
    if session_id:
        thread_id = session_id
    else:
        # Keyed by user_id, not username - see D-user-id in
        # docs/plans/session-persistence-and-url-routing.md.
        with get_session() as intel_session:
            intel_user_id = get_user_id(intel_session, username)
        thread_id = f"Online_Intel_{intel_user_id}"
    challenge_desc = (
        f"{curr_challenge.name}: {curr_challenge.roundIntroduction} "
        f"{personalize(curr_challenge.description, resolve_markers=True)}"
    )

    graph_builder = create_online_intel_workflow_graph()

    try:
        async with AsyncPostgresSaver.from_conn_string(settings.POSTGRES_CHECKPOINTER_URI) as checkpointer:
            await checkpointer.setup()
            graph = graph_builder.compile(checkpointer=checkpointer)

            opik_tracer = OpikTracer(
                project_name="MLOps serious game - Online Intel",
                metadata={"thread_id": thread_id, "card_id": card_id},
            )

            config = {
                "configurable": {
                    "thread_id": thread_id,
                    "ws": ws,
                    "callback": callback,
                },
                "callbacks": [opik_tracer],
                "recursion_limit": 50,
            }

            output_state = await graph.ainvoke(
                input={
                    "phase_id": phase_id,
                    "challenge_id": challenge_id,
                    "challenge": challenge_desc,
                    "card_id": card_id,
                    "stakeholder_ids": stakeholder_ids,
                },
                config=config,
            )

            player_message = output_state.get("player_message", "")
            stakeholder_responses = output_state.get("stakeholder_responses", [])

            return player_message, stakeholder_responses, output_state

    except Exception as e:
        print(f"[Online Intel Workflow Error] {e}")
        import traceback
        traceback.print_exc()
        raise RuntimeError(f"Error running online intel workflow: {e}") from e
