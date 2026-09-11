"""Websocket handlers for the merged pitch phase (plan 06).

Thin on purpose: every rule lives in `pitch_debate_service.session`, every write in
`pitch_debate_service.store` and `graph_service.store`. These handlers only gather the player's
situation, call in, and send back what the screen shows.

The graph is written exactly once per pitch, at commit.
"""

from typing import Any, Optional

from fastapi import WebSocket

from mlops_serious_game.application.graph_service import store as graph_store
from mlops_serious_game.application.graph_service.apply import apply_ops
from mlops_serious_game.application.pitch_debate_service import session as pitch
from mlops_serious_game.application.pitch_debate_service import store as pitch_store
from mlops_serious_game.application.pitch_debate_service.authored import load_authored_index
from mlops_serious_game.domain.emotion_factory import EmotionFactory
from mlops_serious_game.domain.graph_factory import GraphFactory
from mlops_serious_game.domain.persona_resolver import personalize
from mlops_serious_game.domain.phase_factory import PhaseFactory
from mlops_serious_game.domain.requirement_factory import RequirementFactory
from mlops_serious_game.infrastructure.database import GameSession, get_session
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
        self.emotions = pitch_store.emotion_values(username)
        self.points = pitch_store.escalation_points(username)

    def held_items(self) -> list:
        """What the player actually holds, across phases (plan 05)."""
        from mlops_serious_game.application.intel_handler import load_known_intel_items

        return load_known_intel_items(self.username, up_to_phase=self.phase_id)

    def view(self, state: "pitch.PitchState") -> pitch.CardView:
        archetypes = EmotionFactory.get_convincer_archetypes()
        return pitch.card_view(
            self.graph, self.state, self.all_intel, set(state.card_item_ids), self.room,
            self.archetypes,
            main_archetype=archetypes.get(state.main_archetype or ""),
            secondary_archetype=archetypes.get(state.secondary_archetype or ""),
            emotion_values=self.emotions,
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
            select(GameSession).where(GameSession.player == username).order_by(GameSession.id.desc())
        ).first()
        if row is None or not isinstance(row.stakeholder_archetypes, dict):
            return {}
        return dict(row.stakeholder_archetypes)


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
            select(GameSession).where(GameSession.player == username).order_by(GameSession.id.desc())
        ).first()
        drawn = dict(row.stakeholder_archetypes) if row and isinstance(row.stakeholder_archetypes, dict) else {}
    out: dict[str, Any] = {}
    for st_id in room_ids:
        name = (drawn.get(st_id) or {}).get("real_archetype") if isinstance(drawn.get(st_id), dict) else None
        arch = archetypes.get(name or "")
        if arch is not None:
            out[st_id] = arch
    return out


def _load_or_start(ctx: PitchContext) -> "pitch.PitchState":
    state = pitch_store.load_pitch(ctx.username, ctx.phase_id, ctx.challenge_id)
    return state or pitch.start_pitch(ctx.room_ids)


def _item_payload(item) -> dict:
    return {
        "id": item.id,
        "stakeholder_id": item.stakeholder_id,
        "type": item.type.value if hasattr(item.type, "value") else str(item.type),
        "description": personalize(item.description),
    }


