"""Websocket handlers for the merged pitch phase (plan 06).

Thin on purpose: every rule lives in `pitch_debate_service.session`, every write in
`pitch_debate_service.store` and `graph_service.store`. These handlers only gather the player's
situation, call in, and send back what the screen shows.

The graph is written exactly once per pitch, at commit.
"""

import asyncio
from typing import Any, Optional

from fastapi import WebSocket

from mlops_serious_game.application.graph_service import store as graph_store
from mlops_serious_game.application.graph_service.apply import apply_ops
from mlops_serious_game.domain.graph import GraphOp
from mlops_serious_game.application.pitch_debate_service import session as pitch
from mlops_serious_game.application.pitch_debate_service import store as pitch_store
from mlops_serious_game.application.pitch_debate_service.authored import load_authored_index
from mlops_serious_game.domain.emotion_factory import EmotionFactory
from mlops_serious_game.domain.graph_factory import GraphFactory
from mlops_serious_game.domain.persona_resolver import personalize
from mlops_serious_game.domain.phase_factory import PhaseFactory
from mlops_serious_game.domain.requirement import counts_toward_readiness
from mlops_serious_game.domain.requirement_factory import RequirementFactory
from mlops_serious_game.domain.stakeholder_factory import StakeholderFactory
from mlops_serious_game.infrastructure.database import GameSession, get_session, get_user_id
from mlops_serious_game.infrastructure.websocket.handlers.log_handler import send_events
from mlops_serious_game.infrastructure.websocket.manager import manager

from sqlalchemy import select


class PitchContext:
    """Everything one pitch message needs, gathered once."""

    def __init__(self, username: str, phase_id: int, challenge_id: int):
        self.username = username
        self.challenge = PhaseFactory.translate_challenge_index(
            challenge_index=challenge_id, phase_index=phase_id
        )
        self.phase_id = self.challenge.phase_id if self.challenge else phase_id
        self.challenge_id = self.challenge.id if self.challenge else challenge_id
        self.graph = GraphFactory.get_graph()
        replay = graph_store.load_state(username)
        self.state = replay.state
        self.knowledge = replay.knowledge
        self.all_intel = RequirementFactory.get_requirements_for_challenge(self.challenge_id)
        self.room = [
            (ps.stakeholder_id, ps.power)
            for ps in PhaseFactory.get_phases()[self.phase_id].stakeholders
        ]
        self.room_ids = [st_id for st_id, _ in self.room]
        self.archetypes = _stakeholder_archetypes(username, self.room_ids)
        self.read_exactly = _correctly_tagged(username, self.room_ids)
        self.emotions = pitch_store.emotion_values(username, self.room_ids)
        self.points = pitch_store.escalation_points(username)
        self.names = {
            st_id: (StakeholderFactory.get_stakeholder(st_id).name if StakeholderFactory.get_stakeholder(st_id) else st_id)
            for st_id, _ in self.room
        }

    def room_archetypes(self) -> list[tuple[str, str, Any]]:
        """(stakeholder_id, power, true archetype) for everyone in the room - what Reframe's
        "room is listening" side effect scores against (D48)."""
        return [(st_id, power, self.archetypes.get(st_id)) for st_id, power in self.room]

    def held_items(self) -> list:
        """What the player actually holds, across phases (plan 05)."""
        from mlops_serious_game.application.intel_handler import load_known_intel_items

        return load_known_intel_items(self.username, up_to_phase=self.phase_id)

    def emotions_now(self, state: "pitch.PitchState") -> dict[str, dict[str, float]]:
        """Stored emotions with this round's answers folded in.

        The deltas only reach the database at commit, but they have to count while the room is
        still objecting: stonewalling someone has to show up in their buy-in immediately, and the
        committed outcome has to be scored against the room as the player left it.
        """
        return pitch.shift_emotions(self.emotions, state.emotion_deltas)

    def view(self, state: "pitch.PitchState") -> pitch.CardView:
        archetypes = EmotionFactory.get_convincer_archetypes()
        return pitch.card_view(
            self.graph, self.state, self.all_intel, set(state.card_item_ids), self.room,
            self.archetypes,
            main_archetype=archetypes.get(state.main_archetype or ""),
            secondary_archetype=archetypes.get(state.secondary_archetype or ""),
            emotion_values=self.emotions_now(state),
            knowledge=self.knowledge,
        )

    def opposing_stakeholder(self, st_id: str) -> Optional[str]:
        """The other side of this challenge's framing conflict, who enjoys a stonewall (D8)."""
        conflict = getattr(self.challenge, "conflict", None)
        if not conflict:
            return None
        others = [p.stakeholder_id for p in conflict.positions if p.stakeholder_id != st_id]
        return others[0] if others else None


