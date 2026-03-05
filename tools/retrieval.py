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
from utils.document_viewer import get_pdf_page_text, get_full_pdf_text, resolve_doc_path


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
                "start_line": int(metadata.get("start_line") or 1),
                "end_line": int(metadata.get("end_line") or 5),
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

    # Group PDF chunks by (source_file)
    pdf_groups = defaultdict(list)
    for src in pdf_chunks:
        key = src["source_file"]
        pdf_groups[key].append(src)

    # Build page-level sources for PDFs
    pdf_sources = []
    for filename, group in pdf_groups.items():
        # Resolve full path to the PDF
        filepath = resolve_doc_path(filename)
        if not filepath:
            print(f"WARNING: Could not resolve path for {filename}")
            continue
            
        # Get unique pages referenced in this group
        pages = sorted(list(set([g["page"] for g in group if g.get("page") is not None])))
        if not pages:
            pages = [1]
            
        # Load ALL pages of the PDF to support pagination
        import pdfplumber
        full_content_pages = []
        try:
            with pdfplumber.open(str(filepath)) as pdf:
                total_pages = len(pdf.pages)
                for i in range(1, total_pages + 1):
                    page_text = pdf.pages[i-1].extract_text() or ""
                    full_content_pages.append({"page": i, "text": page_text})
        except Exception as e:
            print(f"Error loading PDF pages: {e}")
            # Fallback to matched pages only if full load fails
            for p in pages:
                page_text = get_pdf_page_text(str(filepath), p)
                full_content_pages.append({"page": p, "text": page_text})
            
        chunk_texts = [g["content"] for g in group]
        
        # We can set section to multiple pages if needed, though they are all loaded.
        if len(pages) > 1:
            section = f"Pages {pages[0]}-{pages[-1]}"
        else:
            section = f"Page {pages[0]}"
            
        pdf_sources.append({
            "source_file": filename,
            "page": pages[0], # The first matched page
            "section": section,
            "full_content": full_content_pages,
            "chunks": chunk_texts,
            "start_line": pages[0],
            "end_line": pages[-1],
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