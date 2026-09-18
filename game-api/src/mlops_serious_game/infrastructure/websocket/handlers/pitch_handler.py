"""Websocket handlers for the streamlined pitch negotiation phase.

Thin on purpose: every rule lives in `pitch_debate_service.session`, every write in
`pitch_debate_service.store` and `graph_service.store`. These handlers gather the player's
situation, call into session logic, and send back what the screen shows.
"""

from typing import Any, Optional

from fastapi import WebSocket

from sqlalchemy import select
from sqlalchemy.orm.attributes import flag_modified

from mlops_serious_game.application.action_card_pitch_service import run_action_card_pitch_workflow
from mlops_serious_game.application.graph_service import store as graph_store
from mlops_serious_game.application.graph_service.apply import apply_ops
from mlops_serious_game.application.pitch_debate_service import session as pitch
from mlops_serious_game.application.pitch_debate_service import store as pitch_store
from mlops_serious_game.domain.graph import GraphOp, TechnicalGraph
from mlops_serious_game.domain.graph_factory import GraphFactory
from mlops_serious_game.domain.persona_resolver import personalize
from mlops_serious_game.domain.phase_factory import PhaseFactory
from mlops_serious_game.domain.requirement import (
    ConfidenceType,
    IntelSource,
    StakeholderIntelItem,
    counts_toward_readiness,
    item_target_and_level,
)
from mlops_serious_game.domain.requirement_factory import RequirementFactory
from mlops_serious_game.domain.stakeholder_factory import StakeholderFactory
from mlops_serious_game.infrastructure.database import GameChallenge, get_session, get_user_id
from mlops_serious_game.infrastructure.websocket.handlers.log_handler import send_events
from mlops_serious_game.infrastructure.websocket.manager import manager


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
        self.emotions = pitch_store.emotion_values(username, self.room_ids)
        self.names = {
            st_id: (StakeholderFactory.get_stakeholder(st_id).name if StakeholderFactory.get_stakeholder(st_id) else st_id)
            for st_id, _ in self.room
        }

    def held_items(self) -> list:
        """What the player actually holds, across phases."""
        from mlops_serious_game.application.intel_handler import load_known_intel_items

        return load_known_intel_items(self.username, up_to_phase=self.phase_id)

    def view(self, state: "pitch.PitchState") -> pitch.CardView:
        current_emotions = dict(self.emotions)
        if state.emotion_deltas:
            current_emotions = pitch_store.shift_emotions(current_emotions, state.emotion_deltas)
        return pitch.card_view(
            graph=self.graph,
            state=self.state,
            all_intel=self.all_intel,
            changes=state.atomic_changes,
            room=self.room,
            emotion_values=current_emotions,
            knowledge=self.knowledge,
        )


def get_allowed_targets(graph: TechnicalGraph, phase_id: int, challenge_id: int, all_intel: list) -> list[str]:
    """Governance and infra nodes are viewable/editable anytime; lifecycle nodes only in their phase and challenge."""
    allowed: list[str] = []
    for c in graph.components:
        if c.stage_id == "gov":
            allowed.append(c.id)

    # Phase 0 is the introduction phase; it is skipped for stage calculations (maps to Phase 1: 'req')
    effective_phase = 1 if phase_id == 0 else phase_id
    phase_stage_id = None
    for s in graph.stages:
        if s.phase_id == effective_phase:
            phase_stage_id = s.id
            break

    if phase_stage_id:
        challenge_targets = set()
        for r in all_intel:
            target, _ = item_target_and_level(r)
            if target and graph.is_component(target):
                challenge_targets.add(target)

        stage_comps = [c.id for c in graph.components if c.stage_id == phase_stage_id]
        relevant = [cid for cid in stage_comps if cid in challenge_targets]
        if relevant:
            allowed.extend(relevant)
        else:
            allowed.extend(stage_comps)

    return allowed


def _is_verified(item) -> bool:
    return str(getattr(item.intel_type, "value", item.intel_type)).lower() == "verified"


