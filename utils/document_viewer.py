"""Document viewer with deleted document filtering."""
import os
import re
from typing import Dict, Any, List, Tuple
from pathlib import Path
import streamlit as st
import streamlit.components.v1 as components

try:
    from config import DOCS_DIR
except ImportError:
    import sys
    sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    from config import DOCS_DIR


def document_exists(source_file: str) -> bool:
    """Check if document file exists in the documents folder."""
    possible_paths = [
        Path(DOCS_DIR) / source_file,
        Path(DOCS_DIR).parent / "documents" / source_file,
        Path(DOCS_DIR).parent / source_file,
        Path(source_file),
    ]
    
    for file_path in possible_paths:
        if file_path.exists():
            return True
    return False


def read_full_document(source_file: str) -> Tuple[str, List[str]]:
    """Read document and return lines."""
    possible_paths = [
        Path(DOCS_DIR) / source_file,
        Path(DOCS_DIR).parent / "documents" / source_file,
        Path(DOCS_DIR).parent / source_file,
        Path(source_file),
    ]
    
    for file_path in possible_paths:
        if file_path.exists():
            try:
                with open(file_path, 'r', encoding='utf-8') as f:
                    content = f.read()
                    lines = content.split('\n')
                return content, lines
            except Exception:
                continue
    
    return "", []


