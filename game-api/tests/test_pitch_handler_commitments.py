"""_card_commitments: the pitch LLM's view of what an action card actually settles each target
to, one line per (target, axis) - never one line per rung crossed to get there."""

from mlops_serious_game.domain.graph import GraphOp
from mlops_serious_game.infrastructure.websocket.handlers.pitch_handler import _card_commitments


def test_a_chained_target_gets_one_line_naming_its_final_rung(real):
    """Two raise_to ops on the same (target, axis) - "Implement It Manually" then "Automate It", one slot
    each - must not turn into two separate lines: the LLM narrating a stakeholder's reaction
    around "manual" when the card actually settles the target at "automated" is exactly the bug
    this guards against."""
    ops = [
        GraphOp(kind="raise_to", target="req.data_contracts", axis="automation", value=2, source_kind="action_card"),
        GraphOp(kind="raise_to", target="req.data_contracts", axis="automation", value=3, source_kind="action_card"),
    ]
    commitments = _card_commitments(real, ops)
    assert len(commitments) == 1
    assert "Automated" in commitments[0]
    assert "Manual" not in commitments[0]


def test_different_axes_on_the_same_target_each_get_their_own_line(real):
    ops = [
        GraphOp(kind="raise_to", target="req.data_contracts", axis="automation", value=2, source_kind="action_card"),
        GraphOp(kind="raise_to", target="req.data_contracts", axis="governance", value=3, source_kind="action_card"),
    ]
    commitments = _card_commitments(real, ops)
    assert len(commitments) == 2
    assert any("Manual" in c and "automation" in c for c in commitments)
    assert any("Fully governed" in c and "governance" in c for c in commitments)
