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
        # GAP-025 FIX: Wrap model loading in try/except so a bad model name or
        # missing download gives a clear RuntimeError at startup instead of an
        # opaque crash deep inside sentence_transformers.
        try:
            self.client = chromadb.PersistentClient(path=str(CHROMA_DIR))
            # GAP-040 FIX: Don't cache the collection object — access it via a
            # property so that after ingest (which deletes and recreates the
            # collection) the retriever always gets a fresh reference.
            self._collection_name = "hr_docs_v2"
            self.model = SentenceTransformer(LOCAL_EMBEDDING_MODEL)
        except Exception as exc:
            raise RuntimeError(
                f"Failed to initialise SourceTrackedRetriever. "
                f"Embedding model: '{LOCAL_EMBEDDING_MODEL}'. "
                f"Ensure the model is downloaded and CHROMA_DIR is accessible.\n"
                f"Original error: {exc}"
            ) from exc

        self._reranker: Optional[CrossEncoder] = None

    # GAP-040 FIX: Collection is fetched on every access via a property.
    # After ingest wipes and recreates the collection, this always returns the
    # live collection rather than a stale cached reference.
    @property
    def collection(self):
        return self.client.get_or_create_collection(name=self._collection_name)

    def refresh_collection(self):
        """
        GAP-040 FIX: Explicit refresh hook.
        Call this from api.py's /api/ingest endpoint after ingestion completes
        to ensure the lazy property picks up the new collection immediately.
        No-op when collection property is already live, but kept for clarity.
        """
        # The property already fetches fresh — nothing extra needed.
        # Hook kept so callers have a named method to document intent.
        pass

    @property
    def reranker(self) -> CrossEncoder:
        """Lazy-load the reranker model on first use."""
        if self._reranker is None:
            # GAP-025 FIX: Wrap reranker load in try/except with clear message.
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
        """Detect which policy the user is asking about."""
        query_lower = query.lower()

        policy_keywords = {
            "whistle blower": [
                "whistle", "blower", "whistleblower", "report concern",
                "unethical", "fraud reporting", "reporting mechanism",
            ],
            "confidentiality": [
                "confidential", "secrecy", "secret", "non-disclosure",
                "nda", "data protection",
            ],
            "it asset": [
                "it asset", "computer", "laptop", "software", "vpn",
                "email policy", "internet use", "acceptable use",
            ],
            "leave": [
                "leave", "vacation", "sick leave", "casual leave",
                "earned leave", "maternity", "paternity",
            ],
            # GAP-007 FIX: Missing comma between "solicit" and "external work"
            # caused Python to silently concatenate them into "solicitexternal work".
            # Neither keyword would ever match a query individually.
            "moonlighting": [
                "moonlight", "outside work", "dual employment", "side job",
                "covenants", "compete", "solicit", "external work",
            ],
            "remote work": [
                "remote", "work from home", "wfh", "home office", "telecommute",
            ],
            "onboarding": [
                "onboard", "joining", "new hire", "first day",
                "induction", "orientation",
            ],
            "code of conduct": [
                "code of conduct", "ethics", "behavior", "discipline",
                "workplace behavior",
            ],
        }

        for policy, keywords in policy_keywords.items():
            if any(kw in query_lower for kw in keywords):
                return policy

        return None

    def _normalize_scores(self, chunks: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """
        GAP-022 FIX: Normalize CrossEncoder relevance_score to [0, 1] using
        the sigmoid function so it is comparable with verification_score [0,1]
        and policy_match (0 or 0.2) in the combined ranking formula.

        Without normalization, raw CrossEncoder scores can be large negative
        numbers (e.g. -8) or large positive numbers (e.g. +6), which dominate
        the weighted sum and make verification_score irrelevant.
        """
        for chunk in chunks:
            raw = chunk.get("relevance_score", 0.0)
            # Sigmoid: 1 / (1 + e^-x)  maps any real number to (0, 1)
            chunk["relevance_score"] = 1.0 / (1.0 + math.exp(-raw))
        return chunks

    def rerank_chunks(
        self, query: str, chunks: List[Dict[str, Any]], top_k: int = 5
    ) -> List[Dict[str, Any]]:
        """Rerank chunks using cross-encoder for better relevance."""
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

        # GAP-022 FIX: Normalize after assigning raw scores
        return self._normalize_scores(result)

    def filter_by_policy_type(
        self, chunks: List[Dict[str, Any]], policy_type: Optional[str]
    ) -> List[Dict[str, Any]]:
        """Boost chunks matching the detected policy type to the top."""
        if not policy_type or not chunks:
            return chunks

        matching = []
        non_matching = []

        for chunk in chunks:
            chunk_policy = chunk.get("policy_type", "").lower()
            section = chunk.get("section", "").lower()
            content = chunk.get("content", "").lower()

            is_match = (
                policy_type in chunk_policy
                or policy_type in section
                or policy_type.replace(" ", "_") in content[:500]
            )

            if is_match:
                chunk["policy_match"] = True
                matching.append(chunk)
            else:
                chunk["policy_match"] = False
                non_matching.append(chunk)

        return matching + non_matching

    def verify_source_match(self, query: str, chunk_content: str) -> float:
        """Jaccard-based relevance check. Returns confidence score [0, 1]."""
        query_words = set(re.findall(r'\b\w{4,}\b', query.lower()))
        content_words = set(re.findall(r'\b\w{4,}\b', chunk_content.lower()))

        if not query_words:
            return 0.5

        intersection = len(query_words & content_words)
        return intersection / len(query_words)

    def retrieve_with_sources(
        self, query: str, k: int = 15, final_k: int = 7
    ) -> List[Dict[str, Any]]:
        """Retrieve with reranking and verification."""

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

            # GAP-015 FIX: Use None instead of the hardcoded defaults (1, 5).
            # When start_line/end_line are genuinely absent from metadata,
            # storing 1 and 5 caused all such chunks to appear co-located and
            # get merged into one giant segment with a misleading "Lines 1-5" label.
            raw_start = metadata.get("start_line")
            raw_end = metadata.get("end_line")
            start_line = int(raw_start) if raw_start is not None else None
            end_line = int(raw_end) if raw_end is not None else None

            chunks.append({
                "content": doc_text,
                "source_file": metadata.get("source", "Unknown"),
                "section": metadata.get("section", "General"),
                "policy_type": metadata.get("policy_type", "General"),
                "page": metadata.get("page"),
                "start_line": start_line,
                "end_line": end_line,
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


# Module-level singleton — instantiated once on first import.
# GAP-040: collection is fetched via property so ingest invalidation is automatic.
_retriever = SourceTrackedRetriever()


@tool
def search_policies(query: str) -> Dict[str, Any]:
    """
    Search HR policies and documents. Returns both answer text and source list.
    Uses reranking to ensure the most relevant sources are returned.
    """
    chunk_sources = _retriever.retrieve_with_sources(query, k=15, final_k=10)

    if not chunk_sources:
        return {
            "answer": "No relevant documents found for this query.",
            "sources": [],
        }

    # Split PDF chunks (have a page number) from text chunks
    pdf_chunks = [s for s in chunk_sources if s.get("page") is not None]
    other_chunks = [s for s in chunk_sources if s.get("page") is None]

    # ── PDF sources ───────────────────────────────────────────────────────────
    pdf_groups: Dict[str, list] = defaultdict(list)
    for src in pdf_chunks:
        pdf_groups[src["source_file"]].append(src)

    pdf_sources = []
    for filename, group in pdf_groups.items():
        filepath = resolve_doc_path(filename)
        if not filepath:
            logger.warning("Could not resolve path for %s", filename)
            continue

        pages = sorted(set(g["page"] for g in group if g.get("page") is not None)) or [1]

        # GAP-026 FIX: Load only the matched pages during search instead of
        # loading the entire PDF. Full pagination content is no longer pre-loaded
        # here — the preview panel (document_viewer.py) fetches additional pages
        # lazily via get_pdf_page_text() when the user opens the source card.
        import pdfplumber
        full_content_pages = []
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
            # GAP-008 (display fix): label these as pages, not lines
            "start_line": pages[0],
            "end_line": pages[-1],
            "relevance_score": max(g.get("relevance_score", 0) for g in group),
            "verification_score": max(g.get("verification_score", 0) for g in group),
        })

    # ── Text / MD / DOCX sources ──────────────────────────────────────────────
    final_other_chunks = []
    other_groups: Dict[str, list] = defaultdict(list)
    for src in other_chunks:
        other_groups[src["source_file"]].append(src)

    for filename, group in other_groups.items():
        # GAP-015 FIX: Skip chunks with unknown line positions — merging None
        # values would collapse all position-less chunks into one fake segment.
        valid_group = [
            g for g in group
            if g.get("start_line") is not None and g.get("end_line") is not None
        ]
        unknown_group = [
            g for g in group
            if g.get("start_line") is None or g.get("end_line") is None
        ]

        refined_segments = []

        if valid_group:
            sorted_group = sorted(valid_group, key=lambda x: x["start_line"])
            current_sub = [sorted_group[0]]

            for g in sorted_group[1:]:
                gap = g["start_line"] - current_sub[-1]["end_line"]
                total_l = g["end_line"] - current_sub[0]["start_line"]

                # GAP-009 FIX: Also require the same section header before merging.
                # Previously two chunks from completely different sections of the
                # same file could have adjacent fake line numbers and get merged,
                # producing a Frankenstein text block.
                same_section = g.get("section") == current_sub[-1].get("section")

                if gap <= 2 and total_l <= 50 and same_section:
                    current_sub.append(g)
                else:
                    refined_segments.append(current_sub)
                    current_sub = [g]
            refined_segments.append(current_sub)

        # Chunks without line info get their own single-chunk segment
        for g in unknown_group:
            refined_segments.append([g])

        if not refined_segments:
            continue

        file_segments = []
        ranges = []
        for segment_group in refined_segments:
            s_line = segment_group[0].get("start_line")
            e_line = segment_group[-1].get("end_line")
            combined_content = "\n".join(c.get("content", "") for c in segment_group)

            file_segments.append({
                "start_line": s_line,
                "end_line": e_line,
                "content": combined_content,
                "section": segment_group[0].get("section", "Source"),
            })
            label = f"{s_line}-{e_line}" if s_line is not None else "?"
            ranges.append(label)

        # GAP-010 FIX: 'content' now concatenates ALL segments, not just [0].
        # Previously the React frontend's text-file branch used source.content
        # which only had the first segment, so subsequent segments were invisible.
        all_content = "\n\n---\n\n".join(seg["content"] for seg in file_segments)

        # GAP-016 FIX: Attach 'chunks' to text sources so the React frontend
        # has the same chunk-based highlighting data that PDF sources get.
        # Previously source.chunks was always undefined for text files, forcing
        # the highlighting to fall back to answer-derived terms (wrong content).
        chunk_texts = [g.get("content", "") for g in group]

        final_other_chunks.append({
            "source_file": filename,
            "section": f"Lines {', '.join(ranges)}",
            "segments": file_segments,
            "content": all_content,          # GAP-010 FIX: all segments
            "chunks": chunk_texts,            # GAP-016 FIX: chunk texts for highlighting
            "start_line": file_segments[0]["start_line"],
            "end_line": file_segments[-1]["end_line"],
        })

    # ── Combine and deduplicate ───────────────────────────────────────────────
    final_sources = pdf_sources + final_other_chunks

    seen: set = set()
    deduped_sources = []
    for src in final_sources:
        key = (src["source_file"], src.get("section", ""))
        if key not in seen:
            seen.add(key)
            deduped_sources.append(src)

    # ── Build answer text for the LLM ─────────────────────────────────────────
    results_text = []
    for i, src in enumerate(deduped_sources[:8], 1):
        full_text = ""

        if "full_content" in src and src["full_content"]:
            start_page = src.get("start_line", 1)
            end_page = src.get("end_line", start_page)
            for page_info in src["full_content"]:
                page_num = page_info.get("page")
                if start_page <= page_num <= end_page:
                    full_text += f"\n[Page {page_num}]\n{page_info.get('text', '')}\n"
        elif "segments" in src and src["segments"]:
            for seg in src["segments"]:
                full_text += (
                    f"\n[Lines {seg.get('start_line', '?')}-{seg.get('end_line', '?')}]\n"
                    f"{seg.get('content', '')}\n"
                )
        else:
            full_text = src.get("content", "")

        if len(full_text) > 5000:
            full_text = full_text[:5000] + "... [truncated]"

        if not full_text.strip():
            full_text = "[No text available for this source]"

        results_text.append(
            f"RESULT {i} [Source: {src['source_file']} | "
            f"Section: {src['section']} | "
            f"Lines: {src['start_line']}-{src['end_line']}]\n"
            f"{full_text}"
        )

    answer = "\n\n---\n\n".join(results_text)

    return {"answer": answer, "sources": deduped_sources}