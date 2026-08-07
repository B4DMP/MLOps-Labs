from loguru import logger
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from philoagents.config import settings


async def reset_conversation_state() -> dict:
    """Deletes all conversation state data from PostgreSQL.

    This function removes all stored conversation checkpoints and writes,
    effectively resetting all philosopher conversations.

    Returns:
        dict: Status message indicating success or failure with details.
    """
    try:
        async_engine = create_async_engine(settings.POSTGRES_ASYNC_URI)
        tables_cleared = []

        async with async_engine.begin() as conn:
            for table in ["checkpoints", "checkpoint_writes", "checkpoint_blobs"]:
                try:
                    await conn.execute(text(f"TRUNCATE TABLE {table} CASCADE;"))
                    tables_cleared.append(table)
                    logger.info(f"Truncated table: {table}")
                except Exception:
                    pass

        await async_engine.dispose()

        return {
            "status": "success",
            "message": f"Successfully cleared checkpoint tables: {', '.join(tables_cleared)}",
        }

    except Exception as e:
        logger.error(f"Failed to reset conversation state: {str(e)}")
        raise RuntimeError(f"Failed to reset conversation state: {str(e)}") from e
