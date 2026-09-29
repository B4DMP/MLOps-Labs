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
from mlops_serious_game.application.action_card_veto_service import run_action_card_veto_workflow
from mlops_serious_game.application.graph_service import store as graph_store
from mlops_serious_game.application.graph_service.apply import apply_ops
from mlops_serious_game.application.pitch_debate_service import session as pitch
from mlops_serious_game.application.pitch_debate_service import store as pitch_store
from mlops_serious_game.application.pitch_debate_service.scoring import VETO_THRESHOLD
from mlops_serious_game.domain.emotion import VETO_MALUS
from mlops_serious_game.domain.emotion_factory import EmotionFactory
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
from mlops_serious_game.infrastructure.database import GameChallenge, get_session
from mlops_serious_game.infrastructure.websocket.handlers.log_handler import send_events
from mlops_serious_game.infrastructure.websocket.manager import manager


class PitchContext:
    """Everything one pitch message needs, gathered once."""

    def __init__(self, user_id: int, phase_id: int, challenge_id: int):
        self.user_id = user_id
        self.challenge = PhaseFactory.translate_challenge_index(
            challenge_index=challenge_id, phase_index=phase_id
        )
        self.phase_id = self.challenge.phase_id if self.challenge else phase_id
        self.challenge_id = self.challenge.id if self.challenge else challenge_id
        self.graph = GraphFactory.get_graph()
        replay = graph_store.load_state(user_id)
        self.state = replay.state
        self.all_intel = RequirementFactory.get_requirements_for_challenge(self.challenge_id)
        self.room = [
            (ps.stakeholder_id, ps.power, ps.interest)
            for ps in PhaseFactory.get_phases()[self.phase_id].stakeholders
        ]
        self.room_ids = [st_id for st_id, _, _ in self.room]
        self.emotions = pitch_store.emotion_values(user_id, self.room_ids)
        self.names = {
            st_id: (StakeholderFactory.get_stakeholder(st_id).name if StakeholderFactory.get_stakeholder(st_id) else st_id)
            for st_id, _, _ in self.room
        }

    def held_items(self) -> list:
        """What the player actually holds, across phases."""
        from mlops_serious_game.application.intel_handler import load_known_intel_items

        return load_known_intel_items(self.user_id, up_to_phase=self.phase_id)

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
        )


def _primary_veto_read(view: pitch.CardView) -> pitch.StakeholderRead:
    """Which stakeholder's veto is *the* veto: boundary violations first, then lowest buy-in.

    Shared by the VETO branch of `handle_pitch_commit` (who gets the malus and the chat message)
    and by `handle_pitch_veto_breaker` (who gets overridden) - both need the same answer to "who
    is actually blocking this," so there is exactly one place that decides it.
    """
    veto_reads = [
        r for r in view.reads
        if r.power == "high" and (r.boundary_violated or r.buy_in < VETO_THRESHOLD)
    ]
    veto_reads.sort(key=lambda r: (not r.boundary_violated, r.buy_in))
    if veto_reads:
        return veto_reads[0]
    fallback = [r for r in view.reads if r.boundary_violated or r.buy_in < VETO_THRESHOLD]
    return (fallback or view.reads)[0]


AUTOMATION_LEVEL_NAMES = ["Broken", "Absent", "Manual", "Automated"]
GOVERNANCE_LEVEL_NAMES = ["No governance", "Partially governed", "Mostly governed", "Fully governed"]