def _payload(ctx: PitchContext, state: "pitch.PitchState", view: pitch.CardView, **extra) -> dict:
    held = ctx.held_items()
    card_ids = set(state.card_item_ids)
    options = {}
    for objection in state.open_objections():
        options[objection.id] = [
            spec.model_dump()
            for spec in pitch.options_for(objection, held, card_ids, ctx.points, state.amendments_left)
        ]
    payload = {
        "phase_id": ctx.phase_id,
        "challenge_id": ctx.challenge_id,
        "stage": state.stage,
        "card": [_item_payload(i) for i in pitch.card_items(held + list(ctx.all_intel), card_ids)][:pitch.MAX_CARD_ITEMS],
        "card_item_ids": state.card_item_ids,
        "main_archetype": state.main_archetype,
        "secondary_archetype": state.secondary_archetype,
        "available_items": [_item_payload(i) for i in held],
        "predictions": [p.model_dump() for p in view.predictions],
        "boundary_warnings": [w.model_dump() for w in view.boundary_warnings],
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
        "amendments_left": state.amendments_left,
        "escalation_points": ctx.points,
        "patience": state.patience,
        "outcome": state.outcome,
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


async def handle_pitch_object(websocket: WebSocket, username: str, payload: dict) -> None:
    """Locks the card and lets the room object. Same card, same objections (standing rule)."""
    ctx = PitchContext(username, payload.get("phase_id", 0), payload.get("challenge_id", 0))
    state = _load_or_start(ctx)
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


async def handle_pitch_answer(websocket: WebSocket, username: str, payload: dict) -> None:
    ctx = PitchContext(username, payload.get("phase_id", 0), payload.get("challenge_id", 0))
    state = _load_or_start(ctx)
    objection_id = payload.get("objection_id", "")
    objection = next((o for o in state.objections if o.id == objection_id), None)
    if objection is None:
        await _send(websocket, ctx, state, ctx.view(state), error="that objection is not open")
        return

    held = ctx.held_items()
    allowed = {
        spec.option
        for spec in pitch.options_for(
            objection, held, set(state.card_item_ids), ctx.points, state.amendments_left
        )
        if spec.available
    }
    result = pitch.answer_objection(
        state, objection_id, payload.get("option", ""), ctx.points, allowed,
        item_id=payload.get("item_id"),
        opposing_st_id=ctx.opposing_stakeholder(objection.stakeholder_id),
    )
    if result.rejected is None:
        pitch_store.save_pitch(username, ctx.phase_id, ctx.challenge_id, result.state)
        if result.spent_escalation_point:
            ctx.points = pitch_store.spend_escalation_point(username)
    await _send(websocket, ctx, result.state, ctx.view(result.state), error=result.rejected)


async def handle_pitch_commit(websocket: WebSocket, username: str, payload: dict) -> None:
    """Scores the card and, on anything but a veto, writes it to the graph."""
    ctx = PitchContext(username, payload.get("phase_id", 0), payload.get("challenge_id", 0))
    state = _load_or_start(ctx)
    view = ctx.view(state)
    state = pitch.commit_pitch(state, view)

    applied: dict[str, Any] = {}
    if view.outcome != "VETO":
        applied = _apply_card(ctx, state, view)
        ctx.emotions = pitch_store.apply_emotion_deltas(username, state.emotion_deltas)
    stalemate = pitch.is_stalemate(state, ctx.room, ctx.points)
    if stalemate:
        applied = _apply_stalemate(ctx)
        state = state.model_copy(update={"stage": "DONE", "outcome": "STALEMATE"})

    pitch_store.save_pitch(username, ctx.phase_id, ctx.challenge_id, state)
    await _send(websocket, ctx, state, view, applied=applied, stalemate=stalemate)


async def handle_pitch_rebuild(websocket: WebSocket, username: str, payload: dict) -> None:
    ctx = PitchContext(username, payload.get("phase_id", 0), payload.get("challenge_id", 0))
    state, error = pitch.rebuild(_load_or_start(ctx), ctx.room_ids)
    if error is None:
        pitch_store.save_pitch(username, ctx.phase_id, ctx.challenge_id, state)
    await _send(websocket, ctx, state, ctx.view(state), error=error)


async def handle_pitch_veto_breaker(websocket: WebSocket, username: str, payload: dict) -> None:
    ctx = PitchContext(username, payload.get("phase_id", 0), payload.get("challenge_id", 0))
    state = _load_or_start(ctx)
    view = ctx.view(state)
    vetoing = [r.stakeholder_id for r in view.reads if r.power == "high" and (r.boundary_violated or r.band == "red")]
    result = pitch.veto_breaker(state, ctx.points, vetoing)
    if result.rejected:
        await _send(websocket, ctx, state, view, error=result.rejected)
        return

    ctx.points = pitch_store.spend_escalation_point(username)
    applied = _apply_card(ctx, result.state, view, override=True)
    ctx.emotions = pitch_store.apply_emotion_deltas(username, result.state.emotion_deltas)
    pitch_store.save_pitch(username, ctx.phase_id, ctx.challenge_id, result.state)
    await _send(websocket, ctx, result.state, view, applied=applied)


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
