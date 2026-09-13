"""The event log (plan 11, D51): the domain model, the cause config, and the load-time check
that every cause code used in code actually exists in `gameConfig/EventCauses.json`."""

from pathlib import Path

import pytest

from mlops_serious_game.domain.event import GameEvent
from mlops_serious_game.domain.event_causes import EventCauseFactory, causes_used_in, missing_causes

def _src_dir() -> Path:
    """The `mlops_serious_game` package root, whether tests run from a checkout (source under
    `src/`) or the container image (copied straight to `/app/mlops_serious_game`)."""
    repo_root = Path(__file__).resolve().parents[1]
    for candidate in (repo_root / "src" / "mlops_serious_game", repo_root / "mlops_serious_game"):
        if candidate.exists():
            return candidate
    pytest.skip("mlops_serious_game source tree not found")


SRC = _src_dir()

# Every module this plan's steps 3-4 added `cause="..."` literals to. A future step that logs
# from a new module (gather, build, simulation, gate) should add its file here too.
CAUSE_SOURCE_FILES = [
    SRC / "application" / "pitch_debate_service" / "session.py",
]


def test_every_cause_used_in_code_exists_in_config():
    """The load-time check plan 11 step 1 asks for: a typo'd or unregistered cause code fails
    here instead of shipping a KeyError (or worse, a silently wrong log line) to a player."""
    assert missing_causes(*CAUSE_SOURCE_FILES) == set()


def test_causes_used_in_finds_the_literal_but_not_a_stray_word():
    codes = causes_used_in(*CAUSE_SOURCE_FILES)
    assert "emotion.reframe_hit" in codes
    assert "emotion.reframe_miss" in codes
    assert "outcome.stalemate" in codes


def test_get_raises_on_an_unknown_code():
    with pytest.raises(KeyError):
        EventCauseFactory.get("emotion.not_a_real_code")


def test_render_fills_the_template_from_params():
    text = EventCauseFactory.render("emotion.reframe_hit", {"st": "Data Dave"})
    assert text == "warmer: you put it the way Data Dave thinks about it"


def test_render_raises_when_a_param_is_missing():
    with pytest.raises(KeyError):
        EventCauseFactory.render("emotion.reframe_hit", {})


def test_magnitude_of_buckets_slight_clear_large():
    assert EventCauseFactory.magnitude_of(0.02) == "slight"
    assert EventCauseFactory.magnitude_of(0.2) == "clear"
    assert EventCauseFactory.magnitude_of(-0.5) == "large"


def test_log_handler_serializes_with_rendered_text_so_the_frontend_needs_no_causes_file():
    from mlops_serious_game.infrastructure.websocket.handlers.log_handler import _serialize

    event = GameEvent(step="object", kind="emotion", subject_id="data_dave", cause="emotion.reframe_hit", params={"st": "Data Dave"})
    payload = _serialize(event)
    assert payload["text"] == "warmer: you put it the way Data Dave thinks about it"
    assert payload["cause"] == "emotion.reframe_hit"


def test_game_event_stamped_fills_the_envelope_without_touching_seq():
    event = GameEvent(step="object", kind="emotion", cause="emotion.reframe_hit", subject_id="data_dave")
    stamped = event.stamped(phase_id=2, challenge_id=7)
    assert stamped.phase_id == 2 and stamped.challenge_id == 7
    assert stamped.seq == 0
    assert event.phase_id == 0  # the original is untouched


# ---------- store (DB-backed; skips if no postgres is reachable) ----------

def _postgres_reachable() -> bool:
    import sqlalchemy
    from mlops_serious_game.config import settings

    try:
        url = sqlalchemy.engine.make_url(settings.POSTGRES_URI)
        with sqlalchemy.create_engine(url).connect():
            return True
    except Exception:
        return False


@pytest.fixture
def event_log_db():
    if not _postgres_reachable():
        pytest.skip("no postgres reachable - see docker compose up postgres")
    from conftest import ensure_test_user
    from mlops_serious_game.infrastructure.database.connection import get_session
    from mlops_serious_game.infrastructure.database.models import GameEventRow

    username = "test_event_log_user"
    with get_session() as session:
        session.query(GameEventRow).filter(GameEventRow.user_name == username).delete()
    ensure_test_user(username)
    yield username
    with get_session() as session:
        session.query(GameEventRow).filter(GameEventRow.user_name == username).delete()


def test_append_events_assigns_monotonic_seq_and_load_returns_them_in_order(event_log_db):
    from mlops_serious_game.application.event_log_service.store import append_events, load_events

    username = event_log_db
    first_batch = append_events(username, [
        GameEvent(phase_id=0, challenge_id=1, step="object", kind="emotion", subject_id="data_dave",
                  direction="up", magnitude="slight", cause="emotion.reframe_hit", params={"st": "Data Dave"}),
        GameEvent(phase_id=0, challenge_id=1, step="commit", kind="outcome", cause="outcome.pass"),
    ])
    assert [e.seq for e in first_batch] == [1, 2]

    second_batch = append_events(username, [
        GameEvent(phase_id=0, challenge_id=1, step="commit", kind="outcome", cause="outcome.stalemate"),
    ])
    assert second_batch[0].seq == 3

    loaded = load_events(username)
    assert [e.seq for e in loaded] == [1, 2, 3]
    assert loaded[0].cause == "emotion.reframe_hit"

    since = load_events(username, since_seq=1)
    assert [e.seq for e in since] == [2, 3]
