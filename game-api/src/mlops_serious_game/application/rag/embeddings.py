from langchain_community.embeddings.fastembed import FastEmbedEmbeddings

EmbeddingsModel = FastEmbedEmbeddings


def get_embedding_model(
    model_id: str,
    threads: int | None = None,
) -> EmbeddingsModel:
    """Gets an instance of a FastEmbed embedding model.

    Args:
        model_id (str): The ID/name of the embedding model to use.
        threads (int | None): Number of threads for ONNX runtime inference.

    Returns:
        EmbeddingsModel: A configured FastEmbed embeddings model instance.
    """
    return FastEmbedEmbeddings(
        model_name=model_id,
        threads=threads,
    )
