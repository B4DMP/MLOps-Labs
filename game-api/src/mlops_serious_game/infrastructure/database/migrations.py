"""Applies pending alembic revisions when the API starts.

`init_db` creates missing tables from the models, but it never alters an
existing one, so a database that predates a column just quietly lacks it and the
failure only shows up later as a query error. Running the migrations on startup
closes that gap.

Which action is right depends on where the database starts from:

* **Already stamped** (`alembic_version` present): upgrade to head. The normal case.
* **Empty**: run the chain from base. `0001_initial_schema` builds the schema and
  every later revision applies in order.
* **Populated but never stamped**: a schema built by `Base.metadata.create_all`
  before this project used alembic. `0001_initial_schema` cannot be replayed over
  it, because it creates tables that already exist, but everything after `0001`
  can: those revisions only ALTER, and each one guards its own DDL. So stamp the
  baseline and upgrade from there, and the database picks up every column it is
  missing.

This is also why `run_migrations` runs *before* `init_db`: on an empty database
the chain should build the schema, not find it already built and stamp over it.
"""

from pathlib import Path
from typing import Optional

from loguru import logger
from sqlalchemy import inspect

from mlops_serious_game.config import settings

# Where alembic.ini sits: /app in the container, game-api/ in a local checkout.
_SEARCH_ROOTS = (
    Path.cwd(),
    Path(__file__).resolve().parents[3],
    Path(__file__).resolve().parents[4],
)

# Tables that only this application creates. Any of them means the database has
# been used before, whether or not alembic knows about it.
_APP_TABLES = ("user_data", "game_data", "game_challenge_data", "game_progression_data")

# The revision that corresponds to a schema built straight from the models: it is
# the one that creates the tables rather than altering them. Every later revision
# is guarded and can be replayed over a database that already satisfies it.
_BASELINE_REVISION = "0001_initial_schema"


def _find_alembic_ini() -> Optional[Path]:
    for root in _SEARCH_ROOTS:
        candidate = root / "alembic.ini"
        if candidate.is_file() and (root / "alembic").is_dir():
            return candidate
    return None


def run_migrations() -> None:
    """Brings the database up to the newest revision.

    Raises on failure: a half-migrated schema produces confusing errors much
    later, so it is better to refuse to start.
    """
    if not settings.AUTO_MIGRATE:
        logger.info("AUTO_MIGRATE is off, skipping the alembic upgrade.")
        return

    ini_path = _find_alembic_ini()
    if ini_path is None:
        logger.warning(
            "No alembic.ini found next to an alembic/ directory, skipping migrations. "
            "Looked in: " + ", ".join(str(r) for r in _SEARCH_ROOTS)
        )
        return

    from alembic import command
    from alembic.config import Config

    config = Config(str(ini_path))
    config.set_main_option("script_location", str(ini_path.parent / "alembic"))
    # The URI in alembic.ini points at localhost, which is wrong inside the
    # container. Settings are the single source of truth.
    config.set_main_option("sqlalchemy.url", settings.POSTGRES_URI)

    try:
        from .connection import engine

        tables = set(inspect(engine).get_table_names())

        if "alembic_version" in tables:
            command.upgrade(config, "head")
            logger.info("Database schema is at the newest revision.")
        elif tables & set(_APP_TABLES):
            command.stamp(config, _BASELINE_REVISION)
            command.upgrade(config, "head")
            logger.warning(
                "This database has application tables but no alembic history, so it "
                f"predates migration tracking. Stamped it at {_BASELINE_REVISION} and "
                "applied everything after that."
            )
        else:
            command.upgrade(config, "head")
            logger.info("Empty database: built the schema from the full revision chain.")
    except Exception as e:
        logger.error(f"Alembic upgrade failed: {e}")
        raise
