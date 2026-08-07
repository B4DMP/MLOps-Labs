from langchain_core.documents import Document
from loguru import logger

from mlops_serious_game.application.data import deduplicate_documents, get_extraction_generator
from mlops_serious_game.application.rag.retrievers import get_embedding_model, get_retriever, get_vectorstore
from mlops_serious_game.application.rag.splitters import Splitter, get_splitter
from mlops_serious_game.config import settings
from mlops_serious_game.domain.stakeholder import Stakeholder


class LongTermMemoryCreator:
    def __init__(self, retriever, splitter: Splitter, vectorstore) -> None:
        self.retriever = retriever
        self.splitter = splitter
        self.vectorstore = vectorstore

    @classmethod
    def build_from_settings(cls) -> "LongTermMemoryCreator":
        embedding_model = get_embedding_model(
            settings.RAG_TEXT_EMBEDDING_MODEL_ID, settings.RAG_DEVICE
        )
        vectorstore = get_vectorstore(embedding_model)
        retriever = vectorstore.as_retriever(search_kwargs={"k": settings.RAG_TOP_K})
        splitter = get_splitter(chunk_size=settings.RAG_CHUNK_SIZE)

        return cls(retriever, splitter, vectorstore)

    def __call__(self, stakeholders: list[Stakeholder]) -> None:
        if len(stakeholders) == 0:
            logger.warning("No stakeholders to extract. Exiting.")
            return

        # Clear existing tables if present
        try:
            self.vectorstore.drop_tables()
        except Exception:
            pass
        self.vectorstore.create_tables_if_not_exists()
        try:
            self.vectorstore.create_collection()
        except Exception:
            pass

        extraction_generator = get_extraction_generator(stakeholders)
        for _, docs in extraction_generator:
            chunked_docs = self.splitter.split_documents(docs)
            chunked_docs = deduplicate_documents(chunked_docs, threshold=0.7)
            if chunked_docs:
                # Batch document ingestion in chunks of 100 to avoid exceeding PostgreSQL query parameter limits
                batch_size = 100
                for i in range(0, len(chunked_docs), batch_size):
                    batch = chunked_docs[i : i + batch_size]
                    # Sanitize document text by stripping NUL (0x00) bytes invalid in PostgreSQL TEXT fields
                    for doc in batch:
                        doc.page_content = doc.page_content.replace("\x00", "")
                    self.vectorstore.add_documents(batch)

        logger.info("Successfully ingested long term memory into PostgreSQL (PGVector).")


class LongTermMemoryRetriever:
    def __init__(self, retriever) -> None:
        self.retriever = retriever

    @classmethod
    def build_from_settings(cls) -> "LongTermMemoryRetriever":
        retriever = get_retriever(
            embedding_model_id=settings.RAG_TEXT_EMBEDDING_MODEL_ID,
            k=settings.RAG_TOP_K,
            device=settings.RAG_DEVICE,
        )

        return cls(retriever)

    def __call__(self, query: str) -> list[Document]:
        return self.retriever.invoke(query)
