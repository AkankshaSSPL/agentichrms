import streamlit as st
import os
import sys
import subprocess
import re
from langchain_core.messages import HumanMessage

sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from config import DB_PATH, DOCS_DIR, CHROMA_DIR
from utils.document_viewer import (
    render_document_preview_html,
    deduplicate_sources,
    strip_citation_markers,
    document_exists,
)
from ui_redesign import (
    CUSTOM_CSS, SIDEBAR_BRAND_HTML, SIDEBAR_STATUS_HTML, SIDEBAR_SECTION_LABEL,
    answer_card_html, THINKING_HTML, source_doc_card_html, EMPTY_STATE_HTML
)

@st.cache_resource
def load_graph():
    from agent.graph import graph
    return graph

st.set_page_config(page_title="HR Assistant", page_icon="H", layout="wide")
st.markdown(CUSTOM_CSS, unsafe_allow_html=True)

def init_session():
    if "messages" not in st.session_state:
        st.session_state.messages = []
    if "current_sources" not in st.session_state:
        st.session_state.current_sources = []
    if "current_query" not in st.session_state:
        st.session_state.current_query = None
    if "expanded_doc_idx" not in st.session_state:
        st.session_state.expanded_doc_idx = None

init_session()

# ── Sidebar ──────────────────────────────────────────────────
with st.sidebar:
    st.markdown(SIDEBAR_BRAND_HTML, unsafe_allow_html=True)
    doc_count = len([f for f in os.listdir(DOCS_DIR) if not f.startswith('.')]) if os.path.exists(DOCS_DIR) else 0
    st.markdown(SIDEBAR_STATUS_HTML.format(doc_count=doc_count), unsafe_allow_html=True)

    st.markdown(SIDEBAR_SECTION_LABEL("Quick Questions"), unsafe_allow_html=True)

    queries = [
        "Maternity policy",
        "What is moonlighting disclosure?",
        "Remote work policy",
        "What are the leave types?",
        "Onboarding guidelines",
    ]
    for q in queries:
        if st.button(q, key=q, use_container_width=True):
            st.session_state.current_query = q

    st.markdown(SIDEBAR_SECTION_LABEL("Upload Documents"), unsafe_allow_html=True)
    uploaded = st.file_uploader(
        "Upload docs", type=["pdf", "md", "csv", "xlsx", "txt", "docx"],
        accept_multiple_files=True, label_visibility="collapsed"
    )
    if uploaded:
        os.makedirs(DOCS_DIR, exist_ok=True)
        for f in uploaded:
            with open(os.path.join(DOCS_DIR, f.name), "wb") as out:
                out.write(f.getbuffer())
        if st.button("Ingest", use_container_width=True):
            with st.spinner("Ingesting..."):
                subprocess.run([sys.executable, "ingest_docs.py"], cwd=os.path.dirname(__file__))
                st.cache_resource.clear()   # force graph to pick up new data on next run

    st.markdown("<br><br>", unsafe_allow_html=True)
    if st.button("🗑 Clear conversation", use_container_width=True):
        st.session_state.messages = []
        st.session_state.expanded_doc_idx = None
        st.rerun()

# ── Layout ───────────────────────────────────────────────────
col_chat, col_preview = st.columns([1.6, 1], gap="small")

with col_chat:
    if not st.session_state.messages:
        st.markdown(EMPTY_STATE_HTML, unsafe_allow_html=True)

    for msg in st.session_state.messages:
        if msg["role"] == "user":
            st.markdown(
                f'<div class="user-msg"><div class="u-avatar">👤</div>'
                f'<div class="u-bubble">{msg["content"]}</div></div>',
                unsafe_allow_html=True,
            )
        else:
            answer_text = msg["content"]
            sources = msg.get("sources", [])

            # Build refs block from structured sources (no regex needed)
            refs_html = ""
            if sources:
                refs_html += '<div class="refs-block"><div class="refs-label">📎 Sources</div>'
                for src in sources:
                    filename = src.get("source_file", "")
                    exists = document_exists(filename)
                    icon = "📄" if exists else "⚠️"
                    section = src.get("section", "")
                    refs_html += (
                        f'<div class="ref-row"><span>{icon}</span>'
                        f'<span class="ref-file">{filename}</span>'
                        f'<span class="ref-loc">— {section}</span></div>'
                    )
                refs_html += "</div>"

            # Strip raw [Source: ...] markers — one greedy sweep, no brittle regex parsing
            display_answer = strip_citation_markers(answer_text)

            st.markdown(answer_card_html(display_answer + refs_html), unsafe_allow_html=True)

