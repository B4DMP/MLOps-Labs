"""Hand the Pen (docs/plans/hand-over-the-pen.md): `draft_for_pen`'s trust-band logic and
`merge_pen_into_card`'s sealed-state handling. Pure, no DB - run with `-m "not db"` before pushing."""

from unittest.mock import patch

from conftest import make_intel_item as _item
from conftest import make_target as _target

from mlops_serious_game.application.pitch_debate_service import pen
from mlops_serious_game.application.pitch_debate_service.session import (
    AtomicChange,
    PenState,
    PitchState,
)
from mlops_serious_game.domain.emotion import PitchTuning
from mlops_serious_game.domain.emotion_factory import EmotionFactory
from mlops_serious_game.domain.graph import GraphState

TUNING = PitchTuning()
ROOM = [("data_dave", "high", "high"), ("reliability_ruth", "low", "low")]


def _emotions(trust: float) -> dict:
    return EmotionFactory.create_emotion_values({"trust": trust})


# ---------- trust_band ----------

def test_trust_band_buckets():
    assert pen.trust_band(_emotions(0.1)) == "low"
    assert pen.trust_band(_emotions(0.5)) == "medium"
    assert pen.trust_band(_emotions(0.9)) == "high"
    assert pen.trust_band(None) == "medium"


# ---------- can_hand_pen_to (eligibility) ----------

def test_can_hand_pen_to_owner(real):
    assert pen.can_hand_pen_to("data_dave", "data.validation", real, held_items=[]) is True


def test_can_hand_pen_to_held_driver_note(real):
    held = [_item("d1", "reliability_ruth", "driver", suggested=_target("data.validation", 2))]
    assert pen.can_hand_pen_to("reliability_ruth", "data.validation", real, held) is True


def test_can_hand_pen_to_held_trade_off_branch(real):
    held = [_item(
        "t1", "reliability_ruth", "trade_off",
        branch_x={"target": "data.validation", "axis": "automation", "level": 2},
    )]
    assert pen.can_hand_pen_to("reliability_ruth", "data.validation", real, held) is True


def test_can_hand_pen_to_held_boundary_note(real):
    held = [_item(
        "b1", "reliability_ruth", "boundary",
        holds={"component": "data.validation", "axis": "automation", "op": "gte", "level": 2},
    )]
    assert pen.can_hand_pen_to("reliability_ruth", "data.validation", real, held) is True


def test_can_hand_pen_to_neither(real):
    assert pen.can_hand_pen_to("reliability_ruth", "data.validation", real, held_items=[]) is False


# ---------- draft_for_pen: band logic ----------

def test_draft_medium_trust_uses_own_ask(real):
    state = GraphState.from_config(real)
    all_intel = [_item("d1", "data_dave", "driver", suggested=_target("data.validation", 2, axis="automation"))]
    draft = pen.draft_for_pen(
        "data_dave", "data.validation", real, state, all_intel, ROOM, {"data_dave": _emotions(0.5)}, TUNING
    )
    assert draft is not None
    assert draft.band == "medium"
    assert draft.change.axis == "automation"
    assert draft.change.value == 2
    assert draft.item_id == "d1"


def test_draft_medium_trust_no_ask_uses_next_step(real):
    state = GraphState.from_config(real)
    draft = pen.draft_for_pen(
        "data_dave", "data.validation", real, state, [], ROOM, {"data_dave": _emotions(0.5)}, TUNING
    )
    assert draft is not None
    assert draft.band == "medium"
    assert draft.item_id is None
    # Automation sorts before governance when nothing else picks between them.
    assert draft.change.axis == "automation"
    assert draft.change.value == 2


def test_draft_high_trust_no_ask_extends_two_steps(real):
    # data.validation: automation 1 (allowed up to 3). High trust lifts the plain next step (2)
    # one further rung, the trust dividend (pen_trust_dividend_steps = 2 by default).
    state = GraphState.from_config(real)
    draft = pen.draft_for_pen(
        "data_dave", "data.validation", real, state, [], ROOM, {"data_dave": _emotions(0.9)}, TUNING
    )
    assert draft.band == "high"
    assert draft.change.axis == "automation"
    assert draft.change.value == 3


def test_draft_high_trust_respects_own_ask(real):
    # data.ingestion is already implemented (MANUAL), so a governance ask is legal on its own.
    state = GraphState.from_config(real)
    all_intel = [_item("d1", "data_dave", "driver", suggested=_target("data.ingestion", 3, axis="governance"))]
    draft = pen.draft_for_pen(
        "data_dave", "data.ingestion", real, state, all_intel, ROOM, {"data_dave": _emotions(0.9)}, TUNING
    )
    assert draft.change.axis == "governance"
    assert draft.change.value == 3
    assert draft.item_id == "d1"


def test_draft_low_trust_picks_the_governance_gate_when_implemented(real):
    # data.ingestion is already MANUAL: a Low-trust holder picks the governance sign-off gate.
    state = GraphState.from_config(real)
    draft = pen.draft_for_pen(
        "data_dave", "data.ingestion", real, state, [], ROOM, {"data_dave": _emotions(0.1)}, TUNING
    )
    assert draft.band == "low"
    assert draft.change.axis == "governance"