def _drawn_archetypes(username: str) -> dict[str, Any]:
    with get_session() as db:
        row = db.scalars(
            select(GameSession).where(GameSession.user_id == get_user_id(db, username)).order_by(GameSession.id.desc())
        ).first()
        if row is None or not isinstance(row.stakeholder_archetypes, dict):
            return {}
        return dict(row.stakeholder_archetypes)


def _guessed_archetypes(username: str, room_ids: list[str]) -> dict[str, str]:
    """Each room stakeholder's archetype as the player has tagged it - their own guess, not the
    ground truth. What the Opener's opening lines are built from (D48)."""
    drawn = _drawn_archetypes(username)
    out: dict[str, str] = {}
    for st_id in room_ids:
        entry = drawn.get(st_id)
        if isinstance(entry, dict) and entry.get("categorized_archetype"):
            out[st_id] = entry["categorized_archetype"]
    return out


def _correctly_tagged(username: str, room_ids: list[str]) -> set[str]:
    """Stakeholders whose convincer profile the player has tagged correctly."""
    drawn = _drawn_archetypes(username)
    out = set()
    for st_id in room_ids:
        entry = drawn.get(st_id)
        if isinstance(entry, dict) and entry.get("categorized_archetype") and (
            entry.get("categorized_archetype") == entry.get("real_archetype")
        ):
            out.add(st_id)
    return out


def _stakeholder_archetypes(username: str, room_ids: list[str]) -> dict[str, Any]:
    """Each stakeholder's true convincer archetype, which is what fit is measured against."""
    archetypes = EmotionFactory.get_convincer_archetypes()
    with get_session() as db:
        row = db.scalars(
            select(GameSession).where(GameSession.user_id == get_user_id(db, username)).order_by(GameSession.id.desc())
        ).first()
        drawn = dict(row.stakeholder_archetypes) if row and isinstance(row.stakeholder_archetypes, dict) else {}
    out: dict[str, Any] = {}
    for st_id in room_ids:
        name = (drawn.get(st_id) or {}).get("real_archetype") if isinstance(drawn.get(st_id), dict) else None
        arch = archetypes.get(name or "")
        if arch is not None:
            out[st_id] = arch
    return out


def _is_verified(item) -> bool:
    return str(getattr(item.intel_type, "value", item.intel_type)).lower() == "verified"


