import click
from langchain_postgres import PGVector
from loguru import logger

from mlops_serious_game.application.rag.embeddings import get_embedding_model
from mlops_serious_game.config import settings


@click.command()
@click.option(
    "--table-name",
    "-t",
    default=settings.POSTGRES_LONG_TERM_MEMORY_TABLE,
    help="Name of the table to delete",
)
@click.option(
    "--postgres-uri",
    "-u",
    default=settings.POSTGRES_URI,
    help="PostgreSQL connection URI",
)
def main(table_name: str, postgres_uri: str) -> None:
    """Command line interface to delete a PGVector collection in PostgreSQL.

    Args:
        table_name: Name of the table/collection to delete.
        postgres_uri: The PostgreSQL connection URI string.
    """
    embedding_model = get_embedding_model(
        settings.RAG_TEXT_EMBEDDING_MODEL_ID, settings.RAG_THREADS
    )
    vectorstore = PGVector(
        embeddings=embedding_model,
        collection_name=table_name,
        connection=postgres_uri,
        use_jsonb=True,
    )
    try:
        vectorstore.drop_tables()
        logger.info(f"Successfully deleted '{table_name}' vector memory.")
    except Exception as e:
        logger.error(f"Error dropping vector table '{table_name}': {e}")


if __name__ == "__main__":
    main()