async def _verify_heard(
    websocket: WebSocket,
    ctx: PitchContext,
    item_ids: list[str],
) -> None:
    """Auto-corrects and verifies heard items in the player's dossier."""
    from mlops_serious_game.application.intel_handler import (
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

    if not changed:
        return
    if ctx.challenge:
        dossier = await retrieve_dossier_data(ctx.challenge, websocket)
        await manager.send_event(websocket=websocket, event="intel:dossier_data", payload={"dossier": dossier})


def _load_or_start(ctx: PitchContext) -> "pitch.PitchState":
    state = pitch_store.load_pitch(ctx.username, ctx.phase_id, ctx.challenge_id)
    return state or pitch.start_pitch(ctx.room_ids)


def _item_payload(item, chains: Optional[dict] = None) -> dict:
    chain = (chains or {}).get(item.id, {})
    intel_type = getattr(item, "intel_type", "unconfirmed")
    intel_type_val = intel_type.value if hasattr(intel_type, "value") else str(intel_type)
    cat_type = getattr(item, "categorized_type", getattr(item, "type", None))
    cat_type_val = cat_type.value if hasattr(cat_type, "value") else str(cat_type)
    is_verified = (intel_type_val.lower() == "verified")
    display_desc = item.description if is_verified else (getattr(item, "categorized_description", None) or item.description)
    source = getattr(item, "source", None)
    source_val = source.value if hasattr(source, "value") else (str(source) if source else None)
    bx = getattr(item, "branch_x", None)
    by = getattr(item, "branch_y", None)
    return {
        "id": item.id,
        "stakeholder_id": item.stakeholder_id,
        "type": cat_type_val,
        "categorized_type": cat_type_val,
        "intel_type": intel_type_val,
        "source": source_val,
        "description": personalize(display_desc),
        "chain_id": chain.get("chain_id", item.id),
        "chain_position": chain.get("chain_position", 0),
        "chain_length": chain.get("chain_length", 1),
        "branch_x": bx.model_dump(mode="json") if hasattr(bx, "model_dump") else bx,
        "branch_y": by.model_dump(mode="json") if hasattr(by, "model_dump") else by,
    }


def _payload(ctx: PitchContext, state: "pitch.PitchState", view: pitch.CardView, **extra) -> dict:
    from mlops_serious_game.application.intel_handler import chain_index

    held = ctx.held_items()
    chains = chain_index(held)
    allowed_targets = get_allowed_targets(ctx.graph, ctx.phase_id, ctx.challenge_id, list(ctx.all_intel))
    upstream_map = {c.id: pitch.find_pipeline_predecessors(ctx.graph, c.id) for c in ctx.graph.components}

    payload = {
        "phase_id": ctx.phase_id,
        "challenge_id": ctx.challenge_id,
        "stage": state.stage,
        "atomic_changes": [c.model_dump() for c in state.atomic_changes],
        "allowed_targets": allowed_targets,
        "upstream_map": upstream_map,
        "available_items": [_item_payload(i, chains) for i in held],
        "predictions": [p.model_dump() for p in view.predictions],
        "boundary_warnings": [
            {**w.model_dump(), "line": personalize(w.line) if w.line else None}
            for w in pitch.player_boundary_warnings(ctx.graph, view.boundary_warnings, held)
        ],
        "reads": [r.model_dump() for r in view.reads],
        "predicted_outcome": view.outcome,
        "objections": [o.model_dump() for o in state.open_objections()],
        "feedback_messages": [m.model_dump() for m in state.feedback_messages],
        "intel_total": len([r for r in ctx.all_intel if r.stakeholder_id]),
        "intel_verified": len([
            i for i in held
            if getattr(i, "challenge_id", None) == ctx.challenge_id
            and counts_toward_readiness(getattr(i, "intel_type", None))
        ]),
        "emotion_deltas": state.emotion_deltas,
        "outcome": state.outcome,
        "presentation_count": getattr(state, "presentation_count", 0),
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

    raw_changes = payload.get("atomic_changes", [])
    allowed = set(get_allowed_targets(ctx.graph, ctx.phase_id, ctx.challenge_id, list(ctx.all_intel)))

    valid_changes: list[pitch.AtomicChange] = []
    for c in raw_changes[:pitch.MAX_ATOMIC_CHANGES]:
        target = c.get("target") if isinstance(c, dict) else getattr(c, "target", None)
        if not target or target not in allowed:
            await _send(
                websocket,
                ctx,
                state,
                ctx.view(state),
                error=f"Target '{target}' is not viewable or editable in this phase/challenge.",
            )
            return
        valid_changes.append(pitch.AtomicChange(target=target, kind="raise_to"))

    state.atomic_changes = valid_changes
    state.stage = "PREPARE"
    pitch_store.save_pitch(username, ctx.phase_id, ctx.challenge_id, state)
    await _send(websocket, ctx, state, ctx.view(state))


async def handle_pitch_evaluate(websocket: WebSocket, username: str, payload: dict) -> None:
    """Evaluates the pitched Action Card once against all room stakeholders."""
    ctx = PitchContext(username, payload.get("phase_id", 0), payload.get("challenge_id", 0))
    state = _load_or_start(ctx)

    if "atomic_changes" in payload:
        raw_changes = payload.get("atomic_changes", [])
        allowed = set(get_allowed_targets(ctx.graph, ctx.phase_id, ctx.challenge_id, list(ctx.all_intel)))
        state.atomic_changes = [
            pitch.AtomicChange(target=c["target"], kind="raise_to")
            for c in raw_changes[:pitch.MAX_ATOMIC_CHANGES]
            if (c.get("target") if isinstance(c, dict) else getattr(c, "target", None)) in allowed
        ]

    if not state.atomic_changes:
        await _send(websocket, ctx, state, ctx.view(state), error="Configure at least one atomic graph change first")
        return

    existing_messages = []
    with get_session() as db:
        row = db.scalars(
            select(GameChallenge)
            .where(
                GameChallenge.user_id == get_user_id(db, username),
                GameChallenge.phase_index == ctx.phase_id,
                GameChallenge.challenge_index == ctx.challenge_id,
            )
            .order_by(GameChallenge.id.desc())
        ).first()
        if row:
            existing_messages = list(row.messages or [])

    prefix = "pitch_"
    matching_pitch_ids = {
        m.get("conversation_id")
        for m in existing_messages
        if isinstance(m, dict) and str(m.get("conversation_id", "")).startswith(prefix)
    }
    pitch_index = max(len(matching_pitch_ids) + 1, getattr(state, "presentation_count", 0) + 1)
    pitch_conv_id = f"{prefix}{pitch_index}"

    new_state, view, items_to_correct = pitch.evaluate_pitch(
        graph=ctx.graph,
        state=ctx.state,
        all_intel=ctx.all_intel,
        changes=state.atomic_changes,
        room=ctx.room,
        current_emotions=ctx.emotions,
        held_items=ctx.held_items(),
        names=ctx.names,
        knowledge=ctx.knowledge,
        presentation_count=pitch_index,
    )

    if items_to_correct:
        await _verify_heard(websocket, ctx, items_to_correct)


    # Prepare context for the dedicated Action Card Pitch LangGraph service
    challenge_context = (
        f"{ctx.challenge.name}: {ctx.challenge.roundIntroduction} "
        f"{personalize(ctx.challenge.description, resolve_markers=True)}"
        if ctx.challenge
        else "MLOps Project Resolution Meeting"
    )

    card_ops_list = pitch.atomic_changes_to_ops(ctx.graph, ctx.state, state.atomic_changes)
    level_names = ["Broken", "Absent", "Manual", "Automated", "Governed"]
    commitments = []
    for op in card_ops_list:
        target_name = ctx.graph.component(op.target).name if ctx.graph.is_component(op.target) else op.target
        lvl_val = int(op.value) if op.value is not None else 1
        lvl_str = level_names[lvl_val] if 0 <= lvl_val <= 4 else str(lvl_val)
        commitments.append(f"- Raise {target_name} to {lvl_str} (Level {lvl_val})")
    card_summary = "\n".join(commitments) if commitments else "No atomic changes configured in the proposed card."

    reads_by_st = {r.stakeholder_id: r for r in view.reads}
    card_atoms = {f"{op.kind}({op.target}, {op.value})" for op in card_ops_list}
    warnings = pitch.boundary_checks(
        ctx.graph, ctx.state, ctx.all_intel, state.atomic_changes, ctx.room_ids, knowledge=ctx.knowledge
    )
    violated_map: dict[str, list] = {}
    for w in warnings:
        if w.violated and w.stakeholder_id:
            violated_map.setdefault(w.stakeholder_id, []).append(w)

    stakeholders_ctx_list = []
    revealed_by_st: dict[str, list] = {}
    held_map = {i.id: i for i in ctx.held_items()}
    newly_verified_or_stored = False

    for st_id, power in ctx.room:
        st = StakeholderFactory.get_stakeholder(st_id)
        st_name = ctx.names.get(st_id, st.name if st else st_id)
        st_intel = [i for i in ctx.all_intel if getattr(i, "stakeholder_id", None) == st_id]
        read = reads_by_st.get(st_id)
        buy_in_val = read.buy_in if read and read.buy_in is not None else 0.5
        band = read.band if read else "amber"
        emotional_state = read.emotional_state if read else "neutral"
        emotion_values = read.emotion_values if read else {}
        boundary_violated = read.boundary_violated if read else False

        primary_obj = pitch.compute_stakeholder_primary_objection(
            st_id=st_id,
            st_intel=st_intel,
            changes=state.atomic_changes,
            card_atoms=card_atoms,
            violated_boundaries=violated_map.get(st_id, []),
            graph=ctx.graph,
            state=ctx.state,
        )

        obj_item_id = primary_obj.get("item_id")
        if obj_item_id and not primary_obj.get("is_approval", False):
            held_item = held_map.get(obj_item_id)
            is_already_verified = held_item is not None and _is_verified(held_item)
            if not is_already_verified:
                req = next((r for r in st_intel if getattr(r, "id", None) == obj_item_id), None)
                if not req:
                    req = RequirementFactory.get_requirement(obj_item_id)
                if req:
                    intel_item = StakeholderIntelItem.from_requirement(
                        req,
                        intel_type=ConfidenceType.VERIFIED,
                        categorized_type=req.type,
                        categorized_description=req.description,
                        source=IntelSource.DEBATE,
                    )
                    intel_item.dossier_source = "objection"
                    if websocket and ctx.challenge:
                        from mlops_serious_game.application.intel_handler import store_intel_item
                        await store_intel_item(ctx.challenge, websocket, intel_item)
                        newly_verified_or_stored = True

                    item_dict = intel_item.model_dump(mode="json")
                    item_dict["is_verified"] = True
                    item_dict["stakeholder_id"] = st_id
                    item_dict["stakeholder_name"] = st_name
                    revealed_by_st[st_id] = [item_dict]

        constraints = getattr(st, "constraints", getattr(st, "requirements", "")) if st else ""

        stakeholders_ctx_list.append({
            "stakeholder_id": st_id,
            "stakeholder_name": st_name,
            "responsibilities": st.responsibilities if st else "",
            "priorities": st.priorities if st else "",
            "constraints": constraints,
            "power": power,
            "emotional_state": emotional_state,
            "emotion_values": emotion_values,
            "buy_in": buy_in_val,
            "band": band,
            "boundary_violated": boundary_violated,
            "is_approval": primary_obj["is_approval"],
            "objection_kind": primary_obj["objection_kind"],
            "objection_detail": primary_obj["objection_detail"],
            "objection_target": primary_obj.get("objection_target"),
            "distance": primary_obj.get("distance", 0.0),
        })

    if newly_verified_or_stored and ctx.challenge and websocket:
        from mlops_serious_game.application.intel_handler import retrieve_dossier_data
        dossier = await retrieve_dossier_data(ctx.challenge, websocket)
        await manager.send_event(websocket=websocket, event="intel:dossier_data", payload={"dossier": dossier})

    addressed_names_str = ", ".join([s["stakeholder_name"] for s in stakeholders_ctx_list])

    player_msg, stakeholder_responses, _ = await run_action_card_pitch_workflow(
        username=username,
        phase_id=ctx.phase_id,
        challenge_id=ctx.challenge_id,
        challenge_context=challenge_context,
        pitch_attempt=pitch_index,
        action_card_summary=card_summary,
        action_card_commitments=commitments,
        stakeholders=stakeholders_ctx_list,
        addressed_stakeholders=addressed_names_str,
    )

    await manager.send_event(
        websocket=websocket,
        event="intel:message_received",
        payload={
            "type": "player_message",
            "message": player_msg,
            "conversation_id": pitch_conv_id,
        },
    )

    new_db_entries = [
        {
            "id": "user",
            "message": player_msg,
            "conversation_id": pitch_conv_id,
            "ac_id": -1,
        }
    ]

    for resp in stakeholder_responses:
        st_id = resp["stakeholder_id"]
        st_name = resp.get("stakeholder_name") or ctx.names.get(st_id, st_id)
        msg_text = resp["message"]
        st_revealed = revealed_by_st.get(st_id, [])
        await manager.send_event(
            websocket=websocket,
            event="intel:message_received",
            payload={
                "type": "stakeholder_message",
                "stakeholder_id": st_id,
                "stakeholder_name": st_name,
                "message": msg_text,
                "conversation_id": pitch_conv_id,
                "revealed_intel": st_revealed,
                "revealed_intel_items": st_revealed,
            },
        )
        new_db_entries.append({
            "id": st_id,
            "message": msg_text,
            "conversation_id": pitch_conv_id,
            "ac_id": -1,
            "revealed_intel": st_revealed,
            "revealed_intel_items": st_revealed,
        })

    with get_session() as db:
        row = db.scalars(
            select(GameChallenge)
            .where(
                GameChallenge.user_id == get_user_id(db, username),
                GameChallenge.phase_index == ctx.phase_id,
                GameChallenge.challenge_index == ctx.challenge_id,
            )
            .order_by(GameChallenge.id.desc())
        ).first()
        if row:
            current_msgs = list(row.messages or [])
            current_msgs.extend(new_db_entries)
            row.messages = current_msgs
            flag_modified(row, "messages")
            db.commit()

    pitch_store.save_pitch(username, ctx.phase_id, ctx.challenge_id, new_state)
    await _send(websocket, ctx, new_state, view)


async def handle_pitch_commit(websocket: WebSocket, username: str, payload: dict) -> None:
    """Locks in the pitch outcome and, on anything but a veto, writes it to the graph."""
    ctx = PitchContext(username, payload.get("phase_id", 0), payload.get("challenge_id", 0))
    state = _load_or_start(ctx)

    if "atomic_changes" in payload:
        raw_changes = payload.get("atomic_changes", [])
        allowed = set(get_allowed_targets(ctx.graph, ctx.phase_id, ctx.challenge_id, list(ctx.all_intel)))
        state.atomic_changes = [
            pitch.AtomicChange(target=c["target"], kind="raise_to")
            for c in raw_changes[:pitch.MAX_ATOMIC_CHANGES]
            if (c.get("target") if isinstance(c, dict) else getattr(c, "target", None)) in allowed
        ]

    if not state.atomic_changes:
        await _send(websocket, ctx, state, ctx.view(state), error="Configure at least one atomic graph change first")
        return

    view = ctx.view(state)
    committed_state, events = pitch.commit_pitch(state, view, names=ctx.names)
    applied: dict[str, Any] = {}
    if view.outcome != "VETO":
        applied = _apply_card(ctx, committed_state, view)
        if committed_state.emotion_deltas:
            ctx.emotions = pitch_store.apply_emotion_deltas(username, committed_state.emotion_deltas, ctx.room_ids)

    pitch_store.save_pitch(username, ctx.phase_id, ctx.challenge_id, committed_state)
    await send_events(websocket, username, [e.stamped(phase_id=ctx.phase_id, challenge_id=ctx.challenge_id) for e in events])
    await _send(websocket, ctx, committed_state, view, applied=applied)


def _apply_card(ctx: PitchContext, state: pitch.PitchState, view: pitch.CardView) -> dict[str, Any]:
    """Writes the card to the graph from atomic changes."""
    ops = pitch.atomic_changes_to_ops(ctx.graph, ctx.state, state.atomic_changes)
    if not ops:
        return {"ops": 0, "outcome": state.outcome}
    buy_in = {r.stakeholder_id: r.buy_in for r in view.reads}
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
    return {
        "ops": len(result.resolved_ops),
        "outcome": state.outcome,
        "debt_created": [d.model_dump(mode="json") for d in result.debt_created],
    }


__all__ = [
    "PitchContext",
    "handle_pitch_state",
    "handle_pitch_set_card",
    "handle_pitch_evaluate",
    "handle_pitch_commit",
]
