"""Edge-targeted intel is held back from a player's first playthrough (docs/gameplay-flow.md):
new players only have to read intel about the graph's components, not the hand-offs between
them. Runs against a real throwaway Postgres (like test_run_scope.py) since the gate reads
`run_index`, not a mocked stand-in.
"""

import uuid

import pytest
import sqlalchemy
from sqlalchemy import create_engine, text
from unittest.mock import MagicMock, patch

from mlops_serious_game.application.intel_handler import (
    generate_offline_intel_artifacts,
    is_edge_requirement,
    is_first_playthrough,
)
from mlops_serious_game.config import settings
from mlops_serious_game.domain.offline_intel_artifact import OfflineIntelArtifact
from mlops_serious_game.domain.offline_intel_artifact_factory import OfflineIntelArtifactFactory
from mlops_serious_game.domain.requirement import StakeholderRequirement
from mlops_serious_game.domain.requirement_factory import RequirementFactory

# Real ids from gameConfig/MlopsGraph.json - a component and an edge, loaded by the `real` fixture.
NODE_TARGET = "data.ingestion"
EDGE_TARGET = "e.contracts_ingest"

# Needs a real Postgres connection (not mocked) - excluded from CI via `-m "not db"`.
pytestmark = pytest.mark.db


def _admin_engine():
    admin_url = sqlalchemy.engine.make_url(settings.POSTGRES_URI).set(database="postgres")
    return create_engine(admin_url, isolation_level="AUTOCOMMIT")


def _postgres_reachable() -> bool:
    try:
        with _admin_engine().connect():
            return True
    except Exception:
        return False


@pytest.fixture
def migrated_db(monkeypatch):
    """A throwaway database migrated to head, with `get_session()` redirected at it (copied from
    test_run_scope.py: the point is real `run_index` columns, which a SQLite stand-in lacks)."""
    if not _postgres_reachable():
        pytest.skip("no postgres reachable - see docker compose up postgres")

    from pathlib import Path
    from alembic import command
    from alembic.config import Config as AlembicConfig
    from sqlalchemy.orm import sessionmaker
    from mlops_serious_game.infrastructure.database import connection as db_connection

    db_name = f"test_edge_intel_{uuid.uuid4().hex[:12]}"
    admin = _admin_engine()
    with admin.connect() as conn:
        conn.execute(text(f'CREATE DATABASE "{db_name}"'))
    try:
        test_url = sqlalchemy.engine.make_url(settings.POSTGRES_URI).set(database=db_name)
        test_uri = test_url.render_as_string(hide_password=False)
        monkeypatch.setattr(settings, "POSTGRES_URI", test_uri)

        alembic_dir = Path(__file__).resolve().parents[1] / "alembic"
        alembic_ini = Path(__file__).resolve().parents[1] / "alembic.ini"
        cfg = AlembicConfig(str(alembic_ini))
        cfg.set_main_option("script_location", str(alembic_dir))
        command.upgrade(cfg, "head")

        engine = create_engine(test_uri)
        monkeypatch.setattr(db_connection, "engine", engine)
        monkeypatch.setattr(
            db_connection,
            "SessionLocal",
            sessionmaker(autocommit=False, autoflush=False, bind=engine),
        )

        yield db_name
        engine.dispose()
    finally:
        with admin.connect() as conn:
            conn.execute(
                text(
                    "SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
                    "WHERE datname = :name AND pid <> pg_backend_pid()"
                ),
                {"name": db_name},
            )
            conn.execute(text(f'DROP DATABASE IF EXISTS "{db_name}"'))


def _stance(req_id: str, target: str) -> StakeholderRequirement:
    return StakeholderRequirement(
        id=req_id, challenge_id=7, stakeholder_id="tess_tester", type="driver",
        description=f"cares about {req_id}", suggested={"target": target, "axis": "automation", "level": 3},
    )


def _artifact(req: StakeholderRequirement) -> OfflineIntelArtifact:
    return OfflineIntelArtifact(
        id=f"art_{req.id}", requirement_id=req.id, challenge_id=7, stakeholder_id=req.stakeholder_id,
        narrator_id=None, artifact_type="email", content="...", is_known=False,
    )


def _challenge():
    challenge = MagicMock()
    challenge.id = 7
    challenge.phase_id = 0
    return challenge


def test_is_edge_requirement_distinguishes_node_and_edge_targets(real):
    assert is_edge_requirement(_stance("on_node", NODE_TARGET)) is False
    assert is_edge_requirement(_stance("on_edge", EDGE_TARGET)) is True


# ── `is_first_playthrough` against real `run_index` rows ───────────────────────


def _seed_user() -> int:
    from mlops_serious_game.infrastructure.database.connection import get_session
    from mlops_serious_game.infrastructure.database.models import Campaign, User

    with get_session() as session:
        campaign = Campaign(campaign_name="camp-edge-intel", campaign_key=f"camp-{uuid.uuid4().hex[:8]}")
        session.add(campaign)
        session.flush()
        user = User(
            campaign_key=campaign.campaign_key, campaign_id=campaign.id,
            email=f"{uuid.uuid4().hex[:8]}@example.test",
            password_hash="$2b$12$test.hash.not.a.real.bcrypt.digest..............",
            users_on_machine=1, is_verified=True,
        )
        session.add(user)
        session.flush()
        return user.id