async def _verify_heard(
    websocket: WebSocket,
    ctx: PitchContext,
    item_ids: list[str],
    stakeholder_ids: list[str],
) -> None:
    """What the room has said out loud stops being a guess.

    The player's notes on those items are verified, corrected where they were filed wrong, and
    the archetypes the player tagged for the stakeholders who spoke are verified the same way.
    Only notes the player holds: an objection about something they never found adds nothing.
    """
    from mlops_serious_game.application.intel_handler import (
        correct_and_verify_convincer_archetype,
        correct_and_verify_intel_item,
        retrieve_dossier_data,
    )

    held = {i.id: i for i in ctx.held_items()}
    changed = False
    for item_id in dict.fromkeys(item_ids):
        item = held.get(item_id)
        if item is not None and not _is_verified(item):
            correct_and_verify_intel_item(ctx.username, item_id, ctx.challenge)
            changed = True

    drawn = _drawn_archetypes(ctx.username)
    for st_id in dict.fromkeys(s for s in stakeholder_ids if s):
        entry = drawn.get(st_id)
        if isinstance(entry, dict) and entry.get("categorized_archetype") and not entry.get("verified"):
            correct_and_verify_convincer_archetype(ctx.username, st_id)
            changed = True

    if not changed:
        return
    # A corrected archetype is a correct one now, so the risk read may show its exact number.
    ctx.read_exactly = _correctly_tagged(ctx.username, ctx.room_ids)
    if ctx.challenge:
        dossier = await retrieve_dossier_data(ctx.challenge, websocket)
        await manager.send_event(websocket=websocket, event="intel:dossier_data", payload={"dossier": dossier})


def _load_or_start(ctx: PitchContext) -> "pitch.PitchState":
    state = pitch_store.load_pitch(ctx.username, ctx.phase_id, ctx.challenge_id)
    return state or pitch.start_pitch(ctx.room_ids)


def _item_payload(item, chains: Optional[dict] = None) -> dict:
    chain = (chains or {}).get(item.id, {})
    return {
        "id": item.id,
        "stakeholder_id": item.stakeholder_id,
        "type": item.type.value if hasattr(item.type, "value") else str(item.type),
        "description": personalize(item.description),
        # A refinement chain is one selectable item in the builder, offered as its newest link
        # (plan 05). The builder needs the chain to group the rows it is handed.
        "chain_id": chain.get("chain_id", item.id),
        "chain_position": chain.get("chain_position", 0),
        "chain_length": chain.get("chain_length", 1),
    }


def _payload(ctx: PitchContext, state: "pitch.PitchState", view: pitch.CardView, **extra) -> dict:
    from mlops_serious_game.application.intel_handler import chain_index

    held = ctx.held_items()
    chains = chain_index(held)
    card_ids = set(state.card_item_ids)
    hardened = frozenset(state.hardened_item_ids)
    options = {}
    for objection in state.open_objections():
        options[objection.id] = [
            spec.model_dump()
            for spec in pitch.options_for(objection, held, card_ids, ctx.points, state.amendments_left, hardened)
        ]
    payload = {
        "phase_id": ctx.phase_id,
        "challenge_id": ctx.challenge_id,
        "stage": state.stage,
        "card": [_item_payload(i, chains) for i in pitch.card_items(held + list(ctx.all_intel), card_ids)][:pitch.MAX_CARD_ITEMS],
        "card_item_ids": state.card_item_ids,
        "main_archetype": state.main_archetype,
        "secondary_archetype": state.secondary_archetype,
        # The Opener (D48): one opening line per archetype the player has tagged for the room,
        # plus "any other" on the frontend for the rest. Their own guesses, never the ground truth.
        "opener_archetypes": pitch.opener_archetypes(_guessed_archetypes(ctx.username, ctx.room_ids)),
        "available_items": [_item_payload(i, chains) for i in held],
        "predictions": [p.model_dump() for p in view.predictions],
        # Only lines the player has found and filed as lines (the outcome still counts them all).
        "boundary_warnings": [
            {**w.model_dump(), "line": personalize(w.line) if w.line else None}
            for w in pitch.player_boundary_warnings(ctx.graph, view.boundary_warnings, held)
        ],
        "uncompensated_losses": view.uncompensated_losses,
        # Risk read: the band always, the exact number only for stakeholders whose Language the
        # player tagged correctly (plan 06).
        "reads": [
            {**r.model_dump(), "buy_in": r.buy_in if r.stakeholder_id in ctx.read_exactly else None}
            for r in view.reads
        ],
        "predicted_outcome": view.outcome,
        "objections": [
            {**o.model_dump(), "text": personalize(o.text), "options": options.get(o.id, [])}
            for o in state.open_objections()
        ],
        # Readiness: how much of this challenge's intel the player has actually pinned down.
        # Pitching on almost nothing is how players learn nothing, so the screen gates it.
        "intel_total": len([r for r in ctx.all_intel if r.stakeholder_id]),
        # Q36/D53: an Inferred note has been tested against the stakeholder, so it counts here
        # the same as a Verified one.
        "intel_verified": len([
            i for i in held
            if getattr(i, "challenge_id", None) == ctx.challenge_id
            and counts_toward_readiness(getattr(i, "intel_type", None))
        ]),
        # How far this round has moved each stakeholder, so the room can show it as it happens.
        "emotion_deltas": state.emotion_deltas,
        "amendments_left": state.amendments_left,
        "escalation_points": ctx.points,
        "patience": state.patience,
        # Patience in words, not pips (D50): full / impatient / at their limit.
        "patience_words": {st_id: state.patience_word(st_id) for st_id in ctx.room_ids},
        "outcome": state.outcome,
        "hardened_item_ids": state.hardened_item_ids,
    }
    payload.update(extra)
    return payload


