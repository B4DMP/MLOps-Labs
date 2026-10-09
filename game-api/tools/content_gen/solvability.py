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
    """A card of at most MAX_ATOMIC_CHANGES changes the room does not veto, or None. Exhaustive over `candidate_changes`."""
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


# The incident is fixable with room to spare: several cards at par, and at least two that leave a slot free,
# so a player is never asked to guess the one four-change combination.
REPAIR_MIN_AT_PAR = 3
REPAIR_MIN_SPARE = 2
_RANK = {"PASS": 2, "SOFT_PASS": 1, "VETO": 0}


def incident_of(challenge) -> Optional[tuple[str, str]]:
    """(target, axis) the challenge's opening world event breaks first, or None."""
    ops = challenge.get("on_enter_ops") if isinstance(challenge, dict) else getattr(challenge, "on_enter_ops", None)
    for op in ops or []:
        if op.get("kind") == "set_to" and op.get("target"):
            return op["target"], op.get("axis") or "automation"
    return None


def repair_report(
    graph, state, reqs, room: list[tuple], target: str, axis: str = "automation", par: str = "PASS",
    emotion_values: Optional[dict] = None, need_at_par: int = REPAIR_MIN_AT_PAR, need_spare: int = REPAIR_MIN_SPARE,
) -> dict:
    """How many cards put the broken `target` back to working order (Manual or better) and still get the
    room's par outcome, and how many of those leave a slot free. Stops as soon as both needs are met.

    Exhaustive over the changes the items name plus the repair itself, so a room where only one
    four-change card works shows as `at_par == 1`."""
    from mlops_serious_game.application.pitch_debate_service import session as pitch
    from mlops_serious_game.domain.emotion_factory import EmotionFactory
    from mlops_serious_game.domain.graph import AutomationState

    report = {"target": target, "repairing": 0, "at_par": 0, "spare": 0, "best": "VETO", "searched_all": True}
    if state.value(target, axis) >= AutomationState.MANUAL:
        return {**report, "at_par": need_at_par, "spare": need_spare}
    levels = [lv for lv in graph.allowed_for(target, axis) if lv >= AutomationState.MANUAL]
    if not levels:
        return report
    repair = pitch.AtomicChange(kind="raise_to", target=target, axis=axis, value=min(levels))
    if emotion_values is None:
        emotion_values = {sid: EmotionFactory.create_default_emotion_values(0.5) for sid, *_ in room}
    others = [c for c in candidate_changes(graph, state, reqs) if not (c.target == target and c.axis == axis)]
    wanted = _RANK.get(par, 2)
    for size in range(0, min(pitch.MAX_ATOMIC_CHANGES - 1, len(others)) + 1):
        for extra in itertools.combinations(others, size):
            card = [repair, *extra]
            view = pitch.card_view(graph=graph, state=state, all_intel=list(reqs), changes=card,
                                   room=room, emotion_values=emotion_values)
            report["repairing"] += 1
            if _RANK.get(view.outcome, 0) > _RANK[report["best"]]:
                report["best"] = view.outcome
            if _RANK.get(view.outcome, 0) >= wanted:
                report["at_par"] += 1
                if len(card) < pitch.MAX_ATOMIC_CHANGES:
                    report["spare"] += 1
            if report["at_par"] >= need_at_par and report["spare"] >= need_spare:
                report["searched_all"] = False
                return report
    return report


def repair_errors(graph, state, reqs, room: list[tuple], challenge, par: str = "PASS") -> list[str]:
    """Empty when the incident can be fixed at par with room to spare; otherwise one message to act on."""
    incident = incident_of(challenge)
    if incident is None:
        return []
    target, axis = incident
    r = repair_report(graph, state, [q for q in reqs if q.type != "fact"], room, target, axis, par)
    # A small room (the demo has two stakeholders) offers few cards at all: half of them is enough there.
    needed = min(REPAIR_MIN_AT_PAR, max(1, r["repairing"] // 2))
    spare_needed = min(REPAIR_MIN_SPARE, needed)
    if r["at_par"] >= needed and r["spare"] >= spare_needed:
        return []
    return [
        f"repairing {target} reaches {par} with only {r['at_par']} of {r['repairing']} cards, {r['spare']} of them leaving a slot free "
        f"(best outcome {r['best']}; need {needed} and {spare_needed}): a boundary or an unmet demand blocks the fix, or "
        "every passing card needs all the slots. A repair has to stay inside every high power boundary, and a stakeholder should ask "
        "for it or accept it, so that fixing what broke is also what the room wants"
    ]


def room_of(roster: list[dict]) -> list[tuple]:
    return [(r["stakeholder_id"], r["power"], r["interest"]) for r in roster]


def veto_free_errors(ctx, challenge: dict, roster: list[dict], reqs: list) -> list[str]:
    """Empty when some card passes; otherwise one message the generator can act on."""
    from mlops_serious_game.application.pitch_debate_service import session as pitch
    from content_gen.stages.items import challenge_state

    if not any(r["power"] == "high" for r in roster):
        return []
    state = challenge_state(ctx, challenge)
    if find_veto_free_card(ctx.graph, state, [r for r in reqs if r.type != "fact"], room_of(roster)) is not None:
        return []
    high = sorted(r["stakeholder_id"] for r in roster if r["power"] == "high")
    return [
        f"no card of at most {pitch.MAX_ATOMIC_CHANGES} changes gets past a veto from {high}: boundaries of high power stakeholders must "
        "be satisfiable together, and each of them needs at least one driver or trade_off a card can meet. "
        "Loosen a boundary, give a driver a smaller first step, or turn a demand into a trade_off"
    ]
