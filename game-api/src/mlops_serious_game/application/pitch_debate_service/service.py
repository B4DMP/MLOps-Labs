import asyncio
from typing import Any, Optional

from langchain_core.messages import HumanMessage
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
from loguru import logger
from opik.integrations.langchain import OpikTracer
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from mlops_serious_game.application.dialogue_options_service import DialogueOption
from mlops_serious_game.application.pitch_debate_service.graph import (
    create_pitch_debate_graph,
)
from mlops_serious_game.application.pitch_debate_service.state import (
    EmotionValues,
    PitchDebateState,
    StakeholderIntelItem,
)
from mlops_serious_game.config import settings


async def get_response(
    challenge: str,
    _thread_id: str,
    phase_id: int,
    challenge_id: int = 0,
    option_index: Optional[int] = None,
    initial_start: bool = False,
    initial_emotion_values: Optional[dict[str, EmotionValues]] = None,
    intel_items: Optional[list[StakeholderIntelItem]] = None,
    stakeholder_convincer_profile: Optional[dict[str, list[StakeholderIntelItem]]] = None,
    ws=None,
    callback=None,
) -> tuple[dict[str, Any], PitchDebateState]:
    """Run a conversation step through the pitch debate dialogue option & CME workflow graph.

    Args:
        challenge: The current MLOps challenge description.
        _thread_id: Session/thread identifier.
        phase_id: Current phase index.
        challenge_id: Current challenge index.
        option_index: Chosen dialogue option index (0-based).
        initial_start: Flag indicating if this is the initial round start.
        initial_emotion_values: Baseline emotion values if starting fresh.
        intel_items: List of player's discovered/available intel items.
        stakeholder_convincer_profile: Convincer profiles per stakeholder.
        ws: Optional WebSocket connection.
        callback: Optional callback for streaming events.

    Returns:
        tuple[dict[str, Any], PitchDebateState]: (emotion_deltas, output_state)
    """
    graph_builder = create_pitch_debate_graph()

    try:
        async with AsyncPostgresSaver.from_conn_string(settings.POSTGRES_CHECKPOINTER_URI) as checkpointer:
            await checkpointer.setup()
            graph = graph_builder.compile(checkpointer=checkpointer)
            opik_tracer = OpikTracer(
                project_name="MLOps serious game",
                metadata={"thread_id": _thread_id},
            )

            config = {
                "configurable": {
                    "thread_id": _thread_id,
                    "ws": ws,
                    "callback": callback,
                },
                "callbacks": [opik_tracer],
                "recursion_limit": 150,
            }

            checkpoint = await checkpointer.aget(config)
            checkpoint_values = checkpoint.get("channel_values", {}) if checkpoint else {}

            last_selected_intel: Optional[StakeholderIntelItem] = None
            last_selected_option: Optional[DialogueOption] = None

            if initial_start:
                messages = [HumanMessage(content="Welcome to the meeting everybody")]
            else:
                if option_index is None:
                    raise ValueError("option_index must be provided when initial_start is False")

                prev_options = checkpoint_values.get("dialogue_options", [])
                if not prev_options or not (0 <= option_index < len(prev_options)):
                    raise IndexError(
                        f"Dialogue option index {option_index} out of bounds for options length {len(prev_options)}"
                    )

                selected_opt = prev_options[option_index]
                if isinstance(selected_opt, dict):
                    selected_opt = DialogueOption(**selected_opt)
                last_selected_option = selected_opt
                messages = [HumanMessage(content=selected_opt.text)]

                available_intels = (
                    intel_items
                    if intel_items is not None
                    else checkpoint_values.get("intel_items", [])
                )

                if selected_opt.intel_item_id:
                    for item in available_intels:
                        item_id = getattr(item, "id", None) or (item.get("id") if isinstance(item, dict) else None)
                        req_id = getattr(item, "requirement_id", None) or (item.get("requirement_id") if isinstance(item, dict) else None)
                        if (item_id and str(item_id) == str(selected_opt.intel_item_id)) or (req_id and str(req_id) == str(selected_opt.intel_item_id)):
                            last_selected_intel = (
                                item if isinstance(item, StakeholderIntelItem) else StakeholderIntelItem(**item)
                            )
                            break
                    if not last_selected_intel:
                        for item in available_intels:
                            desc = getattr(item, "description", "") or getattr(item, "categorized_description", "") or (
                                item.get("description", "") or item.get("categorized_description", "") if isinstance(item, dict) else ""
                            )
                            if desc and desc in selected_opt.text:
                                last_selected_intel = (
                                    item if isinstance(item, StakeholderIntelItem) else StakeholderIntelItem(**item)
                                )
                                break

            input_data: dict[str, Any] = {
                "messages": messages,
                "challenge": challenge,
                "phase_id": phase_id,
                "challenge_id": challenge_id,
                "last_selected_intel": last_selected_intel,
                "last_selected_option": last_selected_option,
            }

            if not checkpoint_values.get("emotion_values") and initial_emotion_values:
                input_data["emotion_values"] = initial_emotion_values

            if intel_items is not None:
                input_data["intel_items"] = intel_items

            if stakeholder_convincer_profile is not None:
                input_data["stakeholder_convincer_profile"] = stakeholder_convincer_profile

            if not initial_start and last_selected_option and callback:
                cb_state = {"messages": [HumanMessage(content=last_selected_option.text)]}
                if asyncio.iscoroutinefunction(callback):
                    await callback(websocket=ws, state=cb_state)
                else:
                    callback(websocket=ws, state=cb_state)

            output_state = await graph.ainvoke(
                input=input_data,
                config=config,
            )

            emotion_deltas = output_state.get("emotion_deltas", {})
            return emotion_deltas, output_state

    except (ValueError, IndexError):
        raise
    except Exception as e:
        raise RuntimeError(f"Error running pitch debate CME conversation workflow: {str(e)}") from e


async def reset_conversation_state() -> dict:
    """Deletes all conversation state data from PostgreSQL."""
    try:
        async_engine = create_async_engine(settings.POSTGRES_ASYNC_URI)
        tables_cleared = []

        async with async_engine.begin() as conn:
            for table in ["checkpoints", "checkpoint_writes", "checkpoint_blobs"]:
                try:
                    await conn.execute(text(f"TRUNCATE TABLE {table} CASCADE;"))
                    tables_cleared.append(table)
                    logger.info(f"Truncated table: {table}")
                except Exception:
                    pass

        await async_engine.dispose()

        return {
            "status": "success",
            "message": f"Successfully cleared checkpoint tables: {', '.join(tables_cleared)}",
        }

    except Exception as e:
        logger.error(f"Failed to reset conversation state: {str(e)}")
        raise RuntimeError(f"Failed to reset conversation state: {str(e)}") from e


async def reset_thread(thread_id: str):
    """Deletes all checkpoint records for a specific thread."""
    async_engine = create_async_engine(settings.POSTGRES_ASYNC_URI)
    async with async_engine.begin() as conn:
        await conn.execute(text("DELETE FROM checkpoints WHERE thread_id = :thread_id"), {"thread_id": thread_id})
        await conn.execute(text("DELETE FROM checkpoint_writes WHERE thread_id = :thread_id"), {"thread_id": thread_id})
        await conn.execute(text("DELETE FROM checkpoint_blobs WHERE thread_id = :thread_id"), {"thread_id": thread_id})
    await async_engine.dispose()