async def _send(websocket: WebSocket, ctx: PitchContext, state, view, **extra) -> None:
    await manager.send_event(
        websocket=websocket, event="pitch:state", payload=_payload(ctx, state, view, **extra)
    )


async def handle_pitch_state(websocket: WebSocket, username: str, payload: dict) -> None:
    ctx = PitchContext(username, payload.get("phase_id", 0), payload.get("challenge_id", 0))
    state = _load_or_start(ctx)
    await _send(websocket, ctx, state, ctx.view(state))


async def handle_pitch_set_card(websocket: WebSocket, username: str, payload: dict) -> None:
    ctx = PitchContext(username, payload.get("phase_id", 0), payload.get("challenge_id", 0))
    state = _load_or_start(ctx)
    wanted = list(payload.get("item_ids", []))
    held_ids = {i.id for i in ctx.held_items()}
    if not held_ids.issuperset(wanted):
        # A card is built from intel the player actually found, never from the answer key.
        await _send(websocket, ctx, state, ctx.view(state), error="you do not hold all of those items")
        return
    state, error = pitch.set_card(
        state,
        wanted,
        payload.get("main_archetype"),
        payload.get("secondary_archetype"),
    )
    if error is None:
        pitch_store.save_pitch(username, ctx.phase_id, ctx.challenge_id, state)
    await _send(websocket, ctx, state, ctx.view(state), error=error)


async def handle_pitch_sound_out(websocket: WebSocket, username: str, payload: dict) -> None:
    """Sound someone out (D50): a stakeholder reacts to the draft card, at the cost of one of
    their patience. Never opens the objection round and never touches the graph."""
    ctx = PitchContext(username, payload.get("phase_id", 0), payload.get("challenge_id", 0))
    state = _load_or_start(ctx)
    stakeholder_id = payload.get("stakeholder_id")
    if stakeholder_id not in ctx.room_ids:
        await _send(websocket, ctx, state, ctx.view(state), error="that stakeholder is not in the room")
        return
    if state.stage != "PREPARE":
        await _send(websocket, ctx, state, ctx.view(state), error="the card is already in front of the room")
        return
    if not pitch.sound_out_available(state.patience.get(stakeholder_id, pitch.DEFAULT_PATIENCE)):
        await _send(websocket, ctx, state, ctx.view(state), error="they are at their last point - sounding them out risks nothing left to spend")
        return

    view = ctx.view(state)
    read = next((r for r in view.reads if r.stakeholder_id == stakeholder_id), None)
    if read is None:
        await _send(websocket, ctx, state, ctx.view(state), error="that stakeholder is not in the room")
        return

    objection_kind = None
    if read.boundary_violated or read.band == "red":
        fired = pitch.objections_for(
            ctx.graph, ctx.state, ctx.all_intel, set(state.card_item_ids), [stakeholder_id],
            authored=load_authored_index(), held_items=ctx.held_items(),
        )
        objection_kind = fired[0].kind if fired else None

    state, reply, events = pitch.sound_out(state, stakeholder_id, read, objection_kind, names=ctx.names)
    pitch_store.save_pitch(username, ctx.phase_id, ctx.challenge_id, state)
    await send_events(websocket, username, [e.stamped(phase_id=ctx.phase_id, challenge_id=ctx.challenge_id) for e in events])
    await _send(websocket, ctx, state, ctx.view(state), sound_out={"stakeholder_id": stakeholder_id, "reply": reply})


