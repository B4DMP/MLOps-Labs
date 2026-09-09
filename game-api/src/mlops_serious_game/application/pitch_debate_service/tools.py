from typing import Annotated
from langchain_core.tools import tool
from langgraph.prebuilt import InjectedState
from loguru import logger

from mlops_serious_game.application.rag.retrievers import get_embedding_model, get_vectorstore
from mlops_serious_game.config import settings


_vectorstore = None


def _get_vectorstore():
    """Lazy-load the vectorstore instance to avoid timeout during startup."""
    global _vectorstore
    
    if _vectorstore is None:
        embedding_model = get_embedding_model(
            settings.RAG_TEXT_EMBEDDING_MODEL_ID, settings.RAG_THREADS
        )
        _vectorstore = get_vectorstore(embedding_model)
    
    return _vectorstore


@tool
def retrieve_stakeholder_context(query: str, state: Annotated[dict, InjectedState]) -> str:
    """Search and return information about MLOps, stakeholder traits, and their professional knowledge. Use this tool for queries about MLOps, stakeholder motivations, roles, or their domain-specific expertise."""
    vectorstore = _get_vectorstore()
    
    stakeholder_ids = state.get("stakeholder_ids", [])
    filter_dict = None
    if stakeholder_ids:
        stakeholder_id = stakeholder_ids[-1]
        filter_dict = {"stakeholder_id": stakeholder_id}
        logger.info(f"RAG retrieval filtering for stakeholder: {stakeholder_id}")
    else:
        logger.warning("No stakeholder_ids found in graph state. Querying without filter.")
    
    search_kwargs = {"k": settings.RAG_TOP_K}
    if filter_dict:
        search_kwargs["filter"] = filter_dict
        
    retriever = vectorstore.as_retriever(search_kwargs=search_kwargs)
    docs = retriever.invoke(query)
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