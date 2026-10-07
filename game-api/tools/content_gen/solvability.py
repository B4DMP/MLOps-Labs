"""Can a challenge be passed without a veto? Asked of a challenge's own intel, with the game's own pitch scoring.

A card is at most `MAX_ATOMIC_CHANGES` changes and only `raise_to` and `set_trigger` can be slotted, so
the search runs over the changes the items name (nothing else moves anyone's buy-in) and returns the
first card `card_view` does not call a VETO. Room emotions start neutral, as in a fresh run."""

import itertools
from typing import Optional


def item_changes(req) -> list[dict]:
    """Every change an item's payload names, as AtomicChange kwargs. A Trade-off's branches are
    alternatives, so both are offered; the search decides which to take."""
    from mlops_serious_game.domain.requirement import IntelTag

    out: list[dict] = []

    def add_ops(ops) -> None:
        for op in ops or []:
            if op.get("kind") == "raise_to" and op.get("axis") and isinstance(op.get("value"), int):
                out.append({"kind": "raise_to", "target": op["target"], "axis": op["axis"], "value": op["value"]})
            elif op.get("kind") == "set_trigger" and op.get("value"):
                out.append({"kind": "set_trigger", "target": op["target"], "value": op["value"]})

    if req.type == IntelTag.DRIVER and req.suggested is not None and req.suggested.axis:
        out.append({"kind": "raise_to", "target": req.suggested.target, "axis": req.suggested.axis,
                    "value": req.suggested.level})
    add_ops(req.ops)
    for branch in (req.branch_x, req.branch_y):
        if branch is None:
            continue
        if branch.target and branch.axis and branch.level is not None:
            out.append({"kind": "raise_to", "target": branch.target, "axis": branch.axis, "value": branch.level})
        add_ops(branch.ops)
    return out


def candidate_changes(graph, state, reqs) -> list:
    """Distinct slottable changes named by the items that would actually move something.

    A raise_to is capped to one rung per card (resolve_step_cap), so an item naming a level more
    than one rung above the current one is only reachable via an intermediate card too - inserted
    here as its own candidate so the search can actually find the real multi-slot path. Two cases:
    governance on a target whose automation is still below manual (needs the automation floor
    first - and a governance raise there is rejected outright, not capped, if that floor is
    missing), and an automation raise that jumps past manual (broken/absent straight to automated,
    where the floor after either resting state is always manual, never a skipped level)."""
    from mlops_serious_game.application.pitch_debate_service import session as pitch
    from mlops_serious_game.domain.graph import AutomationState

    seen: set[tuple] = set()
    out = []

    def _add_floor(target: str, auto: Optional[int]) -> None:
        if auto is None:
            return
        floor_key = ("raise_to", target, "automation", auto)
        if floor_key not in seen:
            seen.add(floor_key)
            out.append(pitch.AtomicChange(kind="raise_to", target=target, axis="automation", value=auto))

    for req in reqs:
        for spec in item_changes(req):
            key = (spec["kind"], spec["target"], spec.get("axis"), spec["value"])
            if key in seen or not graph.is_target(spec["target"]):
                continue
            if spec["kind"] == "raise_to":
                current = state.value(spec["target"], spec["axis"])
                if spec["value"] <= current:
                    continue
                manual_or_above = (a for a in graph.allowed_for(spec["target"], "automation") if a >= AutomationState.MANUAL)
                if spec["axis"] == "governance" and current < AutomationState.MANUAL:
                    # Governance on something not yet implemented needs its automation step in the same card.
                    _add_floor(spec["target"], min(manual_or_above, default=None))
                elif (
                    spec["axis"] == "automation"
                    and current < AutomationState.MANUAL
                    and spec["value"] > AutomationState.MANUAL
                ):
                    # A multi-rung automation jump (broken/absent straight to automated) needs
                    # the manual floor slotted first.
                    _add_floor(spec["target"], min(manual_or_above, default=None))
            seen.add(key)
            out.append(pitch.AtomicChange(**spec))
    return out


def find_veto_free_card(graph, state, reqs, room: list[tuple], emotion_values: Optional[dict] = None) -> Optional[list]:
    """A card of at most three changes the room does not veto, or None. Exhaustive over `candidate_changes`."""
    from mlops_serious_game.application.pitch_debate_service import session as pitch
    from mlops_serious_game.domain.emotion_factory import EmotionFactory

    if emotion_values is None:
        emotion_values = {sid: EmotionFactory.create_default_emotion_values(0.5) for sid, *_ in room}
    candidates = candidate_changes(graph, state, reqs)
    for size in range(0, min(pitch.MAX_ATOMIC_CHANGES, len(candidates)) + 1):
        for card in itertools.combinations(candidates, size):
            view = pitch.card_view(graph=graph, state=state, all_intel=list(reqs), changes=list(card),
                                   room=room, emotion_values=emotion_values)
            if view.outcome != "VETO":
                return list(card)
    return None


def room_of(roster: list[dict]) -> list[tuple]:
    return [(r["stakeholder_id"], r["power"], r["interest"]) for r in roster]


def veto_free_errors(ctx, challenge: dict, roster: list[dict], reqs: list) -> list[str]:
    """Empty when some card passes; otherwise one message the generator can act on."""
    from content_gen.stages.items import challenge_state

    if not any(r["power"] == "high" for r in roster):
        return []
    state = challenge_state(ctx, challenge)
    if find_veto_free_card(ctx.graph, state, [r for r in reqs if r.type != "fact"], room_of(roster)) is not None:
        return []
    high = sorted(r["stakeholder_id"] for r in roster if r["power"] == "high")
    return [
        f"no card of at most 3 changes gets past a veto from {high}: boundaries of high power stakeholders must "
        "be satisfiable together, and each of them needs at least one driver or trade_off a card can meet. "
        "Loosen a boundary, give a driver a smaller first step, or turn a demand into a trade_off"
    ]