def _start_run(user_id: int, run_index: int, seeded_from_run: int | None) -> None:
    from mlops_serious_game.infrastructure.database.connection import get_session
    from mlops_serious_game.infrastructure.database.models import GameProgression

    with get_session() as session:
        session.add(GameProgression(
            user_id=user_id, run_index=run_index, seeded_from_run=seeded_from_run,
            game_progress_index=2, additional_data=[],
        ))


def test_a_player_is_on_their_first_playthrough_until_they_start_a_second_run(migrated_db):
    user_id = _seed_user()
    assert is_first_playthrough(user_id) is True

    _start_run(user_id, 1, None)
    assert is_first_playthrough(user_id) is True

    _start_run(user_id, 2, seeded_from_run=1)
    assert is_first_playthrough(user_id) is False


# ── The offline intel deck itself ───────────────────────────────────────────────


@pytest.mark.anyio
async def test_the_offline_deck_hides_edge_intel_on_a_first_playthrough_only(real, migrated_db):
    node_item, edge_item = _stance("node_stance", NODE_TARGET), _stance("edge_stance", EDGE_TARGET)
    artifacts = {node_item.id: _artifact(node_item), edge_item.id: _artifact(edge_item)}
    by_id = {node_item.id: node_item, edge_item.id: edge_item}

    user_id = _seed_user()
    _start_run(user_id, 1, None)

    with patch.dict(OfflineIntelArtifactFactory.artifacts_by_requirement, artifacts), \
         patch.object(RequirementFactory, "get_requirement", side_effect=by_id.get):
        first_playthrough_deck = await generate_offline_intel_artifacts(_challenge(), user_id=user_id)

    assert {c["requirement_id"] for c in first_playthrough_deck} == {"node_stance"}

    _start_run(user_id, 2, seeded_from_run=1)

    with patch.dict(OfflineIntelArtifactFactory.artifacts_by_requirement, artifacts), \
         patch.object(RequirementFactory, "get_requirement", side_effect=by_id.get):
        second_playthrough_deck = await generate_offline_intel_artifacts(_challenge(), user_id=user_id)

    assert {c["requirement_id"] for c in second_playthrough_deck} == {"node_stance", "edge_stance"}


# ── The results screen's "intel available" count ────────────────────────────────


def test_results_available_intel_excludes_edges_only_for_the_run_that_never_showed_them(real, migrated_db):
    from mlops_serious_game.application.results_service.service import _intel_facts

    node_item, edge_item = _stance("node_fact_req", NODE_TARGET), _stance("edge_fact_req", EDGE_TARGET)

    user_id = _seed_user()
    _start_run(user_id, 1, None)

    with patch.object(RequirementFactory, "requirements", [node_item, edge_item]):
        run_one = _intel_facts(user_id, 1, {7})
        assert run_one["counts"]["available"] == 1

        _start_run(user_id, 2, seeded_from_run=1)
        run_two = _intel_facts(user_id, 2, {7})
        assert run_two["counts"]["available"] == 2


# ── Pitch scoring itself (buy-in, boundary checks, veto reasoning) ─────────────


@pytest.mark.anyio
async def test_pitch_context_excludes_edge_intel_from_scoring_on_a_first_playthrough_only(real, migrated_db):
    """`PitchContext.all_intel` is the one list buy-in, boundary checks (hence VETOs) and veto
    objection text all read from (`pitch_handler.py`). A hidden edge requirement must not just be
    unlisted in the dossier - it must be absent here too, or a stakeholder can still veto, and a
    veto message can still quote, a hand-off the player was never told about."""
    from mlops_serious_game.domain.phase_factory import PhaseFactory
    from mlops_serious_game.infrastructure.websocket.handlers.pitch_handler import PitchContext
    from test_playtest import _begun_game, _dealt_challenge

    node_item, edge_item = _stance("node_scoring", NODE_TARGET), _stance("edge_scoring", EDGE_TARGET)

    user_id = await _begun_game()
    challenge_id = _dealt_challenge(user_id)
    challenge = PhaseFactory.get_challenge_by_id(challenge_id)

    with patch.object(
        RequirementFactory, "get_requirements_for_challenge",
        side_effect=lambda cid: [node_item, edge_item] if cid == challenge.id else [],
    ):
        first_playthrough_ctx = PitchContext(user_id, challenge.phase_id, challenge.id)
        assert {i.id for i in first_playthrough_ctx.all_intel} == {"node_scoring"}

        _start_run(user_id, 2, seeded_from_run=1)
        second_playthrough_ctx = PitchContext(user_id, challenge.phase_id, challenge.id)
        assert {i.id for i in second_playthrough_ctx.all_intel} == {"node_scoring", "edge_scoring"}
