from .client import MongoClientWrapper


class MongoIndex:
    def __init__(
        self,
        retriever,
        mongodb_client: MongoClientWrapper,
    ) -> None:
        self.retriever = retriever
        self.mongodb_client = mongodb_client

    def create(
        self,
        embedding_dim: int,
        is_hybrid: bool = False,
    ) -> None:
        vectorstore = self.retriever.vectorstore

        vectorstore.create_vector_search_index(
            dimensions=embedding_dim,
            filters=["stakeholder_id"],
        )
        if is_hybrid:
            definition = {
                "mappings": {
                    "dynamic": False,
                    "fields": {
                        vectorstore._text_key: {
                            "type": "string",
                            "indexOptions": "offsets",
                            "store": True,
                            "norms": "include",
                        },
                        "stakeholder_id": {"type": "token"},
                    }
                }
            }
            self.mongodb_client.collection.create_search_index(
                model={
                    "definition": definition,
                    "name": self.retriever.search_index_name,
                    "type": "search",
                }
            )

        # Create standard B-tree index on stakeholder_id for pre-filtering
        self.mongodb_client.collection.create_index("stakeholder_id")
