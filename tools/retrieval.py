"""Retrieval tools with source tracking – returns structured data."""
import os
import sys
import chromadb
from sentence_transformers import SentenceTransformer
from langchain_core.tools import tool
from typing import List, Dict, Any
from collections import defaultdict

try:
    from config import CHROMA_DIR, LOCAL_EMBEDDING_MODEL, DOCS_DIR
except ImportError:
    sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    from config import CHROMA_DIR, LOCAL_EMBEDDING_MODEL, DOCS_DIR

# Import the helper from document_viewer
from utils.document_viewer import get_pdf_page_text, resolve_doc_path


class SourceTrackedRetriever:
    def __init__(self):
        self.client = chromadb.PersistentClient(path=str(CHROMA_DIR))
        self.collection = self.client.get_or_create_collection(name="hr_docs_v2")
        self.model = SentenceTransformer(LOCAL_EMBEDDING_MODEL)

    def retrieve_with_sources(self, query: str, k: int = 8) -> List[Dict[str, Any]]:
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
                "page": metadata.get("page"),          # may be None for non-PDFs
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
    chunk_sources = _retriever.retrieve_with_sources(query, k=8)

    if not chunk_sources:
        return {
            "answer": "No relevant documents found for this query.",
            "sources": []
        }

    # Separate PDF chunks (with page number) from others
    pdf_chunks = [s for s in chunk_sources if s.get("page") is not None]
    other_chunks = [s for s in chunk_sources if s.get("page") is None]

    # Group PDF chunks by (source_file, page)
    pdf_groups = defaultdict(list)
    for src in pdf_chunks:
        key = (src["source_file"], src["page"])
        pdf_groups[key].append(src)

    # Build page-level sources for PDFs
    pdf_sources = []
    for (filename, page_num), group in pdf_groups.items():
        # Resolve full path to the PDF
        filepath = resolve_doc_path(filename)
        if not filepath:
            print(f"WARNING: Could not resolve path for {filename}")
            continue
        full_page_text = get_pdf_page_text(str(filepath), page_num)
        chunk_texts = [g["content"] for g in group]
        section = group[0]["section"]   # e.g. "Page 12"
        pdf_sources.append({
            "source_file": filename,
            "page": page_num,
            "section": section,
            "full_content": full_page_text,
            "chunks": chunk_texts,
        })

    # Combine PDF page sources with other chunk sources
    final_sources = pdf_sources + other_chunks

    # Build answer string from original chunk_sources (no change)
    results = []
    for i, src in enumerate(chunk_sources, 1):
        results.append(
            f"RESULT {i}:\n"
            f"[Source: {src['source_file']} | Section: {src['section']} | "
            f"Lines {src['start_line']}-{src['end_line']}]\n\n"
            f"{src['content'][:1200]}{'...' if len(src['content']) > 1200 else ''}"
        )
    answer = "\n\n---\n\n".join(results)

    return {
        "answer": answer,
        "sources": final_sources
    }