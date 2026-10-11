"""Hand the Pen (docs/plans/hand-over-the-pen.md): what a stakeholder drafts by trust band, where the
draft lands in the card, and the locked slot. Pure, no DB - run with `-m "not db"` before pushing."""

from conftest import make_intel_item as _item
from conftest import make_target as _target

from mlops_serious_game.application.pitch_debate_service import pen
from mlops_serious_game.application.pitch_debate_service.session import AtomicChange
from mlops_serious_game.domain.emotion import PitchTuning
from mlops_serious_game.domain.emotion_factory import EmotionFactory
from mlops_serious_game.domain.graph import GraphState

TUNING = PitchTuning()
ROOM = [("data_dave", "high", "high"), ("reliability_ruth", "low", "low")]
ALLOWED = {"data.validation", "data.ingestion"}


def _emotions(trust: float) -> dict:
    return {"data_dave": EmotionFactory.create_emotion_values({"trust": trust})}


def _draft(real, intel, trust=0.5, card=(), allowed=ALLOWED, skip=(), seed="s"):
    return pen.draft_for_pen(
        "data_dave", real, GraphState.from_config(real), intel, ROOM, _emotions(trust), TUNING, card,
        allowed_targets=allowed, skip_item_ids=skip, seed=seed,
    )


def _driver(id, target, level, axis="automation", who="data_dave"):
    return _item(id, who, "driver", suggested=_target(target, level, axis=axis))


def _trade_off(id, target, level, axis="automation", who="data_dave"):
    return _item(id, who, "trade_off", branch_x={"target": target, "axis": axis, "level": level})


# ---------- trust_band ----------

def test_trust_band_buckets():
    assert pen.trust_band(EmotionFactory.create_emotion_values({"trust": 0.1})) == "low"
    assert pen.trust_band(EmotionFactory.create_emotion_values({"trust": 0.5})) == "medium"
    assert pen.trust_band(EmotionFactory.create_emotion_values({"trust": 0.9})) == "high"
    assert pen.trust_band(None) == "medium"


# ---------- draft_for_pen: what they pick ----------

def test_medium_trust_drafts_their_driver_one_rung_at_a_time(real):
    # An automation ask two rungs up must still be drafted as automation: the plain next-step
    # candidates alone used to drop it, which skewed every draft towards the governance gate.
    draft = _draft(real, [_driver("d1", "data.validation", 3)])
    assert (draft.band, draft.item_id) == ("medium", "d1")
    assert (draft.change.target, draft.change.axis, draft.change.value) == ("data.validation", "automation", 2)


def test_high_trust_prefers_a_trade_off_and_gets_the_dividend(real):
    intel = [_driver("d1", "data.ingestion", 3), _trade_off("t1", "data.validation", 2)]
    draft = _draft(real, intel, trust=0.9)
    assert draft.band == "high"
    assert draft.item_id == "t1"
    # The branch asks for level 2; a High-trust holder goes one rung further.
    assert (draft.change.target, draft.change.value) == ("data.validation", 3)


def _concession(id, target, max_level, axis="automation", who="data_dave"):
    from types import SimpleNamespace

    return _item(id, who, "trade_off", concedes=SimpleNamespace(target=target, axis=axis, accepts_max_level=max_level))


def test_a_concession_trade_off_is_drafted_as_a_step_toward_what_they_would_accept(real):
    # Most Trade-offs in the content are concessions with no branches; they used to draft nothing.
    draft = _draft(real, [_concession("t1", "data.validation", 2)])
    assert draft.item_id == "t1"
    assert (draft.change.target, draft.change.axis, draft.change.value) == ("data.validation", "automation", 2)


def test_a_concession_already_met_is_not_an_ask(real):
    # data.validation sits at automation 1: a ceiling of 1 is already reached, so nothing to draft from it.
    draft = _draft(real, [_concession("t1", "data.validation", 1)])
    assert draft is None or draft.item_id != "t1"


def test_low_trust_does_not_draft_from_a_trade_off(real):
    draft = _draft(real, [_concession("t1", "data.validation", 2)], trust=0.1)
    assert draft is None or draft.item_id != "t1"


def test_medium_trust_prefers_a_driver_over_a_trade_off(real):
    intel = [_trade_off("t1", "data.validation", 2), _driver("d1", "data.ingestion", 3)]
    assert _draft(real, intel).item_id == "d1"


def test_low_trust_only_drafts_a_driver_and_prefers_the_sign_off_gate(real):
    # data.ingestion already works, so a sign-off gate on it is legal.
    draft = _draft(real, [_driver("d1", "data.ingestion", 3)], trust=0.1)
    assert draft.band == "low"
    assert (draft.change.target, draft.change.axis) == ("data.ingestion", "governance")
    assert _draft(real, [_trade_off("t1", "data.validation", 2)], trust=0.1).item_id is None


