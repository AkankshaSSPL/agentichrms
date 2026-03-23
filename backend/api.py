"""FastAPI backend for the HR Assistant React frontend."""
import os
import sys
import subprocess
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, UploadFile, File, HTTPException, Request
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# Add project root to path
PROJECT_ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from config import DOCS_DIR, CHROMA_DIR, DB_PATH
from utils.document_viewer import (
    resolve_doc_path, document_exists, strip_citation_markers, deduplicate_sources,
)

app = FastAPI(title="HR Assistant API")

# ── GAP-006 FIX: Restrict CORS to known origins only ─────────────────────────
# In production, replace with your actual frontend domain.
# Read from env so it can be overridden without code changes.
_raw_origins = os.getenv("ALLOWED_ORIGINS", "http://localhost:3000,http://localhost:8501")
ALLOWED_ORIGINS = [o.strip() for o in _raw_origins.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type", "X-API-Key"],
)

# ── GAP-033 FIX: Maximum upload file size (50 MB) ────────────────────────────
MAX_UPLOAD_BYTES = int(os.getenv("MAX_UPLOAD_BYTES", str(50 * 1024 * 1024)))  # 50 MB default

# ── Lazy-load the agent graph ─────────────────────────────────────────────────
_graph = None

def get_graph():
    global _graph
    if _graph is None:
        from agent.graph import graph
        _graph = graph
    return _graph


# ── Request / Response Models ─────────────────────────────────────────────────

class ChatRequest(BaseModel):
    message: str
    history: list[dict] = []

class SourceInfo(BaseModel):
    source_file: str
    section: str
    start_line: int
    end_line: int
    content: Optional[str] = None
    score: Optional[float] = None
    full_content: Optional[list[dict]] = None
    chunks: Optional[list[str]] = None
    page: Optional[int] = None

class ChatResponse(BaseModel):
    answer: str
    sources: list[SourceInfo]
    steps: list[dict]

class DocumentPreviewRequest(BaseModel):
    source_file: str
    start_line: int = 1
    end_line: int = 10


# ── Helpers ───────────────────────────────────────────────────────────────────

def _safe_filename(raw_name: str) -> str:
    """
    GAP-001 / GAP-020 FIX: Strip any directory components from a filename so
    that path traversal payloads like '../../.env' are reduced to just '.env'
    and then blocked by the extension/character checks below.

    Returns the sanitised basename, or raises HTTPException(400) if the name
    is empty or contains characters that are not safe for a filename.
    """
    # os.path.basename handles both '/' and '\\' separators
    name = os.path.basename(raw_name.strip())
    if not name or name.startswith("."):
        raise HTTPException(400, "Invalid filename.")
    # Disallow remaining traversal characters and shell-special characters
    forbidden = set('<>:"/\\|?*')
    if any(ch in forbidden for ch in name):
        raise HTTPException(400, f"Filename contains forbidden characters: {name}")
    return name


def _safe_resolved_path(source_file: str) -> Path:
    """
    GAP-001 / GAP-020 FIX: Resolve a document path and assert it sits inside
    DOCS_DIR. Raises HTTPException(400) on traversal, HTTPException(404) if the
    file does not exist.
    """
    safe_name = _safe_filename(source_file)
    docs_root = Path(DOCS_DIR).resolve()
    candidate = (docs_root / safe_name).resolve()

    # Ensure the resolved path is still inside DOCS_DIR
    try:
        candidate.relative_to(docs_root)
    except ValueError:
        raise HTTPException(400, "Access to that path is not permitted.")

    if not candidate.exists():
        raise HTTPException(404, f"File not found: {safe_name}")

    return candidate


# ── Endpoints ─────────────────────────────────────────────────────────────────

@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "chroma_exists": os.path.exists(CHROMA_DIR),
        "db_exists": os.path.exists(DB_PATH),
    }


@app.post("/api/chat", response_model=ChatResponse)
def chat(req: ChatRequest):
    """
    GAP-011 FIX: Wrap the entire agent pipeline in try/except so that
    exceptions return a clean 500 instead of leaking stack traces.
    """
    try:
        from langchain_core.messages import HumanMessage, AIMessage
        graph = get_graph()

        # Build full conversation history for multi-turn actions (e.g. email)
        history = []
        for m in req.history:
            if m.get("role") == "user":
                history.append(HumanMessage(content=m["content"]))
            elif m.get("role") == "assistant" and m.get("content"):
                history.append(AIMessage(content=m["content"]))
        history.append(HumanMessage(content=req.message))

        inputs = {"messages": history, "sources": []}

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
        display_answer = strip_citation_markers(full_response)

        return ChatResponse(answer=display_answer, sources=sources, steps=steps)

    except Exception as e:
        # Log full details server-side; return a safe message to the client
        import traceback
        traceback.print_exc()
        raise HTTPException(
            status_code=500,
            detail="An error occurred while processing your request. Please try again.",
        )


