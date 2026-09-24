import asyncio
import datetime
from typing import Any, Optional
from fastapi import WebSocket
from pydantic import BaseModel, Field
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import create_async_engine

from mlops_serious_game.config import settings
from mlops_serious_game.domain.Challenge import Challenge
from mlops_serious_game.domain.persona_resolver import personalize
from mlops_serious_game.domain.emotion_factory import EmotionConfig, EmotionFactory
from mlops_serious_game.domain.briefing_factory import BriefingFactory
from mlops_serious_game.domain.metric_factory import MetricFactory
from mlops_serious_game.domain.question_factory import QuestionFactory
from mlops_serious_game.domain.stakeholder_factory import StakeholderFactory
from mlops_serious_game.domain.phase_factory import PhaseFactory
from mlops_serious_game.domain.requirement import IntelSource, StakeholderIntelItem
from mlops_serious_game.domain.requirement_factory import RequirementFactory
from mlops_serious_game.application.graph_service import store as graph_store
from mlops_serious_game.application.graph_service.scheduler import next_challenge
from mlops_serious_game.application.graph_service.view import evaluate_graph
from mlops_serious_game.domain.graph_factory import GraphFactory
from mlops_serious_game.application.intel_handler import (
    intel_rows,
    observe_tagged_facts,
    load_known_intel_items_for_challenge,
    determine_dialogue_options,
)
from mlops_serious_game.application.services import user_settings_service
from mlops_serious_game.infrastructure.websocket.handlers.log_handler import send_events
from mlops_serious_game.application.pitch_debate_service import (
    DialogueOption,
    get_checkpoint_dialogue_options,
    save_checkpoint_dialogue_options,
)
from mlops_serious_game.application.results_service.service import results_for as get_gate7_results
from mlops_serious_game.infrastructure.database.run_scope import current_run_index, run_chain
from mlops_serious_game.infrastructure.database import (
    Campaign,
    User,
    GameProgression,
    GameChallenge,
    GameSession,
    IntelItem,
    async_engine,
    get_session,
    get_user_id,
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
        for table in ["checkpoints", "checkpoint_writes", "checkpoint_blobs"]:
            table_check = await conn.execute(text(f"SELECT to_regclass('{table}');"))
            if table_check.scalar() is not None:
                await conn.execute(
                    text(f"DELETE FROM {table} WHERE thread_id = :thread_id;"),
                    {"thread_id": thread_id},
                )


def get_metrics() -> dict[str, Any]:
    metrics_list = [MetricFactory.get_metric(m) for m in MetricFactory.get_available_metrics()]
    return {m.id: (m.model_dump() if hasattr(m, 'model_dump') else m) for m in metrics_list}


def get_stakeholders() -> dict[str, Any]:
    """The cast as the current player sees it: their persona names and looks."""
    return {
        s.id: s.model_dump(exclude={"personas"})
        for s in StakeholderFactory.get_all_stakeholders()
    }


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
            "challenges_per_phase": p.challenges_per_phase,
            "challenge_quota": p.challenge_quota,
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
    """Retrieves or creates a GameSession record for a given player's current run.

    One row per run, not per player: escalation points and grudges are per playthrough, so a new
    game gets its own. Personas are not - they are who this player's colleagues are - so a run
    after the first inherits the draw rather than recasting the cast mid-campaign.
    """
    from mlops_serious_game.application.persona_service import sync_personas

    def _init_in_session(s):
        user_id = get_user_id(s, player)
        run_index = current_run_index(s, user_id)
        stmt = (
            select(GameSession)
            .where(GameSession.user_id == user_id, GameSession.run_index == run_index)
            .order_by(GameSession.id.desc())
        )
        session_rec = s.scalars(stmt).first()
        if not session_rec:
            previous = s.scalars(
                select(GameSession)
                .where(GameSession.user_id == user_id)
                .order_by(GameSession.id.desc())
            ).first()
            personas = (
                dict(previous.stakeholder_personas)
                if previous and previous.stakeholder_personas
                else StakeholderFactory.choose_personas(player)
            )
            session_rec = GameSession(
                player=player,
                user_id=user_id,
                run_index=run_index,
                stakeholder_personas=personas,
            )
            s.add(session_rec)
            s.commit()
        else:
            sync_personas(player, session_rec)
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
        user_id = get_user_id(session, username)
        records = intel_rows(session, user_id)

        for record in records:
            data = record.intel_item_data
            if isinstance(data, dict):
                item_id = data.get("id")
                req = RequirementFactory.get_requirement(item_id)
                if req and req.challenge_id == challenge.id:
                    item = StakeholderIntelItem.from_requirement(
                        req,
                        intel_type=data.get("intel_type", "unconfirmed"),
                        categorized_type=data.get("categorized_type", req.type),
                        categorized_description=data.get("categorized_description", ""),
                        # The requirement text is config-owned and looked up by id, so
                        # take it from the config rather than the stored copy. That copy
                        # holds whichever names were rendered when the row was written.
                        description=req.description,
                        # Provenance is the player's, not the config's: it says how they came
                        # by the item, so it has to survive this rebuild.
                        source=data.get("source") or (
                            IntelSource.PUBLIC_RECORD
                            if data.get("is_public_record")
                            else IntelSource.OFFLINE_ARTIFACT
                        ),
                    )
                    intel_items.append(item)

    return intel_items


async def get_dialogue_options(
    challenge: Challenge,
    discovered_intel_items: Optional[list[StakeholderIntelItem]] = None,
    messages: Optional[list[Any]] = None,
    username: Optional[str] = None,
    session_id: Optional[str] = None,
) -> list[dict[str, Any]]:
    """Determines dialogue options outside of LangGraph and returns serialized options.
    If dialogue options are already saved in the LangGraph checkpoint for this thread, returns those.
    Otherwise, generates new options and persists them into the checkpoint.
    """
    if session_id:
        thread_id = session_id
    elif username:
        # Keyed by user_id, not username - see D-user-id in
        # docs/plans/session-persistence-and-url-routing.md.
        with get_session() as dialogue_session:
            dialogue_user_id = get_user_id(dialogue_session, username)
        thread_id = f"MLOps_Convo_{dialogue_user_id}"
    else:
        thread_id = None
    if thread_id:
        existing_options = await get_checkpoint_dialogue_options(thread_id)
        if existing_options:
            return [
                opt.model_dump(exclude={"text"}, exclude_none=True)
                if hasattr(opt, "model_dump")
                else opt
                for opt in existing_options
            ]

    if discovered_intel_items is None and username:
        discovered_intel_items = get_discovered_intel_items(username=username, challenge=challenge)

    options = determine_dialogue_options(discovered_intel_items=discovered_intel_items or [])

    if thread_id:
        await save_checkpoint_dialogue_options(thread_id, options)

    return [opt.model_dump(exclude={"text"}, exclude_none=True) for opt in options]


def inherited_state(username: str) -> tuple[list, dict]:
    """The gauges and the room a run inherits from the run it continues.

    Empty for a fresh start, which has no ancestors. Read from the last challenge an ancestor
    played, whose `metric_values` were finalised when that challenge ended.
    """
    with get_session() as session:
        user_id = get_user_id(session, username)
        ancestors = run_chain(session, user_id)[1:]
        if not ancestors:
            return [], {}
        last = session.scalars(
            select(GameChallenge)
            .where(GameChallenge.user_id == user_id, GameChallenge.run_index.in_(ancestors))
            .order_by(GameChallenge.id.desc())
        ).first()
        if last is None:
            return [], {}
        metrics = list(last.metric_values) if isinstance(last.metric_values, list) else []
        emotions = dict(last.emotion_values) if isinstance(last.emotion_values, dict) else {}
        return metrics, emotions


NEW_RUN_MODES = ("fresh", "spiral")


async def handle_new_run(websocket: WebSocket, username: str, payload: dict) -> None:
    """Starts another playthrough (docs/plans/results-screen.md, D1/D4/D11).

    Two modes, and the only difference is one column. `fresh` opens a clean run; `spiral` opens one
    that continues the run just finished, so the player returns to requirements carrying the
    system they built, with its maturity, debt and anti-patterns intact.

    **Nothing is deleted, in either mode.** A new run is an insert: the finished run keeps every
    row it wrote, because the results screen and the admin aggregates read that history.

    Refused unless the campaign allows replay and the current run is actually finished, so a crafted
    frame cannot restart someone mid-game or get past a research campaign's one-run rule.
    """
    mode = payload.get("mode")
    if mode not in NEW_RUN_MODES:
        await manager.send_error(websocket, "mode must be 'fresh' or 'spiral'.", code="BAD_MODE")
        return

    with get_session() as session:
        user = session.scalar(select(User).where(User.user_name == username))
        campaign = session.scalar(select(Campaign).where(Campaign.id == user.campaign_id)) if user else None
        if user is None or campaign is None or not campaign.allow_replay:
            await manager.send_error(websocket, "This campaign does not allow a new game.", code="REPLAY_DISABLED")
            return

        user_id = user.id
        run = current_run_index(session, user_id)
        finished = session.scalar(
            select(func.count(GameProgression.id)).where(
                GameProgression.user_id == user_id,
                GameProgression.run_index == run,
                GameProgression.game_progress_index == 4,
            )
        )
        if not finished:
            await manager.send_error(websocket, "Finish this game before starting another.", code="RUN_NOT_FINISHED")
            return

        if mode == "spiral":
            gate7 = get_gate7_results(username, run, refresh=True)["gate7"]
            if "spiral" not in gate7["allowed_modes"]:
                await manager.send_error(
                    websocket,
                    f"Gate 7 called {gate7['name']} ({gate7['code']}) on this run - only a fresh "
                    "start is available.",
                    code="GATE7_BLOCKED",
                )
                return

        previous = session.scalars(
            select(GameSession)
            .where(GameSession.user_id == user_id, GameSession.run_index == run)
            .order_by(GameSession.id.desc())
        ).first()

        new_run = run + 1
        session.add(
            GameProgression(
                user_name=username,
                user_id=user_id,
                run_index=new_run,
                seeded_from_run=run if mode == "spiral" else None,
                # Straight into play: the intro questionnaire is not asked again (its answers are
                # the baseline the whole before/after series is measured from) and the player has
                # already had the briefing.
                game_progress_index=2,
                time_stamp=datetime.datetime.utcnow(),
                additional_data=[],
            )
        )
        # One session row per run. Personas carry over so the cast is not recast mid-campaign;
        # escalation starts fresh (D15's three points are per game). Grudges are what a next
        # iteration carries: neglected stakeholders remember, and a new cycle does not wipe that.
        session.add(
            GameSession(
                player=username,
                user_id=user_id,
                run_index=new_run,
                stakeholder_personas=dict(previous.stakeholder_personas) if previous and previous.stakeholder_personas else {},
                grudges=list(previous.grudges) if previous and mode == "spiral" and previous.grudges else [],
            )
        )

    await manager.send_event(
        websocket=websocket,
        event="game:new_run_started",
        payload={"run_index": new_run, "mode": mode},
    )


async def handle_game_init(
    websocket: WebSocket,
    username: str,
    payload: dict
) -> tuple[int, int]| dict[str, str]:
    # Check campaign questionnaire preference
    use_questionnaire = True
    with get_session() as session:
        user = session.scalar(select(User).where(User.user_name == username))
        if user:
            camp = session.scalar(select(Campaign).where(Campaign.id == user.campaign_id))
            if camp is not None:
                use_questionnaire = camp.use_questionnaire

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
            "use_questionnaire": use_questionnaire,
            "settings": {
                **user_settings_service.get_settings(username),
                "can_reset_account": settings.ENABLE_RESET_USER,
                "can_playtest": settings.ENABLE_PLAYTEST_TOOLS,
            },
        }
    )

    game_progress_index = 0
    last_gamestate_id = [0, 0, 0]
    metric_values = [MetricFactory.get_metric(m).start_value for m in MetricFactory.get_available_metrics()]
    saved_messages = []
    saved_tokens = None
    saved_played_engagement_card_ids = []
    saved_engagement_card_targets = {}
    saved_action_card = {}
    emotion_values_dict = {
        st.id: EmotionFactory.create_default_emotion_values()
        for st in StakeholderFactory.stakeholders
    }

    with get_session() as session:
        user_id = get_user_id(session, username)

        # Initialize or retrieve persistent player GameSession
        get_or_create_game_session(username, session)

        # Fetch user progression index. This run only: the maximum across every run would read a
        # finished first game (index 4) as the new one's position and send a replaying player
        # straight back to the results screen.
        results = session.scalars(
            select(GameProgression).where(
                GameProgression.user_id == user_id,
                GameProgression.run_index == current_run_index(session, user_id),
            )
        ).all()
        for r in results:
            if r.game_progress_index > game_progress_index:
                game_progress_index = r.game_progress_index

        # If campaign disables questionnaire, skip intro or outro questionnaires
        if not use_questionnaire:
            if game_progress_index == 0:
                game_progress_index = 1
                session.add(
                    GameProgression(
                        user_name=username,
                        user_id=user_id,
                        run_index=current_run_index(session, user_id),
                        game_progress_index=1,
                        time_stamp=datetime.datetime.utcnow(),
                        additional_data=[]
                    )
                )
            elif game_progress_index == 3:
                game_progress_index = 4
                session.add(
                    GameProgression(
                        user_name=username,
                        user_id=user_id,
                        run_index=current_run_index(session, user_id),
                        game_progress_index=4,
                        time_stamp=datetime.datetime.utcnow(),
                        additional_data=[]
                    )
                )

        # Fetch latest game challenge state. Scoped to this run: on a new game the player has
        # no challenge row yet, and the previous run's last one would resume them mid-campaign.
        run_index = current_run_index(session, user_id)
        stmt = (
            select(GameChallenge)
            .where(GameChallenge.user_id == user_id, GameChallenge.run_index == run_index)
            .order_by(GameChallenge.id.desc())
        )
        latest_session = session.scalars(stmt).first()
        if latest_session is not None:
            last_gamestate_id[0] = latest_session.phase_index
            last_gamestate_id[1] = latest_session.challenge_index
            last_gamestate_id[2] = latest_session.challenge_loop_index
            if latest_session.emotion_values and isinstance(latest_session.emotion_values, dict):
                emotion_values_dict = latest_session.emotion_values
            else:
                stmt_ev = (
                    select(GameChallenge)
                    .where(
                        GameChallenge.user_id == user_id,
                        GameChallenge.run_index == run_index,
                        GameChallenge.emotion_values.isnot(None),
                    )
                    .order_by(GameChallenge.id.desc())
                )
                session_with_ev = session.scalars(stmt_ev).first()
                if session_with_ev and isinstance(session_with_ev.emotion_values, dict):
                    emotion_values_dict = session_with_ev.emotion_values
            if isinstance(latest_session.metric_values, list):
                metric_values = latest_session.metric_values
            if hasattr(latest_session, "messages") and isinstance(latest_session.messages, list):
                saved_messages = latest_session.messages
            saved_tokens = latest_session.attention_tokens
            if isinstance(latest_session.action_card, dict):
                saved_action_card = latest_session.action_card
                saved_played_engagement_card_ids = latest_session.action_card.get("played_engagement_card_ids", [])
                saved_engagement_card_targets = latest_session.action_card.get("engagement_card_targets", {})
            if not saved_action_card.get("title"):
                stmt_ac = (
                    select(GameChallenge)
                    .where(
                        GameChallenge.user_id == user_id,
                        GameChallenge.phase_index == latest_session.phase_index,
                        GameChallenge.challenge_index == latest_session.challenge_index,
                    )
                    .order_by(GameChallenge.id.desc())
                )
                for rec in session.scalars(stmt_ac).all():
                    if isinstance(rec.action_card, dict) and rec.action_card.get("title"):
                        saved_action_card = {**rec.action_card, "played_engagement_card_ids": saved_played_engagement_card_ids, "engagement_card_targets": saved_engagement_card_targets}
                        break

    await send_progress_index_payload(websocket, game_progress_index)

    if(game_progress_index==2):
        if latest_session is None:
            # A next iteration starts from what the last run left: the gauges where they ended and
            # the room as it was. A fresh start has no ancestors, so this changes nothing for it.
            inherited_metrics, inherited_emotions = inherited_state(username)
            if inherited_metrics:
                metric_values = inherited_metrics
            if inherited_emotions:
                emotion_values_dict = inherited_emotions
            # No challenge recorded yet for this run: deal one through the same scheduler
            # every later challenge goes through, so retired/legacy templates are never dealt here.
            curr_challenge: Challenge = select_first_challenge(username)
            await store_or_update_challenge(
                challenge=curr_challenge,
                challenge_loop_id=0,
                action_card={},
                metric_values=metric_values,
                messages=[],
                username=username,
                attention_tokens=curr_challenge.attention_tokens,
            )
            saved_tokens = curr_challenge.attention_tokens
        else:
            curr_challenge: Challenge = PhaseFactory.translate_challenge_index(
                challenge_index=last_gamestate_id[1],
                phase_index=last_gamestate_id[0]
            )
        # The graph ships dark for now: a failure here must never block the game.
        try:
            graph_store.enter_challenge(username, curr_challenge)
        except Exception as e:
            print(f"[Graph seed error] {e}")
        if saved_tokens is None:
            saved_tokens = curr_challenge.attention_tokens

        await manager.send_event(
            websocket=websocket,
            event="game:state_update",
            payload={
                "progressionIndex": 2,
                "type": "state",
                "phases_amount": len(PhaseFactory.get_phases()),
                "challenges_amount": PhaseFactory.get_phases()[curr_challenge.phase_id].challenge_quota,
                "phase_id": curr_challenge.phase_id,
                "challenge_id": curr_challenge.id,
                "challenge_loop_id": last_gamestate_id[2],
                "name": curr_challenge.name,
                "description": curr_challenge.description,
                "roundIntroduction": curr_challenge.roundIntroduction,
                "metric_values": metric_values,
                "messages": saved_messages,
                "attention_tokens": saved_tokens,
                "action_card": saved_action_card,
                "played_engagement_card_ids": saved_played_engagement_card_ids,
                "engagement_card_targets": saved_engagement_card_targets,
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
                "emotional_states": EmotionFactory.get_emotion_states_dict(emotion_values_dict),
                "emotion_dimensions": EmotionFactory.get_emotion_dimensions_dict(emotion_values_dict),
                "emotion_values": emotion_values_dict,
                **({
                    "dialogue_options": await get_dialogue_options(
                        challenge=curr_challenge,
                        messages=saved_messages,
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

    use_q = True
    with get_session() as session:
        user = session.scalar(select(User).where(User.user_name == username))
        if user:
            camp = session.scalar(select(Campaign).where(Campaign.id == user.campaign_id))
            if camp is not None:
                use_q = camp.use_questionnaire

    if not use_q:
        if game_progress_index == 0:
            game_progress_index = 1
        elif game_progress_index == 3:
            game_progress_index = 4

    # Store in PostgreSQL via SQLAlchemy
    with get_session() as session:
        progress_user_id = get_user_id(session, username)
        session.add(
            GameProgression(
                user_name=username,
                user_id=progress_user_id,
                run_index=current_run_index(session, progress_user_id),
                game_progress_index=game_progress_index,
                time_stamp=datetime.datetime.utcnow(),
                additional_data=additional_data
            )
        )

    if game_progress_index == 2:
        last_gamestate_id = payload.get("last_gamestate_id", [0, 0, 0])
        is_fresh_start = last_gamestate_id[0] == 0 and last_gamestate_id[1] == 0

        initial_metric_values = payload.get("initial_metric_values", [MetricFactory.get_metric(m).start_value for m in MetricFactory.get_available_metrics()])
        if is_fresh_start:
            # A brand-new player has no challenge yet: deal one through the same scheduler
            # every later challenge goes through, so retired/legacy templates are skipped here too.
            curr_challenge: Challenge = select_first_challenge(username)
        else:
            curr_challenge: Challenge = PhaseFactory.translate_challenge_index(
                challenge_index=last_gamestate_id[1],
                phase_index=last_gamestate_id[0]
            )
        if curr_challenge:
            # Fires the challenge's on_enter_ops (e.g. "the KPI doc was deleted") so the graph
            # actually matches what its on-record Facts describe. Without this, a Fact asserting
            # the post-seed state reads as stale against a graph still sitting at its precondition
            # state. The graph ships dark for now: a failure here must never block the game.
            try:
                graph_store.enter_challenge(username, curr_challenge)
            except Exception as e:
                print(f"[Graph seed error] {e}")

            await manager.send_event(
                websocket=websocket,
                event="game:state_update",
                payload={
                    "progressionIndex": 2,
                    "type": "state",
                    "phases_amount": len(PhaseFactory.get_phases()),
                    "challenges_amount": PhaseFactory.get_phases()[curr_challenge.phase_id].challenge_quota,
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
    with get_session() as session:
        user_id = get_user_id(session, username)

        # Carry forward the latest persisted emotion_values along this run's chain. The chain, not
        # every run: a fresh start begins the room neutral, while a next iteration inherits how
        # the last one left it (docs/plans/results-screen.md, D11).
        stmt_ev = (
            select(GameChallenge)
            .where(
                GameChallenge.user_id == user_id,
                GameChallenge.run_index.in_(run_chain(session, user_id)),
                GameChallenge.emotion_values.isnot(None),
            )
            .order_by(GameChallenge.id.desc())
        )
        prev_session_ev = session.scalars(stmt_ev).first()
        carried_emotion_values = prev_session_ev.emotion_values if prev_session_ev else None

        stmt = select(GameChallenge).where(
            GameChallenge.user_id == user_id,
            GameChallenge.phase_index == challenge.phase_id,
            GameChallenge.challenge_index == challenge.id
        ).order_by(GameChallenge.id.desc())

        existing = session.scalars(stmt).first()

        if challenge_loop_id == 0:
            # A repeated state_update for the same challenge's very first stage (e.g. a
            # duplicate emit on reconnect) must not insert a second GameChallenge row for
            # it - that would let `handle_game_init`'s "latest row" resume logic and this
            # challenge's own row collide/duplicate for no reason.
            if existing:
                existing.action_card = action_card
                existing.metric_values = metric_values
                existing.attention_tokens = attention_tokens
                existing.time_stamp = datetime.datetime.utcnow()
                if not existing.emotion_values and carried_emotion_values:
                    existing.emotion_values = carried_emotion_values
            else:
                session.add(
                    GameChallenge(
                        user_name=username,
                        user_id=user_id,
                        run_index=current_run_index(session, user_id),
                        phase_index=challenge.phase_id,
                        challenge_index=challenge.id,
                        challenge_loop_index=challenge_loop_id,
                        action_card=action_card,
                        metric_values=metric_values,
                        time_stamp=datetime.datetime.utcnow(),
                        messages=[],
                        attention_tokens=attention_tokens,
                        emotion_values=carried_emotion_values,
                    )
                )
        else:
            if existing:
                existing.challenge_loop_index = challenge_loop_id
                merged_card = dict(existing.action_card) if isinstance(existing.action_card, dict) else {}
                if isinstance(action_card, dict):
                    merged_card.update(action_card)
                    if "pitch" not in action_card and isinstance(existing.action_card, dict) and "pitch" in existing.action_card:
                        merged_card["pitch"] = existing.action_card["pitch"]
                existing.action_card = merged_card
                flag_modified(existing, "action_card")
                existing.metric_values = metric_values
                existing.messages = messages
                existing.attention_tokens = attention_tokens
                existing.time_stamp = datetime.datetime.utcnow()
                if not existing.emotion_values and carried_emotion_values:
                    existing.emotion_values = carried_emotion_values
            else:
                session.add(
                    GameChallenge(
                        user_name=username,
                        user_id=user_id,
                        run_index=current_run_index(session, user_id),
                        phase_index=challenge.phase_id,
                        challenge_index=challenge.id,
                        challenge_loop_index=challenge_loop_id,
                        action_card=action_card,
                        metric_values=metric_values,
                        time_stamp=datetime.datetime.utcnow(),
                        messages=messages,
                        attention_tokens=attention_tokens,
                        emotion_values=carried_emotion_values,
                    )
                )

def _first_non_retired_challenge(start_phase_id: int) -> Challenge | None:
    """Last-resort safety net for the fallback paths below: `translate_challenge_index`'s
    positional lookup can land on a retired/legacy template, so when the scheduler itself
    can't run, walk the phases directly instead and skip anything retired."""
    for phase in PhaseFactory.get_phases():
        if phase.id < start_phase_id:
            continue
        for challenge in phase.challenges:
            if not challenge.retired:
                return challenge
    return None


def played_templates(username: str) -> set[str]:
    """Every challenge template this player has ever been dealt, **across all runs**.

    Deliberately not run-scoped (docs/plans/results-screen.md, D1): a new game should deal
    challenges the player has not seen, so the played set is the one thing that outlives a run.

    It is also what keeps `graph_store.has_batch`'s `enter:<template>` key unambiguous: because a
    template is never dealt twice to the same player, a per-challenge lookup can never collide
    across runs.
    """
    with get_session() as session:
        user_id = get_user_id(session, username)
        played_ids = set(
            session.scalars(
                select(GameChallenge.challenge_index).where(GameChallenge.user_id == user_id)
            ).all()
        )
    templates = set()
    for cid in played_ids:
        try:
            templates.add(PhaseFactory.get_challenge_by_id(cid).template_id)
        except ValueError:
            continue
    return templates


def select_first_challenge(username: str) -> Challenge | None:
    """Picks the first challenge of a run via the same scheduler as every later pick, so a
    retired/legacy template is never dealt just because it's challenge #1.

    The played set is read rather than assumed empty: this runs for the first challenge of a
    *second* game too, which must not re-deal something the player already worked through.

    Falls back to plain sequential order if the graph cannot be read, same as select_next_challenge.
    """
    try:
        graph = GraphFactory.get_graph()
        replayed = graph_store.load_state(username)
        ctx = evaluate_graph(graph, replayed.state).context(graph, replayed.state)
        return next_challenge(
            PhaseFactory.get_phases(),
            current_phase_id=1,
            played=played_templates(username),
            ctx=ctx,
            seed=username,
        )
    except Exception as e:
        print(f"[Challenge selection error, falling back to sequential] {e}")
        return _first_non_retired_challenge(1)


def select_next_challenge(username: str, phase_id: int, challenge_id: int) -> Challenge | None:
    """Picks the next challenge from the player's graph state. None ends the game.

    Falls back to plain sequential order if the graph cannot be read, so a graph problem
    never blocks progression.
    """
    try:
        graph = GraphFactory.get_graph()
        current = PhaseFactory.translate_challenge_index(challenge_index=challenge_id, phase_index=phase_id)
        played = played_templates(username)
        if current:
            played.add(current.template_id)
        replayed = graph_store.load_state(username)
        ctx = evaluate_graph(graph, replayed.state).context(graph, replayed.state)
        current_phase = current.phase_id if current else phase_id
        return next_challenge(PhaseFactory.get_phases(), current_phase, played, ctx, seed=username)
    except Exception as e:
        print(f"[Challenge selection error, falling back to sequential] {e}")
        return _first_non_retired_challenge(phase_id)


async def handle_state_update_request(
    websocket: WebSocket,
    username: str,
    payload: dict,
) -> tuple[int, int, int]:
    try:
        # phase_id/challenge_id come from the player's own stored progression, never the client's
        # claim (docs/plans/session-persistence-and-url-routing.md, D-server-truth): a crafted
        # payload asserting a different phase/challenge must not be able to redirect this update
        # at some other challenge's row. Only a brand-new player with no GameChallenge row at all
        # yet falls back to the payload, since there is nothing server-side to trust yet.
        #
        # challenge_loop_index is deliberately NOT overridden the same way: unlike phase/challenge
        # (pure "where"), it is the actual command this handler acts on - "advance to this stage" -
        # and internal callers (e.g. playtest_handler's skip-challenge tool) rely on being able to
        # set it ahead of whatever is currently stored. Overriding it from stored state instead of
        # trusting the payload was tried and breaks that legitimate advance mechanism (verified by
        # test_playtest.py/test_playtest_veto_breaker.py failing when it was). It remains an
        # unresolved gap - a crafted payload can still claim to be further along in the current
        # challenge's stages than it really is - noted in the plan's Open questions rather than
        # silently left undocumented.
        with get_session() as db_session:
            state_user_id = get_user_id(db_session, username)
            latest_challenge = db_session.scalars(
                select(GameChallenge)
                .where(GameChallenge.user_id == state_user_id)
                .order_by(GameChallenge.id.desc())
            ).first()
            if latest_challenge is not None:
                phase_id = latest_challenge.phase_index
                challenge_id = latest_challenge.challenge_index
            else:
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
                if challenge_loop_index == 1 and challenge:
                    try:
                        events = observe_tagged_facts(challenge, username)
                        await send_events(
                            websocket, username,
                            [e.stamped(phase_id=phase_id, challenge_id=challenge_id) for e in events],
                        )
                    except Exception as e:
                        print(f"[Graph fact observe error] {e}")
                if challenge_loop_index == 2:
                    messages = []
            case _:
                # Update the completed challenge record with its ending metric_values
                with get_session() as db_session:
                    completed_user_id = get_user_id(db_session, username)
                    stmt = (
                        select(GameChallenge)
                        .where(
                            GameChallenge.user_id == completed_user_id,
                            GameChallenge.phase_index == phase_id,
                            GameChallenge.challenge_index == challenge_id,
                        )
                        .order_by(GameChallenge.id.desc())
                    )
                    completed_rec = db_session.scalars(stmt).first()
                    # What the simulation actually did to the metrics (`set_metric_changes`),
                    # read now while the row is still attached - the client's own "proceed"
                    # request never carries this (see the note where `ac_changes` is used below).
                    persisted_metric_changes = (
                        dict(completed_rec.action_card.get("metric_changes", {}))
                        if completed_rec and isinstance(completed_rec.action_card, dict)
                        else {}
                    )
                    if completed_rec and metric_values:
                        completed_rec.metric_values = metric_values
                        completed_rec.challenge_loop_index = 3
                    elif not completed_rec and metric_values:
                        db_session.add(
                            GameChallenge(
                                user_name=username,
                                user_id=completed_user_id,
                                run_index=current_run_index(db_session, completed_user_id),
                                phase_index=phase_id,
                                challenge_index=challenge_id,
                                challenge_loop_index=3,
                                metric_values=metric_values,
                                time_stamp=datetime.datetime.utcnow(),
                                action_card=action_card,
                                messages=[],
                                attention_tokens=attention_tokens,
                            )
                        )
                    db_session.commit()

                # next challenge / round completion (after simulation phase)
                challenge: Challenge = select_next_challenge(username, phase_id, challenge_id)

                if challenge is None:
                    use_q = True
                    with get_session() as db_session:
                        user = db_session.scalar(select(User).where(User.user_name == username))
                        if user:
                            camp = db_session.scalar(select(Campaign).where(Campaign.id == user.campaign_id))
                            if camp is not None:
                                use_q = camp.use_questionnaire

                    if use_q:
                        with get_session() as db_session:
                            db_session.add(
                                GameProgression(
                                    user_name=username,
                                    user_id=get_user_id(db_session, username),
                                    run_index=current_run_index(db_session, get_user_id(db_session, username)),
                                    game_progress_index=3,
                                    time_stamp=datetime.datetime.utcnow(),
                                    additional_data=[]
                                )
                            )
                        await send_progress_index_payload(websocket, 3)
                    else:
                        with get_session() as db_session:
                            db_session.add(
                                GameProgression(
                                    user_name=username,
                                    user_id=get_user_id(db_session, username),
                                    run_index=current_run_index(db_session, get_user_id(db_session, username)),
                                    game_progress_index=4,
                                    time_stamp=datetime.datetime.utcnow(),
                                    additional_data=[]
                                )
                            )
                        await manager.send_event(
                            websocket=websocket,
                            event="game:progress_change",
                            payload={"progressionIndex": 4}
                        )
                    return (phase_id, challenge_id + 1, 0)

                try:
                    graph_store.enter_challenge(username, challenge)
                except Exception as e:
                    print(f"[Graph enter challenge error] {e}")

                load_known_intel_items_for_challenge(challenge, username)
                
                #calculate new metric values
                new_metric_values=[]

                # `action_card` here is the client's own request payload, which - for the
                # "proceed to next milestone" call this branch handles - never actually carries
                # a "metric_changes" key (see `ac_simulation.tsx`'s handleAcSimulationContinue).
                # `persisted_metric_changes`, written by the simulation step itself, is the real
                # source; the payload's own value (if a caller ever does send one) still wins.
                ac_changes = {
                    **persisted_metric_changes,
                    **(action_card.get("metric_changes", {}) if isinstance(action_card, dict) else {}),
                }

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
        persisted_ac = action_card
        with get_session() as session:
            ev_user_id = get_user_id(session, username)
            stmt = (
                select(GameChallenge)
                .where(
                    GameChallenge.user_id == ev_user_id,
                    GameChallenge.run_index == current_run_index(session, ev_user_id),
                    GameChallenge.emotion_values.isnot(None),
                )
                .order_by(GameChallenge.id.desc())
            )
            latest = session.scalars(stmt).first()
            if latest and isinstance(latest.emotion_values, dict) and latest.emotion_values:
                ev_dict = latest.emotion_values
            if latest and isinstance(latest.action_card, dict) and latest.action_card.get("title"):
                persisted_ac = latest.action_card

        await manager.send_event(
            websocket=websocket,
            event="game:state_update",
            payload={
                "progressionIndex": 2,
                "type": "state",
                "phases_amount": len(PhaseFactory.get_phases()),
                "challenges_amount": PhaseFactory.get_phases()[challenge.phase_id].challenge_quota,
                "phase_id": challenge.phase_id,
                "challenge_id": challenge.id,
                "challenge_loop_id": challenge_loop_index,
                "name": challenge.name,
                "description": challenge.description,
                "roundIntroduction": challenge.roundIntroduction,
                "metric_values": metric_values,
                "messages": messages,
                "attention_tokens": attention_tokens,
                "action_card": persisted_ac,
                "played_engagement_card_ids": persisted_ac.get("played_engagement_card_ids", []) if isinstance(persisted_ac, dict) else [],
                "engagement_card_targets": persisted_ac.get("engagement_card_targets", {}) if isinstance(persisted_ac, dict) else {},
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
                "emotional_states": EmotionFactory.get_emotion_states_dict(ev_dict),
                "emotion_dimensions": EmotionFactory.get_emotion_dimensions_dict(ev_dict),
            }
        )

        if challenge_loop_index == 2:
            from mlops_serious_game.infrastructure.websocket.handlers.chat_handler import (
                handle_chat_message,
            )

            # Keyed by user_id, not username - see D-user-id in
            # docs/plans/session-persistence-and-url-routing.md.
            with get_session() as chat_session:
                chat_thread_user_id = get_user_id(chat_session, username)
            chat_payload = {
                "session_id": f"MLOps_Convo_{chat_thread_user_id}",
                "challenge": challenge.name
                + ": "
                + challenge.roundIntroduction
                + personalize(challenge.description, resolve_markers=True),
                "phase_id": challenge.phase_id,
                "challenge_id": challenge.id,
                "initial_start": True,
                "action_card": persisted_ac or action_card,
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