def test_draft_low_trust_picks_highest_step_among_several_when_no_gate_applies(real):
    # Not implemented, so no sign-off gate is on the table - among whatever is legal, Low trust
    # picks the highest step (can overshoot other people's ceilings), not the gate special-case.
    state = GraphState.from_config(real)
    candidates = [
        AtomicChange(target="data.validation", kind="raise_to", axis="automation", value=2),
        AtomicChange(target="data.validation", kind="raise_to", axis="governance", value=3),
    ]
    with patch(
        "mlops_serious_game.application.pitch_debate_service.pen._legal_changes_on_target",
        return_value=candidates,
    ):
        draft = pen.draft_for_pen(
            "data_dave", "data.validation", real, state, [], ROOM, {"data_dave": _emotions(0.1)}, TUNING
        )
    assert draft.band == "low"
    assert draft.change.value == 3


def test_draft_never_crosses_a_room_boundary(real):
    # data.ingestion is already implemented, so both axes have a legal next step to choose from.
    state = GraphState.from_config(real)
    boundary = _item(
        "b1", "reliability_ruth", "boundary",
        holds={"component": "data.ingestion", "axis": "automation", "op": "lt", "level": 3, "on": "nominal"},
    )
    draft = pen.draft_for_pen(
        "data_dave", "data.ingestion", real, state, [boundary], ROOM, {"data_dave": _emotions(0.5)}, TUNING
    )
    assert draft is not None
    # The automation candidate (2 -> 3) would violate the boundary; only governance remains legal.
    assert draft.change.axis == "governance"


def test_draft_returns_none_when_every_legal_change_violates_a_boundary(real):
    state = GraphState.from_config(real)
    boundaries = [
        _item(
            "b1", "reliability_ruth", "boundary",
            holds={"component": "data.ingestion", "axis": "automation", "op": "lt", "level": 3, "on": "nominal"},
        ),
        _item(
            "b2", "reliability_ruth", "boundary",
            holds={"component": "data.ingestion", "axis": "governance", "op": "lt", "level": 3, "on": "nominal"},
        ),
    ]
    draft = pen.draft_for_pen(
        "data_dave", "data.ingestion", real, state, boundaries, ROOM, {"data_dave": _emotions(0.5)}, TUNING
    )
    assert draft is None


def test_draft_single_legal_option_every_band_picks_it(real):
    state = GraphState.from_config(real)
    only_change = AtomicChange(target="data.validation", kind="raise_to", axis="automation", value=2)
    with patch(
        "mlops_serious_game.application.pitch_debate_service.pen.card_search.candidate_changes",
        return_value=[only_change],
    ):
        for trust, band in ((0.1, "low"), (0.5, "medium"), (0.9, "high")):
            draft = pen.draft_for_pen(
                "data_dave", "data.validation", real, state, [], ROOM, {"data_dave": _emotions(trust)}, TUNING
            )
            assert draft.band == band
            assert draft.change.axis == "automation"
            assert draft.change.value >= 2


def test_draft_is_deterministic(real):
    state = GraphState.from_config(real)
    draft_1 = pen.draft_for_pen(
        "data_dave", "data.validation", real, state, [], ROOM, {"data_dave": _emotions(0.9)}, TUNING
    )
    draft_2 = pen.draft_for_pen(
        "data_dave", "data.validation", real, state, [], ROOM, {"data_dave": _emotions(0.9)}, TUNING
    )
    assert draft_1 == draft_2


# ---------- merge_pen_into_card (sealed state) ----------

def test_merge_pen_into_card_seals_and_reveals_once():
    change = AtomicChange(target="data.validation", kind="raise_to", axis="automation", value=2)
    state = PitchState(pen=PenState(stakeholder_id="data_dave", target="data.validation", change=change, band="medium"))

    error = pen.merge_pen_into_card(state)
    assert error is None
    assert state.pen.revealed is True
    assert any(c.delegated_to == "data_dave" and c.target == "data.validation" for c in state.atomic_changes)

    # A second merge (e.g. a re-pitch) just re-validates, it doesn't duplicate the sealed change.
    error_again = pen.merge_pen_into_card(state)
    assert error_again is None
    assert len(state.atomic_changes) == 1


def test_merge_pen_into_card_rejects_a_dropped_delegated_change():
    change = AtomicChange(target="data.validation", kind="raise_to", axis="automation", value=2)
    state = PitchState(
        pen=PenState(stakeholder_id="data_dave", target="data.validation", change=change, band="medium", revealed=True)
    )
    # Already revealed, but the resubmitted card doesn't carry the delegated change.
    error = pen.merge_pen_into_card(state)
    assert error is not None


def test_merge_pen_into_card_is_a_no_op_without_a_pen():
    state = PitchState()
    assert pen.merge_pen_into_card(state) is None
    assert state.atomic_changes == []
