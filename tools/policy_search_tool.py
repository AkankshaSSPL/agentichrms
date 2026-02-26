"""RAG Retriever tool exposed to LangGraph."""
import chromadb
from sentence_transformers import SentenceTransformer, CrossEncoder
import sys
import os
from .base import hr_tool

# Ensure config can be imported
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from config import CHROMA_DIR, LOCAL_EMBEDDING_MODEL, LOCAL_RERANK_MODEL

# Global instances
_embed_model = None
_rerank_model = None
_collection = None

def _get_resources():
    global _embed_model, _rerank_model, _collection
    if _embed_model is None:
        _embed_model = SentenceTransformer(LOCAL_EMBEDDING_MODEL)
    if _rerank_model is None:
        _rerank_model = CrossEncoder(LOCAL_RERANK_MODEL)
    if _collection is None:
        client = chromadb.PersistentClient(path=str(CHROMA_DIR))
        _collection = client.get_or_create_collection("hr_docs_v2")
    return _embed_model, _rerank_model, _collection

@hr_tool
def search_policies(query: str) -> str:
    """
    Search company policies, employee handbook, and guidelines.
    Use this for ANY general question about rules, benefits, leave types, or procedures.
    Returns: Relevant excerpts with line numbers.
    """
    embed_model, rerank_model, collection = _get_resources()
    
    # 1. Vector Search
    q_vec = embed_model.encode([query]).tolist()
    results = collection.query(query_embeddings=q_vec, n_results=10)
    
    if not results['documents'][0]:
        return "No relevant policies found."
        
    # 2. Rerank
    candidates = []
    for i, doc in enumerate(results['documents'][0]):
        candidates.append({
            "text": doc,
            "meta": results['metadatas'][0][i]
        })
        
    passages = [[query, c["text"]] for c in candidates]
    scores = rerank_model.predict(passages)
    
    ranked = sorted(zip(candidates, scores), key=lambda x: x[1], reverse=True)
    top_3 = ranked[:3]
    
    # Format output for the agent
    response = f"Found {len(top_3)} relevant policy sections:\n\n"
    for item, score in top_3:
        meta = item["meta"]
        response += f"--- Source: {meta['source']} (Lines {meta['start_line']}-{meta['end_line']}) ---\n"
        response += f"Section: {meta['section']}\n"
        response += item["text"] + "\n\n"
        
    return response
