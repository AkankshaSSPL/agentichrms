"""
HR ASSISTANT — COMPLETE UI REDESIGN
Drop-in replacement styling + layout for app.py

INSTRUCTIONS FOR DEV 1:
1. Copy the CSS block (PASTE_CSS_HERE) into your app.py at the top, inside st.markdown()
2. Replace your sidebar, main chat, and source panel layout with the structure below
3. The 3-column layout uses st.columns([1, 2.2, 1.5]) ratio

COLUMN LAYOUT:
│ LEFT SIDEBAR (1)  │  CENTER CHAT (2.2)  │  RIGHT PREVIEW (1.5) │
│ - Logo/Brand      │  - Chat history     │  - Source Preview     │
│ - Status          │  - Answer card      │  - Doc line viewer    │
│ - Quick prompts   │  - Input box        │  - Steps expander     │
│ - Upload          │                     │                       │
"""

# ============================================================
# PASTE THIS ENTIRE st.markdown BLOCK at the top of app.py
# right after your imports, before any other st. calls
# ============================================================

CUSTOM_CSS = """
<style>
/* ── FONTS ─────────────────────────────────────────────── */
@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&family=DM+Mono:wght@400;500&family=Fraunces:ital,wght@0,300;0,600;1,300&display=swap');

/* ── ROOT VARIABLES ─────────────────────────────────────── */
:root {
  --bg-base:       #0d0f12;
  --bg-panel:      #13161b;
  --bg-card:       #1a1e26;
  --bg-hover:      #1f2430;
  --border:        #252a35;
  --border-light:  #2e3444;
  --accent:        #4f8ef7;
  --accent-soft:   #1e3a6e;
  --accent-glow:   rgba(79,142,247,0.15);
  --success:       #3ecf8e;
  --success-soft:  #0d2e1f;
  --warning:       #f59e0b;
  --error:         #ef4444;
  --error-soft:    #2a1010;
  --text-primary:  #e8eaf0;
  --text-secondary:#8b92a5;
  --text-muted:    #4a5168;
  --font-body:     'DM Sans', sans-serif;
  --font-mono:     'DM Mono', monospace;
  --font-display:  'Fraunces', serif;
  --radius:        10px;
  --radius-lg:     16px;
}

/* ── GLOBAL RESET ───────────────────────────────────────── */
html, body, [data-testid="stAppViewContainer"] {
  background: var(--bg-base) !important;
  font-family: var(--font-body) !important;
  color: var(--text-primary) !important;
}

[data-testid="stAppViewContainer"] > .main {
  background: var(--bg-base) !important;
  padding: 0 !important;
}

/* Hide default Streamlit chrome */
#MainMenu, footer, header { visibility: hidden !important; }
[data-testid="stDecoration"] { display: none !important; }
[data-testid="stToolbar"] { display: none !important; }

/* ── SCROLLBAR ──────────────────────────────────────────── */
::-webkit-scrollbar { width: 4px; height: 4px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--border-light); border-radius: 4px; }

/* ── SIDEBAR ────────────────────────────────────────────── */
[data-testid="stSidebar"] {
  background: var(--bg-panel) !important;
  border-right: 1px solid var(--border) !important;
  padding: 0 !important;
}

[data-testid="stSidebar"] > div:first-child {
  padding: 24px 20px !important;
}

/* Sidebar brand */
.sidebar-brand {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 28px;
  padding-bottom: 20px;
  border-bottom: 1px solid var(--border);
}

.sidebar-brand-icon {
  width: 36px;
  height: 36px;
  background: linear-gradient(135deg, var(--accent), #7c3aed);
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
}

.sidebar-brand-name {
  font-family: var(--font-display);
  font-size: 18px;
  font-weight: 600;
  color: var(--text-primary);
  letter-spacing: -0.3px;
}

.sidebar-brand-sub {
  font-size: 10px;
  color: var(--text-muted);
  font-weight: 300;
  letter-spacing: 1px;
  text-transform: uppercase;
}

/* Status badge */
.status-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 24px;
  padding: 10px 14px;
  background: var(--success-soft);
  border: 1px solid rgba(62,207,142,0.2);
  border-radius: var(--radius);
  font-size: 12px;
  color: var(--success);
  font-weight: 500;
}

.status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--success);
  animation: pulse 2s infinite;
  flex-shrink: 0;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}

/* Section labels */
.sidebar-section-label {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 1.2px;
  text-transform: uppercase;
  color: var(--text-muted);
  margin: 20px 0 10px 0;
}

/* Quick prompt buttons */
.stButton > button {
  width: 100% !important;
  background: var(--bg-card) !important;
  border: 1px solid var(--border) !important;
  color: var(--text-secondary) !important;
  border-radius: var(--radius) !important;
  padding: 10px 14px !important;
  font-family: var(--font-body) !important;
  font-size: 12.5px !important;
  font-weight: 400 !important;
  text-align: left !important;
  transition: all 0.15s ease !important;
  margin-bottom: 6px !important;
}

.stButton > button:hover {
  background: var(--bg-hover) !important;
  border-color: var(--accent) !important;
  color: var(--text-primary) !important;
  transform: translateX(2px) !important;
}

/* File uploader */
[data-testid="stFileUploader"] {
  background: var(--bg-card) !important;
  border: 1.5px dashed var(--border-light) !important;
  border-radius: var(--radius) !important;
  padding: 16px !important;
}

[data-testid="stFileUploader"]:hover {
  border-color: var(--accent) !important;
  background: var(--accent-glow) !important;
}

[data-testid="stFileUploader"] label {
  color: var(--text-secondary) !important;
  font-size: 12px !important;
}

/* ── CENTER CHAT ────────────────────────────────────────── */
.chat-container {
  height: calc(100vh - 100px);
  overflow-y: auto;
  padding: 32px 28px 20px;
  display: flex;
  flex-direction: column;
  gap: 24px;
}

/* User message bubble */
.user-message {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: 8px;
}

.user-avatar {
  width: 30px;
  height: 30px;
  border-radius: 8px;
  background: linear-gradient(135deg, var(--accent), #7c3aed);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  flex-shrink: 0;
}

.user-bubble {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 0 var(--radius-lg) var(--radius-lg) var(--radius-lg);
  padding: 10px 16px;
  font-size: 13.5px;
  color: var(--text-secondary);
  max-width: 80%;
}

/* Answer card */
.answer-card {
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 24px 28px;
  position: relative;
  overflow: hidden;
}

.answer-card::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 2px;
  background: linear-gradient(90deg, var(--accent), #7c3aed, var(--success));
}

.answer-label {
  font-family: var(--font-display);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 1.5px;
  text-transform: uppercase;
  color: var(--accent);
  margin-bottom: 14px;
  display: flex;
  align-items: center;
  gap: 6px;
}

.answer-body {
  font-size: 14px;
  line-height: 1.75;
  color: var(--text-primary);
}

.answer-body strong { color: var(--accent); font-weight: 600; }
.answer-body ul, .answer-body ol { padding-left: 18px; }
.answer-body li { margin-bottom: 6px; }
.answer-body a { color: var(--accent); }

/* References section */
.references-card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 16px 20px;
  margin-top: 16px;
}

.ref-label {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 1.2px;
  text-transform: uppercase;
  color: var(--text-muted);
  margin-bottom: 10px;
}

.ref-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 0;
  border-bottom: 1px solid var(--border);
  font-size: 12.5px;
}

.ref-item:last-child { border-bottom: none; }
.ref-filename { color: var(--text-primary); font-weight: 500; }
.ref-location { color: var(--text-muted); font-style: italic; }

/* Thinking state */
.thinking-card {
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 20px 28px;
  display: flex;
  align-items: center;
  gap: 14px;
}

.thinking-dots {
  display: flex;
  gap: 4px;
}

.thinking-dots span {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--accent);
  animation: bounce 1.2s infinite;
}

.thinking-dots span:nth-child(2) { animation-delay: 0.2s; }
.thinking-dots span:nth-child(3) { animation-delay: 0.4s; }

@keyframes bounce {
  0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
  30% { transform: translateY(-6px); opacity: 1; }
}

.thinking-text {
  font-size: 13px;
  color: var(--text-secondary);
  font-family: var(--font-mono);
}

/* Warning / error override bubble */
.warning-card {
  background: var(--error-soft);
  border: 1px solid rgba(239,68,68,0.3);
  border-radius: var(--radius);
  padding: 12px 16px;
  font-size: 13px;
  color: #fca5a5;
  display: flex;
  gap: 8px;
  align-items: flex-start;
}

/* ── INPUT BAR ──────────────────────────────────────────── */
.input-wrapper {
  position: sticky;
  bottom: 0;
  background: var(--bg-base);
  padding: 16px 28px 20px;
  border-top: 1px solid var(--border);
}

[data-testid="stTextInput"] input,
[data-testid="stChatInput"] textarea {
  background: var(--bg-card) !important;
  border: 1.5px solid var(--border-light) !important;
  border-radius: var(--radius-lg) !important;
  color: var(--text-primary) !important;
  font-family: var(--font-body) !important;
  font-size: 13.5px !important;
  padding: 14px 18px !important;
  transition: border-color 0.2s !important;
}

[data-testid="stTextInput"] input:focus,
[data-testid="stChatInput"] textarea:focus {
  border-color: var(--accent) !important;
  box-shadow: 0 0 0 3px var(--accent-glow) !important;
  outline: none !important;
}

[data-testid="stTextInput"] input::placeholder,
[data-testid="stChatInput"] textarea::placeholder {
  color: var(--text-muted) !important;
}

/* ── RIGHT PANEL — SOURCE PREVIEW ───────────────────────── */
.preview-panel {
  background: var(--bg-panel);
  border-left: 1px solid var(--border);
  height: 100vh;
  overflow-y: auto;
  padding: 24px 20px;
}

.preview-header {
  font-family: var(--font-display);
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 20px;
  padding-bottom: 14px;
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  gap: 8px;
}

/* Source doc card */
.source-doc-card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 14px 16px;
  margin-bottom: 12px;
  transition: border-color 0.2s;
}

.source-doc-card:hover { border-color: var(--accent); }

.source-doc-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}

.source-doc-name {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--text-primary);
  display: flex;
  align-items: center;
  gap: 6px;
}

.source-doc-location {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-muted);
  margin-top: 4px;
}

.open-btn {
  background: var(--accent-soft) !important;
  border: 1px solid var(--accent) !important;
  color: var(--accent) !important;
  border-radius: 6px !important;
  padding: 4px 12px !important;
  font-size: 11px !important;
  font-weight: 500 !important;
  cursor: pointer;
  transition: all 0.15s;
}

.open-btn:hover {
  background: var(--accent) !important;
  color: white !important;
}

/* Error doc card */
.source-doc-card.error {
  border-color: rgba(239,68,68,0.3);
  background: var(--error-soft);
}

.source-doc-card.error .source-doc-name { color: #fca5a5; }

/* Code viewer */
.code-viewer {
  background: #0a0c10;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
  margin-top: 10px;
  font-family: var(--font-mono);
  font-size: 12px;
}

.code-viewer-line {
  display: flex;
  padding: 2px 12px;
  line-height: 1.6;
}

.code-viewer-line.highlighted {
  background: rgba(255, 220, 50, 0.12);
  border-left: 2px solid #fbbf24;
}

.code-viewer-linenum {
  color: var(--text-muted);
  min-width: 28px;
  user-select: none;
  padding-right: 14px;
  font-size: 11px;
}

.code-viewer-text { color: #c9d1d9; }

/* Steps expander */
[data-testid="stExpander"] {
  background: var(--bg-card) !important;
  border: 1px solid var(--border) !important;
  border-radius: var(--radius) !important;
  margin-top: 12px !important;
}

[data-testid="stExpander"] summary {
  font-size: 12px !important;
  color: var(--text-secondary) !important;
  font-family: var(--font-body) !important;
}

/* ── DIVIDERS ────────────────────────────────────────────── */
hr { border-color: var(--border) !important; margin: 20px 0 !important; }

/* ── EMPTY STATE ─────────────────────────────────────────── */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 60%;
  text-align: center;
  gap: 12px;
  opacity: 0.6;
}

.empty-state-icon {
  font-size: 40px;
  margin-bottom: 8px;
}

.empty-state-title {
  font-family: var(--font-display);
  font-size: 20px;
  font-weight: 600;
  color: var(--text-secondary);
}

.empty-state-sub {
  font-size: 13px;
  color: var(--text-muted);
  max-width: 260px;
  line-height: 1.6;
}

/* ── COLUMN LAYOUT OVERRIDE ──────────────────────────────── */
/* Removes default streamlit column padding for tight 3-col layout */
[data-testid="column"] {
  padding: 0 !important;
}

/* ── TAG PILLS ───────────────────────────────────────────── */
.tag-pill {
  display: inline-block;
  background: var(--accent-soft);
  color: var(--accent);
  border: 1px solid rgba(79,142,247,0.3);
  border-radius: 20px;
  padding: 2px 10px;
  font-size: 11px;
  font-weight: 500;
  margin-right: 4px;
}

</style>
"""

