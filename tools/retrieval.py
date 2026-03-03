"""Retrieval tools with source tracking – returns structured data."""
import os
import sys
import chromadb
from sentence_transformers import SentenceTransformer
from langchain_core.tools import tool
from typing import List, Dict, Any

try:
    from config import CHROMA_DIR, LOCAL_EMBEDDING_MODEL, DOCS_DIR
except ImportError:
    sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    from config import CHROMA_DIR, LOCAL_EMBEDDING_MODEL, DOCS_DIR


class SourceTrackedRetriever:
    def __init__(self):
        self.client = chromadb.PersistentClient(path=str(CHROMA_DIR))
        self.collection = self.client.get_or_create_collection(name="hr_docs_v2")
        self.model = SentenceTransformer(LOCAL_EMBEDDING_MODEL)

    def retrieve_with_sources(self, query: str, k: int = 5) -> List[Dict[str, Any]]:
        """Retrieve documents with source tracking."""
        query_embedding = self.model.encode(query).tolist()

        results = self.collection.query(
            query_embeddings=[query_embedding],
            n_results=k,
            include=["documents", "metadatas", "distances"]
        )

        if not results["documents"] or not results["documents"][0]:
            return []

        sources = []
        for i in range(len(results["documents"][0])):
            metadata = results["metadatas"][0][i]
            doc_text = results["documents"][0][i]

            source_info = {
                "content": doc_text,
                "source_file": metadata.get("source", "Unknown"),
                "section": metadata.get("section", "General"),
                "start_line": int(metadata.get("start_line", 1)),
                "end_line": int(metadata.get("end_line", 5)),
                "score": 1 - results["distances"][0][i]
            }
            sources.append(source_info)

        return sources


_retriever = SourceTrackedRetriever()


@tool
def search_policies(query: str) -> Dict[str, Any]:
    """
    Search HR policies and documents. Returns both answer text and source list.
    """
    sources = _retriever.retrieve_with_sources(query, k=5)

    if not sources:
        return {
            "answer": "No relevant documents found for this query.",
            "sources": []
        }

    # Format results for LLM (the "answer" part)
    results = []
    for i, src in enumerate(sources, 1):
        results.append(
            f"RESULT {i}:\n"
            f"[Source: {src['source_file']} | Section: {src['section']} | "
            f"Lines {src['start_line']}-{src['end_line']}]\n\n"
            f"{src['content'][:1200]}{'...' if len(src['content']) > 1200 else ''}"
        )

    answer = "\n\n---\n\n".join(results)

    return {
        "answer": answer,
        "sources": sources
    }