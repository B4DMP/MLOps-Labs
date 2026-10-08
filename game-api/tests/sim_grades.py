"""Simulated full runs per play profile, to see what grades the scoring actually hands out.

Not part of the suite (the name does not match `test_*`), and it needs Postgres. Run it by name:

    docker compose exec api python -m pytest tests/sim_grades.py -s -q

SIM_SEEDS (default 4) is how many runs each profile plays. Players differ by user id, which seeds
the card search, so the runs are reproducible.
"""

import os
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlalchemy import func, select

from mlops_serious_game.application.playtest_service.profiles import PROFILES
from mlops_serious_game.config import settings

from test_run_scope import _seed_user, _start_run, migrated_db  # noqa: F401  (fixture used by name)

pytestmark = pytest.mark.db

SEEDS = int(os.environ.get("SIM_SEEDS", "4"))
MAX_CHALLENGES = 10


def _finished(user_id: int) -> bool:
    from mlops_serious_game.infrastructure.database.connection import get_session
    from mlops_serious_game.infrastructure.database.models import GameProgression

    with get_session() as session:
        top = session.scalar(
            select(func.max(GameProgression.game_progress_index)).where(GameProgression.user_id == user_id)
        )
    return (top or 0) >= 3


async def _play(name: str, n: int) -> dict:
    from mlops_serious_game.application.results_service.service import build_results
    from mlops_serious_game.infrastructure.websocket.handlers import game_handler, playtest_handler
    from mlops_serious_game.infrastructure.websocket.manager import manager

    user_id = _seed_user(f"{name}{n}", campaign_key=f"camp-{name}{n}")
    _start_run(user_id, 1, None)
    played = 0
    with patch.object(manager, "send_event", new=AsyncMock()), \
         patch.object(manager, "send_error", new=AsyncMock()), \
         patch.object(settings, "ENABLE_PLAYTEST_TOOLS", True):
        await game_handler.handle_game_init(MagicMock(), user_id, {})
        while not _finished(user_id) and played < MAX_CHALLENGES:
            await playtest_handler.handle_playtest_skip_challenge(MagicMock(), user_id, {"profile": name})
            played += 1

    results = build_results(user_id)
    diagnosis = await _diagnose(user_id, name) if not _finished(user_id) else None
    return {
        "profile": name,
        "n": n,
        "challenges": played,
        "finished": _finished(user_id),
        "grade": results["grade"]["grade"],
        "overall": round(results["grade"]["overall"], 3),
        "pillars": {p["id"]: round(p["score"], 2) for p in results["pillars"]},
        "grudges": next(p["detail"].get("fired_grudges") for p in results["pillars"] if p["id"] == "stakeholder_relations"),
        "outcomes": [d["outcome"] for d in results["decisions"]],
        "gate7": results["gate7"]["code"],
        "pipe_detail": next(p["detail"] for p in results["pillars"] if p["id"] == "pipeline_health"),
        "mood": _mood(user_id),
        "stuck": diagnosis,
    }


def _mood(user_id: int) -> dict:
    """Final room mood as scored today (plain mean of the 7 dimensions) and with stress and
    perceived risk flipped, since for those two lower is better."""
    from mlops_serious_game.infrastructure.database.connection import get_session
    from mlops_serious_game.infrastructure.database.models import GameChallenge

    with get_session() as session:
        row = session.scalars(
            select(GameChallenge).where(GameChallenge.user_id == user_id).order_by(GameChallenge.id.desc())
        ).first()
        emotions = dict(row.emotion_values or {})
    raw, flipped = [], []
    for values in emotions.values():
        if not values:
            continue
        raw.append(sum(values.values()) / len(values))
        flipped.append(sum((1 - v) if k in ("stress", "perceived_risk") else v for k, v in values.items()) / len(values))
    mean = lambda xs: round(sum(xs) / len(xs), 3) if xs else None
    return {"raw": mean(raw), "valence": mean(flipped)}


async def _diagnose(user_id: int, name: str) -> dict:
    """Why a run stopped: what the search sees in the room it is stuck in."""
    from mlops_serious_game.application.pitch_debate_service import store as pitch_store
    from mlops_serious_game.application.pitch_debate_service import card_search as auto_card
    from mlops_serious_game.application.playtest_service.profiles import profile_named
    from mlops_serious_game.infrastructure.websocket.handlers import playtest_handler as ph

    challenge, _row = ph._current(user_id)
    ctx = ph._prepare(user_id, challenge, profile_named(name))
    allowed = ph.get_allowed_targets(ctx.graph, ctx.phase_id, ctx.challenge_id, list(ctx.all_intel))
    candidates = auto_card.candidate_changes(ctx.graph, ctx.state, allowed, list(ctx.all_intel))
    result = ph._search(user_id, ctx, profile_named("perfect"))
    return {
        "challenge": challenge.id,
        "escalation_points": pitch_store.escalation_points(user_id),
        "intel_items": len(list(ctx.all_intel)),
        "allowed_targets": len(list(allowed)),
        "candidates": len(candidates),
        "best_outcome": result.outcome if result else None,
        "min_buy_in": result.min_buy_in if result else None,
        "room_emotions": {sid: round(sum(v.values()) / len(v), 2) for sid, v in ctx.emotions.items() if v},
    }


@pytest.mark.anyio
async def test_simulate_runs(migrated_db):
    rows = []
    names = os.environ.get("SIM_PROFILES", ",".join(PROFILES)).split(",")
    for name in names:
        for n in range(SEEDS):
            row = await _play(name, n)
            rows.append(row)
            print("SIM", row, flush=True)

    print("\nSIM SUMMARY")
    for name in names:
        mine = [r for r in rows if r["profile"] == name]
        print(f"{name:8} grades={[r['grade'] for r in mine]} overall={[r['overall'] for r in mine]}")
