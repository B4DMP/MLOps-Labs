"""A committed stakeholder's story in the debrief must agree with the arrows next to it."""

from mlops_serious_game.infrastructure.websocket.handlers.simulation_handler import _story


class _Report:
    def __init__(self, stakeholders):
        self._data = {"targets": [], "world_events": [], "stakeholders": stakeholders}

    def model_dump(self, mode="json"):
        return {**self._data, "stakeholders": [dict(s) for s in self._data["stakeholders"]]}


def _st(status="committed"):
    return {"stakeholder_id": "a", "name": "A", "status": status, "story": "Fully backed it flawlessly."}


def test_a_committed_stakeholder_with_a_capped_part_is_not_told_flawless():
    out = _story(_Report([_st()]), {"a": {"trust": -0.15}}, {"a": "capped_delivery"})
    assert "flawless" not in out["stakeholders"][0]["story"]
    assert "held back" in out["stakeholders"][0]["story"]


def test_a_clean_delivery_keeps_the_original_story():
    out = _story(_Report([_st()]), {"a": {"trust": 0.25}}, {"a": "clean_delivery"})
    assert out["stakeholders"][0]["story"] == "Fully backed it flawlessly."


def test_a_resistant_stakeholder_keeps_their_own_story():
    out = _story(_Report([_st("resistant")]), {"a": {"trust": -0.2}}, {"a": "technical_debt"})
    assert out["stakeholders"][0]["story"] == "Fully backed it flawlessly."
