"""
rag/extract.py — shared text extraction and chunking for BM25 RAG.

Used by:
  - rag/bm25_index.py  (index rebuild)
  - backend/api/docs.py (upload validation)

Never import ChromaDB or sentence-transformers here.
"""
import re
import logging
from pathlib import Path
from typing import List

logger = logging.getLogger(__name__)


class ExtractionError(Exception):
    """Raised when a file cannot be read or parsed. Caller should log and skip."""


# ── Text extraction ────────────────────────────────────────────────────────────

def extract_text(path: Path) -> str:
    """
    Extract plain text from a file.

    Supported formats: .pdf, .docx, .md, .txt
    Raises ExtractionError on any failure so callers can skip bad files without
    crashing the whole index build.
    """
    suffix = path.suffix.lower()
    try:
        if suffix == ".pdf":
            return _extract_pdf(path)
        elif suffix == ".docx":
            return _extract_docx(path)
        elif suffix in (".md", ".txt"):
            return path.read_text(encoding="utf-8", errors="replace")
        else:
            raise ExtractionError(f"Unsupported file type: {suffix}")
    except ExtractionError:
        raise
    except Exception as exc:
        raise ExtractionError(f"Failed to extract {path.name}: {exc}") from exc


def _extract_pdf(path: Path) -> str:
    try:
        from pypdf import PdfReader
    except ImportError:
        raise ExtractionError("pypdf not installed; cannot read PDF files.")
    reader = PdfReader(str(path))
    pages = []
    for page in reader.pages:
        text = page.extract_text() or ""
        pages.append(text)
    full = "\n\n".join(pages)
    if not full.strip():
        raise ExtractionError(f"PDF produced no text (scanned image?): {path.name}")
    return full


def _extract_docx(path: Path) -> str:
    try:
        import docx
    except ImportError:
        raise ExtractionError("python-docx not installed; cannot read DOCX files.")
    doc = docx.Document(str(path))
    paragraphs = [p.text for p in doc.paragraphs if p.text.strip()]
    if not paragraphs:
        raise ExtractionError(f"DOCX produced no text: {path.name}")
    return "\n\n".join(paragraphs)


# ── Chunking ───────────────────────────────────────────────────────────────────

# Blank-line boundary or markdown heading
_SEMANTIC_SPLIT = re.compile(r"\n{2,}|(?=\n#+\s)")


def chunk_text(
    text: str,
    chunk_size: int = 500,
    chunk_overlap: int = 100,
) -> List[str]:
    """
    Split text into chunks for indexing.

    Strategy:
      1. Split on blank lines / markdown headings first (semantic units).
      2. If any semantic unit is still larger than chunk_size, fall back to a
         sliding fixed window so BM25 never receives a wall of text.
      3. Merge tiny fragments (< 80 chars) into the previous chunk to avoid
         orphaned single-sentence chunks.

    Returns a non-empty list; even a single short document returns one chunk.
    """
    if not text.strip():
        return []

    # Step 1 — semantic split
    raw_parts = [p.strip() for p in _SEMANTIC_SPLIT.split(text) if p.strip()]

    # Step 2 — window-split any oversized parts
    parts: List[str] = []
    for part in raw_parts:
        if len(part) <= chunk_size:
            parts.append(part)
        else:
            parts.extend(_window_split(part, chunk_size, chunk_overlap))

    if not parts:
        return [text.strip()[:chunk_size]]

    # Step 3 — merge orphaned tiny fragments
    merged: List[str] = []
    for part in parts:
        if merged and len(part) < 80:
            merged[-1] = merged[-1] + " " + part
        else:
            merged.append(part)

    return merged


def _window_split(text: str, size: int, overlap: int) -> List[str]:
    """Sliding-window character split with overlap."""
    chunks = []
    start = 0
    while start < len(text):
        end = start + size
        chunks.append(text[start:end].strip())
        start += size - overlap
    return [c for c in chunks if c]