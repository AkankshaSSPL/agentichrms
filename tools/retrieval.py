"""Retrieval tools with source tracking and reranker verification."""
import os
import sys
import re
import chromadb
from sentence_transformers import SentenceTransformer, CrossEncoder
from langchain_core.tools import tool
from typing import List, Dict, Any, Optional
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
        # Initialize reranker (lazy loading)
        self._reranker = None
    
    @property
    def reranker(self):
        """Lazy load the reranker model."""
        if self._reranker is None:
            print("Loading reranker model...")
            self._reranker = CrossEncoder('cross-encoder/ms-marco-MiniLM-L-6-v2')
        return self._reranker

    def extract_policy_type(self, query: str) -> Optional[str]:
        """Detect which policy the user is asking about."""
        query_lower = query.lower()
        
        policy_keywords = {
            "whistle blower": ["whistle", "blower", "whistleblower", "report concern", "unethical", "fraud reporting", "reporting mechanism"],
            "confidentiality": ["confidential", "secrecy", "secret", "non-disclosure", "nda", "data protection"],
            "it asset": ["it asset", "computer", "laptop", "software", "vpn", "email policy", "internet use", "acceptable use"],
            "leave": ["leave", "vacation", "sick leave", "casual leave", "earned leave", "maternity", "paternity"],
            "moonlighting": ["moonlight", "outside work", "dual employment", "side job", "external work"],
            "remote work": ["remote", "work from home", "wfh", "home office", "telecommute"],
            "onboarding": ["onboard", "joining", "new hire", "first day", "induction", "orientation"],
            "code of conduct": ["code of conduct", "ethics", "behavior", "discipline", "workplace behavior"],
        }
        
        for policy, keywords in policy_keywords.items():
            if any(kw in query_lower for kw in keywords):
                return policy
        
        return None

    def rerank_chunks(self, query: str, chunks: List[Dict[str, Any]], top_k: int = 5) -> List[Dict[str, Any]]:
        """
        Rerank chunks using cross-encoder for better relevance.
        """
        if not chunks:
            return []
        
        # Prepare pairs for reranking
        pairs = [(query, chunk["content"]) for chunk in chunks]
        
        # Get relevance scores
        scores = self.reranker.predict(pairs)
        
        # Sort by score (descending)
        scored_chunks = list(zip(chunks, scores))
        scored_chunks.sort(key=lambda x: x[1], reverse=True)
        
        # Return top_k chunks with scores added
        result = []
        for chunk, score in scored_chunks[:top_k]:
            chunk["relevance_score"] = float(score)
            result.append(chunk)
        
        return result

    def filter_by_policy_type(self, chunks: List[Dict[str, Any]], policy_type: Optional[str]) -> List[Dict[str, Any]]:
        """
        Boost chunks matching the detected policy type to the top.
        """
        if not policy_type or not chunks:
            return chunks
        
        # Separate chunks by policy match
        matching = []
        non_matching = []
        
        for chunk in chunks:
            chunk_policy = chunk.get("policy_type", "").lower()
            section = chunk.get("section", "").lower()
            content = chunk.get("content", "").lower()
            
            # Check if policy type appears in metadata or content
            is_match = (
                policy_type in chunk_policy or 
                policy_type in section or
                policy_type.replace(" ", "_") in content[:500]  # Check start of content
            )
            
            if is_match:
                # Boost score slightly for matching policies
                chunk["policy_match"] = True
                matching.append(chunk)
            else:
                chunk["policy_match"] = False
                non_matching.append(chunk)
        
        # Return matching first, then non-matching
        return matching + non_matching

    def verify_source_match(self, query: str, chunk_content: str) -> float:
        """
        Check if chunk content is relevant to the query.
        Returns confidence score 0-1.
        """
        query_words = set(re.findall(r'\b\w{4,}\b', query.lower()))
        content_words = set(re.findall(r'\b\w{4,}\b', chunk_content.lower()))
        
        if not query_words:
            return 0.5
        
        # Calculate Jaccard similarity
        intersection = len(query_words & content_words)
        union = len(query_words | content_words)
        
        if union == 0:
            return 0.5
            
        return intersection / len(query_words)  # Normalize by query length

    def retrieve_with_sources(self, query: str, k: int = 15, final_k: int = 5) -> List[Dict[str, Any]]:
        """
        Retrieve with reranking and verification.
        
        Args:
            query: User question
            k: Number of chunks to retrieve initially (higher = more candidates)
            final_k: Number of chunks to return after reranking
        """
        # Step 1: Detect policy type from query
        policy_type = self.extract_policy_type(query)
        if policy_type:
            print(f"Detected policy type: {policy_type}")
        
        # Step 2: Get query embedding and retrieve from ChromaDB
        query_embedding = self.model.encode(query).tolist()
        results = self.collection.query(
            query_embeddings=[query_embedding],
            n_results=k,  # Retrieve more for reranking
            include=["documents", "metadatas", "distances"]
        )

        if not results["documents"] or not results["documents"][0]:
            return []

        # Step 3: Convert to list of dicts
        chunks = []
        for i in range(len(results["documents"][0])):
            metadata = results["metadatas"][0][i]
            doc_text = results["documents"][0][i]
            
            chunks.append({
                "content": doc_text,
                "source_file": metadata.get("source", "Unknown"),
                "section": metadata.get("section", "General"),
                "policy_type": metadata.get("policy_type", "General"),  # From your updated ingest_docs
                "page": metadata.get("page"),
                "start_line": int(metadata.get("start_line") or 1),
                "end_line": int(metadata.get("end_line") or 5),
                "score": 1 - results["distances"][0][i]  # Convert distance to similarity
            })

        # Step 4: Filter by policy type (boost matching policies)
        chunks = self.filter_by_policy_type(chunks, policy_type)
        
        # Step 5: Rerank for relevance
        reranked_chunks = self.rerank_chunks(query, chunks, top_k=final_k * 2)
        
        # Step 6: Verify and add verification scores
        verified_sources = []
        for chunk in reranked_chunks:
            v_score = self.verify_source_match(query, chunk["content"])
            chunk["verification_score"] = v_score
            
            # Only include if reasonably relevant
            if chunk["relevance_score"] > 0.1 or chunk.get("policy_match"):
                verified_sources.append(chunk)
        
        # Sort by combined score (relevance + verification + policy boost)
        verified_sources.sort(
            key=lambda x: (
                x.get("relevance_score", 0) * 0.5 + 
                x.get("verification_score", 0) * 0.3 +
                (0.2 if x.get("policy_match") else 0)
            ), 
            reverse=True
        )
        
        return verified_sources[:final_k]