async def handle_pitch_object(websocket: WebSocket, username: str, payload: dict) -> None:
    """Locks the card and lets the room object. Same card, same objections (standing rule)."""
    ctx = PitchContext(username, payload.get("phase_id", 0), payload.get("challenge_id", 0))
    state = _load_or_start(ctx)
    if state.stage != "PREPARE":
        # Re-running this after commit would reopen a finished pitch: `handle_pitch_commit` would
        # then see stage OBJECT again and write the card's ops to the graph a second time (the
        # module docstring's "exactly once per pitch").
        await _send(websocket, ctx, state, ctx.view(state), error="the room has already heard this card")
        return
    if not state.card_item_ids:
        await _send(websocket, ctx, state, ctx.view(state), error="build a card first")
        return
    objections = pitch.objections_for(
        ctx.graph, ctx.state, ctx.all_intel, set(state.card_item_ids), ctx.room_ids,
        authored=load_authored_index(), held_items=ctx.held_items(),
    )
    state = pitch.open_objection_round(state, objections)
    pitch_store.save_pitch(username, ctx.phase_id, ctx.challenge_id, state)
    await _send(websocket, ctx, state, ctx.view(state))


async def _voice_and_send(
    websocket: WebSocket,
    ctx: "PitchContext",
    objection,
    option: str,
    item_id: Optional[str],
    held: list,
    reframe_ctx,
    cleared: bool,
    reframe_result: Optional[str],
    events: list,
) -> None:
    """Face the room voicing (plan 11, step 5): puts the already-decided answer into words.
    Runs as a background task - the mechanical response is sent before this is even scheduled,
    so a slow or failed LLM call never holds up the game (D51's "mechanics never wait on it")."""
    from mlops_serious_game.application.pitch_debate_service.voicing import voice_answer
    from mlops_serious_game.domain.event_causes import EventCauseFactory

    st_archetype = ctx.archetypes.get(objection.stakeholder_id)
    item_context = None
    if option == "amend" and item_id:
        item = next((i for i in held if i.id == item_id), None)
        if item:
            item_context = personalize(item.description)
    chosen = reframe_ctx.chosen if reframe_ctx else None
    challenge = ctx.challenge
    challenge_desc = (
        f"{challenge.name}: {challenge.roundIntroduction} {personalize(challenge.description, resolve_markers=True)}"
        if challenge else ""
    )
    st = StakeholderFactory.get_stakeholder(objection.stakeholder_id)
    st_name = ctx.names.get(objection.stakeholder_id, objection.stakeholder_id)
    cause_texts = [EventCauseFactory.render(e.cause, e.params) for e in events if e.kind == "emotion"]

    try:
        player_line, stakeholder_line = await voice_answer(
            challenge=challenge_desc,
            option=option,
            stakeholder_name=st_name,
            stakeholder_role=getattr(st, "responsibilities", "") if st else "",
            archetype_label=getattr(st_archetype, "label", None) or getattr(st_archetype, "name", "") or "",
            archetype_strategy=getattr(st_archetype, "strategy", "") or "",
            objection_text=personalize(objection.text),
            item_context=item_context,
            chosen_archetype_name=getattr(chosen, "label", None) or getattr(chosen, "name", None),
            chosen_archetype_strategy=getattr(chosen, "strategy", None),
            cleared=cleared,
            reframe_result=reframe_result,
            cause_texts=cause_texts,
        )
    except Exception:
        return

    # Both lines go to Conversation history (plan 11); the effects already went to the log.
    await manager.send_event(
        websocket=websocket, event="intel:message_received",
        payload={"type": "player_message", "message": player_line},
    )
    await manager.send_event(
        websocket=websocket, event="intel:message_received",
        payload={
            "type": "stakeholder_message", "stakeholder_id": objection.stakeholder_id,
            "stakeholder_name": st_name, "message": stakeholder_line,
        },
    )


