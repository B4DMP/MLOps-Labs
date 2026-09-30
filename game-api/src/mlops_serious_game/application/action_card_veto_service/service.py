from typing import Any, Optional
from fastapi import WebSocket
from opik.integrations.langchain import OpikTracer

from mlops_serious_game.application.action_card_veto_service.graph import create_action_card_veto_graph
from mlops_serious_game.application.action_card_veto_service.state import ActionCardVetoState
from mlops_serious_game.infrastructure.database import get_session


async def run_action_card_veto_workflow(
    user_id: int,
    phase_id: int,
    challenge_id: int,
    challenge_context: str,
    action_card_summary: str,
    action_card_commitments: list[str],
    stakeholder_id: str,
    stakeholder_name: str,
    stakeholder_role: str,
    stakeholder_power: str,
    stakeholder_responsibilities: str,
    stakeholder_priorities: str,
    stakeholder_constraints: str,
    emotional_state: str,
    buy_in: float,
    boundary_violated: bool,
    objection_kind: str,
    objection_detail: str,
    objection_target: Optional[str] = None,
    pitch_chat_summary: Optional[str] = None,
    ws: WebSocket | None = None,
    session_id: str | None = None,
    callback: Any | None = None,
) -> tuple[str, ActionCardVetoState]:
    """Runs the dedicated Action Card Veto LangGraph workflow to generate the stakeholder's veto message.

    Returns:
        tuple[str, ActionCardVetoState]: Generated veto message and final state.
    """
    if session_id:
        thread_id = session_id
    else:
        thread_id = f"Action_Card_Veto_{user_id}_{phase_id}_{challenge_id}_{stakeholder_id}"

    graph_builder = create_action_card_veto_graph()
    graph = graph_builder.compile()

    opik_tracer = OpikTracer(
        project_name="MLOps serious game - Action Card Veto",
        metadata={
            "thread_id": thread_id,
            "user_id": user_id,
            "phase_id": phase_id,
            "challenge_id": challenge_id,
            "stakeholder_id": stakeholder_id,
        },
    )

    config = {
        "configurable": {
            "thread_id": thread_id,
            "ws": ws,
            "callback": callback,
        },
        "callbacks": [opik_tracer],
        "recursion_limit": 20,
    }

    input_state: ActionCardVetoState = {
        "phase_id": phase_id,
        "challenge_id": challenge_id,
        "challenge_context": challenge_context,
        "action_card_summary": action_card_summary,
        "action_card_commitments": action_card_commitments,
        "stakeholder_id": stakeholder_id,
        "stakeholder_name": stakeholder_name,
        "stakeholder_role": stakeholder_role,
        "stakeholder_power": stakeholder_power,
        "stakeholder_responsibilities": stakeholder_responsibilities,
        "stakeholder_priorities": stakeholder_priorities,
        "stakeholder_constraints": stakeholder_constraints,
        "emotional_state": emotional_state,
        "buy_in": buy_in,
        "boundary_violated": boundary_violated,
        "objection_kind": objection_kind,
        "objection_detail": objection_detail,
        "objection_target": objection_target,
        "pitch_chat_summary": pitch_chat_summary,
    }

    try:
        output_state: ActionCardVetoState = await graph.ainvoke(
            input=input_state,
            config=config,
        )

        veto_message = output_state.get("veto_message", "")
        return veto_message, output_state

    except Exception as e:
        print(f"[Action Card Veto Workflow Error] {e}")
        import traceback
        traceback.print_exc()

        # Deterministic in-character fallback message referencing power and earlier debate
        if boundary_violated:
            fallback_msg = (
                f"I am using my executive authority to veto this action proposal. As I previously stated during our debate, "
                f"this proposal crosses a critical non negotiable boundary for my department that cannot be overlooked."
            )
        else:
            fallback_msg = (
                f"I am exercising my power to veto this action plan. As we discussed earlier in the meeting, "
                f"this proposal fails to address the core operational requirements needed to sign off on deployment."
            )

        return fallback_msg, {
            **input_state,
            "veto_message": fallback_msg,
        }
