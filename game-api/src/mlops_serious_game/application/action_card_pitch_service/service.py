from typing import Any
from fastapi import WebSocket
from opik.integrations.langchain import OpikTracer

from mlops_serious_game.application.action_card_pitch_service.graph import (
    create_action_card_pitch_graph,
)
from mlops_serious_game.application.action_card_pitch_service.state import (
    ActionCardPitchState,
    StakeholderPitchContext,
)
from mlops_serious_game.infrastructure.database import get_session


async def run_action_card_pitch_workflow(
    user_id: int,
    phase_id: int,
    challenge_id: int,
    challenge_context: str,
    pitch_attempt: int,
    action_card_summary: str,
    action_card_commitments: list[str],
    stakeholders: list[StakeholderPitchContext],
    addressed_stakeholders: str = "everyone in the room",
    ws: WebSocket | None = None,
    session_id: str | None = None,
    callback: Any | None = None,
) -> tuple[str, list[dict[str, Any]], ActionCardPitchState]:
    """Runs the dedicated Action Card Pitch LangGraph workflow to generate the player's pitch and stakeholder reactions.

    Args:
        user_id (str): Player user_id.
        phase_id (int): Current phase index.
        challenge_id (int): Current challenge index.
        challenge_context (str): Context of the challenge.
        pitch_attempt (int): 1-based attempt counter for this challenge pitch.
        action_card_summary (str): Summarized commitments of the Action Card.
        action_card_commitments (list[str]): Detailed list of commitments.
        stakeholders (list[StakeholderPitchContext]): Pre-evaluated stakeholder context list.
        addressed_stakeholders (str): String representation of addressed stakeholders.
        ws (WebSocket | None): Active websocket connection.
        session_id (str | None): Optional thread/session ID for tracing.
        callback (Any | None): Optional callback to stream generated messages.

    Returns:
        tuple[str, list[dict], ActionCardPitchState]: Generated player message, stakeholder responses, and final state.
    """
    if session_id:
        thread_id = session_id
    else:
        thread_id = f"Action_Card_Pitch_{user_id}_{phase_id}_{challenge_id}_{pitch_attempt}"

    graph_builder = create_action_card_pitch_graph()
    graph = graph_builder.compile()

    opik_tracer = OpikTracer(
        project_name="MLOps serious game - Action Card Pitch",
        metadata={
            "thread_id": thread_id,
            "user_id": user_id,
            "phase_id": phase_id,
            "challenge_id": challenge_id,
            "pitch_attempt": pitch_attempt,
        },
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

    input_state: ActionCardPitchState = {
        "phase_id": phase_id,
        "challenge_id": challenge_id,
        "challenge_context": challenge_context,
        "pitch_attempt": pitch_attempt,
        "action_card_summary": action_card_summary,
        "action_card_commitments": action_card_commitments,
        "stakeholders": stakeholders,
        "addressed_stakeholders": addressed_stakeholders,
    }

    try:
        output_state: ActionCardPitchState = await graph.ainvoke(
            input=input_state,
            config=config,
        )

        player_message = output_state.get("player_message", "")
        stakeholder_responses = output_state.get("stakeholder_responses", [])

        return player_message, stakeholder_responses, output_state

    except Exception as e:
        # Fallback if LLM or LangGraph encounters an issue
        print(f"[Action Card Pitch Workflow Error] {e}")
        import traceback
        traceback.print_exc()

        # Generate clean deterministic fallback messages
        if pitch_attempt == 1:
            fallback_player = f"Welcome to the resolution meeting. I am proposing an action plan with {len(action_card_commitments)} commitments to address our challenges."
        else:
            fallback_player = f"I have reconsidered our approach based on your feedback and am now proposing this updated action plan."

        fallback_stakeholders = []
        for st in stakeholders:
            st_name = st.get("stakeholder_name", st.get("stakeholder_id", ""))
            repeat = st.get("repeat_context")
            if repeat == "answered":
                msg = "Better. That took a while."
            elif repeat == "unchanged":
                msg = "You brought me the same problem again."
            elif st.get("is_approval", False) or st.get("objection_kind") == "none":
                msg = "The proposal looks aligned with my priorities. I am on board."
            elif st.get("objection_kind") == "misclassification":
                msg = "You completely misunderstood my position on my requirements."
            elif st.get("objection_kind") == "boundary":
                tgt = st.get("objection_target", "core constraints")
                msg = f"This crosses a hard boundary for me on {tgt}! I cannot sign off on this."
            elif st.get("objection_kind") == "trade_off":
                msg = "Neither my primary demand nor my compromise was addressed in the card."
            else:
                tgt = st.get("objection_target", "my priorities")
                msg = f"The proposal completely neglects my demand for {tgt}."
            if repeat == "changed_unanswered":
                msg = f"Different, but not enough. {msg}"

            fallback_stakeholders.append({
                "stakeholder_id": st.get("stakeholder_id", ""),
                "stakeholder_name": st_name,
                "message": msg,
                "buy_in": st.get("buy_in", 0.5),
                "band": st.get("band", "amber"),
                "emotional_state": st.get("emotional_state", "neutral"),
                "objection_kind": st.get("objection_kind", "none"),
            })

        return fallback_player, fallback_stakeholders, {
            **input_state,
            "player_message": fallback_player,
            "stakeholder_responses": fallback_stakeholders,
        }