async def handle_pitch_answer(websocket: WebSocket, username: str, payload: dict) -> None:
    ctx = PitchContext(username, payload.get("phase_id", 0), payload.get("challenge_id", 0))
    state = _load_or_start(ctx)
    objection_id = payload.get("objection_id", "")
    objection = next((o for o in state.objections if o.id == objection_id), None)
    if objection is None:
        await _send(websocket, ctx, state, ctx.view(state), error="that objection is not open")
        return

    held = ctx.held_items()
    hardened = frozenset(state.hardened_item_ids)
    allowed = {
        spec.option
        for spec in pitch.options_for(
            objection, held, set(state.card_item_ids), ctx.points, state.amendments_left, hardened
        )
        if spec.available
    }
    reframe_ctx = None
    if payload.get("option") == "reframe":
        chosen = payload.get("chosen_archetype")
        archetypes = EmotionFactory.get_convincer_archetypes()
        reframe_ctx = pitch.ReframeContext(
            chosen=archetypes.get(chosen) if chosen else None,
            stakeholder_archetype=ctx.archetypes.get(objection.stakeholder_id),
            room=ctx.room_archetypes(),
        )
    result = pitch.answer_objection(
        state, objection_id, payload.get("option", ""), ctx.points, allowed,
        item_id=payload.get("item_id"),
        opposing_st_id=ctx.opposing_stakeholder(objection.stakeholder_id),
        reframe=reframe_ctx,
        names=ctx.names,
    )
    if result.rejected is None:
        pitch_store.save_pitch(username, ctx.phase_id, ctx.challenge_id, result.state)
        if result.spent_escalation_point:
            ctx.points = pitch_store.spend_escalation_point(username)
        await send_events(websocket, username, [e.stamped(phase_id=ctx.phase_id, challenge_id=ctx.challenge_id) for e in result.events])
        # The stakeholder has answered: their note and their archetype are no longer a guess.
        await _verify_heard(
            websocket, ctx,
            [objection.item_id] if objection.item_id else [],
            [objection.stakeholder_id],
        )
        asyncio.create_task(_voice_and_send(
            websocket, ctx, objection, payload.get("option", ""), payload.get("item_id"), held,
            reframe_ctx, result.cleared, result.reframe_result, result.events,
        ))
    await _send(websocket, ctx, result.state, ctx.view(result.state), error=result.rejected, reframe_result=result.reframe_result)


