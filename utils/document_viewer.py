"""Document viewer — source preview with full page support for PDFs."""
import os
import re
import html as html_module   # GAP FIX: explicit alias — avoids local variable shadowing
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


# ── Helpers ──────────────────────────────────────────────────────────────────

def resolve_doc_path(source_file: str) -> Path | None:
    """
    GAP-002 FIX: Find the actual file on disk, strictly within DOCS_DIR.

    Previously this function included `Path(source_file)` as a raw fallback
    candidate, which allowed an attacker to pass '/etc/passwd' or
    'C:\\Windows\\System32\\config\\SAM' and have it resolved and read.

    Now every candidate is validated with .relative_to(docs_root) before
    being returned. Any path that resolves outside DOCS_DIR is silently
    skipped, and the raw Path(source_file) fallback is removed entirely.
    """
    # Reject traversal characters before anything else
    name = os.path.basename(source_file.strip())
    if not name:
        return None

    docs_root = Path(DOCS_DIR).resolve()

    # Only search within DOCS_DIR — the raw Path(source_file) fallback is gone
    candidates = [
        Path(DOCS_DIR) / name,
        Path(DOCS_DIR).parent / "documents" / name,
        Path(DOCS_DIR).parent / name,
    ]

    for candidate in candidates:
        try:
            resolved = candidate.resolve()
            # Enforce that the resolved path is inside DOCS_DIR
            resolved.relative_to(docs_root)
            if resolved.exists():
                return resolved
        except ValueError:
            # .relative_to() raises ValueError when the path escapes docs_root
            continue

    return None


def document_exists(source_file: str) -> bool:
    return resolve_doc_path(source_file) is not None


def strip_citation_markers(text: str) -> str:
    """Remove ALL [Source: ...] markers from LLM output."""
    return re.sub(r'\[Source:[^\]]*\]', '', text).strip()


