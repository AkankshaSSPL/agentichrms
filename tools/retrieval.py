"""Retrieval tools with source tracking and reranker verification."""
import os
import sys
import re
import math
import logging
import chromadb
from sentence_transformers import SentenceTransformer, CrossEncoder
from langchain_core.tools import tool
from typing import List, Dict, Any, Optional
from collections import defaultdict

logger = logging.getLogger(__name__)

try:
    from config import CHROMA_DIR, LOCAL_EMBEDDING_MODEL, LOCAL_RERANK_MODEL, DOCS_DIR
except ImportError:
    sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    from config import CHROMA_DIR, LOCAL_EMBEDDING_MODEL, LOCAL_RERANK_MODEL, DOCS_DIR

from utils.document_viewer import get_pdf_page_text, resolve_doc_path


class SourceTrackedRetriever:
    def __init__(self):
        try:
            self.client = chromadb.PersistentClient(path=str(CHROMA_DIR))
            self._collection_name = "hr_policies"
            self.model = SentenceTransformer(LOCAL_EMBEDDING_MODEL)
        except Exception as exc:
            raise RuntimeError(
                f"Failed to initialise SourceTrackedRetriever. "
                f"Embedding model: '{LOCAL_EMBEDDING_MODEL}'. "
                f"Ensure the model is downloaded and CHROMA_DIR is accessible.\n"
                f"Original error: {exc}"
            ) from exc

        self._reranker: Optional[CrossEncoder] = None

    @property
    def collection(self):
        return self.client.get_or_create_collection(name=self._collection_name)

    def refresh_collection(self):
        pass

    @property
    def reranker(self) -> CrossEncoder:
        if self._reranker is None:
            try:
                logger.info("Loading reranker model '%s'...", LOCAL_RERANK_MODEL)
                self._reranker = CrossEncoder(LOCAL_RERANK_MODEL)
            except Exception as exc:
                raise RuntimeError(
                    f"Failed to load reranker model '{LOCAL_RERANK_MODEL}'. "
                    f"Ensure the model is downloaded.\nOriginal error: {exc}"
                ) from exc
        return self._reranker

    def extract_policy_type(self, query: str) -> Optional[str]:
        query_lower = query.lower()
        policy_keywords = {
            "whistle blower": ["whistle", "blower", "whistleblower", "report concern", "unethical", "fraud reporting", "reporting mechanism"],
            "confidentiality": ["confidential", "secrecy", "secret", "non-disclosure", "nda", "data protection"],
            "it asset": ["it asset", "computer", "laptop", "software", "vpn", "email policy", "internet use", "acceptable use"],
            "leave": ["leave", "vacation", "sick leave", "casual leave", "earned leave", "maternity", "paternity"],
            "moonlighting": ["moonlight", "outside work", "dual employment", "side job", "covenants", "compete", "solicit", "external work"],
            "remote work": ["remote", "work from home", "wfh", "home office", "telecommute"],
            "onboarding": ["onboard", "joining", "new hire", "first day", "induction", "orientation"],
            "code of conduct": ["code of conduct", "ethics", "behavior", "discipline", "workplace behavior"],
        }
        for policy, keywords in policy_keywords.items():
            if any(kw in query_lower for kw in keywords):
                return policy
        return None

    def _normalize_scores(self, chunks: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        for chunk in chunks:
            raw = chunk.get("relevance_score", 0.0)
            chunk["relevance_score"] = 1.0 / (1.0 + math.exp(-raw))
        return chunks

    def rerank_chunks(self, query: str, chunks: List[Dict[str, Any]], top_k: int = 5) -> List[Dict[str, Any]]:
        if not chunks:
            return []
        pairs = [(query, chunk["content"]) for chunk in chunks]
        scores = self.reranker.predict(pairs)
        scored_chunks = list(zip(chunks, scores))
        scored_chunks.sort(key=lambda x: x[1], reverse=True)
        result = []
        for chunk, score in scored_chunks[:top_k]:
            chunk["relevance_score"] = float(score)
            result.append(chunk)
        return self._normalize_scores(result)

    def filter_by_policy_type(self, chunks: List[Dict[str, Any]], policy_type: Optional[str]) -> List[Dict[str, Any]]:
        if not policy_type or not chunks:
            return chunks
        matching, non_matching = [], []
        for chunk in chunks:
            chunk_policy = chunk.get("policy_type", "").lower()
            section = chunk.get("section", "").lower()
            content = chunk.get("content", "").lower()
            is_match = (policy_type in chunk_policy or policy_type in section or policy_type.replace(" ", "_") in content[:500])
            chunk["policy_match"] = is_match
            (matching if is_match else non_matching).append(chunk)
        return matching + non_matching

    def verify_source_match(self, query: str, chunk_content: str) -> float:
        query_words = set(re.findall(r'\b\w{4,}\b', query.lower()))
        content_words = set(re.findall(r'\b\w{4,}\b', chunk_content.lower()))
        if not query_words:
            return 0.5
        return len(query_words & content_words) / len(query_words)

    def retrieve_with_sources(self, query: str, k: int = 15, final_k: int = 7) -> List[Dict[str, Any]]:
        policy_type = self.extract_policy_type(query)
        if policy_type:
            logger.debug("Detected policy type: %s", policy_type)

        query_embedding = self.model.encode(query).tolist()
        results = self.collection.query(
            query_embeddings=[query_embedding],
            n_results=k,
            include=["documents", "metadatas", "distances"],
        )

        if not results["documents"] or not results["documents"][0]:
            return []

        chunks = []
        for i in range(len(results["documents"][0])):
            metadata = results["metadatas"][0][i]
            doc_text = results["documents"][0][i]
            chunk_index = metadata.get("chunk", i)
            chunks.append({
                "content": doc_text,
                "source_file": metadata.get("source", "Unknown"),
                "section": metadata.get("section", "General"),
                "policy_type": metadata.get("policy_type", "General"),
                "page": metadata.get("page"),
                "chunk_index": chunk_index,
                "score": 1 - results["distances"][0][i],
            })

        chunks = self.filter_by_policy_type(chunks, policy_type)
        reranked_chunks = self.rerank_chunks(query, chunks, top_k=final_k * 2)

        verified_sources = []
        for chunk in reranked_chunks:
            v_score = self.verify_source_match(query, chunk["content"])
            chunk["verification_score"] = v_score
            if chunk["relevance_score"] > 0.1 or chunk.get("policy_match"):
                verified_sources.append(chunk)

        verified_sources.sort(
            key=lambda x: (
                x.get("relevance_score", 0) * 0.5
                + x.get("verification_score", 0) * 0.3
                + (0.2 if x.get("policy_match") else 0)
            ),
            reverse=True,
        )
        return verified_sources[:final_k]


_retriever = SourceTrackedRetriever()


@tool
def search_policies(query: str) -> Dict[str, Any]:
    """Search HR policies and documents. Returns focused answer and source list."""
    chunk_sources = _retriever.retrieve_with_sources(query, k=15, final_k=10)

    if not chunk_sources:
        return {"answer": "No relevant documents found for this query.", "sources": []}

    # Build sources for preview (same as before, but we will adjust the answer)
    pdf_chunks = [s for s in chunk_sources if s.get("page") is not None]
    other_chunks = [s for s in chunk_sources if s.get("page") is None]

    pdf_sources = []
    for filename, group in _group_by_file(pdf_chunks).items():
        filepath = resolve_doc_path(filename)
        if not filepath:
            logger.warning("Could not resolve path for %s", filename)
            continue

        pages = sorted(set(g["page"] for g in group if g.get("page") is not None)) or [1]
        full_content_pages = []
        import pdfplumber
        try:
            with pdfplumber.open(str(filepath)) as pdf:
                total_pages = len(pdf.pages)
                for p in pages:
                    if 1 <= p <= total_pages:
                        text = pdf.pages[p - 1].extract_text() or ""
                        full_content_pages.append({"page": p, "text": text})
        except Exception as exc:
            logger.error("Error loading PDF pages for %s: %s", filename, exc)
            for p in pages:
                text = get_pdf_page_text(str(filepath), p)
                full_content_pages.append({"page": p, "text": text})

        chunk_texts = [g["content"] for g in group]
        section = f"Pages {pages[0]}-{pages[-1]}" if len(pages) > 1 else f"Page {pages[0]}"
        pdf_sources.append({
            "source_file": filename,
            "page": pages[0],
            "section": section,
            "full_content": full_content_pages,
            "chunks": chunk_texts,
            "start_line": pages[0],
            "end_line": pages[-1],
            "relevance_score": max(g.get("relevance_score", 0) for g in group),
            "verification_score": max(g.get("verification_score", 0) for g in group),
        })

    # Text sources
    final_other_chunks = []
    for filename, group in _group_by_file(other_chunks).items():
        chunks_sorted = sorted(group, key=lambda x: x.get("chunk_index", 0))
        segments = []
        for chunk in chunks_sorted:
            chunk_idx = chunk.get("chunk_index", 0)
            segments.append({
                "start_line": chunk_idx,
                "end_line": chunk_idx,
                "content": chunk["content"],
                "section": chunk.get("section", f"Chunk {chunk_idx}"),
            })
        all_content = "\n\n---\n\n".join(seg["content"] for seg in segments)
        chunk_texts = [g["content"] for g in group]
        section_label = f"Chunks {segments[0]['start_line']}–{segments[-1]['end_line']}" if len(segments) > 1 else f"Chunk {segments[0]['start_line']}"
        final_other_chunks.append({
            "source_file": filename,
            "section": section_label,
            "segments": segments,
            "content": all_content,
            "chunks": chunk_texts,
            "start_line": segments[0]["start_line"],
            "end_line": segments[-1]["end_line"],
        })

    final_sources = pdf_sources + final_other_chunks
    deduped_sources = []
    seen = set()
    for src in final_sources:
        key = (src["source_file"], src.get("section", ""))
        if key not in seen:
            seen.add(key)
            deduped_sources.append(src)

    # ── NEW: Build focused answer – only the most relevant chunk per source ──
    answer_parts = []
    for src in deduped_sources[:3]:  # limit to top 3 sources
        # Take the first segment/chunk content as the most relevant
        if "full_content" in src and src["full_content"]:
            # For PDF, use the first page's text (or the matched page if available)
            text = src["full_content"][0].get("text", "")
            if text:
                answer_parts.append(f"**From {src['source_file']}**\n{text[:800]}...")
        elif "segments" in src and src["segments"]:
            text = src["segments"][0].get("content", "")
            if text:
                answer_parts.append(f"**From {src['source_file']}**\n{text[:800]}...")
        else:
            text = src.get("content", "")
            if text:
                answer_parts.append(f"**From {src['source_file']}**\n{text[:800]}...")

    if not answer_parts:
        answer = "I found some relevant documents but could not extract a short answer. Please open the source preview."
    else:
        answer = "\n\n".join(answer_parts)

    return {"answer": answer, "sources": deduped_sources}


def _group_by_file(chunks):
    groups = defaultdict(list)
    for src in chunks:
        groups[src["source_file"]].append(src)
    return groups