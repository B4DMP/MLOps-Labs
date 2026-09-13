"""Re-tag stored intel items to the Driver / Boundary / Trade-off / Fact taxonomy

The old tags (requirement, negotiable_preference, personal_friction) are gone from the code,
so rows still carrying them would fail to load. Each row is rewritten with the same rule the
game config was re-tagged with:

    requirement           -> boundary if it states a refusal line, else driver
    negotiable_preference -> driver
    personal_friction     -> driver

A player's tag that was right stays right. A wrong tag maps with the generic rule and may, in
rare cases, now count as right; this only touches development data.

Also folds the old boolean `is_public_record` into `source`, which the removed read-time shim
used to do.

Revision ID: f6a7b8c9d0e1
Revises: e5f6a7b8c9d0
Create Date: 2026-09-11 17:00:00.000000

"""
import json
import logging
import os
import re
from typing import Any, Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = 'f6a7b8c9d0e1'
down_revision: Union[str, None] = 'e5f6a7b8c9d0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

logger = logging.getLogger("alembic.runtime.migration")

TABLE = os.getenv("POSTGRES_INTEL_DATA_TABLE", "intel_data")
LEGACY = {"requirement", "negotiable_preference", "personal_friction"}
GENERIC = {"requirement": "boundary", "negotiable_preference": "driver", "personal_friction": "driver"}
REFUSAL = re.compile(r"\b(mandates?|requires?|required|must|cannot|can't|never|will not|won't|non-negotiable)\b", re.I)


def _new_tag(old: str, description: str) -> str:
    if old == "requirement":
        return "boundary" if REFUSAL.search(description or "") else "driver"
    return GENERIC.get(old, old)


def _retag(payload: dict[str, Any]) -> tuple[dict[str, Any], bool]:
    data = dict(payload)
    changed = False
    if "is_public_record" in data:
        was_public = data.pop("is_public_record")
        if was_public and not data.get("source"):
            data["source"] = "public_record"
        changed = True

    old_type = data.get("type")
    old_cat = data.get("categorized_type")
    if old_type in LEGACY:
        data["type"] = _new_tag(old_type, data.get("description", ""))
        changed = True
    if old_cat in LEGACY:
        data["categorized_type"] = data["type"] if old_cat == old_type else GENERIC[old_cat]
        changed = True
    return data, changed


def upgrade() -> None:
    bind = op.get_bind()
    rows = bind.execute(sa.text(f"SELECT id, intel_item_data FROM {TABLE}")).fetchall()
    updated = 0
    for row_id, raw in rows:
        payload = raw if isinstance(raw, dict) else json.loads(raw or "{}")
        if not isinstance(payload, dict):
            continue
        data, changed = _retag(payload)
        if changed:
            bind.execute(
                sa.text(f"UPDATE {TABLE} SET intel_item_data = CAST(:data AS JSON) WHERE id = :id"),
                {"data": json.dumps(data), "id": row_id},
            )
            updated += 1
    logger.info("Re-tagged %d of %d intel items", updated, len(rows))


def downgrade() -> None:
    # The old tags carry information the new ones do not (a Driver was once a preference or a
    # friction), so there is nothing faithful to restore.
    pass