async def handle_pitch_commit(websocket: WebSocket, username: str, payload: dict) -> None:
    """Scores the card and, on anything but a veto, writes it to the graph."""
    ctx = PitchContext(username, payload.get("phase_id", 0), payload.get("challenge_id", 0))
    state = _load_or_start(ctx)
    if state.stage != "OBJECT":
        # The graph is written exactly once per pitch (module docstring): committing only makes
        # sense once the room has actually objected, never straight from PREPARE or twice in a row.
        await _send(websocket, ctx, state, ctx.view(state), error="face the room before you commit")
        return
    view = ctx.view(state)
    state, events = pitch.commit_pitch(state, view, names=ctx.names)
    # The room has reacted to the whole card, so every note on it is confirmed or corrected.
    await _verify_heard(websocket, ctx, list(state.card_item_ids), [])

    applied: dict[str, Any] = {}
    if view.outcome != "VETO":
        applied = _apply_card(ctx, state, view)
        ctx.emotions = pitch_store.apply_emotion_deltas(username, state.emotion_deltas, ctx.room_ids)
    stalemate = pitch.is_stalemate(state, ctx.room, ctx.points)
    if stalemate:
        applied = _apply_stalemate(ctx)
        state, stalemate_events = pitch.mark_stalemate(state)
        events += stalemate_events

    pitch_store.save_pitch(username, ctx.phase_id, ctx.challenge_id, state)
    await send_events(websocket, username, [e.stamped(phase_id=ctx.phase_id, challenge_id=ctx.challenge_id) for e in events])
    await _send(websocket, ctx, state, view, applied=applied, stalemate=stalemate)


async def handle_pitch_rebuild(websocket: WebSocket, username: str, payload: dict) -> None:
    ctx = PitchContext(username, payload.get("phase_id", 0), payload.get("challenge_id", 0))
    state = _load_or_start(ctx)
    if state.stage != "COMMIT":
        # Rebuild is one of the ways out of a stood veto (D7); it is not a way to abandon a card
        # that has not been faced yet (that is just building a different card in PREPARE).
        await _send(websocket, ctx, state, ctx.view(state), error="nothing to rebuild yet")
        return
    state, error, events = pitch.rebuild(state, ctx.room_ids, names=ctx.names)
    if error is None:
        pitch_store.save_pitch(username, ctx.phase_id, ctx.challenge_id, state)
        await send_events(websocket, username, [e.stamped(phase_id=ctx.phase_id, challenge_id=ctx.challenge_id) for e in events])
    await _send(websocket, ctx, state, ctx.view(state), error=error)


async def handle_pitch_veto_breaker(websocket: WebSocket, username: str, payload: dict) -> None:
    ctx = PitchContext(username, payload.get("phase_id", 0), payload.get("challenge_id", 0))
    state = _load_or_start(ctx)
    if state.stage != "COMMIT":
        # Only a stood veto (stage COMMIT, D1/D7) can be pushed through with an Escalation Point.
        await _send(websocket, ctx, state, ctx.view(state), error="no veto standing to push through")
        return
    view = ctx.view(state)
    vetoing = [r.stakeholder_id for r in view.reads if r.power == "high" and (r.boundary_violated or r.band == "red")]
    result = pitch.veto_breaker(state, ctx.points, vetoing, names=ctx.names)
    if result.rejected:
        await _send(websocket, ctx, state, view, error=result.rejected)
        return

    ctx.points = pitch_store.spend_escalation_point(username)
    applied = _apply_card(ctx, result.state, view, override=True)
    ctx.emotions = pitch_store.apply_emotion_deltas(username, result.state.emotion_deltas, ctx.room_ids)
    pitch_store.save_pitch(username, ctx.phase_id, ctx.challenge_id, result.state)
    await send_events(websocket, username, [e.stamped(phase_id=ctx.phase_id, challenge_id=ctx.challenge_id) for e in result.events])
    await _send(websocket, ctx, result.state, view, applied=applied)


