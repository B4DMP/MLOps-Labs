import datetime
from typing import Any
from fastapi import WebSocket
from pydantic import BaseModel, Field
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import create_async_engine

from philoagents.config import settings
from philoagents.domain.Challenge import Challenge
from philoagents.domain.briefing_factory import BriefingFactory
from philoagents.domain.metric_factory import MetricFactory
from philoagents.domain.question_factory import QuestionFactory
from philoagents.domain.stakeholder_factory import StakeholderFactory
from philoagents.domain.phase_factory import PhaseFactory
from philoagents.infrastructure.database import (
    GameProgression,
    GameSession,
    async_engine,
    get_session,
)

from ..manager import manager


class GameData(BaseModel):
    id: Any = Field(None, alias="_id")
    userName: str
    phaseIndex: int
    challengeIndex: int
    actionCard: Any
    metricValues: list[int]
    timeStamp: datetime.datetime
    messages: list[Any]


class GameProgressionData(BaseModel):
    id: Any = Field(None, alias="_id")
    userName: str
    gameProgressIndex: int
    timeStamp: datetime.datetime
    additional_data: list[Any]


async def reset_thread(thread_id: str):


    # Note: Direct SQL is used because checkpoint tables are managed internally by LangGraph
    
    async with async_engine.begin() as conn:
        await conn.execute(text("DELETE FROM checkpoints WHERE thread_id = :thread_id"), {"thread_id": thread_id})
        await conn.execute(text("DELETE FROM checkpoint_writes WHERE thread_id = :thread_id"), {"thread_id": thread_id})
        await conn.execute(text("DELETE FROM checkpoint_blobs WHERE thread_id = :thread_id"), {"thread_id": thread_id})


def get_metrics() -> dict[str, Any]:
    metrics_list = [MetricFactory.get_metric(m) for m in MetricFactory.get_available_metrics()]
    return {m.id: (m.model_dump() if hasattr(m, 'model_dump') else m) for m in metrics_list}


def get_stakeholders() -> dict[str, Any]:
    stakeholder_list = [StakeholderFactory.get_stakeholder(s) for s in StakeholderFactory.get_available_stakeholders()]
    return {s.id: (s.model_dump() if hasattr(s, 'model_dump') else s) for s in stakeholder_list}


def get_intro_questions() -> list[Any]:
    return [q.model_dump() if hasattr(q, 'model_dump') else q for q in QuestionFactory.intro_questions]


def get_outro_questions() -> list[Any]:
    return [q.model_dump() if hasattr(q, 'model_dump') else q for q in QuestionFactory.outro_questions]


def get_phases() -> list[Any]:
    return [{"phase_name": p.name, "phase_desc": p.description} for p in PhaseFactory.get_phases()]


async def handle_game_init(
    websocket: WebSocket,
    username: str,
    payload: dict
) -> tuple[int, int]:
    # Send init static configurations
    await manager.send_event(
        websocket=websocket,
        event="game:init_data",
        payload={
            "type": "init",
            "metrics": get_metrics(),
            "stakeholders": get_stakeholders(),
            "phases": get_phases()
        }
    )

    # Fetch user progression index from db
    game_progress_index = 0
    with get_session() as session:
        results = session.scalars(
            select(GameProgression).where(GameProgression.user_name == username)
        ).all()
        for r in results:
            if r.game_progress_index > game_progress_index:
                game_progress_index = r.game_progress_index

    last_gamestate_id = [0, 0]
    initial_metric_values = [MetricFactory.get_metric(m).start_value for m in MetricFactory.get_available_metrics()]

    with get_session() as session:
        results = session.scalars(
            select(GameSession).where(GameSession.user_name == username)
        ).all()
        for r in results:
            if r.phase_index > last_gamestate_id[0] or (r.phase_index == last_gamestate_id[0] and r.challenge_index > last_gamestate_id[1]):
                last_gamestate_id = [r.phase_index, r.challenge_index]
                if isinstance(r.metric_values, list):
                    initial_metric_values = r.metric_values

    await send_progress_index_payload(websocket, game_progress_index, last_gamestate_id, initial_metric_values)
    return (last_gamestate_id[0], last_gamestate_id[1])


