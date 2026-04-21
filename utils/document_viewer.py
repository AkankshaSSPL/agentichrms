# utils/document_viewer.py – backend version (no Streamlit)
import os
from pathlib import Path
from config import DOCS_DIR

# Try to import pdfplumber for PDF text extraction
try:
    import pdfplumber
except ImportError:
    pdfplumber = None

def get_pdf_page_text(pdf_path: str, page_num: int) -> str:
    """Extract text from a specific PDF page using pdfplumber."""
    if not pdfplumber:
        return "[PDF extraction not available – install pdfplumber]"
    try:
        with pdfplumber.open(pdf_path) as pdf:
            if page_num - 1 < len(pdf.pages):
                return pdf.pages[page_num - 1].extract_text() or ""
            else:
                return f"Page {page_num} out of range (total pages: {len(pdf.pages)})"
    except Exception as e:
        return f"Error reading PDF page: {str(e)}"

def resolve_doc_path(filename: str) -> str | None:
    """Resolve document path from DOCS_DIR."""
    docs_path = Path(DOCS_DIR)
    candidates = [docs_path / filename, docs_path / filename.lower(), docs_path / filename.upper()]
    for candidate in candidates:
        if candidate.exists():
            return str(candidate)
    return None

# For compatibility with frontend (if needed), we keep render_document_preview_html
# but make it a no‑op or return a placeholder when not in Streamlit.
def render_document_preview_html(source):
    """Placeholder for backend – frontend handles rendering."""
    return "<div>Preview not available in API mode</div>"

def deduplicate_sources(sources):
    """Remove duplicate sources based on file and section."""
    seen = set()
    unique = []
    for src in sources:
        key = (src.get("source_file"), src.get("section"))
        if key not in seen:
            seen.add(key)
            unique.append(src)
    return unique

def strip_citation_markers(text: str) -> str:
    """Remove citation markers like [1], [2] from text."""
    import re
    return re.sub(r'\[\d+\]', '', text)

def document_exists(filename: str) -> bool:
    """Check if a document exists in DOCS_DIR."""
    docs_path = Path(DOCS_DIR)
    return (docs_path / filename).exists()