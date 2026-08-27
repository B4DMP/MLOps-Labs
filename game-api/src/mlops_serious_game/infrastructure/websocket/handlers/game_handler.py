from fastapi import websockets
import datetime
from typing import Any
from fastapi import WebSocket
from pydantic import BaseModel, Field
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import create_async_engine

from mlops_serious_game.config import settings
from mlops_serious_game.domain.Challenge import Challenge
from mlops_serious_game.domain.briefing_factory import BriefingFactory
from mlops_serious_game.domain.metric_factory import MetricFactory
from mlops_serious_game.domain.question_factory import QuestionFactory
from mlops_serious_game.domain.stakeholder_factory import StakeholderFactory
from mlops_serious_game.domain.phase_factory import PhaseFactory
from mlops_serious_game.application.intel_dossier import clear_intel_items_for_user
from mlops_serious_game.infrastructure.database import (
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
        await conn.execute(text("DELETE FROM checkpoints WHERE thread_id = :thread_id;"), {"thread_id": thread_id})
        await conn.execute(text("DELETE FROM checkpoint_writes WHERE thread_id = :thread_id;"), {"thread_id": thread_id})
        await conn.execute(text("DELETE FROM checkpoint_blobs WHERE thread_id = :thread_id;"), {"thread_id": thread_id})


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

def get_engagement_cards() -> list[Any]:
    from mlops_serious_game.domain.engagementCardFactory import EngagementCardFactory
    return [c.model_dump() if hasattr(c, 'model_dump') else c for c in EngagementCardFactory.get_available_cards()]

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

    game_progress_index = 0
    last_gamestate_id = [0, 0, 0]
    metric_values = [MetricFactory.get_metric(m).start_value for m in MetricFactory.get_available_metrics()]
    saved_pitch_debate_messages = []
    saved_online_intel_messages = []
    saved_tokens = None
    saved_played_card_ids = []
    saved_card_targets = {}

    with get_session() as session:
        # Fetch user progression index
        results = session.scalars(
            select(GameProgression).where(GameProgression.user_name == username)
        ).all()
        for r in results:
            if r.game_progress_index > game_progress_index:
                game_progress_index = r.game_progress_index

        # Fetch latest game session state
        stmt = (
            select(GameSession)
            .where(GameSession.user_name == username)
            .order_by(GameSession.phase_index.desc(), GameSession.challenge_index.desc(), GameSession.id.desc())
        )
        latest_session = session.scalars(stmt).first()
        if latest_session:
            last_gamestate_id = [
                latest_session.phase_index,
                latest_session.challenge_index,
                latest_session.challenge_loop_index,
            ]
            if isinstance(latest_session.metric_values, list):
                metric_values = latest_session.metric_values
            if hasattr(latest_session, "pitch_debate_messages") and isinstance(latest_session.pitch_debate_messages, list):
                saved_pitch_debate_messages = latest_session.pitch_debate_messages
            if hasattr(latest_session, "online_intel_gathering_messages") and isinstance(latest_session.online_intel_gathering_messages, list):
                saved_online_intel_messages = latest_session.online_intel_gathering_messages
            saved_tokens = latest_session.attention_tokens
            if isinstance(latest_session.action_card, dict):
                saved_played_card_ids = latest_session.action_card.get("played_card_ids", [])
                saved_card_targets = latest_session.action_card.get("card_targets", {})

    #DEBUG skip intro questions
    if last_gamestate_id[0]==0 and last_gamestate_id[1]==0 and game_progress_index==2:
        last_gamestate_id[1]=1

    await send_progress_index_payload(websocket, game_progress_index)

    if(game_progress_index==2):
        curr_challenge: Challenge = PhaseFactory.translate_challenge_index(
            challenge_index=last_gamestate_id[1],
            phase_index=last_gamestate_id[0]
        )
        if saved_tokens is None:
            saved_tokens = curr_challenge.attention_tokens

        await manager.send_event(
            websocket=websocket,
            event="game:state_update",
            payload={
                "progressionIndex": 2,
                "type": "state",
                "phases_amount": len(PhaseFactory.get_phases()),
                "challenges_amount": (sum(len(p.challenges) for p in PhaseFactory.get_phases())),
                "phase_id": curr_challenge.phase_id,
                "challenge_id": curr_challenge.id,
                "challenge_loop_id": last_gamestate_id[2],
                "name": curr_challenge.name,
                "description": curr_challenge.description,
                "roundIntroduction": curr_challenge.roundIntroduction,
                "metric_values": metric_values,
                "pitch_debate_messages": saved_pitch_debate_messages,
                "online_intel_gathering_messages": saved_online_intel_messages,
                "attention_tokens": saved_tokens,
                "played_card_ids": saved_played_card_ids,
                "card_targets": saved_card_targets,
                "engagement_cards": get_engagement_cards(),
            }
        )

    return (last_gamestate_id[0], last_gamestate_id[1], last_gamestate_id[2])


async def send_progress_index_payload(
    websocket: WebSocket,
    index: int,
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

    if game_progress_index == 2:
        last_gamestate_id = payload.get("last_gamestate_id", [0, 0, 0])
        #DEBUG skip intro questions
        if last_gamestate_id[0] == 0 and last_gamestate_id[1] == 0:
            last_gamestate_id[1] = 1
            
        initial_metric_values = payload.get("initial_metric_values", [MetricFactory.get_metric(m).start_value for m in MetricFactory.get_available_metrics()])
        curr_challenge: Challenge = PhaseFactory.translate_challenge_index(
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
                    "challenge_loop_id": last_gamestate_id[2] if len(last_gamestate_id) > 2 else 0,
                    "name": curr_challenge.name,
                    "description": curr_challenge.description,
                    "roundIntroduction": curr_challenge.roundIntroduction,
                    "metric_values": initial_metric_values,
                    "attention_tokens": curr_challenge.attention_tokens,
                    "engagement_cards": get_engagement_cards(),
                }
            )
    else:
        await send_progress_index_payload(websocket, game_progress_index)



async def store_or_update_challenge(
    challenge: Challenge,
    challenge_loop_id: int,
    action_card: dict,
    metric_values: list[int],
    messages: list[str],
    username: str,
    attention_tokens: int,
) -> None:
    if challenge_loop_id == 0:
        with get_session() as session:
            session.add(
                GameSession(
                    user_name=username,
                    phase_index=challenge.phase_id,
                    challenge_index=challenge.id,
                    challenge_loop_index=challenge_loop_id,
                    action_card=action_card,
                    metric_values=metric_values,
                    time_stamp=datetime.datetime.utcnow(),
                    pitch_debate_messages=[],
                    online_intel_gathering_messages=[],
                    attention_tokens=attention_tokens,
                )
            )
    else:
        with get_session() as session:
            stmt = select(GameSession).where(
                GameSession.user_name == username,
                GameSession.phase_index == challenge.phase_id,
                GameSession.challenge_index == challenge.id
            ).order_by(GameSession.id.desc())
            
            existing = session.scalars(stmt).first()
            if existing:
                existing.challenge_loop_index = challenge_loop_id
                existing.action_card = action_card
                existing.metric_values = metric_values
                if challenge_loop_id == 2:
                    existing.pitch_debate_messages = messages
                elif challenge_loop_id == 3 and messages:
                    existing.pitch_debate_messages = messages
                existing.attention_tokens = attention_tokens
                existing.time_stamp = datetime.datetime.utcnow()
            else:
                session.add(
                    GameSession(
                        user_name=username,
                        phase_index=challenge.phase_id,
                        challenge_index=challenge.id,
                        challenge_loop_index=challenge_loop_id,
                        action_card=action_card,
                        metric_values=metric_values,
                        time_stamp=datetime.datetime.utcnow(),
                        pitch_debate_messages=messages if challenge_loop_id in (2, 3) else [],
                        online_intel_gathering_messages=messages if challenge_loop_id == 1 else [],
                        attention_tokens=attention_tokens,
                    )
                )

async def handle_state_update_request(
    websocket: WebSocket,
    username: str,
    payload: dict,
) -> tuple[int, int, int]:
    try:
        phase_id = payload.get("phase_id", 0)
        challenge_id = payload.get("challenge_id", 0)
        challenge_loop_index = payload.get("challenge_loop_index", 0)
        metric_values = payload.get("metric_values", [])
        action_card = payload.get("action_card", {})
        messages = payload.get("messages", [])
        attention_tokens = payload.get("attention_tokens")
        
        #challenge loop index 0 - offline intel gathering
        #challenge loop index 1 - online intel gathering
        #challenge loop inde: 2 - pitch debate
        #challenge loop index 3 - simulation
        challenge_loop_index+=1
        match challenge_loop_index:
            case 1 | 2 | 3:
                challenge: Challenge = PhaseFactory.translate_challenge_index(
                    challenge_index=challenge_id,
                    phase_index=phase_id
                )
                if attention_tokens is None and challenge:
                    attention_tokens = challenge.attention_tokens
            case _:
                # next challenge / round completion (after simulation phase)
                await clear_intel_items_for_user(websocket)
                challenge: Challenge = PhaseFactory.translate_challenge_index(
                    challenge_index=challenge_id+1,
                    phase_index=phase_id
                )

                if challenge is None:
                    await manager.send_event(
                        websocket=websocket,
                        event="game:progress_change",
                        payload={"progressionIndex": 4}
                    )
                    return (phase_id,challenge_id+1,0)
                
                #calculate new metric values
                new_metric_values=[]    

                ac_changes = action_card.get("metric_changes", {}) if isinstance(action_card, dict) else {}
                
                for i, m_name in enumerate(MetricFactory.get_available_metrics()):
                    cur_val = metric_values[i] if i < len(metric_values) else 0
                    change = ac_changes.get(m_name, 0) + challenge.metric_changes.get(m_name, 0)
                    new_metric_values.append(cur_val + change)

                metric_values = new_metric_values
                challenge_loop_index = 0
                messages = []
                attention_tokens = challenge.attention_tokens
                action_card = {}

        await store_or_update_challenge(
            challenge=challenge,
            challenge_loop_id=challenge_loop_index,
            action_card=action_card,
            metric_values=metric_values,
            messages=messages,
            username=username,
            attention_tokens=attention_tokens,
        )

        await manager.send_event(
            websocket=websocket,
            event="game:state_update",
            payload={
                "progressionIndex": 2,
                "type": "state",
                "phases_amount": len(PhaseFactory.get_phases()),
                "challenges_amount": len(PhaseFactory.get_phases()[challenge.phase_id].challenges),
                "phase_id": challenge.phase_id,
                "challenge_id": challenge.id,
                "challenge_loop_id": challenge_loop_index,
                "name": challenge.name,
                "description": challenge.description,
                "roundIntroduction": challenge.roundIntroduction,
                "metric_values": metric_values,
                "messages": messages,
                "attention_tokens": attention_tokens,
                "played_card_ids": action_card.get("played_card_ids", []) if isinstance(action_card, dict) else [],
                "card_targets": action_card.get("card_targets", {}) if isinstance(action_card, dict) else {},
                "engagement_cards": get_engagement_cards(),
            }
        )
    
        return (challenge.phase_id, challenge.id, challenge_loop_index)
    except Exception as e:
        print(f"[GameStateHandler Error] {e}")
        await manager.send_error(websocket, str(e))
        return (0, 0, 0)