def _card_commitments(graph: TechnicalGraph, card_ops_list: list) -> list[str]:
    """One line per (target, axis) actually settled by this card, for the pitch LLM's prompt.

    A target chained through several steps on one axis (one authored option per rung - "Implement
    It" then "Automate It", each its own slot) shows up as one `raise_to` op per rung here; only
    the *last* one is what the card actually commits that target to; the earlier ones are just the
    stepping stones the slot mechanic requires. Collapsing to the final rung before handing this
    to the LLM keeps it from narrating a stakeholder's reaction around an intermediate step
    ("stepping to manual") the card has already moved past.
    """
    final_by_key: dict[tuple[str, Optional[str]], Any] = {}
    for op in card_ops_list:
        if op.kind in ("raise_to", "set_to"):
            final_by_key[(op.target, op.axis)] = op
        else:
            final_by_key[(op.target, op.kind, id(op))] = op

    commitments = []
    for op in final_by_key.values():
        target_name = graph.component(op.target).name if graph.is_component(op.target) else op.target
        if op.kind in ("raise_to", "set_to"):
            try:
                lvl_val = int(op.value) if op.value is not None else 1
                names = GOVERNANCE_LEVEL_NAMES if op.axis == "governance" else AUTOMATION_LEVEL_NAMES
                lvl_str = names[lvl_val] if 0 <= lvl_val < len(names) else str(lvl_val)
                commitments.append(f"- Raise {target_name} {op.axis or ''} to {lvl_str} (level {lvl_val})")
            except (ValueError, TypeError):
                commitments.append(f"- Update {target_name}: {op.value}")
        elif op.kind == "set_trigger":
            commitments.append(f"- Set trigger for {target_name}: {op.value}")
        else:
            commitments.append(f"- {op.kind} {target_name}: {op.value}")
    return commitments


def get_allowed_targets(
    graph: TechnicalGraph,
    phase_id: int,
    challenge_id: int,
    all_intel: list,
) -> list[str]:
    """Lifecycle nodes are viewable/editable only in their phase and challenge."""
    allowed: list[str] = []

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
            target, _, _ = item_target_and_level(r)
            if target and graph.is_component(target):
                challenge_targets.add(target)

        stage_comps = [c.id for c in graph.components if c.stage_id == phase_stage_id]
        relevant = [cid for cid in stage_comps if cid in challenge_targets]
        if relevant:
            allowed.extend(relevant)
        else:
            allowed.extend(stage_comps)

    allowed_set = set(allowed)
    for e in graph.edges:
        if e.from_id in allowed_set and e.to_id in allowed_set:
            allowed.append(e.id)

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
            correct_and_verify_intel_item(ctx.user_id, item_id, ctx.challenge)
            changed = True

    if not changed:
        return
    if ctx.challenge:
        dossier = await retrieve_dossier_data(ctx.challenge, websocket)
        await manager.send_event(websocket=websocket, event="intel:dossier_data", payload={"dossier": dossier})


def _load_or_start(ctx: PitchContext) -> "pitch.PitchState":
    state = pitch_store.load_pitch(ctx.user_id, ctx.phase_id, ctx.challenge_id)
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
    from mlops_serious_game.application.intel_handler import chain_index, speaker_of

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
        # Same attribution the dossier uses (`speaker_of`): a Fact has no `stakeholder_id` of its
        # own but still counts against its narrator, or the dossier's per-stakeholder totals run
        # ahead of this one.
        "intel_total": len([r for r in ctx.all_intel if speaker_of(r)]),
        "intel_verified": len([
            i for i in held
            if getattr(i, "challenge_id", None) == ctx.challenge_id
            and speaker_of(i)
            and counts_toward_readiness(getattr(i, "intel_type", None))
        ]),
        "emotion_deltas": state.emotion_deltas,
        "outcome": state.outcome,
        "presentation_count": getattr(state, "presentation_count", 0),
        "last_pitched_changes": [c.model_dump() for c in state.last_pitched_changes],
        "escalation_points": pitch_store.escalation_points(ctx.user_id),
    }
    payload.update(extra)
    return payload


async def _send(websocket: WebSocket, ctx: PitchContext, state, view, **extra) -> None:
    await manager.send_event(
        websocket=websocket, event="pitch:state", payload=_payload(ctx, state, view, **extra)
    )


async def handle_pitch_state(websocket: WebSocket, user_id: int, payload: dict) -> None:
    ctx = PitchContext(user_id, payload.get("phase_id", 0), payload.get("challenge_id", 0))
    state = _load_or_start(ctx)
    await _send(websocket, ctx, state, ctx.view(state))


