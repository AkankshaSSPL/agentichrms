"""FastAPI backend for the HR Assistant React frontend."""
import os
import sys
import json
import subprocess
from pathlib import Path
from typing import Optional
import re

from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, FileResponse
from pydantic import BaseModel

# Add project root to path
PROJECT_ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from config import DOCS_DIR, CHROMA_DIR, DB_PATH
from utils.document_viewer import (
    resolve_doc_path, document_exists, strip_citation_markers, deduplicate_sources,
)

app = FastAPI(title="HR Assistant API")

# CORS for React dev server
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Lazy-load the agent graph ────────────────────────────────
_graph = None

def get_graph():
    global _graph
    if _graph is None:
        from agent.graph import graph
        _graph = graph
    return _graph


# ── Request/Response Models ──────────────────────────────────

class ChatRequest(BaseModel):
    message: str

class SourceInfo(BaseModel):
    source_file: str
    section: str
    start_line: int
    end_line: int
    content: Optional[str] = None
    score: Optional[float] = None

class ChatResponse(BaseModel):
    answer: str
    sources: list[dict]
    steps: list[dict]

class DocumentPreviewRequest(BaseModel):
    source_file: str
    start_line: int = 1
    end_line: int = 10
    section: Optional[str] = None


# ── Endpoints ────────────────────────────────────────────────

@app.get("/api/health")
def health():
    return {"status": "ok", "chroma_exists": os.path.exists(CHROMA_DIR), "db_exists": os.path.exists(DB_PATH)}


@app.post("/api/chat", response_model=ChatResponse)
def chat(req: ChatRequest):
    from langchain_core.messages import HumanMessage

    graph = get_graph()
    inputs = {"messages": [HumanMessage(content=req.message)], "sources": []}

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

    return ChatResponse(
        answer=display_answer,
        sources=[{
            "source_file": s.get("source_file", ""),
            "section": s.get("section", ""),
            "start_line": s.get("start_line", 1),
            "end_line": s.get("end_line", 5),
            "content": s.get("content", ""),
            "score": s.get("score", 0),
        } for s in sources],
        steps=steps,
    )


@app.get("/api/documents")
def list_documents():
    if not os.path.exists(DOCS_DIR):
        return {"documents": []}
    files = []
    for f in sorted(os.listdir(DOCS_DIR)):
        fpath = os.path.join(DOCS_DIR, f)
        if os.path.isfile(fpath):
            files.append({
                "name": f,
                "size": os.path.getsize(fpath),
                "ext": os.path.splitext(f)[1].lower(),
            })
    return {"documents": files}


@app.get("/docs/{filename:path}")
async def serve_document(filename: str):
    # Security: block path traversal attempts
    if ".." in filename or filename.startswith("/") or filename.startswith("\\"):
        raise HTTPException(400, "Invalid file path")
    
    file_path = os.path.join(DOCS_DIR, filename)
    if not os.path.isfile(file_path):
        raise HTTPException(404, "File not found")
    
    return FileResponse(file_path, media_type="application/pdf")


@app.post("/api/upload")
async def upload_files(files: list[UploadFile] = File(...)):
    os.makedirs(DOCS_DIR, exist_ok=True)
    saved = []
    for f in files:
        path = os.path.join(DOCS_DIR, f.filename)
        content = await f.read()
        with open(path, "wb") as out:
            out.write(content)
        saved.append(f.filename)
    return {"uploaded": saved}


@app.post("/api/ingest")
def ingest():
    global _graph
    result = subprocess.run(
        [sys.executable, str(PROJECT_ROOT / "ingest_docs.py")],
        cwd=str(PROJECT_ROOT),
        capture_output=True, text=True,
    )
    # Reset the graph so it picks up new data
    _graph = None
    return {
        "success": result.returncode == 0,
        "stdout": result.stdout,
        "stderr": result.stderr,
    }


@app.post("/api/document-preview")
def document_preview(req: DocumentPreviewRequest):
    """Return document content for the preview panel."""
    source_file = req.source_file
    ext = os.path.splitext(source_file)[1].lower()

    resolved = resolve_doc_path(source_file)
    if not resolved:
        raise HTTPException(404, f"File not found: {source_file}")

    if ext in (".md", ".txt"):
        with open(resolved, "r", encoding="utf-8", errors="ignore") as f:
            lines = f.read().split("\n")
        total = len(lines)
        start = max(1, min(req.start_line, total))
        end = max(start, min(req.end_line, total))
        window_start = max(0, start - 5)
        window_end = min(total, end + 10)

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
    elif ext == ".pdf":
        page = None
        if req.section:
            match = re.search(r"page\s*(\d+)", req.section, re.IGNORECASE)
            if match:
                page = int(match.group(1))

        file_url = f"/docs/{os.path.basename(resolved)}"

        return {
            "type": "pdf",
            "url": file_url,
            "page": page,
            "start_line": req.start_line,
            "end_line": req.end_line,
            "snippet": None,
        }
    else:
        # For DOCX/Excel — return the chunk content from the request
        return {
            "type": "binary",
            "message": f"Binary file: {source_file}",
            "section": f"Lines {req.start_line}–{req.end_line}",
        }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