# ============================================================
# SIDEBAR HTML COMPONENTS — inject via st.markdown()
# ============================================================

SIDEBAR_BRAND_HTML = """
<div class="sidebar-brand">
  <div class="sidebar-brand-icon">🧠</div>
  <div>
    <div class="sidebar-brand-name">HR Assistant</div>
    <div class="sidebar-brand-sub">Policy Intelligence</div>
  </div>
</div>
"""

SIDEBAR_STATUS_HTML = """
<div class="status-row">
  <div class="status-dot"></div>
  Knowledge base connected · {doc_count} documents
</div>
"""  # format with doc_count at runtime

SIDEBAR_SECTION_LABEL = lambda text: f'<div class="sidebar-section-label">{text}</div>'

# ============================================================
# ANSWER CARD HTML — wrap LLM response in this
# ============================================================

def answer_card_html(answer_text_html: str) -> str:
    return f"""
<div class="answer-card">
  <div class="answer-label">✦ Answer</div>
  <div class="answer-body">{answer_text_html}</div>
</div>
"""

# ============================================================
# THINKING STATE HTML
# ============================================================

THINKING_HTML = """
<div class="thinking-card">
  <div class="thinking-dots">
    <span></span><span></span><span></span>
  </div>
  <div class="thinking-text">Searching knowledge base...</div>
</div>
"""

