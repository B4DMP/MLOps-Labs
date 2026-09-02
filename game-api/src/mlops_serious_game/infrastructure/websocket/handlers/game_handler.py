import asyncio
import datetime
from typing import Any, Optional
from fastapi import WebSocket
from pydantic import BaseModel, Field
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import create_async_engine

from mlops_serious_game.config import settings
from mlops_serious_game.domain.Challenge import Challenge
from mlops_serious_game.domain.emotion_factory import EmotionConfig, EmotionFactory
from mlops_serious_game.domain.briefing_factory import BriefingFactory
from mlops_serious_game.domain.metric_factory import MetricFactory
from mlops_serious_game.domain.question_factory import QuestionFactory
from mlops_serious_game.domain.stakeholder_factory import StakeholderFactory
from mlops_serious_game.domain.phase_factory import PhaseFactory
from mlops_serious_game.domain.requirement import StakeholderIntelItem
from mlops_serious_game.domain.requirement_factory import RequirementFactory
from mlops_serious_game.application.intel_handler import (
    clear_intel_items_for_user,
    get_default_stakeholder_archetypes,
)
from mlops_serious_game.application.dialogue_options_service import (
    DialogueOption,
    generate_dialogue_options,
)
from mlops_serious_game.infrastructure.database import (
    GameProgression,
    GameChallenge,
    GameSession,
    IntelItem,
    async_engine,
    get_session,
)
from sqlalchemy.orm.attributes import flag_modified

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
    return [
        {
            "id": p.id,
            "phase_name": p.name,
            "phase_desc": p.description,
            "phase_introduction": p.phase_introduction,
            "stakeholder_power_interest": [
                {
                    "stakeholder_id": ps.stakeholder_id,
                    "power": ps.power,
                    "interest": ps.interest,
                }
                for ps in p.stakeholders
            ],
        }
        for p in PhaseFactory.get_phases()
    ]


def get_emotion_colors() -> dict[str, str]:
    return EmotionFactory.get_emotion_colors()


def get_engagement_cards() -> list[Any]:
    from mlops_serious_game.domain.engagementCardFactory import EngagementCardFactory
    return [c.model_dump() if hasattr(c, 'model_dump') else c for c in EngagementCardFactory.get_available_cards()]



def get_or_create_game_session(player: str, db_session=None) -> GameSession:
    """Retrieves or creates a GameSession record for a given player."""
    def _init_in_session(s):
        stmt = select(GameSession).where(GameSession.player == player)
        session_rec = s.scalars(stmt).first()
        if not session_rec:
            st_archs = get_default_stakeholder_archetypes()
            session_rec = GameSession(player=player, stakeholder_archetypes=st_archs)
            s.add(session_rec)
            s.commit()
        else:
            archs = dict(session_rec.stakeholder_archetypes or {})
            updated_archs = get_default_stakeholder_archetypes(archs)
            if updated_archs != archs:
                session_rec.stakeholder_archetypes = updated_archs
                flag_modified(session_rec, "stakeholder_archetypes")
                s.commit()
        return session_rec

    if db_session is not None:
        return _init_in_session(db_session)
    with get_session() as s:
        return _init_in_session(s)


def get_discovered_intel_items(
    username: str,
    challenge: Challenge,
) -> list[StakeholderIntelItem]:
    """Returns the classified intel items that were discovered by a given player in a given challenge."""
    intel_items: list[StakeholderIntelItem] = []

    with get_session() as session:
        records = session.scalars(
            select(IntelItem).where(IntelItem.user_name == username)
        ).all()

        for record in records:
            data = record.intel_item_data
            if isinstance(data, dict):
                try:
                    item = StakeholderIntelItem(**data)
                except Exception:
                    item = StakeholderIntelItem(
                        id=str(data.get("id", "")),
                        requirement_id=str(data.get("requirement_id", "")),
                        intel_type=data.get("intel_type", "unconfirmed"),
                        categorized_type=data.get("categorized_type", "requirement"),
                        description=data.get("description", ""),
                    )
                req = RequirementFactory.get_requirement(item.requirement_id)
                if req and req.challenge_id == challenge.id:
                    if not item.description:
                        item.description = req.description
                    intel_items.append(item)
                elif not req and str(data.get("challenge_id", "")) == str(challenge.id):
                    intel_items.append(item)

    return intel_items


