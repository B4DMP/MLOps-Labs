"""Websocket handlers for Gather (D49, plan 11): engagement cards buy conversations.

`gather:open` starts one conversation per target stakeholder (a fixed number of turns, per D49's
table). `gather:ask` resolves one turn. `gather:close` ends a conversation early; unused turns are
lost. Every rule lives in `pitch_debate_service.gather` (pure); this module only gathers the
player's situation, calls in, writes what changed, and sends back the turn menu.
"""

from typing import Any, Optional

from fastapi import WebSocket
from sqlalchemy import select
from sqlalchemy.orm.attributes import flag_modified

from mlops_serious_game.application.intel_handler import (
    load_known_intel_items,
    mark_intel_item_inferred,
    mark_intel_item_refuted,
    retrieve_dossier_data,
    rule_out_archetype,
    ruled_out_archetypes,
    store_intel_item,
)
from mlops_serious_game.application.pitch_debate_service import gather
from mlops_serious_game.application.pitch_debate_service import gather_store
from mlops_serious_game.application.pitch_debate_service import store as pitch_store
from mlops_serious_game.domain.emotion_factory import EmotionFactory
from mlops_serious_game.domain.engagementCardFactory import EngagementCardFactory
from mlops_serious_game.domain.event import GameEvent
from mlops_serious_game.domain.metric_factory import MetricFactory
from mlops_serious_game.domain.phase_factory import PhaseFactory
from mlops_serious_game.domain.requirement import ConfidenceType, IntelSource, StakeholderIntelItem, gist_or_fallback
from mlops_serious_game.domain.requirement_factory import RequirementFactory
from mlops_serious_game.domain.stakeholder_factory import StakeholderFactory
from mlops_serious_game.infrastructure.database import GameChallenge, GameSession, get_session
from mlops_serious_game.infrastructure.websocket.handlers.log_handler import send_events
from mlops_serious_game.infrastructure.websocket.manager import manager


def _challenge_and_room(phase_id: int, challenge_id: int):
    challenge = PhaseFactory.translate_challenge_index(challenge_index=challenge_id, phase_index=phase_id)
    if not challenge:
        phases = PhaseFactory.get_phases()
        challenge = phases[0].challenges[0]
    room_ids = [ps.stakeholder_id for ps in PhaseFactory.get_phases()[challenge.phase_id].stakeholders]
    return challenge, room_ids


def _stakeholder_name(st_id: str) -> str:
    st = StakeholderFactory.get_stakeholder(st_id)
    return st.name if st else st_id


def _archetypes(username: str) -> dict[str, dict]:
    with get_session() as db:
        row = db.scalars(
            select(GameSession).where(GameSession.player == username).order_by(GameSession.id.desc())
        ).first()
        return dict(row.stakeholder_archetypes) if row and isinstance(row.stakeholder_archetypes, dict) else {}


def _true_archetype(archetypes: dict[str, dict], st_id: str) -> Optional[str]:
    entry = archetypes.get(st_id)
    if isinstance(entry, dict) and entry.get("real_archetype"):
        return entry["real_archetype"]
    st = StakeholderFactory.get_stakeholder(st_id)
    return getattr(st, "convincer_archetype", None) if st else None


def _archetype_verified(archetypes: dict[str, dict], st_id: str) -> bool:
    entry = archetypes.get(st_id)
    return bool(isinstance(entry, dict) and entry.get("verified"))


async def _held_items(username: str, phase_id: int) -> list[StakeholderIntelItem]:
    return load_known_intel_items(username, up_to_phase=phase_id)


def _options_payload(
    username: str, phase_id: int, challenge_id: int, conversation: gather.GatherConversation,
    card, held: list[StakeholderIntelItem],
) -> list[dict[str, Any]]:
    challenge, _ = _challenge_and_room(phase_id, challenge_id)
    pool = RequirementFactory.get_requirements_for_stakeholder_in_challenge(challenge.id, conversation.stakeholder_id)
    archetypes = _archetypes(username)
    one_on_one_eligible = card.id == "eng_1" and gather.one_on_one_pair(held, conversation.stakeholder_id) is not None
    seed = f"{username}|{challenge.id}|{conversation.card_id}|{conversation.stakeholder_id}|{conversation.turns_used}"
    specs = gather.gather_options_for(
        conversation, held, pool, card.allowed_requirement_types,
        _archetype_verified(archetypes, conversation.stakeholder_id),
        ruled_out_archetypes(username, conversation.stakeholder_id),
        EmotionFactory.get_available_archetype_names(),
        seed,
        one_on_one_eligible=one_on_one_eligible,
    )
    return [s.model_dump() for s in specs]


