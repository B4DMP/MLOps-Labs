from logging.config import fileConfig
import os
import sys
from pathlib import Path

from sqlalchemy import engine_from_config, inspect, pool, text
from alembic import context

# Ensure app package is importable
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from mlops_serious_game.config import settings
from mlops_serious_game.infrastructure.database.models import Base

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata

def get_url():
    return settings.POSTGRES_URI

# main and graph-redesign both shipped a revision `e5f6a7b8c9d0` on top of `d4e5f6a7b8c9`: main's
# added campaign attributes, ours created graph_op_log. Ours kept the id and main's was renumbered
# to `d0e1f2a3b4c5` at the end of the chain. A database migrated on main is therefore stamped
# `e5f6a7b8c9d0` without ever having created graph_op_log, and the later revisions that alter it
# would fail. Rewinding the stamp one step replays everything after `d4e5f6a7b8c9`, which is safe
# because each of those revisions guards its own DDL.
_SHARED_REVISION = "e5f6a7b8c9d0"
_SHARED_REVISION_PARENT = "d4e5f6a7b8c9"
_GRAPH_OP_LOG_TABLE = os.getenv("POSTGRES_GRAPH_OP_LOG_TABLE", "graph_op_log")


def _rewind_stamp_from_main(connectable) -> None:
    with connectable.begin() as connection:
        tables = set(inspect(connection).get_table_names())
        if "alembic_version" not in tables or _GRAPH_OP_LOG_TABLE in tables:
            return
        current = connection.execute(text("SELECT version_num FROM alembic_version")).scalars().all()
        if current == [_SHARED_REVISION]:
            connection.execute(
                text("UPDATE alembic_version SET version_num = :parent"),
                {"parent": _SHARED_REVISION_PARENT},
            )


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode."""
    url = get_url()
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations in 'online' mode."""
    configuration = config.get_section(config.config_ini_section, {})
    configuration["sqlalchemy.url"] = get_url()
    connectable = engine_from_config(
        configuration,
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    _rewind_stamp_from_main(connectable)

    with connectable.connect() as connection:
        context.configure(
            connection=connection, target_metadata=target_metadata
        )

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
