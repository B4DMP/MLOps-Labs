import asyncio
from typing import Any, Optional

from langchain_core.messages import HumanMessage
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
from loguru import logger
from opik.integrations.langchain import OpikTracer
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine


from mlops_serious_game.application.pitch_debate_service.graph import (
    create_pitch_debate_graph,
)
from mlops_serious_game.application.pitch_debate_service.state import (
    DialogueOption,
    EmotionValues,
    PitchDebateState,
    StakeholderIntelItem,
)
from mlops_serious_game.domain.emotion_factory import EmotionFactory
from mlops_serious_game.domain.stakeholder_factory import StakeholderFactory
from mlops_serious_game.config import settings


async def get_checkpoint_dialogue_options(
    thread_id: str,
) -> Optional[list[DialogueOption]]:
    """Retrieves existing dialogue options from the LangGraph checkpoint for a given thread, if any."""
    try:
        async with AsyncPostgresSaver.from_conn_string(settings.POSTGRES_CHECKPOINTER_URI) as checkpointer:
            await checkpointer.setup()
            config = {"configurable": {"thread_id": thread_id}}
            checkpoint = await checkpointer.aget(config)
            if checkpoint:
                channel_values = checkpoint.get("channel_values", {})
                saved_options = channel_values.get("dialogue_options")
                if saved_options and len(saved_options) > 0:
                    result = []
                    for opt in saved_options:
                        try:
                            result.append(opt if isinstance(opt, DialogueOption) else DialogueOption(**opt))
                        except Exception:
                            continue
                    if result:
                        return result
    except Exception as e:
        logger.warning(f"[get_checkpoint_dialogue_options error] {e}")
    return None


async def save_checkpoint_dialogue_options(
    thread_id: str,
    dialogue_options: list[DialogueOption],
) -> bool:
    """Updates the dialogue options in the LangGraph checkpoint for a given thread."""
    try:
        graph_builder = create_pitch_debate_graph()
        async with AsyncPostgresSaver.from_conn_string(settings.POSTGRES_CHECKPOINTER_URI) as checkpointer:
            await checkpointer.setup()
            graph = graph_builder.compile(checkpointer=checkpointer)
            config = {"configurable": {"thread_id": thread_id}}
            checkpoint = await checkpointer.aget(config)
            if checkpoint:
                await graph.aupdate_state(config, {"dialogue_options": dialogue_options})
                return True
    except Exception as e:
        logger.warning(f"[save_checkpoint_dialogue_options error] {e}")
    return False