with col_preview:
    st.markdown('<div class="preview-header">📎 Source Preview</div>', unsafe_allow_html=True)

    # Show sources from the latest assistant message
    latest_sources = []
    latest_msg = None
    for msg in reversed(st.session_state.messages):
        if msg["role"] == "assistant":
            latest_sources = msg.get("sources", [])
            latest_msg = msg
            break

    for idx, src in enumerate(latest_sources):
        filename = src.get("source_file", "")
        section = src.get("section", "General")
        start = src.get("start_line", 1)
        end = src.get("end_line", 5)
        location = f"{section} · Lines {start}–{end}"
        exists = document_exists(filename)

        st.markdown(source_doc_card_html(filename, location, found=exists), unsafe_allow_html=True)

        is_expanded = (st.session_state.expanded_doc_idx == idx)
        btn_label = "Close" if is_expanded else "Open"

        if st.button(btn_label, key=f"expand_{idx}_{filename}"):
            if is_expanded:
                st.session_state.expanded_doc_idx = None
            else:
                st.session_state.expanded_doc_idx = idx
            st.rerun()

        if is_expanded:
            render_document_preview_html(src)

    if latest_msg and latest_msg.get("steps"):
        with st.expander("⚙ Agent Steps"):
            for step in latest_msg["steps"]:
                st.write(f"{step['type']}: {step.get('name', '')}")

# ── Input ────────────────────────────────────────────────────
query = st.chat_input("Ask about HR policies...")
if st.session_state.get("current_query"):
    query = st.session_state.pop("current_query")

if query:
    st.session_state.expanded_doc_idx = None
    st.session_state.messages.append({"role": "user", "content": query})
    st.rerun()

# ── Processing ───────────────────────────────────────────────
if st.session_state.messages and st.session_state.messages[-1]["role"] == "user":
    user_msg = st.session_state.messages[-1]["content"]

    with col_chat:
        thinking_placeholder = st.empty()
        thinking_placeholder.markdown(THINKING_HTML, unsafe_allow_html=True)

    # Greeting detection — handle without calling the agent
    greeting_words = {
        "hi", "hello", "hey", "good morning", "good afternoon",
        "good evening", "greetings", "howdy", "hola", "namaste",
    }
    if user_msg.strip().lower().rstrip("!.,") in greeting_words:
        st.session_state.messages.append({
            "role": "assistant",
            "content": "How should I help you today?",
            "steps": [],
            "sources": [],
        })
        st.rerun()

    try:
        graph = load_graph()
        inputs = {"messages": [HumanMessage(content=user_msg)], "sources": []}

        full_response = ""
        steps = []
        sources = []

        for event in graph.stream(inputs):
            for key, value in event.items():
                if key == "agent":
                    msg = value["messages"][0]
                    full_response += msg.content or ""
                    if hasattr(msg, "tool_calls"):
                        for tc in msg.tool_calls or []:
                            steps.append({"type": "tool", "name": tc.get("name")})
                elif key == "tools":
                    if "sources" in value and value["sources"]:
                        sources.extend(value["sources"])

        sources = deduplicate_sources(sources)

        st.session_state.messages.append({
            "role": "assistant",
            "content": full_response,
            "steps": steps,
            "sources": sources,
        })
        st.rerun()

    except Exception as e:
        st.error(f"Error: {e}")
        st.session_state.messages.append({
            "role": "assistant",
            "content": f"Error: {e}",
            "sources": [],
        })
        st.rerun()