async def get_dialogue_options(
    challenge: Challenge,
    discovered_intel_items: Optional[list[StakeholderIntelItem]] = None,
    messages: Optional[list[Any]] = None,
    username: Optional[str] = None,
    session_id: Optional[str] = None,
) -> list[dict[str, Any]]:
    """Builds the dialogue options LangGraph workflow and generates serialized dialogue options."""
    if discovered_intel_items is None and username:
        discovered_intel_items = get_discovered_intel_items(username=username, challenge=challenge)

    options, _ = await generate_dialogue_options(
        messages=messages or [],
        challenge=challenge.description,
        discovered_intel_items=discovered_intel_items or [],
        session_id=session_id,
    )
    return [opt.model_dump() for opt in options]


async def handle_game_init(
    websocket: WebSocket,
    username: str,
    payload: dict
) -> tuple[int, int]| dict[str, str]:
    # Send init static configurations
    await manager.send_event(
        websocket=websocket,
        event="game:init_data",
        payload={
            "type": "init",
            "metrics": get_metrics(),
            "stakeholders": get_stakeholders(),
            "phases": get_phases(),
            "emotion_colors": get_emotion_colors(),
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
    saved_action_card = {}
    emotion_values_dict = {
        st.id: EmotionFactory.create_default_emotion_values()
        for st in StakeholderFactory.stakeholders
    }

    with get_session() as session:
        # Initialize or retrieve persistent player GameSession
        get_or_create_game_session(username, session)

        # Fetch user progression index
        results = session.scalars(
            select(GameProgression).where(GameProgression.user_name == username)
        ).all()
        for r in results:
            if r.game_progress_index > game_progress_index:
                game_progress_index = r.game_progress_index

        # Fetch latest game challenge state
        stmt = (
            select(GameChallenge)
            .where(GameChallenge.user_name == username)
            .order_by(GameChallenge.id.desc())
        )
        latest_session = session.scalars(stmt).first()
        if latest_session:
            last_gamestate_id = [
                latest_session.phase_index,
                latest_session.challenge_index,
                latest_session.challenge_loop_index,
            ]
            if isinstance(latest_session.emotion_values, dict) and latest_session.emotion_values:
                emotion_values_dict = latest_session.emotion_values
            else:
                stmt_ev = (
                    select(GameChallenge)
                    .where(GameChallenge.user_name == username, GameChallenge.emotion_values.isnot(None))
                    .order_by(GameChallenge.id.desc())
                )
                session_with_ev = session.scalars(stmt_ev).first()
                if session_with_ev and isinstance(session_with_ev.emotion_values, dict):
                    emotion_values_dict = session_with_ev.emotion_values
            if isinstance(latest_session.metric_values, list):
                metric_values = latest_session.metric_values
            if hasattr(latest_session, "pitch_debate_messages") and isinstance(latest_session.pitch_debate_messages, list):
                saved_pitch_debate_messages = latest_session.pitch_debate_messages
            if hasattr(latest_session, "online_intel_gathering_messages") and isinstance(latest_session.online_intel_gathering_messages, list):
                saved_online_intel_messages = latest_session.online_intel_gathering_messages
            saved_tokens = latest_session.attention_tokens
            if isinstance(latest_session.action_card, dict):
                saved_action_card = latest_session.action_card
                saved_played_card_ids = latest_session.action_card.get("played_card_ids", [])
                saved_card_targets = latest_session.action_card.get("card_targets", {})
        else:
            #  DEBUG: Skip intro questions / challenge for fresh game sessions
            if last_gamestate_id[0] == 0 and last_gamestate_id[1] == 0 and game_progress_index == 2:
                last_gamestate_id[1] = 1

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
                "action_card": saved_action_card,
                "played_card_ids": saved_played_card_ids,
                "card_targets": saved_card_targets,
                "engagement_cards": get_engagement_cards(),
                "challenge_stakeholders": [
                    {
                        "stakeholder_id": ps.stakeholder_id,
                        "power": ps.power,
                        "interest": ps.interest,
                    }
                    for ps in PhaseFactory.get_phases()[curr_challenge.phase_id].stakeholders
                ],
                "facial_expressions": EmotionFactory.get_facial_expressions_dict(emotion_values_dict),
                "convincer_archetypes": EmotionFactory.get_convincer_archetypes_dict(),
                **({
                    "dialogue_options": await get_dialogue_options(
                        challenge=curr_challenge,
                        messages=saved_pitch_debate_messages,
                        username=username,
                    )
                } if last_gamestate_id[2] == 2 else {}),
            }
        )

    return (last_gamestate_id[0], last_gamestate_id[1], last_gamestate_id[2]), emotion_values_dict


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
                    "convincer_archetypes": EmotionFactory.get_convincer_archetypes_dict(),
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
    with get_session() as session:
        # Carry forward latest persisted emotion_values from user's history
        stmt_ev = (
            select(GameChallenge)
            .where(GameChallenge.user_name == username, GameChallenge.emotion_values.isnot(None))
            .order_by(GameChallenge.id.desc())
        )
        prev_session_ev = session.scalars(stmt_ev).first()
        carried_emotion_values = prev_session_ev.emotion_values if prev_session_ev else None

        if challenge_loop_id == 0:
            session.add(
                GameChallenge(
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
                    emotion_values=carried_emotion_values,
                )
            )
        else:
            stmt = select(GameChallenge).where(
                GameChallenge.user_name == username,
                GameChallenge.phase_index == challenge.phase_id,
                GameChallenge.challenge_index == challenge.id
            ).order_by(GameChallenge.id.desc())
            
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
                if not existing.emotion_values and carried_emotion_values:
                    existing.emotion_values = carried_emotion_values
            else:
                session.add(
                    GameChallenge(
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
                        emotion_values=carried_emotion_values,
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
                if challenge_loop_index == 2:
                    messages = [{"id": "", "message": "Welcome to the meeting everybody", "ac_id": -1}]
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

        ev_dict = {
            st.id: EmotionFactory.create_default_emotion_values()
            for st in StakeholderFactory.stakeholders
        }
        with get_session() as session:
            stmt = (
                select(GameChallenge)
                .where(GameChallenge.user_name == username, GameChallenge.emotion_values.isnot(None))
                .order_by(GameChallenge.id.desc())
            )
            latest = session.scalars(stmt).first()
            if latest and isinstance(latest.emotion_values, dict) and latest.emotion_values:
                ev_dict = latest.emotion_values

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
                "pitch_debate_messages": messages if challenge_loop_index == 2 else [],
                "messages": messages,
                "attention_tokens": attention_tokens,
                "action_card": action_card,
                "played_card_ids": action_card.get("played_card_ids", []) if isinstance(action_card, dict) else [],
                "card_targets": action_card.get("card_targets", {}) if isinstance(action_card, dict) else {},
                "engagement_cards": get_engagement_cards(),
                "challenge_stakeholders": [
                    {
                        "stakeholder_id": ps.stakeholder_id,
                        "power": ps.power,
                        "interest": ps.interest,
                    }
                    for ps in PhaseFactory.get_phases()[challenge.phase_id].stakeholders
                ],
                "facial_expressions": EmotionFactory.get_facial_expressions_dict(ev_dict),
                "convincer_archetypes": EmotionFactory.get_convincer_archetypes_dict(),
            }
        )

        if challenge_loop_index == 2:
            from mlops_serious_game.infrastructure.websocket.handlers.chat_handler import (
                handle_chat_message,
            )

            chat_payload = {
                "session_id": f"MLOps_Convo_{username}",
                "challenge": challenge.name + ": " + challenge.roundIntroduction + challenge.description,
                "phase_id": challenge.phase_id,
                "challenge_id": challenge.id,
                "initial_start": True,
            }
            asyncio.create_task(
                handle_chat_message(
                    websocket=websocket,
                    username=username,
                    payload=chat_payload,
                )
            )

        return (challenge.phase_id, challenge.id, challenge_loop_index)
    except Exception as e:
        print(f"[GameStateHandler Error] {e}")
        await manager.send_error(websocket, str(e))
        return (0, 0, 0)