async def handle_pitch_set_card(websocket: WebSocket, user_id: int, payload: dict) -> None:
    ctx = PitchContext(user_id, payload.get("phase_id", 0), payload.get("challenge_id", 0))
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
        kind = c.get("kind", "raise_to") if isinstance(c, dict) else getattr(c, "kind", "raise_to")
        axis = c.get("axis") if isinstance(c, dict) else getattr(c, "axis", None)
        val = c.get("value") if isinstance(c, dict) else getattr(c, "value", None)
        trigger = c.get("trigger") if isinstance(c, dict) else getattr(c, "trigger", None)
        attr = c.get("attr") if isinstance(c, dict) else getattr(c, "attr", None)
        valid_changes.append(pitch.AtomicChange(target=target, kind=kind, axis=axis, value=val, trigger=trigger, attr=attr))

    state.atomic_changes = valid_changes
    state.stage = "PREPARE"
    pitch_store.save_pitch(user_id, ctx.phase_id, ctx.challenge_id, state)
    await _send(websocket, ctx, state, ctx.view(state))


async def handle_pitch_evaluate(websocket: WebSocket, user_id: int, payload: dict) -> None:
    """Evaluates the pitched Action Card once against all room stakeholders."""
    ctx = PitchContext(user_id, payload.get("phase_id", 0), payload.get("challenge_id", 0))
    state = _load_or_start(ctx)

    if "atomic_changes" in payload:
        raw_changes = payload.get("atomic_changes", [])
        allowed = set(get_allowed_targets(ctx.graph, ctx.phase_id, ctx.challenge_id, list(ctx.all_intel)))
        state.atomic_changes = [
            pitch.AtomicChange(
                target=c.get("target") if isinstance(c, dict) else getattr(c, "target", None),
                kind=c.get("kind", "raise_to") if isinstance(c, dict) else getattr(c, "kind", "raise_to"),
                axis=c.get("axis") if isinstance(c, dict) else getattr(c, "axis", None),
                value=c.get("value") if isinstance(c, dict) else getattr(c, "value", None),
                trigger=c.get("trigger") if isinstance(c, dict) else getattr(c, "trigger", None),
                attr=c.get("attr") if isinstance(c, dict) else getattr(c, "attr", None),
            )
            for c in raw_changes[:pitch.MAX_ATOMIC_CHANGES]
            if (c.get("target") if isinstance(c, dict) else getattr(c, "target", None)) and (
                (c.get("target") if isinstance(c, dict) else getattr(c, "target", None)) in allowed
                or ctx.graph.is_target(c.get("target") if isinstance(c, dict) else getattr(c, "target", None))
            )
        ]

    if not state.atomic_changes:
        await _send(websocket, ctx, state, ctx.view(state), error="Configure at least one atomic graph change first")
        return

    if state.last_pitched_changes and pitch.same_card(state.atomic_changes, state.last_pitched_changes):
        await _send(websocket, ctx, state, ctx.view(state), error="Change the proposal before pitching it again")
        return

    existing_messages = []
    with get_session() as db:
        row = db.scalars(
            select(GameChallenge)
            .where(
                GameChallenge.user_id == user_id,
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
    commitments = _card_commitments(ctx.graph, card_ops_list)
    card_summary = "\n".join(commitments) if commitments else "No atomic changes configured in the proposed card."

    reads_by_st = {r.stakeholder_id: r for r in view.reads}
    card_atoms = {f"{op.kind}({op.target}, {op.value})" for op in card_ops_list}
    warnings = pitch.boundary_checks(
        ctx.graph, ctx.state, ctx.all_intel, state.atomic_changes, ctx.room_ids
    )
    violated_map: dict[str, list] = {}
    for w in warnings:
        if w.violated and w.stakeholder_id:
            violated_map.setdefault(w.stakeholder_id, []).append(w)

    stakeholders_ctx_list = []
    revealed_by_st: dict[str, list] = {}
    held_map = {i.id: i for i in ctx.held_items()}
    newly_verified_or_stored = False

    silent_ids = pitch.silent_stakeholders(state, new_state.reaction_signatures)

    for room_entry in ctx.room:
        st_id = room_entry[0]
        if st_id in silent_ids:
            continue
        power = room_entry[1]
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
        user_id=user_id,
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
        read = reads_by_st.get(st_id)
        emotional_state = read.emotional_state if read else "neutral"
        emotion_values = read.emotion_values if read else {}
        facial_expression = EmotionFactory.derive_facial_expression_for_state(emotional_state)
        buy_in_val = read.buy_in if read and read.buy_in is not None else 0.5

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
                "emotional_state": emotional_state,
                "facial_expression": facial_expression,
                "emotion_values": emotion_values,
                "emotion_dimensions": EmotionFactory.derive_gating_dimensions(emotion_values) if emotion_values else None,
                "emotion_dimensions_full": EmotionFactory.derive_all_dimensions(emotion_values) if emotion_values else None,
                "buy_in": buy_in_val,
            },
        )
        new_db_entries.append({
            "id": st_id,
            "message": msg_text,
            "conversation_id": pitch_conv_id,
            "ac_id": -1,
            "revealed_intel": st_revealed,
            "revealed_intel_items": st_revealed,
            "emotional_state": emotional_state,
            "facial_expression": facial_expression,
        })

    with get_session() as db:
        row = db.scalars(
            select(GameChallenge)
            .where(
                GameChallenge.user_id == user_id,
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

    if new_state.emotion_deltas:
        pitch_store.apply_emotion_deltas(user_id, new_state.emotion_deltas, ctx.room_ids)
    pitch_store.save_pitch(user_id, ctx.phase_id, ctx.challenge_id, new_state)
    await _send(websocket, ctx, new_state, view)


async def handle_pitch_commit(websocket: WebSocket, user_id: int, payload: dict) -> None:
    """Locks in the pitch outcome and, on anything but a veto, writes it to the graph."""
    ctx = PitchContext(user_id, payload.get("phase_id", 0), payload.get("challenge_id", 0))
    state = _load_or_start(ctx)

    if "atomic_changes" in payload:
        raw_changes = payload.get("atomic_changes", [])
        allowed = set(get_allowed_targets(ctx.graph, ctx.phase_id, ctx.challenge_id, list(ctx.all_intel)))
        state.atomic_changes = [
            pitch.AtomicChange(
                target=c.get("target") if isinstance(c, dict) else getattr(c, "target", None),
                kind=c.get("kind", "raise_to") if isinstance(c, dict) else getattr(c, "kind", "raise_to"),
                axis=c.get("axis") if isinstance(c, dict) else getattr(c, "axis", None),
                value=c.get("value") if isinstance(c, dict) else getattr(c, "value", None),
                trigger=c.get("trigger") if isinstance(c, dict) else getattr(c, "trigger", None),
                attr=c.get("attr") if isinstance(c, dict) else getattr(c, "attr", None),
            )
            for c in raw_changes[:pitch.MAX_ATOMIC_CHANGES]
            if (c.get("target") if isinstance(c, dict) else getattr(c, "target", None)) and (
                (c.get("target") if isinstance(c, dict) else getattr(c, "target", None)) in allowed
                or ctx.graph.is_target(c.get("target") if isinstance(c, dict) else getattr(c, "target", None))
            )
        ]

    if not state.atomic_changes:
        await _send(websocket, ctx, state, ctx.view(state), error="Configure at least one atomic graph change first")
        return

    view = ctx.view(state)
    committed_state, events = pitch.commit_pitch(state, view, names=ctx.names, graph=ctx.graph)
    applied: dict[str, Any] = {}
    veto_info: Optional[dict[str, Any]] = None

    if view.outcome != "VETO":
        applied = _apply_card(ctx, committed_state, view)
        if committed_state.emotion_deltas:
            ctx.emotions = pitch_store.apply_emotion_deltas(user_id, committed_state.emotion_deltas, ctx.room_ids)
    else:
        # 1. Identify high-power vetoing stakeholders
        primary_veto_read = _primary_veto_read(view)
        veto_st_id = primary_veto_read.stakeholder_id
        veto_st = StakeholderFactory.get_stakeholder(veto_st_id)
        # `ctx.names` only covers this phase's room roster - a vetoing stakeholder outside it
        # (e.g. an escalation from someone not seated this phase) would fall back to the raw id
        # there, so look the name up directly from the full roster instead.
        veto_st_name = veto_st.name if veto_st else ctx.names.get(veto_st_id, veto_st_id)

        # 2. Apply emotion penalty for the stakeholder who vetoes
        malus_key = "boundary_veto" if primary_veto_read.boundary_violated else "low_buyin_stalemate"
        veto_malus_delta = VETO_MALUS.get(malus_key, {})
        veto_deltas = {veto_st_id: veto_malus_delta}
        ctx.emotions = pitch_store.apply_emotion_deltas(user_id, veto_deltas, ctx.room_ids)

        # 3. Retrieve recent pitch chat history for this challenge
        existing_messages = []
        with get_session() as db:
            row = db.scalars(
                select(GameChallenge)
                .where(
                    GameChallenge.user_id == user_id,
                    GameChallenge.phase_index == ctx.phase_id,
                    GameChallenge.challenge_index == ctx.challenge_id,
                )
                .order_by(GameChallenge.id.desc())
            ).first()
            if row:
                existing_messages = list(row.messages or [])

        relevant_chat_msgs = [
            f"{m.get('stakeholder_name') or m.get('id')}: {m.get('message')}"
            for m in existing_messages
            if isinstance(m, dict) and (m.get("id") == veto_st_id or str(m.get("conversation_id", "")).startswith("pitch_"))
        ]
        pitch_chat_summary = "\n".join(relevant_chat_msgs[-6:]) if relevant_chat_msgs else ""

        # 4. Compute primary objection details
        card_ops_list = pitch.atomic_changes_to_ops(ctx.graph, ctx.state, state.atomic_changes)
        card_atoms = {f"{op.kind}({op.target}, {op.value})" for op in card_ops_list}
        commitments = _card_commitments(ctx.graph, card_ops_list)
        card_summary = "\n".join(commitments) if commitments else "No atomic changes configured."

        st_intel = [i for i in ctx.all_intel if getattr(i, "stakeholder_id", None) == veto_st_id]
        warnings = pitch.boundary_checks(
            ctx.graph, ctx.state, ctx.all_intel, state.atomic_changes, [veto_st_id]
        )
        violated_st_warnings = [w for w in warnings if w.violated and w.stakeholder_id == veto_st_id]

        primary_obj = pitch.compute_stakeholder_primary_objection(
            st_id=veto_st_id,
            st_intel=st_intel,
            changes=state.atomic_changes,
            card_atoms=card_atoms,
            violated_boundaries=violated_st_warnings,
            graph=ctx.graph,
            state=ctx.state,
        )

        challenge_context = (
            f"{ctx.challenge.name}: {ctx.challenge.roundIntroduction} "
            f"{personalize(ctx.challenge.description, resolve_markers=True)}"
            if ctx.challenge
            else "MLOps Project Resolution Meeting"
        )

        # 5. Run dedicated Action Card Veto LangGraph workflow
        veto_message, _ = await run_action_card_veto_workflow(
            user_id=user_id,
            phase_id=ctx.phase_id,
            challenge_id=ctx.challenge_id,
            challenge_context=challenge_context,
            action_card_summary=card_summary,
            action_card_commitments=commitments,
            stakeholder_id=veto_st_id,
            stakeholder_name=veto_st_name,
            stakeholder_role=getattr(veto_st, "role_description", "Key Decision Maker") if veto_st else "Key Decision Maker",
            stakeholder_power=primary_veto_read.power,
            stakeholder_responsibilities=veto_st.responsibilities if veto_st else "",
            stakeholder_priorities=veto_st.priorities if veto_st else "",
            stakeholder_constraints=getattr(veto_st, "constraints", getattr(veto_st, "requirements", "")) if veto_st else "",
            emotional_state=primary_veto_read.emotional_state,
            buy_in=primary_veto_read.buy_in,
            boundary_violated=primary_veto_read.boundary_violated,
            objection_kind=primary_obj["objection_kind"],
            objection_detail=primary_obj["objection_detail"],
            objection_target=primary_obj.get("objection_target"),
            pitch_chat_summary=pitch_chat_summary,
        )

        veto_info = {
            "stakeholder_id": veto_st_id,
            "stakeholder_name": veto_st_name,
            "power": primary_veto_read.power,
            "message": veto_message,
            "objection_kind": primary_obj["objection_kind"],
            "objection_detail": primary_obj["objection_detail"],
            "boundary_violated": primary_veto_read.boundary_violated,
        }

        # Send veto message event into the chat
        await manager.send_event(
            websocket=websocket,
            event="intel:message_received",
            payload={
                "type": "stakeholder_message",
                "stakeholder_id": veto_st_id,
                "stakeholder_name": veto_st_name,
                "message": f"🚫 [VETO] {veto_message}",
                "conversation_id": f"veto_{ctx.challenge_id}",
                "is_veto": True,
            },
        )

        with get_session() as db:
            row = db.scalars(
                select(GameChallenge)
                .where(
                    GameChallenge.user_id == user_id,
                    GameChallenge.phase_index == ctx.phase_id,
                    GameChallenge.challenge_index == ctx.challenge_id,
                )
                .order_by(GameChallenge.id.desc())
            ).first()
            if row:
                current_msgs = list(row.messages or [])
                current_msgs.append({
                    "id": veto_st_id,
                    "message": f"🚫 [VETO] {veto_message}",
                    "conversation_id": f"veto_{ctx.challenge_id}",
                    "ac_id": -1,
                    "is_veto": True,
                })
                row.messages = current_msgs
                flag_modified(row, "messages")
                db.commit()

    pitch_store.save_pitch(user_id, ctx.phase_id, ctx.challenge_id, committed_state)
    await send_events(websocket, user_id, [e.stamped(phase_id=ctx.phase_id, challenge_id=ctx.challenge_id) for e in events])
    await _send(websocket, ctx, committed_state, view, applied=applied, veto_info=veto_info)


async def handle_pitch_veto_breaker(websocket: WebSocket, user_id: int, payload: dict) -> None:
    """Spends an Escalation Point to push a stood veto through anyway (D15).

    Only usable on a committed veto - `pitch:commit` must have already landed on VETO, the same
    way the old flow required a "stood veto" before this was available. This pushes *that* card
    through; it does not let the player change the card first (that is just building a different
    one via `pitch:set_card`, free, no escalation needed - the tool exists for when no card would
    ever clear the room, not as a shortcut around building one).
    """
    ctx = PitchContext(user_id, payload.get("phase_id", 0), payload.get("challenge_id", 0))
    state = _load_or_start(ctx)
    if state.stage != "DONE" or state.outcome != "VETO":
        await _send(websocket, ctx, state, ctx.view(state), error="no veto standing to push through")
        return

    points = pitch_store.escalation_points(user_id)
    if points <= 0:
        await _send(websocket, ctx, state, ctx.view(state), error="no Escalation Points left")
        return

    view = ctx.view(state)
    overridden = _primary_veto_read(view).stakeholder_id
    updated_state, events = pitch.veto_breaker(state, overridden, names=ctx.names)

    ctx.emotions = pitch_store.apply_emotion_deltas(
        user_id, {overridden: EmotionFactory.get_pitch_tuning().emotion_veto_breaker}, ctx.room_ids
    )
    applied = _apply_card(ctx, updated_state, view)
    pitch_store.spend_escalation_point(user_id)

    pitch_store.save_pitch(user_id, ctx.phase_id, ctx.challenge_id, updated_state)
    await send_events(websocket, user_id, [e.stamped(phase_id=ctx.phase_id, challenge_id=ctx.challenge_id) for e in events])
    # `_payload` fetches escalation_points fresh, so it already reflects the spend above.
    await _send(websocket, ctx, updated_state, view, applied=applied, veto_info=None, veto_broken=True)


def _apply_card(ctx: PitchContext, state: pitch.PitchState, view: pitch.CardView) -> dict[str, Any]:
    """Evaluates card operations in memory for the pitch result. The simulation phase persists the graph changes."""
    ops = pitch.atomic_changes_to_ops(ctx.graph, ctx.state, state.atomic_changes)
    if not ops:
        return {"ops": 0, "outcome": state.outcome}
    buy_in = {r.stakeholder_id: r.buy_in for r in view.reads}
    result = apply_ops(ctx.graph, ctx.state, ops, owner_buyin=buy_in)
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
    "handle_pitch_veto_breaker",
]
