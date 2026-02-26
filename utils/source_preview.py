"""Utility for rendering source previews with syntax highlighting."""
import re
import html
import streamlit as st
from typing import List, Dict, Any, Optional

def extract_citations(text: str) -> List[Dict[str, Any]]:
    """
    Extract citation markers from AI response.
    Format: [Source: filename | Section: X | Lines Y-Z]
    """
    pattern = r'\[Source:\s*([^|]+)\s*\|\s*Section:\s*([^|]+)\s*\|\s*Lines\s*(\d+)-(\d+)\]'
    matches = re.findall(pattern, text)
    
    citations = []
    for match in matches:
        citations.append({
            "source_file": match[0].strip(),
            "section": match[1].strip(),
            "start_line": int(match[2]),
            "end_line": int(match[3])
        })
    return citations

def highlight_text_segment(text: str, highlight_start: int, highlight_end: int) -> str:
    """Highlight a specific segment of text with HTML."""
    escaped = html.escape(text)
    before = escaped[:highlight_start]
    highlight = escaped[highlight_start:highlight_end]
    after = escaped[highlight_end:]
    
    return f'{before}<mark style="background-color: #ffeb3b; color: #000; padding: 2px 4px; border-radius: 3px;">{highlight}</mark>{after}'

def render_line_numbers(content: str, start_line: int = 1, highlight_range: Optional[tuple] = None) -> str:
    """
    Render content with line numbers and optional highlighting.
    
    Args:
        content: Text content to render
        start_line: Starting line number
        highlight_range: Tuple of (start, end) line numbers to highlight
    """
    lines = content.split('\n')
    html_lines = []
    
    for i, line in enumerate(lines):
        line_num = start_line + i
        is_highlighted = False
        
        if highlight_range:
            hl_start, hl_end = highlight_range
            if hl_start <= line_num <= hl_end:
                is_highlighted = True
        
        # Escape HTML in line content
        escaped_line = html.escape(line)
        
        if is_highlighted:
            line_html = (
                f'<div style="display: flex; background-color: #fff3cd; border-left: 3px solid #ffc107;">'
                f'<span style="color: #6c757d; padding: 0 8px; min-width: 40px; text-align: right; user-select: none;">{line_num}</span>'
                f'<span style="flex: 1; padding: 0 8px; font-family: monospace; white-space: pre-wrap;">{escaped_line}</span>'
                f'</div>'
            )
        else:
            line_html = (
                f'<div style="display: flex;">'
                f'<span style="color: #6c757d; padding: 0 8px; min-width: 40px; text-align: right; user-select: none;">{line_num}</span>'
                f'<span style="flex: 1; padding: 0 8px; font-family: monospace; white-space: pre-wrap;">{escaped_line}</span>'
                f'</div>'
            )
        
        html_lines.append(line_html)
    
    return '\n'.join(html_lines)

def render_source_preview(source: Dict[str, Any], expanded: bool = False) -> None:
    """
    Render a single source document preview with Streamlit.
    
    Args:
        source: Dict with source_file, section, start_line, end_line, content
        expanded: Whether to expand the preview by default
    """
    source_file = source.get("source_file", "Unknown")
    section = source.get("section", "General")
    start_line = source.get("start_line", 1)
    end_line = source.get("end_line", 1)
    content = source.get("content", "")
    
    with st.container():
        # Header
        st.markdown(f"""
        <div style="background-color: #f8f9fa; padding: 10px; border-radius: 8px 8px 0 0; border: 1px solid #dee2e6; border-bottom: none;">
            <strong>📄 {source_file}</strong><br/>
            <span style="color: #6c757d; font-size: 0.9em;">Section: {section} | Lines {start_line}-{end_line}</span>
        </div>
        """, unsafe_allow_html=True)
        
        # Content with line numbers and highlighting
        highlighted_content = render_line_numbers(
            content, 
            start_line=start_line,
            highlight_range=(start_line, end_line)
        )
        
        st.markdown(f"""
        <div style="background-color: #ffffff; border: 1px solid #dee2e6; border-radius: 0 0 8px 8px; overflow-x: auto; max-height: 300px; overflow-y: auto;">
            {highlighted_content}
        </div>
        """, unsafe_allow_html=True)

def render_side_by_side_layout(ai_response: str, sources: List[Dict[str, Any]]) -> None:
    """
    Render the main side-by-side layout: AI answer | Source Preview
    
    Layout:
    -----------------------------------------------------
    | 🤖 Answer                  | 📄 Source Preview     |
    | AI explanation             | Document name         |
    |                            | Highlighted section   |
    -----------------------------------------------------
    """
    # Create two columns: 60% for answer, 40% for sources
    col_answer, col_sources = st.columns([1.5, 1])
    
    with col_answer:
        st.markdown("### 🤖 Answer")
        st.markdown(ai_response)
        
        # Show citation badges below answer
        if sources:
            st.markdown("---")
            st.caption("**Cited Sources:**")
            for i, src in enumerate(sources):
                st.markdown(
                    f'<span style="background-color: #e3f2fd; color: #1976d2; padding: 4px 12px; '
                    f'border-radius: 12px; font-size: 0.85em; margin-right: 8px; display: inline-block; '
                    f'border: 1px solid #bbdefb;">'
                    f'📄 {src["source_file"]} | {src["section"]}</span>',
                    unsafe_allow_html=True
                )
    
    with col_sources:
        st.markdown("### 📄 Source Preview")
        
        if not sources:
            st.info("No document sources available for this response.")
            return
        
        # Create tabs for multiple sources
        if len(sources) == 1:
            render_source_preview(sources[0], expanded=True)
        else:
            tabs = st.tabs([f"Source {i+1}" for i in range(len(sources))])
            for tab, source in zip(tabs, sources):
                with tab:
                    render_source_preview(source, expanded=True)

def render_compact_preview(sources: List[Dict[str, Any]]) -> None:
    """Alternative compact view for sidebar or smaller spaces."""
    for src in sources:
        with st.expander(f"📄 {src['source_file']} - {src['section']}"):
            st.caption(f"Lines {src['start_line']}-{src['end_line']}")
            st.code(src.get("content", "")[:500] + "...", language="markdown")