async def send_progress_index_payload(
    websocket: WebSocket,
    index: int,
    last_gamestate_id: list[int],
    initial_metric_values: list[int]
) -> None:
    if index == 0:
        await manager.send_event(
            websocket=websocket,
            event="game:progress_change",
            payload={"progressionIndex": 0, "type": "questions", "questions": get_intro_questions()}
        )
    elif index == 1:
        await manager.send_event(
            websocket=websocket,
            event="game:progress_change",
            payload={"progressionIndex": 1, "type": "briefing", "content": BriefingFactory.briefing}
        )
    elif index == 2:
        curr_challenge: Challenge = PhaseFactory.get_challenge_by_index(
            challenge_index=last_gamestate_id[1],
            phase_index=last_gamestate_id[0]
        )
        if curr_challenge:
            await manager.send_event(
                websocket=websocket,
                event="game:state_update",
                payload={
                    "progressionIndex": 2,
                    "type": "state",
                    "phases_amount": len(PhaseFactory.get_phases()),
                    "challenges_amount": len(PhaseFactory.get_phases()[curr_challenge.phase_id].challenges),
                    "phase_id": curr_challenge.phase_id,
                    "challenge_id": curr_challenge.id,
                    "name": curr_challenge.name,
                    "description": curr_challenge.description,
                    "roundIntroduction": curr_challenge.roundIntroduction,
                    "metric_values": initial_metric_values,
                    "metric_changes": curr_challenge.metric_changes
                }
            )
    elif index == 3:
        await manager.send_event(
            websocket=websocket,
            event="game:progress_change",
            payload={"progressionIndex": 3, "type": "questions", "questions": get_outro_questions()}
        )
    elif index == 4:
        await manager.send_event(
            websocket=websocket,
            event="game:progress_change",
            payload={"progressionIndex": 4}
        )


async def handle_progress_update(
    websocket: WebSocket,
    username: str,
    payload: dict
) -> None:
    game_progress_index = payload.get("value", payload.get("index", 0))
    additional_data = payload.get("additional_data", [])

    # Store in PostgreSQL via SQLAlchemy
    with get_session() as session:
        session.add(
            GameProgression(
                user_name=username,
                game_progress_index=game_progress_index,
                time_stamp=datetime.datetime.utcnow(),
                additional_data=additional_data
            )
        )

    last_gamestate_id = payload.get("last_gamestate_id", [0, 0])
    initial_metric_values = payload.get("initial_metric_values", [MetricFactory.get_metric(m).start_value for m in MetricFactory.get_available_metrics()])
    await send_progress_index_payload(websocket, game_progress_index, last_gamestate_id, initial_metric_values)


async def handle_state_request(
    websocket: WebSocket,
    username: str,
    payload: dict
) -> tuple[int, int]:
    try:
        phase_id = payload.get("phase_id", 0)
        challenge_id = payload.get("challenge_id", 0)
        metric_values = payload.get("metric_values", [])
        action_card = payload.get("action_card", {})
        messages = payload.get("messages", [])

        next_challenge: Challenge = PhaseFactory.get_challenge_by_index(
            challenge_index=challenge_id,
            phase_index=phase_id
        )

        if challenge_id == 0 and phase_id == 0:
            metric_values = [MetricFactory.get_metric(m).start_value for m in MetricFactory.get_available_metrics()]

        target_phase = next_challenge.phase_id if next_challenge else phase_id
        target_challenge = next_challenge.id if next_challenge else challenge_id

        ac_changes = action_card.get("metric_changes", {}) if isinstance(action_card, dict) else {}
        next_challenge_changes = next_challenge.metric_changes if next_challenge else {}

        new_metric_values = []
        for i, m_name in enumerate(MetricFactory.get_available_metrics()):
            cur_val = metric_values[i] if i < len(metric_values) else 0
            change = ac_changes.get(m_name, 0) + next_challenge_changes.get(m_name, 0)
            new_metric_values.append(cur_val + change)

        with get_session() as session:
            session.add(
                GameSession(
                    user_name=username,
                    phase_index=target_phase,
                    challenge_index=target_challenge,
                    action_card=action_card,
                    metric_values=new_metric_values,
                    time_stamp=datetime.datetime.utcnow(),
                    messages=messages
                )
            )

        if next_challenge is None:
            await manager.send_event(
                websocket=websocket,
                event="game:progress_change",
                payload={"progressionIndex": 3, "type": "questions", "questions": get_outro_questions()}
            )
            return (phase_id, challenge_id)

        await manager.send_event(
            websocket=websocket,
            event="game:state_update",
            payload={
                "progressionIndex": 2,
                "type": "state",
                "phases_amount": len(PhaseFactory.get_phases()),
                "challenges_amount": len(PhaseFactory.get_phases()[next_challenge.phase_id].challenges),
                "phase_id": next_challenge.phase_id,
                "challenge_id": next_challenge.id,
                "name": next_challenge.name,
                "description": next_challenge.description,
                "roundIntroduction": next_challenge.roundIntroduction,
                "metric_values": new_metric_values,
                "metric_changes": next_challenge.metric_changes
            }
        )
        return (next_challenge.phase_id, next_challenge.id)
    except Exception as e:
        print(f"[GameStateHandler Error] {e}")
        await manager.send_error(websocket, str(e))
        return (0, 0)
