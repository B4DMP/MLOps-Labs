"""Hand the Pen (docs/plans/hand-over-the-pen.md): handler-level round trip - delegate seals a
draft, the next evaluate reveals it, a demo phase and a second pen the same challenge are refused.

`pen.py`'s own trust-band/eligibility/boundary logic is unit-tested directly in test_pen.py (on
the stuck challenge's content, many legal changes cross a Boundary by design - that's the whole
point of that fixture - so no owned component there is guaranteed to have a clean draft). This
file is only about the handler wiring (`pitch:delegate`, the sealed payload, the reveal on
evaluate), so it patches `pen.draft_for_pen` to a fixed, known-good draft and lets everything else
(eligibility, state, payload building) run for real.
Reuses test_veto_breaker.py's non-demo challenge fixture and test_intro_pitch.py's demo one, so
this file owns no seeding of its own - see those for the "why this challenge" reasoning.
"""

from unittest.mock import patch

import pytest

from mlops_serious_game.application.pitch_debate_service.pen import PenDraft
from mlops_serious_game.application.pitch_debate_service.session import AtomicChange
from mlops_serious_game.domain.graph_factory import GraphFactory
from mlops_serious_game.domain.phase_factory import PhaseFactory

from test_intro_pitch import IDS as DEMO_IDS
from test_intro_pitch import _seed_intro_player
from test_run_scope import migrated_db  # noqa: F401  (fixture used by name)
from test_veto_breaker import STUCK_CHALLENGE_ID, STUCK_PHASE_ID, _handle, _seed_player_on_stuck_challenge

pytestmark = pytest.mark.db

NON_DEMO_IDS = {"phase_id": STUCK_PHASE_ID, "challenge_id": STUCK_CHALLENGE_ID}


def _an_owned_pair(phase_id: int) -> tuple[str, str]:
    """Any one real (stakeholder, target) pair owned by someone in that phase's room, so
    `can_hand_pen_to`'s owner check passes for real."""
    graph = GraphFactory.get_graph()
    room_ids = {ps.stakeholder_id for ps in PhaseFactory.get_phases()[phase_id].stakeholders}
    for comp in graph.components:
        owner = graph.owner_of(comp.id)
        if owner in room_ids:
            return owner, comp.id
    pytest.skip("no owned component found in this room")


def _patched_draft():
    """A fixed, always-legal draft, so this file never depends on this challenge's content having
    a boundary-free change available (test_pen.py already covers that logic on controlled inputs)."""
    def _draft_for_pen(stakeholder_id, target, *args, **kwargs):
        return PenDraft(
            stakeholder_id=stakeholder_id,
            target=target,
            change=AtomicChange(target=target, kind="raise_to", axis="automation", value=2),
            band="medium",
            item_id=None,
        )
    return patch(
        "mlops_serious_game.infrastructure.websocket.handlers.pitch_handler.pen.draft_for_pen",
        side_effect=_draft_for_pen,
    )


@pytest.mark.anyio
async def test_pitch_delegate_is_refused_in_a_demo_phase(migrated_db):
    await _seed_intro_player()
    # The demo check is the handler's very first check, before it even looks at who's eligible or
    # whether the target is real - so a placeholder stakeholder/target still exercises it.
    result = await _handle(
        "handle_pitch_delegate",
        {**DEMO_IDS, "stakeholder_id": "bear_bruce", "target": "data.ingestion", "atomic_changes": []},
    )
    assert result["error"] == "demo"


@pytest.mark.anyio
async def test_pitch_delegate_seals_then_evaluate_reveals_it(migrated_db):
    await _seed_player_on_stuck_challenge()
    owner, target = _an_owned_pair(STUCK_PHASE_ID)

    with _patched_draft():
        delegated = await _handle(
            "handle_pitch_delegate",
            {**NON_DEMO_IDS, "stakeholder_id": owner, "target": target, "atomic_changes": []},
        )
    assert delegated.get("error") is None
    assert delegated["pen"] == {"stakeholder_id": owner, "target": target, "revealed": False}
    # Sealed: never in the visible card before reveal.
    assert all(c["target"] != target for c in delegated["atomic_changes"])

    evaluated = await _handle("handle_pitch_evaluate", {**NON_DEMO_IDS, "atomic_changes": []})
    assert evaluated["pen"]["revealed"] is True
    assert any(
        c["target"] == target and c["delegated_to"] == owner for c in evaluated["atomic_changes"]
    )


@pytest.mark.anyio
async def test_pitch_delegate_refuses_a_second_pen_the_same_challenge(migrated_db):
    await _seed_player_on_stuck_challenge()
    owner, target = _an_owned_pair(STUCK_PHASE_ID)

    with _patched_draft():
        await _handle(
            "handle_pitch_delegate",
            {**NON_DEMO_IDS, "stakeholder_id": owner, "target": target, "atomic_changes": []},
        )
    await _handle("handle_pitch_evaluate", {**NON_DEMO_IDS, "atomic_changes": []})  # reveals it

    graph = GraphFactory.get_graph()
    room_ids = {ps.stakeholder_id for ps in PhaseFactory.get_phases()[STUCK_PHASE_ID].stakeholders}
    other = next(
        (c.id for c in graph.components if graph.owner_of(c.id) in room_ids and c.id != target), None
    )
    if other is None:
        pytest.skip("only one owned component available in this room")
    other_owner = graph.owner_of(other)

    with _patched_draft():
        result = await _handle(
            "handle_pitch_delegate",
            {**NON_DEMO_IDS, "stakeholder_id": other_owner, "target": other, "atomic_changes": []},
        )
    assert result["error"] == "pen_limit"