def test_low_trust_takes_the_plain_step_when_no_gate_is_legal(real):
    # data.validation is not implemented yet, so there is no gate to take.
    draft = _draft(real, [_driver("d1", "data.validation", 2)], trust=0.1)
    assert (draft.change.axis, draft.change.value) == ("automation", 2)


def test_an_owner_with_nothing_unmet_drafts_a_component_they_own(real):
    draft = _draft(real, [])
    assert draft is not None and draft.item_id is None
    assert real.owner_of(draft.change.target) == "data_dave"


def test_nothing_to_draft_returns_none(real):
    assert _draft(real, [], allowed=set()) is None


def test_a_skipped_item_is_never_the_source(real):
    # An edge item on a first playthrough: the pen must not reveal it.
    draft = _draft(real, [_driver("d1", "data.ingestion", 3)], skip={"d1"})
    assert draft is None or draft.item_id is None


def test_another_stakeholders_item_is_not_drafted(real):
    draft = _draft(real, [_driver("d1", "data.ingestion", 3, who="reliability_ruth")], allowed={"data.ingestion"})
    assert draft is None or draft.item_id is None


def test_a_draft_never_newly_crosses_a_room_boundary(real):
    boundary = _item(
        "b1", "reliability_ruth", "boundary",
        holds={"component": "data.ingestion", "axis": "automation", "op": "lt", "level": 3, "on": "nominal"},
    )
    draft = _draft(real, [_driver("d1", "data.ingestion", 3), boundary], allowed={"data.ingestion"})
    assert draft is None or (draft.change.axis, draft.change.value) != ("automation", 3)


def test_the_same_inputs_give_the_same_draft(real):
    intel = [_driver("d1", "data.validation", 2), _driver("d2", "data.ingestion", 3)]
    assert _draft(real, intel, seed="x") == _draft(real, intel, seed="x")


def test_a_draft_identical_to_a_change_on_the_card_is_not_repeated(real):
    on_card = [AtomicChange(target="data.validation", kind="raise_to", axis="automation", value=2)]
    draft = _draft(real, [_driver("d1", "data.validation", 2)], card=on_card)
    assert draft is None or draft.item_id != "d1"


# ---------- place_draft: where it lands ----------

def _d(target="data.validation", axis="automation", value=2) -> pen.PenDraft:
    return pen.PenDraft(
        stakeholder_id="data_dave", target=target, band="medium",
        change=AtomicChange(target=target, kind="raise_to", axis=axis, value=value),
    )


def _c(target, axis="automation", value=2, delegated_to=None) -> AtomicChange:
    return AtomicChange(target=target, kind="raise_to", axis=axis, value=value, delegated_to=delegated_to)


def test_a_draft_takes_a_free_slot_and_is_locked():
    card, replaced = pen.place_draft([_c("data.ingestion")], _d())
    assert replaced is None
    assert [c.target for c in card] == ["data.ingestion", "data.validation"]
    assert card[-1].delegated_to == "data_dave"


def test_a_draft_takes_over_the_players_change_on_the_same_target_and_axis():
    mine = _c("data.validation", value=3)
    card, replaced = pen.place_draft([_c("data.ingestion"), mine], _d())
    assert replaced == mine
    assert [c.delegated_to for c in card] == [None, "data_dave"]
    assert card[1].value == 2


def test_a_change_on_another_axis_of_the_same_target_stays():
    other_axis = _c("data.validation", axis="governance", value=3)
    card, replaced = pen.place_draft([other_axis], _d())
    assert replaced is None and len(card) == 2


def test_a_draft_needs_a_slot_left_free_unless_it_takes_one_over():
    full = [_c("a"), _c("b"), _c("c")]
    assert pen.place_draft(full, _d(), leave=1) is None
    taken = [*full, _c("data.validation", value=3)]
    card, replaced = pen.place_draft(taken, _d(), leave=1)
    assert replaced is not None and len(card) == 4


# ---------- lock_card: the drafted slot stays ----------

def test_a_submission_cannot_drop_the_drafted_slot():
    stored = [_c("data.validation", delegated_to="data_dave")]
    _, error = pen.lock_card(stored, [_c("data.ingestion")])
    assert error == pen.LOCKED_ERROR


def test_a_submission_cannot_rewrite_or_forge_a_drafted_slot():
    stored = [_c("data.validation", value=2, delegated_to="data_dave")]
    merged, error = pen.lock_card(stored, [_c("data.validation", value=3), _c("data.ingestion", delegated_to="x")])
    assert error is None
    assert (merged[0].value, merged[0].delegated_to) == (2, "data_dave")
    assert merged[1].delegated_to is None


def test_without_a_drafted_slot_the_submission_is_unchanged():
    submitted = [_c("data.ingestion")]
    merged, error = pen.lock_card([_c("data.ingestion")], submitted)
    assert error is None and merged == submitted
