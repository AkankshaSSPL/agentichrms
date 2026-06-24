"""
rag/bm25_index.py

In-memory BM25 index over DOCS_DIR.

Public API (called from agent/tools_registry.py and backend/api/docs.py):

    search(query, k=3)  → list[dict]   search the current index
    rebuild()           → None          re-read DOCS_DIR and rebuild the index

The index is rebuilt:
  • Once at import time (module-level warm-up).
  • After every upload / delete via docs.py → rebuild().

No persistence — the index lives only in RAM and is rebuilt from the files
on disk. This is fast for typical HR document libraries (tens of files).

Chunk format returned by search():
    {
        "source":  "filename.pdf",
        "chunk":   4,               # 0-based chunk index within the file
        "content": "…text…",        # up to 500 chars of the chunk
    }
"""

import logging
import threading
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

# ── Lazy import guard — rank-bm25 is a required dep but we import lazily ──────
# so that a missing install fails at search() time with a clear error rather
# than at module import time, which would crash the whole app.

_lock = threading.Lock()
_bm25 = None          # BM25Okapi instance
_chunks: list[dict] = []   # parallel list — chunk[i] ↔ _bm25 corpus[i]


# ── Text extraction helpers ───────────────────────────────────────────────────

def _extract_text(path: Path) -> str:
    """Extract raw text from a supported file. Returns '' on failure."""
    suffix = path.suffix.lower()
    try:
        if suffix == ".pdf":
            import pypdf
            reader = pypdf.PdfReader(str(path))
            return "\n".join(page.extract_text() or "" for page in reader.pages)

        if suffix == ".docx":
            import docx as _docx
            doc = _docx.Document(str(path))
            return "\n".join(p.text for p in doc.paragraphs)

        if suffix in (".md", ".txt"):
            return path.read_text(encoding="utf-8", errors="replace")

    except Exception as exc:  # noqa: BLE001
        logger.warning("Text extraction failed for %s: %s", path.name, exc)

    return ""


def _chunk_text(text: str, size: int, overlap: int) -> list[str]:
    """Split text into overlapping chunks."""
    chunks = []
    start = 0
    while start < len(text):
        chunk = text[start: start + size].strip()
        if chunk:
            chunks.append(chunk)
        start += size - overlap
    return chunks


# ── Index rebuild ──────────────────────────────────────────────────────────────

def rebuild() -> None:
    """
    Re-read every document in DOCS_DIR, chunk them, and rebuild the BM25 index.
    Thread-safe; safe to call from any thread.
    """
    global _bm25, _chunks

    from backend.core.config import settings
    from rank_bm25 import BM25Okapi

    docs_dir = Path(settings.DOCS_DIR)
    supported = {".pdf", ".md", ".txt", ".docx"}

    new_chunks: list[dict] = []
    corpus: list[list[str]] = []

    if docs_dir.exists():
        for file_path in sorted(docs_dir.iterdir()):
            if not file_path.is_file():
                continue
            if file_path.suffix.lower() not in supported:
                continue

            raw = _extract_text(file_path)
            if not raw.strip():
                logger.debug("Skipping %s — no extractable text", file_path.name)
                continue

            file_chunks = _chunk_text(
                raw,
                size=settings.RAG_CHUNK_SIZE,
                overlap=settings.RAG_CHUNK_OVERLAP,
            )
            for i, chunk in enumerate(file_chunks):
                new_chunks.append({
                    "source": file_path.name,
                    "chunk": i,
                    "content": chunk,
                })
                corpus.append(chunk.lower().split())

    if not corpus:
        logger.info("BM25 index: no documents found in %s — index is empty", docs_dir)
        with _lock:
            _bm25 = None
            _chunks = []
        return

    new_index = BM25Okapi(corpus)

    with _lock:
        _bm25 = new_index
        _chunks = new_chunks

    logger.info(
        "BM25 index rebuilt: %d chunks from %d files",
        len(new_chunks),
        len({c["source"] for c in new_chunks}),
    )


# ── Search ────────────────────────────────────────────────────────────────────

def search(query: str, k: Optional[int] = None) -> list[dict]:
    """
    BM25 search over the in-memory index.

    Args:
        query: Natural-language query string.
        k:     Number of results to return. Defaults to settings.RAG_TOP_K.

    Returns:
        List of up to k chunk dicts: {"source", "chunk", "content"}.
        Returns [] if the index is empty.
    """
    from backend.core.config import settings

    if k is None:
        k = settings.RAG_TOP_K

    with _lock:
        bm25 = _bm25
        chunks = _chunks

    if bm25 is None or not chunks:
        logger.warning("BM25 index is empty — no documents indexed yet")
        return []

    tokenized = query.lower().split()
    scores = bm25.get_scores(tokenized)

    # Get top-k indices by score (highest first)
    top_indices = sorted(range(len(scores)), key=lambda i: scores[i], reverse=True)[:k]

    results = []
    for idx in top_indices:
        if scores[idx] <= 0:
            break  # no relevant results
        results.append(chunks[idx])

    return results


# ── Module-level warm-up ──────────────────────────────────────────────────────
# Runs once when the module is first imported. Failures are caught so a missing
# docs directory on a fresh install doesn't break startup.
try:
    rebuild()
except Exception as _warm_up_exc:  # noqa: BLE001
    logger.warning("BM25 warm-up skipped: %s", _warm_up_exc)