async def handle_pitch_concede(websocket: WebSocket, username: str, payload: dict) -> None:
    """Player drops their card; the conflict's opposing position applies (D41)."""
    ctx = PitchContext(username, payload.get("phase_id", 0), payload.get("challenge_id", 0))
    state = _load_or_start(ctx)
    if state.stage != "COMMIT":
        # "Let them have it" is only on offer while a veto stands (D41), same as the other two
        # ways out of one.
        await _send(websocket, ctx, state, ctx.view(state), error="no veto standing to concede to")
        return
    conflict = getattr(ctx.challenge, "conflict", None)
    if not conflict:
        await _send(websocket, ctx, state, ctx.view(state), error="this challenge has no conflict to concede to")
        return

    view = ctx.view(state)
    vetoing = {r.stakeholder_id for r in view.reads if r.power == "high" and (r.boundary_violated or r.band == "red")}
    winning_pos = next((p for p in conflict.positions if p.stakeholder_id in vetoing), conflict.positions[1])
    losing_pos = next((p for p in conflict.positions if p is not winning_pos), conflict.positions[0])

    source_id = f"concede:{ctx.challenge.template_id if ctx.challenge else ctx.challenge_id}"
    op = GraphOp(
        kind="set_to",
        target=conflict.target,
        value=winning_pos.wants,
        source_kind="world_event",
        source_id=source_id,
    )
    result = apply_ops(ctx.graph, ctx.state, [op])
    graph_store.append_ops(
        ctx.username,
        result.resolved_ops,
        phase_index=ctx.phase_id,
        challenge_template=ctx.challenge.template_id if ctx.challenge else "",
        challenge_loop_index=2,
        source_kind="world_event",
        source_id=source_id,
    )

    state, events = pitch.concede_pitch(state, winning_pos.stakeholder_id, [losing_pos.stakeholder_id], names=ctx.names)
    ctx.emotions = pitch_store.apply_emotion_deltas(username, state.emotion_deltas, ctx.room_ids)
    pitch_store.save_pitch(username, ctx.phase_id, ctx.challenge_id, state)
    await send_events(websocket, username, [e.stamped(phase_id=ctx.phase_id, challenge_id=ctx.challenge_id) for e in events])
    await _send(websocket, ctx, state, view, applied={"ops": len(result.resolved_ops), "outcome": "CONCEDED"})


def _apply_card(ctx: PitchContext, state, view: pitch.CardView, override: bool = False) -> dict[str, Any]:
    """Writes the card to the graph. Unhappy owners land the change one level lower (D-debt)."""
    items = pitch.card_items(list(ctx.all_intel), set(state.card_item_ids))
    ops = pitch.card_ops(items)
    if not ops:
        return {"ops": 0, "outcome": state.outcome}
    buy_in = {r.stakeholder_id: (0.0 if override and r.band == "red" else r.buy_in) for r in view.reads}
    result = apply_ops(ctx.graph, ctx.state, ops, owner_buyin=buy_in)
    graph_store.append_ops(
        ctx.username,
        result.resolved_ops,
        phase_index=ctx.phase_id,
        challenge_template=ctx.challenge.template_id if ctx.challenge else "",
        challenge_loop_index=2,
        source_kind="action_card",
        source_id=f"card:{ctx.challenge.template_id if ctx.challenge else ctx.challenge_id}",
    )
    # Grudges are not written here: the simulation phase creates them from the same outcome
    # (plan 07 step 6), so writing them at commit would count everyone twice.
    return {
        "ops": len(result.resolved_ops),
        "outcome": state.outcome,
        "debt_created": [d.model_dump(mode="json") for d in result.debt_created],
    }


def _apply_stalemate(ctx: PitchContext) -> dict[str, Any]:
    """Nobody agreed, so the world moves on without the player (D7)."""
    from mlops_serious_game.domain.graph import GraphOp

    raw_ops = getattr(ctx.challenge, "stalemate_ops", None) or []
    if not raw_ops:
        return {"ops": 0, "outcome": "STALEMATE"}
    template = ctx.challenge.template_id if ctx.challenge else ""
    ops = [
        GraphOp.model_validate({**raw, "source_kind": "world_event", "source_id": f"stalemate:{template}"})
        for raw in raw_ops
    ]
    graph_store.append_ops(
        ctx.username, ops,
        phase_index=ctx.phase_id, challenge_template=template, challenge_loop_index=2,
        source_kind="world_event", source_id=f"stalemate:{template}",
    )
    return {"ops": len(ops), "outcome": "STALEMATE"}