async def _send_conversation(
    websocket: WebSocket, username: str, phase_id: int, challenge_id: int,
    conversation: gather.GatherConversation, card, held: list[StakeholderIntelItem], **extra,
) -> None:
    payload = {
        "phase_id": phase_id,
        "challenge_id": challenge_id,
        "card_id": conversation.card_id,
        "stakeholder_id": conversation.stakeholder_id,
        "stakeholder_name": _stakeholder_name(conversation.stakeholder_id),
        "turns_left": conversation.turns_left,
        "turns_used": conversation.turns_used,
        "closed": conversation.closed,
        "options": _options_payload(username, phase_id, challenge_id, conversation, card, held),
    }
    payload.update(extra)
    await manager.send_event(websocket=websocket, event="gather:state", payload=payload)


def _target_room_ids(card, requested: list[str], room_ids: list[str]) -> list[str]:
    if card.stakeholder_selection_amount == -1:
        return room_ids
    return [st_id for st_id in requested if st_id in room_ids]


async def handle_gather_open(websocket: WebSocket, username: str, payload: dict) -> None:
    """Plays a card: one new conversation per target, each with the card's full turn budget."""
    phase_id, challenge_id = payload.get("phase_id", 0), payload.get("challenge_id", 0)
    card_id = payload.get("card_id")
    card = EngagementCardFactory.get_card(card_id)
    challenge, room_ids = _challenge_and_room(phase_id, challenge_id)
    targets = _target_room_ids(card, payload.get("stakeholder_ids", []), room_ids)
    if not targets:
        await manager.send_event(
            websocket=websocket, event="system:error",
            payload={"message": "None of those stakeholders take part in this phase."},
        )
        return

    with get_session() as db:
        row = db.scalars(
            select(GameChallenge)
            .where(
                GameChallenge.user_name == username,
                GameChallenge.phase_index == phase_id,
                GameChallenge.challenge_index == challenge_id,
            )
            .order_by(GameChallenge.id.desc())
        ).first()
        if row is not None:
            current_ac = dict(row.action_card or {})
            played = list(current_ac.get("played_engagement_card_ids", []))
            if card_id not in played:
                played.append(card_id)
            current_ac["played_engagement_card_ids"] = played
            card_targets = dict(current_ac.get("engagement_card_targets", {}))
            existing_targets = list(card_targets.get(card_id, []))
            for st_id in targets:
                if st_id not in existing_targets:
                    existing_targets.append(st_id)
            card_targets[card_id] = existing_targets
            current_ac["engagement_card_targets"] = card_targets
            row.action_card = current_ac
            flag_modified(row, "action_card")
            db.commit()

    held = await _held_items(username, phase_id)
    events: list[GameEvent] = []
    conversations = []
    for st_id in targets:
        conversation = gather.GatherConversation(card_id=card_id, stakeholder_id=st_id, turns_left=card.turns)
        gather_store.save_conversation(username, phase_id, challenge_id, conversation)
        conversations.append(conversation)
        events.append(GameEvent(
            step="gather", kind="tokens", subject_id=st_id, direction="down", magnitude="clear",
            cause="tokens.spent", params={"card": card.title, "st": _stakeholder_name(st_id)},
        ))

    await send_events(websocket, username, [e.stamped(phase_id=phase_id, challenge_id=challenge_id) for e in events])
    for conversation in conversations:
        await _send_conversation(websocket, username, phase_id, challenge_id, conversation, card, held)