# ============================================================
# EMPTY STATE HTML (shown when no conversation yet)
# ============================================================

EMPTY_STATE_HTML = """
<div class="empty-state">
  <div class="empty-state-icon">📋</div>
  <div class="empty-state-title">Ask anything about HR</div>
  <div class="empty-state-sub">
    Policies, leave types, onboarding, compliance — 
    all sourced directly from your documents.
  </div>
</div>
"""

# ============================================================
# SOURCE DOC CARD HTML
# ============================================================

def source_doc_card_html(filename: str, location: str, found: bool = True) -> str:
    cls = "source-doc-card" if found else "source-doc-card error"
    icon = "📄" if found else "⚠️"
    btn = '<button class="open-btn">Open</button>' if found else '<span style="font-size:11px;color:#fca5a5;">Not found</span>'
    return f"""
<div class="{cls}">
  <div class="source-doc-header">
    <div class="source-doc-name">{icon} {filename}</div>
    {btn}
  </div>
  <div class="source-doc-location">📍 {location}</div>
</div>
"""

# ============================================================
# HOW TO RESTRUCTURE app.py LAYOUT
# 
# Replace your current layout with this structure:
#
#   with st.sidebar:
#       st.markdown(CUSTOM_CSS, unsafe_allow_html=True)
#       st.markdown(SIDEBAR_BRAND_HTML, unsafe_allow_html=True)
#       st.markdown(SIDEBAR_STATUS_HTML.format(doc_count=X), unsafe_allow_html=True)
#       st.markdown(SIDEBAR_SECTION_LABEL("Quick Questions"), unsafe_allow_html=True)
#       if st.button("Maternity policy"): ...
#       if st.button("What is moonlighting disclosure?"): ...
#       if st.button("Remote work policy"): ...
#       if st.button("What are the leave types?"): ...
#       if st.button("Onboarding guidelines"): ...
#       st.markdown(SIDEBAR_SECTION_LABEL("Upload Documents"), unsafe_allow_html=True)
#       uploaded = st.file_uploader(...)
#
#   col_chat, col_preview = st.columns([1.6, 1], gap="small")
#   # NOTE: Sidebar handles the left column natively in Streamlit
#   # So you only need 2 columns in the main area: chat + preview
#
#   with col_chat:
#       # render chat history + answer card + input
#       st.markdown(THINKING_HTML, unsafe_allow_html=True)   # while running
#       st.markdown(answer_card_html(response), unsafe_allow_html=True)
#
#   with col_preview:
#       # render source preview panel
#       st.markdown('<div class="preview-header">📎 Source Preview</div>', unsafe_allow_html=True)
#       for source in sources:
#           st.markdown(source_doc_card_html(...), unsafe_allow_html=True)
#           # then your existing components.html() doc viewer below
#
# ============================================================

print("""
UI Redesign Components Ready.

FILES TO MODIFY IN app.py:
1. Add st.markdown(CUSTOM_CSS, unsafe_allow_html=True) at very top
2. Replace sidebar content with SIDEBAR_BRAND_HTML + SIDEBAR_STATUS_HTML
3. Replace st.columns layout with col_chat, col_preview = st.columns([1.6, 1])
4. Wrap all answer output in answer_card_html()
5. Replace thinking spinner with THINKING_HTML
6. Replace source cards with source_doc_card_html()

See comments above for exact structure.
""")
