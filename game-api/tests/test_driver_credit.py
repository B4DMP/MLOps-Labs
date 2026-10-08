"""Driver credit: a higher level counts, and progress toward the asked level earns a share. No database."""
from types import SimpleNamespace

from mlops_serious_game.application.pitch_debate_service.session import driver_fulfillment


class _State:
    def __init__(self, levels):
        self._levels = levels

    def value(self, target, axis):
        return self._levels[(target, axis)]


def _driver(atoms):
    return SimpleNamespace(atoms=atoms)


def test_a_higher_level_meets_a_lower_atom():
    f = driver_fulfillment(_driver(["raise_to(t, 2)"]), {"raise_to(t, 3)"}, {("t", "automation"): 3})
    assert f == 1.0


def test_progress_toward_an_atom_earns_a_share():
    state = _State({("t", "automation"): 1})
    f = driver_fulfillment(_driver(["raise_to(t, 3)"]), {"raise_to(t, 2)"}, {("t", "automation"): 2}, state)
    assert f == 0.5


def test_no_progress_and_no_state_earn_nothing():
    state = _State({("t", "automation"): 2})
    assert driver_fulfillment(_driver(["raise_to(t, 3)"]), set(), {}, state) == 0.0
    assert driver_fulfillment(_driver(["raise_to(t, 3)"]), {"raise_to(t, 2)"}, {("t", "automation"): 2}) == 0.0
