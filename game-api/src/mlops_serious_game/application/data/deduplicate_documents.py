import re
from typing import List, Tuple

from datasketch import MinHash, MinHashLSH
from langchain_core.documents import Document
from loguru import logger

from mlops_serious_game.config import settings


def deduplicate_documents(
    documents: List[Document], threshold: float = 0.7
) -> List[Document]:
    """Remove duplicate documents from a list based on content similarity.

    Uses MinHash algorithm to identify similar documents and removes duplicates
    based on the specified similarity threshold.

    Args:
        documents: List of documents to deduplicate.
        threshold: Similarity threshold to consider documents as duplicates.
            Value between 0.0 and 1.0, where higher values require more similarity.

    Returns:
        List of documents with duplicates removed.
    """

    if not documents:
        return []

    duplicates = find_duplicates(documents, threshold)

    logger.info(
        f"{len(duplicates)} / {len(documents)} documents are duplicates. Removing them."
    )

    indices_to_remove = set()
    for i, j, _ in duplicates:
        # Keep the document with more content
        if len(documents[i].page_content) >= len(documents[j].page_content):
            indices_to_remove.add(j)
        else:
            indices_to_remove.add(i)

    return [doc for i, doc in enumerate(documents) if i not in indices_to_remove]


def find_duplicates(
    documents: List[Document],
    threshold: float = 0.7,
    num_perm: int = int(settings.RAG_CHUNK_SIZE * 0.5),
) -> List[Tuple[int, int, float]]:
    """Find duplicate documents using MinHash algorithm.

    Creates MinHash signatures for each document and uses Locality Sensitive Hashing (LSH)
    to efficiently find similar document pairs.

    Args:
        documents: List of documents to check for duplicates.
        threshold: Similarity threshold (0.0-1.0) to consider documents as duplicates.
            Higher values require more similarity between documents.
        num_perm: Number of permutations for MinHash. Higher values provide more
            accurate similarity estimates but require more computation.

    Returns:
        List of tuples containing (doc_index1, doc_index2, similarity_score)
        for document pairs that exceed the similarity threshold.
    """

    minhashes = []

    for doc in documents:
        minhash = MinHash(num_perm=num_perm)
        text = doc.page_content.lower()
        words = re.findall(r"\w+", text)

        # Create shingles (3-grams of words)
        shingles_added = 0
        for i in range(len(words) - 2):
            shingle = " ".join(words[i : i + 3])
            minhash.update(shingle.encode("utf-8"))
            shingles_added += 1

        # Fallback for short documents (fewer than 3 words)
        if shingles_added == 0 and words:
            minhash.update(" ".join(words).encode("utf-8"))

        minhashes.append(minhash)

    # Find similar document pairs using LSH (Locality Sensitive Hashing)
    lsh = MinHashLSH(threshold=threshold, num_perm=num_perm)

    # Add documents to LSH index
    for i, minhash in enumerate(minhashes):
        lsh.insert(i, minhash)

    duplicates = []
    for i, minhash in enumerate(minhashes):
        similar_docs = lsh.query(minhash)

        # Find duplicates (only consider j > i to avoid duplicate comparisons and self-comparison)
        for j in similar_docs:
            if j > i:
                similarity = minhash.jaccard(minhashes[j])
                if similarity >= threshold:
                    duplicates.append((i, j, similarity))

    return duplicates
