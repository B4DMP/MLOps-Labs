from typing import Annotated
from langchain_core.tools import tool
from langgraph.prebuilt import InjectedState
from loguru import logger

from philoagents.application.rag.retrievers import get_retriever
from philoagents.config import settings


_retriever = None


def _get_retriever():
    """Lazy-load the retriever instance to avoid timeout during startup."""
    global _retriever
    
    if _retriever is None:
        _retriever = get_retriever(
            embedding_model_id=settings.RAG_TEXT_EMBEDDING_MODEL_ID,
            k=settings.RAG_TOP_K,
            device=settings.RAG_DEVICE
        )
    
    return _retriever


@tool
def retrieve_stakeholder_context(query: str, state: Annotated[dict, InjectedState]) -> str:
    """Search and return information about MLOps, stakeholder traits, and their professional knowledge. Use this tool for queries about MLOps, stakeholder motivations, roles, or their domain-specific expertise."""
    retriever_instance = _get_retriever()
    
    stakeholder_ids = state.get("stakeholder_ids", [])
    pre_filter = None
    if stakeholder_ids:
        stakeholder_id = stakeholder_ids[-1]
        pre_filter = {"stakeholder_id": {"$eq": stakeholder_id}}
        logger.info(f"RAG retrieval filtering for stakeholder: {stakeholder_id}")
    else:
        logger.warning("No stakeholder_ids found in graph state. Querying without filter.")
    
    from langchain_mongodb.retrievers import MongoDBAtlasHybridSearchRetriever
    
    dynamic_retriever = MongoDBAtlasHybridSearchRetriever(
        vectorstore=retriever_instance.vectorstore,
        search_index_name=retriever_instance.search_index_name,
        top_k=retriever_instance.top_k,
        vector_penalty=retriever_instance.vector_penalty,
        fulltext_penalty=retriever_instance.fulltext_penalty,
        pre_filter=pre_filter
    )
    
    docs = dynamic_retriever.invoke(query)
    return "\n\n".join([doc.page_content for doc in docs])


class LazyToolsList(list):
    """A list that lazy-loads tools on first access."""
    def __init__(self):
        super().__init__()
        self._initialized = False
    
    def _ensure_initialized(self):
        if not self._initialized:
            self.append(retrieve_stakeholder_context)
            self._initialized = True
    
    def __iter__(self):
        self._ensure_initialized()
        return super().__iter__()
    
    def __getitem__(self, index):
        self._ensure_initialized()
        return super().__getitem__(index)
    
    def __len__(self):
        self._ensure_initialized()
        return super().__len__()



tools = LazyToolsList()