@app.get("/api/documents")
def list_documents(skip: int = 0, limit: int = 50):
    """
    GAP-038 FIX: Add skip/limit pagination so the endpoint doesn't return
    an unbounded list when thousands of documents are present.
    """
    if not os.path.exists(DOCS_DIR):
        return {"documents": [], "total": 0, "skip": skip, "limit": limit}

    all_files = []
    for f in sorted(os.listdir(DOCS_DIR)):
        fpath = os.path.join(DOCS_DIR, f)
        if os.path.isfile(fpath):
            all_files.append({
                "name": f,
                "size": os.path.getsize(fpath),
                "ext": os.path.splitext(f)[1].lower(),
            })

    total = len(all_files)
    page = all_files[skip: skip + limit]
    return {"documents": page, "total": total, "skip": skip, "limit": limit}


@app.post("/api/upload")
async def upload_files(files: list[UploadFile] = File(...)):
    """
    GAP-001 FIX: Sanitise every filename with _safe_filename() before writing.
    GAP-033 FIX: Reject files that exceed MAX_UPLOAD_BYTES.
    """
    os.makedirs(DOCS_DIR, exist_ok=True)
    saved = []

    for f in files:
        # Sanitise filename — raises 400 on traversal attempt
        safe_name = _safe_filename(f.filename or "")

        content = await f.read()

        # Size guard
        if len(content) > MAX_UPLOAD_BYTES:
            raise HTTPException(
                413,
                f"File '{safe_name}' exceeds the maximum allowed size of "
                f"{MAX_UPLOAD_BYTES // (1024 * 1024)} MB.",
            )

        dest = os.path.join(DOCS_DIR, safe_name)
        with open(dest, "wb") as out:
            out.write(content)

        saved.append(safe_name)

    return {"uploaded": saved}


@app.post("/api/ingest")
def ingest():
    global _graph
    result = subprocess.run(
        [sys.executable, str(PROJECT_ROOT / "ingest_docs.py")],
        cwd=str(PROJECT_ROOT),
        capture_output=True,
        text=True,
    )
    # Reset the graph so it picks up new ChromaDB data
    _graph = None
    return {
        "success": result.returncode == 0,
        "stdout": result.stdout,
        "stderr": result.stderr,
    }


@app.post("/api/document-preview")
def document_preview(req: DocumentPreviewRequest):
    """
    GAP-020 FIX: Validate source_file through _safe_resolved_path() which
    enforces that the resolved path stays inside DOCS_DIR. Previously,
    passing '/etc/passwd' as source_file would resolve and be read.
    """
    ext = os.path.splitext(req.source_file)[1].lower()

    # Raises 400 on traversal, 404 if not found — no raw resolve_doc_path call
    resolved = _safe_resolved_path(req.source_file)

    if ext in (".md", ".txt", ".docx"):
        if ext == ".docx":
            import docx
            doc = docx.Document(resolved)
            lines = [p.text for p in doc.paragraphs]
        else:
            with open(resolved, "r", encoding="utf-8", errors="ignore") as fh:
                lines = fh.read().split("\n")

        total = len(lines)
        start = max(1, min(req.start_line, total))
        end = max(start, min(req.end_line, total))
        window_start = max(0, start - 10)
        window_end = min(total, end + 30)

        return {
            "type": "text",
            "lines": [
                {
                    "num": i + 1,
                    "text": lines[i] if i < len(lines) else "",
                    "highlighted": start <= (i + 1) <= end,
                }
                for i in range(window_start, window_end)
            ],
            "total_lines": total,
            "highlight_start": start,
            "highlight_end": end,
        }
    else:
        return {
            "type": "binary",
            "message": f"Binary file: {req.source_file}",
            "section": f"Lines {req.start_line}–{req.end_line}",
        }


@app.delete("/api/documents/{filename}")
def delete_document(filename: str):
    """Delete a document from the documents folder."""
    safe_name = _safe_filename(filename)
    docs_root = Path(DOCS_DIR).resolve()
    target = (docs_root / safe_name).resolve()
    try:
        target.relative_to(docs_root)
    except ValueError:
        raise HTTPException(400, "Access to that path is not permitted.")
    if not target.exists():
        raise HTTPException(404, f"File not found: {safe_name}")
    target.unlink()
    return {"deleted": safe_name}


@app.get("/api/pdf-file/{filename:path}")
def serve_pdf(filename: str):
    """Serve a PDF file inline so the React frontend can embed it in an iframe."""
    resolved = _safe_resolved_path(filename)
    if not filename.lower().endswith(".pdf"):
        raise HTTPException(400, "Only PDF files can be served via this endpoint.")
    return FileResponse(
        path=str(resolved),
        media_type="application/pdf",
        headers={"Content-Disposition": f"inline; filename={os.path.basename(filename)}"},
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)