def deduplicate_sources(sources: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Deduplicate sources based on file name, expanding line ranges."""
    seen: Dict[str, Dict] = {}
    out: List[Dict] = []
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
            if (
                existing.get("section") != src.get("section")
                and "Multiple" not in existing.get("section", "")
            ):
                existing["section"] = "Multiple Sections"
    return out


@st.cache_data
def get_pdf_page_text(filepath: str, page_num: int) -> str:
    """Extract a single page's text via pdfplumber."""
    try:
        with pdfplumber.open(filepath) as pdf:
            if 1 <= page_num <= len(pdf.pages):
                return pdf.pages[page_num - 1].extract_text() or ""
    except Exception as e:
        print(f"Error extracting PDF page {page_num} from {filepath}: {e}")
    return ""


@st.cache_data
def get_full_pdf_text(filepath: str) -> str:
    """Extract all pages' text from a PDF via pdfplumber."""
    try:
        parts = []
        with pdfplumber.open(filepath) as pdf:
            for i, page in enumerate(pdf.pages, 1):
                text = page.extract_text() or ""
                parts.append(f"--- Page {i} ---\n{text}")
        return "\n\n".join(parts)
    except Exception as e:
        print(f"Error extracting full PDF text from {filepath}: {e}")
    return ""


# ── Renderers ─────────────────────────────────────────────────────────────────

def render_document_preview_html(source: Dict[str, Any]) -> None:
    """Dispatch to the correct renderer based on file extension."""
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


def _clean_answer_text(answer: str) -> str:
    """
    Strip markdown, citation markers, and formatting from the LLM answer
    so we can match its phrases against raw PDF text.
    """
    # Remove [Source: ...] citation markers
    text = re.sub(r'\[Source:[^\]]*\]', '', answer)
    # Remove markdown bold/italic
    text = re.sub(r'\*{1,2}(.+?)\*{1,2}', r'', text)
    # Remove markdown headers
    text = re.sub(r'^#{1,4}\s+', '', text, flags=re.MULTILINE)
    # Remove bullet point markers
    text = re.sub(r'^\s*[-*•]\s+', '', text, flags=re.MULTILINE)
    # Collapse whitespace
    text = re.sub(r'\s+', ' ', text).strip()
    return text


def _extract_answer_phrases(answer: str, min_len: int = 30) -> List[str]:
    """
    Split the cleaned answer into sentences and meaningful phrases.
    Returns only phrases long enough to be specific (>= min_len chars).
    These are the candidates we will look for in the PDF page text.
    """
    cleaned = _clean_answer_text(answer)
    # Split on sentence boundaries
    sentences = re.split(r'(?<=[.!?])\s+', cleaned)
    phrases = []
    for sent in sentences:
        sent = sent.strip()
        if len(sent) >= min_len:
            phrases.append(sent)
        else:
            # Short sentence — try sub-phrases split on comma/semicolon
            for sub in re.split(r'[,;]\s+', sent):
                sub = sub.strip()
                if len(sub) >= min_len:
                    phrases.append(sub)
    return phrases


def _find_spans_in_text(
    candidates: List[str],
    full_text: str,
    fuzzy_threshold: float = 0.82,
) -> list:
    """
    For each candidate phrase try:
      1. Exact substring match
      2. Fuzzy sliding-window match (difflib, threshold >= fuzzy_threshold)

    Returns a list of (start, end) character positions in full_text.
    Higher fuzzy_threshold means stricter — only use if the answer is
    very close to verbatim. Lower threshold catches more paraphrasing
    but risks false positives.
    """
    import difflib
    spans = []

    for phrase in candidates:
        phrase = phrase.strip()
        if not phrase:
            continue

        # Pass 1: exact match
        pos = full_text.find(phrase)
        if pos != -1:
            spans.append((pos, pos + len(phrase)))
            continue

        # Pass 2: case-insensitive exact match
        pos = full_text.lower().find(phrase.lower())
        if pos != -1:
            spans.append((pos, pos + len(phrase)))
            continue

        # Pass 3: fuzzy sliding window
        if len(phrase) < 20:
            continue  # too short to fuzzy-match reliably
        p_len = len(phrase)
        t_len = len(full_text)
        best_ratio = 0.0
        best_pos = -1
        step = max(1, p_len // 6)
        for i in range(0, t_len - p_len + 1, step):
            window = full_text[i: i + p_len]
            ratio = difflib.SequenceMatcher(None, phrase.lower(), window.lower()).ratio()
            if ratio > best_ratio:
                best_ratio = ratio
                best_pos = i
        if best_ratio >= fuzzy_threshold and best_pos >= 0:
            spans.append((best_pos, best_pos + p_len))

    return spans


def _merge_spans(spans: list) -> list:
    """Merge overlapping or adjacent spans into the minimal covering set."""
    if not spans:
        return []
    spans = sorted(spans, key=lambda x: x[0])
    merged = [list(spans[0])]
    for start, end in spans[1:]:
        if start <= merged[-1][1] + 5:   # +5 allows adjacent spans to merge
            merged[-1][1] = max(merged[-1][1], end)
        else:
            merged.append([start, end])
    return merged


def _build_highlighted_html(full_text: str, merged_spans: list,
                             source_file: str, page_num: int) -> str:
    """
    Render the PDF page text as HTML with <mark> highlight spans.
    Structure (background, font, header bar) is identical to the original.
    """
    escaped = ""
    last_end = 0
    for start, end in merged_spans:
        escaped += html_module.escape(full_text[last_end:start])
        escaped += (
            '<mark style="background-color:#fbbf24;color:#000;'
            'padding:2px 0;border-radius:3px;font-weight:600;">'
        )
        escaped += html_module.escape(full_text[start:end])
        escaped += "</mark>"
        last_end = end
    escaped += html_module.escape(full_text[last_end:])

    return f"""
    <div style="background:#0a0c10;border:1px solid #252a35;border-radius:10px;
                padding:16px;font-family:'DM Mono',monospace;font-size:12px;
                color:#c9d1d9;max-height:350px;overflow-y:auto;
                line-height:1.7;white-space:pre-wrap;">
        <div style="color:#4f8ef7;font-size:10px;font-weight:600;
                    letter-spacing:1.2px;text-transform:uppercase;
                    margin-bottom:10px;padding-bottom:8px;
                    border-bottom:1px solid #252a35;">
            📄 {html_module.escape(source_file)} · Page {page_num}
        </div>
        {escaped}
    </div>
    """


def _render_pdf_preview(source: Dict[str, Any]) -> None:
    """
    Render a PDF page with highlighted spans showing exactly what the
    assistant used in its answer.

    Highlight priority (stops at first tier that produces results):

    Tier 1 — Answer-phrase matching (NEW)
        Extract sentences from the assistant's answer, find each one in the
        PDF page text (exact then fuzzy @ 0.82). This highlights only the
        specific sentences the LLM actually cited — not the whole chunk.

    Tier 2 — Sentence-level chunk matching
        Split each retrieved chunk into individual sentences and match each
        one. Succeeds when the full chunk fails due to whitespace differences.

    Tier 3 — Full-chunk fuzzy matching (original fallback)
        Match the full chunk string with difflib threshold 0.70.
        Broadest coverage, may highlight more text than strictly relevant.
    """
    source_file = source.get("source_file", "Unknown")
    page_num    = source.get("page", 1)
    chunks      = source.get("chunks", [])
    answer      = source.get("answer", "")          # injected by app.py

    filepath = resolve_doc_path(source_file)
    if not filepath:
        st.warning(f"PDF not found: {source_file}")
        return

    full_text = get_pdf_page_text(str(filepath), page_num)
    if not full_text:
        st.warning(f"Could not extract text from page {page_num} of {source_file}.")
        return

    merged_spans: list = []

    # ── Tier 1: answer-phrase matching ───────────────────────────────────────
    if answer:
        phrases = _extract_answer_phrases(answer, min_len=30)
        spans = _find_spans_in_text(phrases, full_text, fuzzy_threshold=0.82)
        merged_spans = _merge_spans(spans)

    # ── Tier 2: sentence-level chunk matching ─────────────────────────────────
    if not merged_spans and chunks:
        sentence_candidates: List[str] = []
        for chunk in chunks:
            sentences = re.split(r'(?<=[.!?])\s+', chunk.strip())
            sentence_candidates.extend(
                s.strip() for s in sentences if len(s.strip()) >= 25
            )
        spans = _find_spans_in_text(sentence_candidates, full_text, fuzzy_threshold=0.78)
        merged_spans = _merge_spans(spans)

    # ── Tier 3: full-chunk fuzzy fallback (original behaviour) ───────────────
    if not merged_spans and chunks:
        import difflib
        spans = []
        for chunk in chunks:
            chunk_clean = chunk.strip()
            if not chunk_clean:
                continue
            # Exact match first
            pos = full_text.find(chunk_clean)
            if pos != -1:
                spans.append((pos, pos + len(chunk_clean)))
                continue
            # Fuzzy match
            chunk_len = len(chunk_clean)
            text_len  = len(full_text)
            best_ratio, best_start = 0.0, -1
            step = max(1, chunk_len // 4)
            for i in range(0, text_len - chunk_len + 1, step):
                ratio = difflib.SequenceMatcher(
                    None, chunk_clean, full_text[i: i + chunk_len]
                ).ratio()
                if ratio > best_ratio and ratio > 0.70:
                    best_ratio, best_start = ratio, i
            if best_start >= 0:
                spans.append((best_start, best_start + chunk_len))
        merged_spans = _merge_spans(spans)

    html_content = _build_highlighted_html(full_text, merged_spans, source_file, page_num)
    components.html(html_content, height=370, scrolling=True)


def _render_text_preview(source: Dict[str, Any]) -> None:
    """Line-by-line viewer with yellow highlighting for .md / .txt files."""
    source_file = source.get("source_file", "Unknown")
    segments = source.get("segments", [])
    if not segments:
        start_line = int(source.get("start_line", 1))
        end_line = int(source.get("end_line", 1))
        segments = [{"start_line": start_line, "end_line": end_line}]

    resolved = resolve_doc_path(source_file)
    if not resolved:
        st.warning(f"Document not found: {source_file}")
        return

    try:
        with open(resolved, "r", encoding="utf-8") as fh:
            lines = fh.read().split("\n")
    except Exception:
        st.warning(f"Could not read: {source_file}")
        return

    total_lines = len(lines)
    all_starts = [s["start_line"] for s in segments if "start_line" in s]
    all_ends = [s["end_line"] for s in segments if "end_line" in s]
    if not all_starts or not all_ends:
        return

    global_start = min(all_starts)
    global_end = max(all_ends)
    window_start = max(0, global_start - 5)
    window_end = min(total_lines, global_end + 10)

    html_parts = ["""<!DOCTYPE html><html><head><style>
        body{margin:0;padding:0;font-family:'DM Mono',monospace;font-size:12px;}
        .doc-container{max-height:350px;overflow-y:auto;background:#0a0c10;
                       border-radius:8px;border:1px solid #252a35;}
        table{width:100%;border-collapse:collapse;}
        td{padding:2px 10px;border:none;line-height:1.65;}
        .num{color:#4a5168;text-align:right;width:28px;
             padding-right:12px;font-size:10px;user-select:none;}
        .content{color:#c9d1d9;white-space:pre-wrap;word-break:break-word;}
        .hl{background:rgba(255,220,50,0.1);border-left:2px solid #fbbf24;}
        .hl .num{color:#fbbf24;font-weight:bold;}
    </style></head><body><div class="doc-container"><table>"""]

    for i in range(window_start, window_end):
        num = i + 1
        text = lines[i] if i < total_lines else ""
        if not text.strip():
            text = "*[empty line]*"
        # Use html_module alias — avoids the shadowing bug
        esc = (
            text.replace("&", "&amp;")
                .replace("<", "&lt;")
                .replace(">", "&gt;")
        )
        is_highlighted = any(
            s.get("start_line") is not None
            and s.get("end_line") is not None
            and s["start_line"] <= num <= s["end_line"]
            for s in segments
        )
        cls = ' class="hl"' if is_highlighted else ""
        html_parts.append(
            f'<tr{cls}><td class="num">{num}</td>'
            f'<td class="content">{esc}</td></tr>'
        )

    html_parts.append("</table></div></body></html>")
    components.html("".join(html_parts), height=370, scrolling=True)
    st.caption("🟨 Yellow = referenced sections")


def _render_data_preview(source: Dict[str, Any]) -> None:
    """Show chunk content for Excel / CSV sources."""
    content = source.get("content", "")
    source_file = source.get("source_file", "Unknown")
    section = source.get("section", "Data")
    if content:
        st.code(content[:2000], language=None)
    else:
        st.info(f"📊 **{html_module.escape(source_file)}** — {html_module.escape(section)} referenced.")


def _render_docx_preview(source: Dict[str, Any]) -> None:
    """Show chunk content for .docx sources."""
    content = source.get("content", "")
    source_file = source.get("source_file", "Unknown")

    if content:
        # GAP FIX: local variable renamed to 'html_str' — the original code used
        # 'html' which silently shadowed the imported html module, making
        # html.escape() unavailable for the rest of the function scope.
        escaped_content = (
            content.replace("&", "&amp;")
                   .replace("<", "&lt;")
                   .replace(">", "&gt;")
        )
        escaped_filename = html_module.escape(source_file)
        html_str = f"""
        <div style="background:#0a0c10;border:1px solid #252a35;border-radius:10px;
                    padding:16px;font-family:'DM Mono',monospace;font-size:12px;
                    color:#c9d1d9;max-height:350px;overflow-y:auto;line-height:1.7;
                    white-space:pre-wrap;word-break:break-word;">
            <div style="color:#4f8ef7;font-size:10px;font-weight:600;
                        letter-spacing:1.2px;text-transform:uppercase;
                        margin-bottom:10px;padding-bottom:8px;
                        border-bottom:1px solid #252a35;">
                📝 {escaped_filename}
            </div>
            {escaped_content}
        </div>
        """
        components.html(html_str, height=370, scrolling=True)
    else:
        st.info(f"📝 **{html_module.escape(source_file)}** referenced.")