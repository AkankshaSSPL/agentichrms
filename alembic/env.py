"""Alembic migration environment.

This file was missing from the repo, which silently broke every migration
(`alembic upgrade head` had no environment to run in). Authored during the
post-merge integration — see CLEANUP_LOG.md.

Design notes:
  * The database URL comes from `settings.DATABASE_URL` (the single env reader),
    NOT from a hardcoded `sqlalchemy.url` in alembic.ini. One source of truth.
  * We import the models *package* so every table registers on `Base.metadata`,
    which `--autogenerate` then diffs against the live schema.
"""

from logging.config import fileConfig

from sqlalchemy import engine_from_config, pool

import backend.database.models  # noqa: F401  (side-effect: registers tables)
from alembic import context
from backend.core.config import settings

# Import Base and ALL models so their tables populate Base.metadata.
# Importing the package runs models/__init__.py, which re-exports every model.
from backend.database.session import Base

# Alembic Config object (reads alembic.ini).
config = context.config

# Inject the runtime DB URL from settings (overrides any value in alembic.ini).
config.set_main_option("sqlalchemy.url", settings.DATABASE_URL)

# Configure Python logging from alembic.ini, if present.
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode (emit SQL, no DBAPI connection)."""
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations in 'online' mode (against a live connection)."""
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
