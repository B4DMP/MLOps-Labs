"""Fixtures and factories shared by the graph/pattern/pitch/simulation test files.

`config_dir` and `real` were copied near-verbatim into four test files (test_graph_core,
test_graph_patterns, test_simulation_pipeline, test_pitch_session); this is the one place that
resolves the gameConfig location and loads the real graph + patterns, so a change to how the
config is found or loaded only has to happen once.

`make_intel_item` and `make_concession` replace the `_item`/`_concedes` helpers that
`test_pitch_session.py` and `test_pitch_scoring.py` each grew independently, with different
field coverage and defaults - now one shared, superset implementation.
"""

import os

# Keep tests off the real Opik/Comet quota (must run before any mlops_serious_game import).
os.environ["OPIK_TRACK_DISABLE"] = "true"
os.environ["COMET_API_KEY"] = ""

from pathlib import Path
from types import SimpleNamespace
from typing import Optional

import pytest

from mlops_serious_game.domain.graph_factory import GraphFactory
from mlops_serious_game.domain.pattern import PatternFactory
from mlops_serious_game.domain.requirement import ConfidenceType, IntelTag


@pytest.fixture(scope="session")
def config_dir() -> Path:
    """The repo's gameConfig directory, whether tests run from a checkout or the container image."""
    for candidate in (
        Path(__file__).resolve().parent.parent.parent / "gameConfig",
        Path(__file__).resolve().parent.parent / "gameConfig",
        Path("/gameConfig"),
    ):
        if (candidate / "MlopsGraph.json").exists():
            return candidate
    pytest.skip("gameConfig not found")


@pytest.fixture(scope="module")
def real(config_dir: Path):
    """The real MlopsGraph.json with its patterns loaded. Module-scoped: each test module that
    uses it gets its own graph object, but doesn't reload it per test."""
    graph = GraphFactory.load_graph(config_dir / "MlopsGraph.json")
    PatternFactory.load(config_dir / "MlopsPatterns.json", graph)
    return graph


def make_intel_item(id, stakeholder_id, tag, **kw):
    """Minimal StakeholderIntelItem substitute: a SimpleNamespace covering every payload field
    `session.py`, `objections.py` and `scoring.py` read via `getattr(..., default)`, so it is a
    safe drop-in for either module's tests regardless of which fields a given test cares about.
    """
    ns = SimpleNamespace(
        id=id,
        stakeholder_id=stakeholder_id,
        type=IntelTag(tag),
        categorized_type=IntelTag(kw.pop("categorized_type", None) or tag),
        metric_id=kw.pop("metric_id", None),
        suggested=kw.pop("suggested", None),
        holds=kw.pop("holds", None),
        ops=kw.pop("ops", []),
        concedes=kw.pop("concedes", None),
        asserts=kw.pop("asserts", None),
        intel_type=kw.pop("intel_type", ConfidenceType.VERIFIED),
        description=f"desc:{id}",
    )
    for k, v in kw.items():
        setattr(ns, k, v)
    ns.is_correct_intel = lambda: ns.type == ns.categorized_type
    return ns


def make_target(target: str, level: Optional[int] = None, axis: str = "automation") -> SimpleNamespace:
    """A `suggested`/`asserts`-shaped payload: `target` (+ `level`/`axis` where the payload carries
    one - docs/plans/graph-governance-automation-rework/00-plan.md)."""
    return SimpleNamespace(target=target, level=level, axis=axis)


def make_concession(loss: Optional[int] = None, target: Optional[str] = None, axis: str = "automation") -> SimpleNamespace:
    """A `concedes`-shaped payload (Trade-off)."""
    return SimpleNamespace(loss=loss, target=target, axis=axis)



def ensure_test_user(username: str, campaign_key: str = "test-campaign") -> None:
    """Registers a real `User` row (and its `Campaign`, if missing) against the shared dev
    Postgres, for domain/handler tests that exercise a made-up username directly against the DB
    without going through `register_user`.

    Needed since docs/plans/pk-migration.md: every per-player table now has a NOT NULL `user_id`
    FK, so inserting a GameSession/IntelItem/etc. row for a username with no `User` row fails
    with a NotNullViolation - this used to silently succeed when tables only had a bare
    `user_name` string column. Skips silently if postgres isn't reachable, so it stays a no-op
    (not a hard dependency) for callers that already skip via their own `_postgres_reachable`.
    """
    from mlops_serious_game.infrastructure.database.connection import get_session
    from mlops_serious_game.infrastructure.database.models import Campaign, User
    from sqlalchemy import select

    try:
        with get_session() as session:
            if session.scalar(select(User).where(User.user_name == username)) is not None:
                return
            campaign = session.scalar(select(Campaign).where(Campaign.campaign_key == campaign_key))
            if campaign is None:
                campaign = Campaign(campaign_name=campaign_key, campaign_key=campaign_key, is_bot_campaign=True)
                session.add(campaign)
                session.flush()
            session.add(User(
                user_name=username,
                campaign_key=campaign_key,
                campaign_id=campaign.id,
                email=f"{username}@example.test",
                password_hash="$2b$12$test.hash.not.a.real.bcrypt.digest..............",
                users_on_machine=1,
                is_verified=True,
            ))
    except Exception:
        pass