async def handle_gather_ask(websocket: WebSocket, username: str, payload: dict) -> None:
    """Resolves one turn: one option, one target, one outcome."""
    phase_id, challenge_id = payload.get("phase_id", 0), payload.get("challenge_id", 0)
    card_id, stakeholder_id = payload.get("card_id"), payload.get("stakeholder_id")
    option = payload.get("option", "")
    card = EngagementCardFactory.get_card(card_id)
    challenge, _ = _challenge_and_room(phase_id, challenge_id)

    conversation = gather_store.load_conversation(username, phase_id, challenge_id, card_id, stakeholder_id)
    if conversation is None or not conversation.is_open:
        await manager.send_event(
            websocket=websocket, event="system:error",
            payload={"message": "that conversation is not open"},
        )
        return

    held = await _held_items(username, phase_id)
    held_by_id = {i.id: i for i in held}
    pool = RequirementFactory.get_requirements_for_stakeholder_in_challenge(challenge.id, stakeholder_id)
    known_ids = {i.id for i in held} | set(conversation.discovered_item_ids)
    seed = f"{username}|{challenge.id}|{card_id}|{stakeholder_id}|{conversation.turns_used}"
    st_name = _stakeholder_name(stakeholder_id)

    allowed = _options_payload(username, phase_id, challenge_id, conversation, card, held)
    matching = next(
        (
            o for o in allowed
            if o["option"] == option and o["available"]
            and o.get("item_id") == payload.get("item_id")
            and o.get("archetype") == payload.get("archetype")
        ),
        None,
    )
    if matching is None:
        await _send_conversation(
            websocket, username, phase_id, challenge_id, conversation, card, held,
            error="that option is not available here",
        )
        return

    if option == "open_question":
        outcome = gather.resolve_open_question(conversation, pool, known_ids, card.allowed_requirement_types, seed, st_name)
        if outcome.result == "revealed" and outcome.item_id:
            req = RequirementFactory.get_requirement(outcome.item_id)
            if req:
                item = StakeholderIntelItem.from_requirement(
                    req, intel_type=ConfidenceType.VERIFIED, categorized_type=req.type,
                    description=req.description, source=IntelSource.INTERVIEW,
                )
                await store_intel_item(challenge, websocket, item)
    elif option == "test_hypothesis":
        item_id = payload.get("item_id")
        outcome = gather.resolve_test_hypothesis(conversation, held_by_id, item_id, st_name)
        if outcome.result == "inferred":
            mark_intel_item_inferred(username, item_id)
        elif outcome.result == "refuted":
            mark_intel_item_refuted(username, item_id)
    elif option == "generic_question":
        def _gist_of(pool_item) -> str:
            metric_id = getattr(pool_item, "metric_id", None) or getattr(
                StakeholderFactory.get_stakeholder(stakeholder_id), "metric_id", None
            )
            metric_label = None
            if metric_id:
                metric = MetricFactory.get_metric(metric_id)
                metric_label = metric.name if metric else None
            return gist_or_fallback(pool_item, st_name, metric_label)

        outcome = gather.resolve_generic_question(conversation, pool, known_ids, seed, st_name, gist_of=_gist_of)
    elif option == "trial_balloon":
        archetypes = _archetypes(username)
        true_arch = _true_archetype(archetypes, stakeholder_id)
        outcome = gather.resolve_trial_balloon(conversation, payload.get("archetype", ""), true_arch or "", st_name)
        if outcome.result == "archetype_matched":
            from mlops_serious_game.application.intel_handler import correct_and_verify_convincer_archetype
            correct_and_verify_convincer_archetype(username, stakeholder_id)
        elif outcome.result == "archetype_ruled_out":
            rule_out_archetype(username, stakeholder_id, payload.get("archetype", ""))
    elif option == "one_on_one":
        # The pair is not a player choice - `gather_options_for` only offers this turn when
        # `one_on_one_pair` finds one, so the server resolves the same pair here rather than
        # trusting client-supplied item ids (which would skip the Boundary/Trade-off-or-Driver
        # type check `one_on_one_pair` already does).
        pair = gather.one_on_one_pair(held, stakeholder_id)
        if pair is None:
            await _send_conversation(
                websocket, username, phase_id, challenge_id, conversation, card, held,
                error="needs a held Boundary and a held Trade-off or Driver on them",
            )
            return
        boundary_item, other_item = pair
        outcome = gather.resolve_one_on_one(conversation, boundary_item, other_item, st_name)
        if outcome.result == "one_on_one_hit":
            from mlops_serious_game.application.intel_handler import correct_and_verify_intel_item
            correct_and_verify_intel_item(username, boundary_item.id, challenge)
            correct_and_verify_intel_item(username, other_item.id, challenge)
    else:
        await _send_conversation(
            websocket, username, phase_id, challenge_id, conversation, card, held,
            error="unknown option",
        )
        return

    gather_store.save_conversation(username, phase_id, challenge_id, outcome.conversation)
    if outcome.emotion_delta:
        pitch_store.apply_emotion_deltas(username, {stakeholder_id: outcome.emotion_delta}, [stakeholder_id])
    await send_events(
        websocket, username, [e.stamped(phase_id=phase_id, challenge_id=challenge_id) for e in outcome.events]
    )

    held_after = await _held_items(username, phase_id)
    dossier = await retrieve_dossier_data(challenge, websocket)
    await manager.send_event(websocket=websocket, event="intel:dossier_data", payload={"dossier": dossier})
    await _send_conversation(
        websocket, username, phase_id, challenge_id, outcome.conversation, card, held_after, result=outcome.result,
    )


async def handle_gather_close(websocket: WebSocket, username: str, payload: dict) -> None:
    """Ends a conversation early; unused turns are lost (D49)."""
    phase_id, challenge_id = payload.get("phase_id", 0), payload.get("challenge_id", 0)
    card_id, stakeholder_id = payload.get("card_id"), payload.get("stakeholder_id")
    card = EngagementCardFactory.get_card(card_id)

    conversation = gather_store.load_conversation(username, phase_id, challenge_id, card_id, stakeholder_id)
    if conversation is None:
        await manager.send_event(
            websocket=websocket, event="system:error", payload={"message": "no such conversation"},
        )
        return

    outcome = gather.close_conversation(conversation, _stakeholder_name(stakeholder_id))
    gather_store.save_conversation(username, phase_id, challenge_id, outcome.conversation)
    await send_events(
        websocket, username, [e.stamped(phase_id=phase_id, challenge_id=challenge_id) for e in outcome.events]
    )
    held = await _held_items(username, phase_id)
    await _send_conversation(websocket, username, phase_id, challenge_id, outcome.conversation, card, held)
