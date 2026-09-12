"""Unify stored intel item payloads with the StakeholderRequirement shape

Rewrites rows in the intel data table that were written before
StakeholderIntelItem became a subclass of StakeholderRequirement.

Legacy payload:
    {id, requirement_id, intel_type, categorized_type, description}
where `id` was the intel item's own id, `description` held the *categorized*
description, and the real requirement data was only reachable by looking up
`requirement_id` in gameConfig/RequirementObjects.json.

Current payload:
    {id, challenge_id, stakeholder_id, type, description,
     intel_type, categorized_type, categorized_description}
where `id` is the requirement's id and `description` is the true requirement
text. The requirement fields are resolved from the same config file here.

Rows whose requirement no longer exists in the config cannot be resolved; they
are rewritten with challenge_id = -1 so they satisfy the model but stay out of
every per-challenge dossier view, and their ids are logged.

Revision ID: c3d4e5f6a7b8
Revises: b2c3d4e5f6a7
Create Date: 2026-09-09 10:00:00.000000

"""
import json
import logging
import os
from pathlib import Path
from typing import Any, Optional, Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c3d4e5f6a7b8'
down_revision: Union[str, None] = 'b2c3d4e5f6a7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

logger = logging.getLogger("alembic.runtime.migration")

DEFAULT_REQUIREMENT_TYPE = "requirement"


def _intel_table_name() -> str:
    """Resolves the intel table name the same way the app models do."""
    try:
        from mlops_serious_game.config import settings

        return settings.POSTGRES_INTEL_DATA_TABLE
    except Exception:  # pragma: no cover - config unavailable in bare contexts
        return "intel_data"


def _requirement_config_path() -> Optional[Path]:
    """Finds RequirementObjects.json in a repo checkout or the container image."""
    here = Path(__file__).resolve()
    candidates = []

    config_dir = os.getenv("MLOPS_GAME_CONFIG_DIR")
    if config_dir:
        candidates.append(Path(config_dir) / "RequirementObjects.json")

    # game-api/alembic/versions/<this file> -> repo root/gameConfig
    if len(here.parents) > 3:
        candidates.append(here.parents[3] / "gameConfig" / "RequirementObjects.json")
    # Container layout (see game-api/Dockerfile: COPY --from=gameconfig . /gameConfig)
    candidates.append(Path("/gameConfig/RequirementObjects.json"))

    for candidate in candidates:
        if candidate.is_file():
            return candidate
    return None


def _load_requirements() -> dict[str, dict[str, Any]]:
    path = _requirement_config_path()
    if path is None:
        raise RuntimeError(
            "Could not locate gameConfig/RequirementObjects.json, which is needed to "
            "backfill challenge_id/stakeholder_id/type on legacy intel items. Set "
            "MLOPS_GAME_CONFIG_DIR to the gameConfig directory and re-run this migration."
        )

    logger.info("Reading requirement definitions from %s", path)
    with path.open("r", encoding="utf-8") as f:
        data = json.load(f)

    requirements: dict[str, dict[str, Any]] = {}
    for entry in data.get("requirements", []):
        req_id = entry.get("id")
        if req_id is None:
            continue
        stakeholder_id = entry.get("stakeholder_id")
        requirements[str(req_id)] = {
            "challenge_id": int(entry["challenge_id"]),
            # Absent/null for a Fact (plan 02: a Fact is about the environment, not a person),
            # never authored as a literal "None" string - str() would silently do that if this
            # ran unconditionally, so only stringify a real value (code-review finding: this
            # crashed with KeyError on the very first Fact entry against current content).
            "stakeholder_id": str(stakeholder_id) if stakeholder_id is not None else None,
            "type": str(entry["type"]),
            "description": str(entry["description"]),
        }
    return requirements


def _is_legacy(payload: dict[str, Any]) -> bool:
    if "requirement_id" in payload:
        return True
    return not all(key in payload for key in ("challenge_id", "stakeholder_id", "type"))


def _upgrade_payload(
    payload: dict[str, Any],
    requirements: dict[str, dict[str, Any]],
) -> tuple[dict[str, Any], bool]:
    """Returns the new-shape payload and whether its requirement was resolved."""
    upgraded = dict(payload)
    req_id = upgraded.pop("requirement_id", None) or upgraded.get("id")
    req = requirements.get(str(req_id)) if req_id else None

    upgraded["id"] = req_id
    # Legacy `description` carried the categorized text; don't clobber an already
    # migrated `categorized_description`.
    categorized_description = (
        upgraded.get("categorized_description") or upgraded.get("description") or ""
    )
    upgraded["categorized_description"] = categorized_description
    upgraded.setdefault("intel_type", "unconfirmed")
    upgraded.setdefault("categorized_type", DEFAULT_REQUIREMENT_TYPE)

    if req:
        upgraded.setdefault("challenge_id", req["challenge_id"])
        upgraded.setdefault("stakeholder_id", req["stakeholder_id"])
        upgraded.setdefault("type", req["type"])
        upgraded["description"] = req["description"]
    else:
        upgraded.setdefault("challenge_id", -1)
        upgraded.setdefault("stakeholder_id", "")
        upgraded.setdefault("type", upgraded["categorized_type"])
        upgraded["description"] = categorized_description

    return upgraded, req is not None


def upgrade() -> None:
    table = _intel_table_name()
    connection = op.get_bind()

    inspector = sa.inspect(connection)
    if not inspector.has_table(table):
        logger.info("Table %s does not exist yet; nothing to migrate.", table)
        return

    requirements = _load_requirements()

    rows = connection.execute(
        sa.text(f"SELECT id, intel_item_data FROM {table} ORDER BY id")  # noqa: S608 - table name from app config
    ).fetchall()

    update_stmt = sa.text(
        f"UPDATE {table} SET intel_item_data = CAST(:payload AS json) WHERE id = :row_id"  # noqa: S608
    )

    migrated = 0
    orphan_ids: list[str] = []
    for row_id, raw in rows:
        payload = json.loads(raw) if isinstance(raw, str) else raw
        if not isinstance(payload, dict) or not _is_legacy(payload):
            continue

        upgraded, resolved = _upgrade_payload(payload, requirements)
        if not resolved:
            orphan_ids.append(str(upgraded.get("id")))

        connection.execute(
            update_stmt,
            {"payload": json.dumps(upgraded), "row_id": row_id},
        )
        migrated += 1

    logger.info("Migrated %d of %d intel item rows to the unified payload shape.", migrated, len(rows))
    if orphan_ids:
        logger.warning(
            "%d intel item(s) reference requirements missing from RequirementObjects.json "
            "and were parked on challenge_id = -1: %s",
            len(orphan_ids),
            ", ".join(sorted(orphan_ids)),
        )


def downgrade() -> None:
    """Irreversible.

    The legacy shape stored the intel item's own `id` alongside `requirement_id`;
    unification dropped that separate id, so the original rows cannot be
    reconstructed. The application's read path still accepts legacy payloads, so
    downgrading the schema does not require downgrading this data.
    """
    pass