_retriever = SourceTrackedRetriever()


@tool
def search_policies(query: str) -> Dict[str, Any]:
    """
    Search HR policies and documents. Returns both answer text and source list.
    Uses reranking to ensure most relevant sources are returned.
    """
    # Use the new retrieval with reranking (get top 5)
    chunk_sources = _retriever.retrieve_with_sources(query, k=15, final_k=5)

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
            # Fallback to matched pages individually
            for p in pages:
                page_text = get_pdf_page_text(str(filepath), p)
                full_content_pages.append({"page": p, "text": page_text})
            
        chunk_texts = [g["content"] for g in group]
        
        # Determine section display
        if len(pages) > 1:
            section = f"Pages {pages[0]}-{pages[-1]}"
        else:
            section = f"Page {pages[0]}"
            
        pdf_sources.append({
            "source_file": filename,
            "page": pages[0],
            "section": section,
            "full_content": full_content_pages,
            "chunks": chunk_texts,
            "start_line": pages[0],
            "end_line": pages[-1],
            "relevance_score": max([g.get("relevance_score", 0) for g in group]),
            "verification_score": max([g.get("verification_score", 0) for g in group]),
        })

    # Process non-PDF chunks (markdown, docx, etc.)
    other_sources = []
    for src in other_chunks:
        other_sources.append({
            "source_file": src["source_file"],
            "section": src["section"],
            "content": src["content"],
            "start_line": src["start_line"],
            "end_line": src["end_line"],
            "relevance_score": src.get("relevance_score", 0),
            "verification_score": src.get("verification_score", 0),
            "policy_type": src.get("policy_type", "General"),
        })

    # Combine all sources
    final_sources = pdf_sources + other_sources

    # Build answer string from top chunk_sources
    results = []
    for i, src in enumerate(chunk_sources, 1):
        # Add verification badge to text
        v_badge = ""
        if src.get("verification_score", 0) > 0.5:
            v_badge = " [Verified]"
        elif src.get("policy_match"):
            v_badge = " [Policy Match]"
            
        results.append(
            f"RESULT {i}{v_badge}:\n"
            f"[Source: {src['source_file']} | Section: {src['section']} | "
            f"Lines {src['start_line']}-{src['end_line']}]\n"
            f"[Relevance: {src.get('relevance_score', 0):.2f} | "
            f"Verification: {src.get('verification_score', 0):.2f}]\n\n"
            f"{src['content'][:1200]}{'...' if len(src['content']) > 1200 else ''}"
        )
    answer = "\n\n---\n\n".join(results)

    return {
        "answer": answer,
        "sources": final_sources
    }