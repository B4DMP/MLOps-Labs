from langchain_huggingface import HuggingFaceEmbeddings
from langchain_postgres import PGVector
from loguru import logger

from mlops_serious_game.config import settings
from .embeddings import get_embedding_model


def get_vectorstore(embedding_model: HuggingFaceEmbeddings) -> PGVector:
    """Creates a PGVector vector store instance using PostgreSQL."""
    return PGVector(
        embeddings=embedding_model,
        collection_name=settings.POSTGRES_LONG_TERM_MEMORY_TABLE,
        connection=settings.POSTGRES_URI,
        use_jsonb=True,
    )


def get_retriever(
    embedding_model_id: str,
    k: int = 3,
    device: str = "cpu",
):
    """Creates and returns a vector search retriever with the specified embedding model.

    Args:
        embedding_model_id (str): The identifier for the embedding model to use.
        k (int, optional): Number of documents to retrieve. Defaults to 3.
        device (str, optional): Device to run the embedding model on. Defaults to "cpu".

    Returns:
        VectorStoreRetriever: A configured vector search retriever.
    """
    logger.info(
        f"Initializing retriever | model: {embedding_model_id} | device: {device} | top_k: {k}"
    )

    embedding_model = get_embedding_model(embedding_model_id, device)
    vectorstore = get_vectorstore(embedding_model)
    return vectorstore.as_retriever(search_kwargs={"k": k})
