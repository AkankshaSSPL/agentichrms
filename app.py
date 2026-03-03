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
    extract_citations, 
    deduplicate_sources,
    filter_existing_sources,
    clean_answer_text
)

@st.cache_resource
def load_graph():
    from agent.graph import graph
    return graph

st.set_page_config(page_title="HR Assistant", page_icon="H", layout="wide")

def init_session():
    if "messages" not in st.session_state:
        st.session_state.messages = []
    if "current_sources" not in st.session_state:
        st.session_state.current_sources = []
    if "current_query" not in st.session_state:
        st.session_state.current_query = None
    if "show_source_panel" not in st.session_state:
        st.session_state.show_source_panel = True
    if "expanded_doc_idx" not in st.session_state:
        st.session_state.expanded_doc_idx = None

init_session()

# Sidebar
with st.sidebar:
    st.markdown("### 🤖 HR Assistant")
    st.divider()
    
    chroma_ok = os.path.exists(CHROMA_DIR)
    st.caption(f"Policy Docs: {'🟢' if chroma_ok else '🔴'}")
    
    uploaded = st.file_uploader("Upload docs", type=["pdf", "md", "csv", "xlsx", "txt"], accept_multiple_files=True)
    if uploaded:
        os.makedirs(DOCS_DIR, exist_ok=True)
        for f in uploaded:
            with open(os.path.join(DOCS_DIR, f.name), "wb") as out:
                out.write(f.getbuffer())
        if st.button("Ingest", use_container_width=True):
            with st.spinner("Ingesting..."):
                subprocess.run([sys.executable, "ingest_docs.py"], cwd=os.path.dirname(__file__))
    
    queries = ["Maternity policy", "What is moonlighting disclosure?", "Remote work policy", "What are the leave types?", "Onboarding guidelines"]
    for q in queries:
        if st.button(q, key=q, use_container_width=True):
            st.session_state.current_query = q
    
    if st.button("Clear", use_container_width=True):
        st.session_state.messages = []
        st.session_state.expanded_doc_idx = None
        st.rerun()

# Main content
st.markdown("## HR Assistant")

