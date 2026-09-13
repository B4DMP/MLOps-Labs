from types import SimpleNamespace
from unittest.mock import patch

from mlops_serious_game.application.online_intel_service.nodes import plan_engagement
from mlops_serious_game.domain.requirement import ConfidenceType, IntelTag
from mlops_serious_game.infrastructure.websocket.handlers import intel_handler as ws_intel


def _held(item_id, filed_as, verified=False, st_id="dave"):
    return SimpleNamespace(
        id=item_id,
        stakeholder_id=st_id,
        categorized_type=filed_as,
        intel_type=ConfidenceType.VERIFIED if verified else ConfidenceType.UNCONFIRMED,
    )


def _req(req_id, tag):
    return SimpleNamespace(id=req_id, type=tag)


def test_checks_come_first_and_share_the_budget_with_reveals():
    held = [_held("h1", IntelTag.DRIVER), _held("h2", IntelTag.BOUNDARY, verified=True)]
    pool = [_req("h1", IntelTag.DRIVER), _req("h2", IntelTag.BOUNDARY), _req("new1", IntelTag.DRIVER), _req("new2", IntelTag.FACT)]

    checks, reveals = plan_engagement(held, pool, "dave", budget=3, allowed_types=[])

    assert [c.id for c in checks] == ["h1"]
    assert sorted(r.id for r in reveals) == ["new1", "new2"]


def test_a_full_budget_of_checks_reveals_nothing():
    held = [_held("h1", IntelTag.DRIVER), _held("h2", IntelTag.TRADE_OFF)]
    pool = [_req("h1", IntelTag.DRIVER), _req("h2", IntelTag.TRADE_OFF), _req("new1", IntelTag.DRIVER)]

    checks, reveals = plan_engagement(held, pool, "dave", budget=2, allowed_types=[])

    assert sorted(c.id for c in checks) == ["h1", "h2"]
    assert reveals == []


def test_the_tag_filter_reads_held_notes_by_the_players_tag():
    # Truly a Boundary, filed as a Driver: a Boundary-only card must pass it over, or it would
    # tell the player the filing was wrong before anyone checked it.
    held = [_held("h1", IntelTag.DRIVER), _held("other", IntelTag.BOUNDARY, st_id="tess")]
    pool = [_req("h1", IntelTag.BOUNDARY), _req("new_b", IntelTag.BOUNDARY), _req("new_d", IntelTag.DRIVER)]

    checks, reveals = plan_engagement(held, pool, "dave", budget=1, allowed_types=["boundary"])

    assert checks == []
    assert [r.id for r in reveals] == ["new_b"]


def test_phase_room_is_the_phases_own_stakeholder_list():
    phase = SimpleNamespace(stakeholders=[SimpleNamespace(stakeholder_id="dave"), SimpleNamespace(stakeholder_id="tess")])
    with patch.object(ws_intel.PhaseFactory, "get_phases", return_value=[phase]):
        assert ws_intel.phase_room(0) == ["dave", "tess"]