def filter_existing_sources(sources: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Filter out sources whose documents don't exist on disk.
    This prevents showing deleted documents in the UI.
    """
    existing_sources = []
    for src in sources:
        source_file = src.get('source_file', '')
        if document_exists(source_file):
            existing_sources.append(src)
    return existing_sources


def deduplicate_sources(sources: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Remove duplicate sources based on source_file."""
    seen_files = set()
    unique_sources = []
    
    for src in sources:
        file_key = src.get('source_file', 'Unknown')
        if file_key in seen_files:
            continue
        seen_files.add(file_key)
        unique_sources.append(src)
    
    return unique_sources


def clean_answer_text(answer_text: str, existing_sources: List[Dict[str, Any]]) -> str:
    """
    Remove citations to deleted documents from the answer text.
    Only keeps citations for documents that exist.
    """
    if not existing_sources:
        # Remove all citations if no sources exist
        return re.sub(
            r'\[Source:\s*[^|]+\s*\|\s*Section:\s*[^|]+\s*\|\s*Lines\s*\d+-\d+\]',
            '',
            answer_text
        ).strip()
    
    # Get list of existing source files
    existing_files = {src.get('source_file', '') for src in existing_sources}
    
    # Find all citations in the text
    citation_pattern = r'\[Source:\s*([^|]+)\s*\|\s*Section:\s*([^|]+)\s*\|\s*Lines\s*(\d+)-(\d+)\]'
    
    def replace_citation(match):
        source_file = match.group(1).strip()
        if source_file in existing_files:
            return match.group(0)  # Keep citation if document exists
        return ''  # Remove citation if document deleted
    
    # Replace citations to deleted documents
    cleaned_text = re.sub(citation_pattern, replace_citation, answer_text)
    
    # Clean up extra whitespace
    cleaned_text = re.sub(r'\n\s*\n\s*\n', '\n\n', cleaned_text)
    
    return cleaned_text.strip()


def render_side_by_side_with_accordion(answer_text: str, sources: List[Dict[str, Any]]) -> None:
    """
    50/50 layout with accordion-style expandable document preview.
    Filters out deleted documents and cleans answer text.
    """
    # Filter out deleted documents FIRST
    existing_sources = filter_existing_sources(sources)
    existing_sources = deduplicate_sources(existing_sources)
    
    # Clean answer text to remove citations to deleted documents
    cleaned_answer = clean_answer_text(answer_text, existing_sources)
    
    if not existing_sources:
        # No existing documents - show cleaned answer only
        st.markdown("### 🤖 Answer")
        st.markdown(cleaned_answer)
        st.caption("ℹ️ Source documents not available (may have been deleted or moved)")
        return
    
    # Extract citations from answer (only existing ones)
    citations = extract_citations(cleaned_answer)
    display_sources = merge_citations_with_sources(citations, existing_sources)
    
    # 50/50 columns
    left_col, right_col = st.columns([1, 1])
    
    # LEFT: Answer
    with left_col:
        st.markdown("### 🤖 Answer")
        
        # Remove remaining citation markers for display
        display_answer = re.sub(
            r'\[Source:\s*[^|]+\s*\|\s*Section:\s*[^|]+\s*\|\s*Lines\s*\d+-\d+\]',
            '',
            cleaned_answer
        ).strip()
        
        st.markdown(display_answer)
        
        # References (only existing documents)
        st.markdown("---")
        st.markdown("**📚 References:**")
        for src in display_sources:
            st.markdown(
                f"• **{src['source_file']}** — *{src['section']}* "
                f"(Lines {src['start_line']}-{src['end_line']})"
            )
    
    # RIGHT: Accordion-style Document Preview
    with right_col:
        st.markdown("### 📄 Source Documents")
        st.caption("Click to expand and view document:")
        
        # Initialize expanded state if not exists
        if "expanded_docs" not in st.session_state:
            st.session_state.expanded_docs = {}
        
        # Create accordion containers for each document
        for idx, src in enumerate(display_sources):
            doc_key = f"doc_{idx}_{src['source_file']}"
            
            # Check if this doc is expanded
            is_expanded = st.session_state.expanded_docs.get(doc_key, False)
            
            # Create container with border
            with st.container():
                # Header row with expand/collapse button
                col1, col2 = st.columns([4, 1])
                
                with col1:
                    # Document info (always visible)
                    st.markdown(f"**📄 {src['source_file']}**")
                    st.caption(f"📍 {src['section']} | Lines {src['start_line']}-{src['end_line']}")
                
                with col2:
                    # Expand/Collapse button
                    btn_label = "Close" if is_expanded else "Open"
                    if st.button(btn_label, key=f"toggle_{doc_key}", use_container_width=True):
                        st.session_state.expanded_docs[doc_key] = not is_expanded
                        st.rerun()
                
                # Show preview if expanded
                if is_expanded:
                    st.divider()
                    render_document_preview_html(src)
                
                # Add spacing between documents
                st.markdown("<br>", unsafe_allow_html=True)


def render_document_preview_html(source: Dict[str, Any]) -> None:
    """
    Render document with yellow highlighting using HTML component.
    """
    source_file = source.get("source_file", "Unknown")
    section = source.get("section", "General")
    start_line = int(source.get("start_line", 1))
    end_line = int(source.get("end_line", 1))
    
    # Read document
    content, lines = read_full_document(source_file)
    
    if not lines:
        st.warning(f"Document not found: {source_file}")
        return
    
    total_lines = len(lines)
    start_line = max(1, min(start_line, total_lines))
    end_line = max(start_line, min(end_line, total_lines))
    
    # Calculate window
    window_start = max(0, start_line - 5)
    window_end = min(total_lines, end_line + 10)
    
    # Build HTML
    html_parts = []
    
    html_parts.append('''
    <!DOCTYPE html>
    <html>
    <head>
    <style>
        body { margin: 0; padding: 0; font-family: 'Courier New', monospace; font-size: 12px; }
        .doc-container { max-height: 350px; overflow-y: auto; background: #fff; border-radius: 6px; }
        table { width: 100%; border-collapse: collapse; }
        td { padding: 3px 6px; border: none; line-height: 1.5; }
        .num { color: #6b7280; text-align: right; width: 40px; background: #f3f4f6; border-right: 1px solid #e5e7eb; }
        .content { color: #374151; white-space: pre-wrap; word-break: break-word; }
        .highlight { background-color: #fef08a !important; }
        .highlight .num { background-color: #fde047 !important; color: #854d0e; font-weight: bold; border-right: 2px solid #f59e0b; }
        .highlight .content { background-color: #fef08a !important; color: #1f2937; }
    </style>
    </head>
    <body>
    <div class="doc-container">
    <table>
    ''')
    
    for i in range(window_start, window_end):
        line_num = i + 1
        line_content = lines[i] if i < len(lines) else ""
        escaped = line_content.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
        
        if start_line <= line_num <= end_line:
            html_parts.append(f'<tr class="highlight"><td class="num">{line_num}</td><td class="content">{escaped}</td></tr>')
        else:
            html_parts.append(f'<tr><td class="num">{line_num}</td><td class="content">{escaped}</td></tr>')
    
    html_parts.append('</table></div></body></html>')
    
    full_html = ''.join(html_parts)
    components.html(full_html, height=370, scrolling=True)
    
    st.caption("🟨 Yellow = answer section")


def merge_citations_with_sources(citations: List[Dict], sources: List[Dict]) -> List[Dict]:
    """Merge citations with sources."""
    if not sources and not citations:
        return []
    
    if sources:
        result = []
        for src in sources:
            matching = None
            for cit in citations:
                if (cit.get('source_file') == src.get('source_file') or 
                    cit.get('source_file', '') in src.get('source_file', '')):
                    matching = cit
                    break
            
            if matching:
                result.append({**src, 'start_line': matching.get('start_line', src.get('start_line')), 
                              'end_line': matching.get('end_line', src.get('end_line')),
                              'section': matching.get('section', src.get('section'))})
            else:
                result.append(src)
        return result
    
    return citations if citations else []


def extract_citations(text: str) -> List[Dict[str, Any]]:
    """Extract citations from text."""
    pattern = r'\[Source:\s*([^|]+)\s*\|\s*Section:\s*([^|]+)\s*\|\s*Lines\s*(\d+)-(\d+)\]'
    matches = re.findall(pattern, text)
    
    return [{"source_file": m[0].strip(), "section": m[1].strip(), 
             "start_line": int(m[2]), "end_line": int(m[3])} for m in matches]


# Backward compatibility
def render_side_by_side_with_buttons(answer_text: str, sources: List[Dict[str, Any]]) -> None:
    render_side_by_side_with_accordion(answer_text, sources)

def render_side_by_side_layout(answer_text: str, sources: List[Dict[str, Any]]) -> None:
    render_side_by_side_with_accordion(answer_text, sources)