# Display messages
for msg in st.session_state.messages:
    if msg["role"] == "user":
        st.markdown(f"**👤 You:** {msg['content']}")
        st.divider()
    
    else:  # Assistant message
        sources = msg.get("sources", [])
        answer_text = msg["content"]
        
        # Check if this is a declined response (not HR-related)
        declined_phrases = [
            "i can only assist with hr-related queries",
            "outside my scope",
            "cannot find relevant information",
            "do not contain information",
            "not found in the available policy"
        ]
        
        is_declined = any(phrase in answer_text.lower() for phrase in declined_phrases)
        
        if is_declined:
            # Show declined message without source panel
            st.markdown("### 🤖 Answer")
            st.warning(answer_text)
            st.info("💡 Please ask HR policy-related questions only. Examples: leave policies, remote work, employee benefits, onboarding, etc.")
        
        elif sources:
            # Valid HR answer with sources - show full layout
            existing_sources = filter_existing_sources(sources)
            existing_sources = deduplicate_sources(existing_sources)
            cleaned_answer = clean_answer_text(answer_text, existing_sources)
            
            if existing_sources:
                # Get display sources with citation matching
                citations = extract_citations(cleaned_answer)
                display_sources = []
                
                for src in existing_sources:
                    matching_citation = None
                    for cit in citations:
                        if (cit.get('source_file') == src.get('source_file') or 
                            cit.get('source_file', '') in src.get('source_file', '')):
                            matching_citation = cit
                            break
                    
                    if matching_citation:
                        display_sources.append({
                            **src,
                            'start_line': matching_citation.get('start_line', src.get('start_line')),
                            'end_line': matching_citation.get('end_line', src.get('end_line')),
                            'section': matching_citation.get('section', src.get('section'))
                        })
                    else:
                        display_sources.append(src)
                
                if st.session_state.show_source_panel:
                    # HEADER ROW with toggle
                    header_col1, header_col2, header_col3 = st.columns([1, 0.08, 0.9])
                    
                    with header_col1:
                        st.markdown("### 🤖 Answer")
                    
                    with header_col2:
                        if st.button("❮", key=f"toggle_header_{msg['content'][:10]}", help="Close source panel"):
                            st.session_state.show_source_panel = False
                            st.session_state.expanded_doc_idx = None
                            st.rerun()
                    
                    with header_col3:
                        st.markdown("### 📄 Source Preview")
                    
                    # CONTENT
                    content_col1, content_col2, content_col3 = st.columns([1, 0.08, 0.9])
                    
                    with content_col1:
                        display_answer = re.sub(
                            r'\[Source:\s*[^|]+\s*\|\s*Section:\s*[^|]+\s*\|\s*Lines\s*\d+-\d+\]',
                            '',
                            cleaned_answer
                        ).strip()
                        st.markdown(display_answer)
                        
                        st.markdown("---")
                        st.markdown("**📚 References:**")
                        for src in display_sources:
                            st.markdown(f"• **{src['source_file']}** — *{src['section']}*")
                    
                    with content_col2:
                        st.markdown("")
                    
                    with content_col3:
                        st.caption("Click to expand document:")
                        
                        for idx, src in enumerate(display_sources):
                            is_expanded = (st.session_state.expanded_doc_idx == idx)
                            
                            with st.container():
                                col1, col2 = st.columns([3, 1])
                                
                                with col1:
                                    st.markdown(f"**📄 {src['source_file']}**")
                                    st.caption(f"📍 {src['section']} | Lines {src['start_line']}-{src['end_line']}")
                                
                                with col2:
                                    btn_label = "Close" if is_expanded else "Open"
                                    if st.button(btn_label, key=f"expand_{idx}_{msg['content'][:10]}", use_container_width=True):
                                        if is_expanded:
                                            st.session_state.expanded_doc_idx = None
                                        else:
                                            st.session_state.expanded_doc_idx = idx
                                        st.rerun()
                                
                                if is_expanded:
                                    st.divider()
                                    render_document_preview_html(src)
                                    st.divider()
                            
                            st.markdown("<br>", unsafe_allow_html=True)
                        
                        if msg.get("steps"):
                            with st.expander("🔧 Steps"):
                                for step in msg["steps"]:
                                    st.write(f"{step['type']}: {step.get('name', '')}")
                
                else:
                    # Panel closed
                    header_col1, header_col2 = st.columns([1.7, 0.08])
                    
                    with header_col1:
                        st.markdown("### 🤖 Answer")
                    
                    with header_col2:
                        if st.button("❯", key=f"toggle_closed_{msg['content'][:10]}", help="Open source panel"):
                            st.session_state.show_source_panel = True
                            st.rerun()
                    
                    content_col1, content_col2 = st.columns([1.7, 0.08])
                    
                    with content_col1:
                        display_answer = re.sub(
                            r'\[Source:\s*[^|]+\s*\|\s*Section:\s*[^|]+\s*\|\s*Lines\s*\d+-\d+\]',
                            '',
                            cleaned_answer
                        ).strip()
                        st.markdown(display_answer)
                        
                        st.markdown("---")
                        st.markdown("**📚 References:**")
                        for src in display_sources:
                            st.markdown(f"• **{src['source_file']}** — *{src['section']}*")
                        
                        st.info("💡 Click '❯' to view source documents with highlights")
                    
                    with content_col2:
                        st.markdown("")
            
            else:
                # Sources were returned but files deleted
                st.markdown("### 🤖 Answer")
                display_answer = re.sub(
                    r'\[Source:\s*[^|]+\s*\|\s*Section:\s*[^|]+\s*\|\s*Lines\s*\d+-\d+\]',
                    '',
                    cleaned_answer
                ).strip()
                st.markdown(display_answer)
                st.caption("ℹ️ Source documents not available (may have been deleted or moved)")
        
        else:
            # No sources returned - valid HR question but no documents found
            st.markdown("### 🤖 Answer")
            st.warning(answer_text)
            st.info("💡 Please upload relevant HR policy documents or ask about available policies.")
        
        st.divider()

# Input
query = st.chat_input("Ask about HR policies...")
if st.session_state.get("current_query"):
    query = st.session_state.pop("current_query")

if query:
    st.session_state.expanded_doc_idx = None
    st.session_state.messages.append({"role": "user", "content": query})
    st.rerun()

# Process
if st.session_state.messages and st.session_state.messages[-1]["role"] == "user":
    user_msg = st.session_state.messages[-1]["content"]
    
    with st.spinner("Thinking..."):
        # Greeting detection — handle without calling the agent
        greeting_words = {"hi", "hello", "hey", "good morning", "good afternoon",
                          "good evening", "greetings", "howdy", "hola", "namaste"}
        if user_msg.strip().lower().rstrip("!.,") in greeting_words:
            st.session_state.messages.append({
                "role": "assistant",
                "content": "How should I help you today?",
                "steps": [],
                "sources": []
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
            
            # Filter and clean
            sources = filter_existing_sources(sources)
            sources = deduplicate_sources(sources)
            
            if sources:
                full_response = clean_answer_text(full_response, sources)
            
            st.session_state.messages.append({
                "role": "assistant",
                "content": full_response,
                "steps": steps,
                "sources": sources
            })
            st.rerun()
            
        except Exception as e:
            st.error(f"Error: {e}")
            st.session_state.messages.append({
                "role": "assistant",
                "content": f"Error: {e}",
                "sources": []
            })
            st.rerun()