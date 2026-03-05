"""Document viewer — source preview with full page support for PDFs."""
import os
import re
from typing import Dict, Any, List
from pathlib import Path
import streamlit as st
import streamlit.components.v1 as components
import pdfplumber

try:
    from config import DOCS_DIR
except ImportError:
    import sys
    sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    from config import DOCS_DIR


# ── Helpers ─────────────────────────────────────────────────

def resolve_doc_path(source_file: str) -> Path | None:
    """Find the actual file on disk. Returns full Path or None."""
    candidates = [
        Path(DOCS_DIR) / source_file,
        Path(DOCS_DIR).parent / "documents" / source_file,
        Path(DOCS_DIR).parent / source_file,
        Path(source_file),
    ]
    for p in candidates:
        if p.exists():
            return p
    return None


def document_exists(source_file: str) -> bool:
    return resolve_doc_path(source_file) is not None


def strip_citation_markers(text: str) -> str:
    """Remove ALL [Source: ...] markers from LLM output."""
    return re.sub(r'\[Source:[^\]]*\]', '', text).strip()


def deduplicate_sources(sources: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Deduplicate sources based on file name, expanding line ranges."""
    seen = {}
    out = []
    for src in sources:
        file = src.get("source_file", "Unknown")
        
        if file not in seen:
            new_src = dict(src)
            seen[file] = new_src
            out.append(new_src)
        else:
            existing = seen[file]
            if src.get("start_line") is not None and existing.get("start_line") is not None:
                existing["start_line"] = min(existing["start_line"], src["start_line"])
            if src.get("end_line") is not None and existing.get("end_line") is not None:
                existing["end_line"] = max(existing["end_line"], src["end_line"])
                
            # Optionally update section to indicate multiple
            if existing.get("section") != src.get("section") and "Multiple" not in existing.get("section", ""):
                existing["section"] = "Multiple Sections"
                
    return out


@st.cache_data
def get_pdf_page_text(filepath: str, page_num: int) -> str:
    """Extract text using pdfplumber for better accuracy."""
    try:
        with pdfplumber.open(filepath) as pdf:
            if 1 <= page_num <= len(pdf.pages):
                return pdf.pages[page_num - 1].extract_text() or ""
    except Exception as e:
        print(f"Error: {e}")
    return ""


@st.cache_data
def get_full_pdf_text(filepath: str) -> str:
    """Extract full text of all pages in a PDF using pdfplumber."""
    try:
        parts = []
        with pdfplumber.open(filepath) as pdf:
            for i, page in enumerate(pdf.pages, 1):
                text = page.extract_text() or ""
                parts.append(f"--- Page {i} ---\n{text}")
        return "\n\n".join(parts)
    except Exception as e:
        print(f"Error: {e}")
    return ""


# ── Renderers ───────────────────────────────────────────────

def render_document_preview_html(source: Dict[str, Any]) -> None:
    """Render the right preview depending on file type."""
    source_file = source.get("source_file", "Unknown")
    ext = os.path.splitext(source_file)[1].lower()

    if ext == ".pdf":
        _render_pdf_preview(source)
    elif ext in (".md", ".txt"):
        _render_text_preview(source)
    elif ext in (".xlsx", ".xls", ".csv"):
        _render_data_preview(source)
    elif ext == ".docx":
        _render_docx_preview(source)
    else:
        st.info(f"Preview not available for {ext} files.")


def _render_pdf_preview(source: Dict[str, Any]) -> None:
    """Render PDF preview showing specific page with highlighted chunks."""
    source_file = source.get("source_file", "Unknown")
    page_num = source.get("page", 1)
    
    # Resolve file path
    filepath = resolve_doc_path(source_file)
    if not filepath:
        st.warning(f"PDF not found: {source_file}")
        return
    
    # Extract page text
    full_text = get_pdf_page_text(str(filepath), page_num)
    
    if not full_text:
        st.warning(f"Could not extract text from page {page_num}")
        return
    
    # Get chunks to highlight
    chunks = source.get("chunks", [])
    
    # Build HTML with highlights
    escaped = full_text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    
    # Highlight each chunk
    for chunk in chunks:
        chunk_clean = chunk.strip()
        if chunk_clean in full_text:
            chunk_esc = chunk_clean.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
            escaped = escaped.replace(chunk_esc, f'<mark style="background-color: #fbbf24; color: #000; padding: 2px 4px; border-radius: 3px;">{chunk_esc}</mark>')
    
    html = f'''
    <div style="background:#0a0c10; border:1px solid #252a35; border-radius:10px;
                padding:16px; font-family:'DM Mono',monospace; font-size:12px;
                color:#c9d1d9; max-height:350px; overflow-y:auto; line-height:1.7;
                white-space:pre-wrap; word-break:break-word;">
        <div style="color:#4f8ef7; font-size:10px; font-weight:600;
                    letter-spacing:1.2px; text-transform:uppercase;
                    margin-bottom:10px; padding-bottom:8px;
                    border-bottom:1px solid #252a35;">
            📄 {source_file} — Page {page_num}
        </div>
        {escaped}
    </div>
    '''
    components.html(html, height=370, scrolling=True)


def _render_text_preview(source: Dict[str, Any]) -> None:
    """Line-by-line viewer with yellow highlighting for .md/.txt files."""
    source_file = source.get("source_file", "Unknown")
    start_line = int(source.get("start_line", 1))
    end_line = int(source.get("end_line", 1))

    resolved = resolve_doc_path(source_file)
    if not resolved:
        st.warning(f"Document not found: {source_file}")
        return

    try:
        with open(resolved, "r", encoding="utf-8") as f:
            lines = f.read().split("\n")
    except Exception:
        st.warning(f"Could not read: {source_file}")
        return

    total_lines = len(lines)
    start_line = max(1, min(start_line, total_lines))
    end_line = max(start_line, min(end_line, total_lines))

    window_start = max(0, start_line - 5)
    window_end = min(total_lines, end_line + 10)

    html_parts = ['''
    <!DOCTYPE html><html><head><style>
        body { margin:0; padding:0; font-family:'DM Mono',monospace; font-size:12px; }
        .doc-container { max-height:350px; overflow-y:auto; background:#0a0c10;
                         border-radius:8px; border:1px solid #252a35; }
        table { width:100%; border-collapse:collapse; }
        td { padding:2px 10px; border:none; line-height:1.65; }
        .num { color:#4a5168; text-align:right; width:28px;
               padding-right:12px; font-size:10px; user-select:none; }
        .content { color:#c9d1d9; white-space:pre-wrap; word-break:break-word; }
        .hl { background:rgba(255,220,50,0.1); border-left:2px solid #fbbf24; }
        .hl .num { color:#fbbf24; font-weight:bold; }
    </style></head><body><div class="doc-container"><table>
    ''']

    for i in range(window_start, window_end):
        num = i + 1
        text = lines[i] if i < len(lines) else ""
        escaped = text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
        cls = ' class="hl"' if start_line <= num <= end_line else ""
        html_parts.append(
            f'<tr{cls}><td class="num">{num}</td><td class="content">{escaped}</td></tr>'
        )

    html_parts.append("</table></div></body></html>")
    components.html("".join(html_parts), height=370, scrolling=True)
    st.caption("🟨 Yellow = referenced section")


def _render_data_preview(source: Dict[str, Any]) -> None:
    """Show chunk content for Excel/CSV sources."""
    content = source.get("content", "")
    source_file = source.get("source_file", "Unknown")
    section = source.get("section", "Data")

    if content:
        st.code(content[:2000], language=None)
    else:
        st.info(f"📊 **{source_file}** — {section} referenced.")


def _render_docx_preview(source: Dict[str, Any]) -> None:
    """Show chunk content for .docx sources."""
    content = source.get("content", "")
    source_file = source.get("source_file", "Unknown")

    if content:
        escaped = content.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
        html = f'''
        <div style="background:#0a0c10; border:1px solid #252a35; border-radius:10px;
                    padding:16px; font-family:'DM Mono',monospace; font-size:12px;
                    color:#c9d1d9; max-height:350px; overflow-y:auto; line-height:1.7;
                    white-space:pre-wrap; word-break:break-word;">
            <div style="color:#4f8ef7; font-size:10px; font-weight:600;
                        letter-spacing:1.2px; text-transform:uppercase;
                        margin-bottom:10px; padding-bottom:8px;
                        border-bottom:1px solid #252a35;">
                📝 {source_file}
            </div>
            {escaped}
        </div>
        '''
        components.html(html, height=370, scrolling=True)
    else:
        st.info(f"📝 **{source_file}** referenced.")