async def get_response(
    challenge: str,
    _thread_id: str,
    phase_id: int,
    challenge_id: int = 0,
    option_id: Optional[str] = None,
    dialogue_option: Optional[DialogueOption | dict[str, Any]] = None,
    addressed_stakeholder_id: Optional[str] = None,
    initial_start: bool = False,
    initial_emotion_values: Optional[dict[str, EmotionValues]] = None,
    intel_items: Optional[list[StakeholderIntelItem]] = None,
    stakeholder_convincer_profile: Optional[dict[str, list[StakeholderIntelItem]]] = None,
    action_card: Optional[dict[str, Any]] = None,
    ws: Optional[Any] = None,
    callback: Optional[Any] = None,
) -> tuple[dict[str, Any], PitchDebateState]:
    """Runs the Pitch Debate LangGraph workflow for a single conversation turn.

    The LangGraph workflow receives the chosen dialogue option and determines the prompt dynamically.
    Dialogue options for the next turn are determined outside of the LangGraph.

    Args:
        challenge: Description of current challenge.
        _thread_id: Session/Thread ID for checkpointer persistence.
        phase_id: Current game phase index.
        challenge_id: Current challenge index within phase.
        option_id: ID of the selected DialogueOption (required when initial_start is False).
        dialogue_option: Optional full DialogueOption object/dict passed from frontend as fallback.
        addressed_stakeholder_id: Optional target stakeholder ID when corporate noise is selected.
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

            if not initial_start:
                if not option_id:
                    raise ValueError("option_id must be provided when initial_start is False")

                prev_options = checkpoint_values.get("dialogue_options", [])
                selected_opt: Optional[DialogueOption] = None
                for opt in prev_options:
                    try:
                        opt_obj = opt if isinstance(opt, DialogueOption) else DialogueOption(**opt)
                        if opt_obj.id == option_id:
                            selected_opt = opt_obj
                            break
                    except Exception:
                        continue

                # Fallback to dialogue_option if not found in checkpoint (e.g. after refresh/reconnect)
                if not selected_opt and dialogue_option:
                    try:
                        selected_opt = (
                            dialogue_option
                            if isinstance(dialogue_option, DialogueOption)
                            else DialogueOption(**dialogue_option)
                        )
                    except Exception as parse_err:
                        logger.warning(f"[get_response dialogue_option parse warning] {parse_err}")

                # Structural fallback by ID prefix
                if not selected_opt:
                    if option_id.startswith("opt_noise_"):
                        all_archetypes = list(EmotionFactory.get_convincer_archetypes().values())
                        matched_arch = all_archetypes[0] if all_archetypes else None
                        selected_opt = DialogueOption(
                            id=option_id,
                            type="corporate_noise",
                            text=None,
                            archetype=matched_arch,
                        )
                    elif option_id.startswith("opt_intel_"):
                        available_intels = (
                            intel_items
                            if intel_items is not None
                            else checkpoint_values.get("intel_items", [])
                        )
                        first_intel = available_intels[0] if available_intels else None
                        st_id = getattr(first_intel, "stakeholder_id", None) if first_intel else None
                        selected_opt = DialogueOption(
                            id=option_id,
                            type="intel",
                            text=None,
                            intel_item_id=str(getattr(first_intel, "id", "")) if first_intel else None,
                            intel_description=str(getattr(first_intel, "description", "")) if first_intel else None,
                            intel_stakeholder_id=str(st_id) if st_id else None,
                        )
                    else:
                        raise ValueError(f"Dialogue option with ID '{option_id}' could not be resolved")

                last_selected_option = selected_opt

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

                if selected_opt.type == "intel" and not last_selected_intel and selected_opt.intel_item_id:
                    last_selected_intel = StakeholderIntelItem(
                        id=selected_opt.intel_item_id,
                        stakeholder_id=selected_opt.intel_stakeholder_id or "",
                        description=selected_opt.intel_description or "",
                        categorized_description=selected_opt.intel_description or "",
                        categorized_type=selected_opt.intel_type or "requirement",
                    )

            input_data: dict[str, Any] = {
                "challenge": challenge,
                "phase_id": phase_id,
                "challenge_id": challenge_id,
                "last_selected_intel": last_selected_intel,
                "last_selected_option": last_selected_option,
                "addressed_stakeholder_id": addressed_stakeholder_id,
            }

            if not checkpoint_values.get("emotion_values") and initial_emotion_values:
                input_data["emotion_values"] = initial_emotion_values

            if intel_items is not None:
                input_data["intel_items"] = intel_items

            if stakeholder_convincer_profile is not None:
                input_data["stakeholder_convincer_profile"] = stakeholder_convincer_profile

            if action_card is not None:
                input_data["action_card"] = action_card
            elif checkpoint_values.get("action_card"):
                input_data["action_card"] = checkpoint_values.get("action_card")

            output_state = await graph.ainvoke(
                input=input_data,
                config=config,
            )

            # Determine dialogue options for the next turn OUTSIDE of LangGraph
            discovered_intels = (
                output_state.get("intel_items", [])
                or checkpoint_values.get("intel_items", [])
                or intel_items
                or []
            )
            from mlops_serious_game.application.intel_handler import determine_dialogue_options
            next_dialogue_options = determine_dialogue_options(
                discovered_intel_items=discovered_intels
            )
            output_state["dialogue_options"] = next_dialogue_options

            # Persist next dialogue options to thread checkpoint
            await graph.aupdate_state(config, {"dialogue_options": next_dialogue_options})

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
                table_check = await conn.execute(text(f"SELECT to_regclass('{table}');"))
                if table_check.scalar() is not None:
                    await conn.execute(text(f"TRUNCATE TABLE {table} CASCADE;"))
                    tables_cleared.append(table)
                    logger.info(f"Truncated table: {table}")

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
        for table in ["checkpoints", "checkpoint_writes", "checkpoint_blobs"]:
            table_check = await conn.execute(text(f"SELECT to_regclass('{table}');"))
            if table_check.scalar() is not None:
                await conn.execute(
                    text(f"DELETE FROM {table} WHERE thread_id = :thread_id;"),
                    {"thread_id": thread_id},
                )
    await async_engine.dispose()
