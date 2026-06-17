"""
Documents API

GET  /documents              — list unique source documents from ChromaDB
GET  /documents/{filename}   — check existence in DOCS_DIR
GET  /documents/{filename}/raw  — stream the file (auth required, path-traversal guarded)
POST /documents/{filename}/view — log a viewer open into the analytics pipeline (non-fatal)
"""

import logging
import os
from pathlib import Path

from chromadb import PersistentClient
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from backend.core.config import settings
from backend.core.permissions import require_authenticated
from backend.database.session import SessionLocal

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Documents"])

# Extension → MIME type map
_MIME: dict[str, str] = {
    ".pdf":  "application/pdf",
    ".md":   "text/markdown",
    ".txt":  "text/plain",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _safe_resolve(filename: str) -> Path:
    """
    Path-traversal guard.
    Returns the resolved absolute path if safe, raises 400/404 otherwise.
    """
    # Reject anything with separators or null bytes
    safe_name = os.path.basename(filename)
    if safe_name != filename or "\x00" in filename:
        raise HTTPException(status_code=400, detail="Invalid filename.")

    docs_dir = Path(settings.DOCS_DIR).resolve()
    candidate = (docs_dir / safe_name).resolve()

    # Confirm the resolved path is still inside DOCS_DIR
    try:
        candidate.relative_to(docs_dir)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid filename.")

    if not candidate.exists():
        raise HTTPException(status_code=404, detail="Document not found.")

    return candidate


# ── List documents ─────────────────────────────────────────────────────────────

@router.get("/documents")
async def list_documents(payload: dict = Depends(require_authenticated)):
    """
    Return one entry per unique source document from ChromaDB.
    Frontend uses d.documents.length for the sidebar doc count.
    """
    try:
        client = PersistentClient(path=str(settings.CHROMA_DIR))
        collection = client.get_collection(settings.CHROMA_COLLECTION_NAME)
        result = collection.get(include=["metadatas"])
        metadatas = result.get("metadatas") or []
        seen: set[str] = set()
        documents = []
        for meta in metadatas:
            source = meta.get("source", "unknown")
            if source not in seen:
                seen.add(source)
                documents.append({"filename": source})
        return {"documents": documents}
    except Exception as e:  # noqa: BLE001
        logger.warning("ChromaDB error in /documents: %s", e)
        return {"documents": []}


# ── Check document existence ───────────────────────────────────────────────────

@router.get("/documents/{filename}")
async def get_document_status(
    filename: str,
    payload: dict = Depends(require_authenticated),
):
    """Check if a specific document exists in DOCS_DIR."""
    file_path = Path(settings.DOCS_DIR) / filename
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="Document not found")
    return {"filename": filename, "status": "available"}


# ── Serve raw file ─────────────────────────────────────────────────────────────

@router.get("/documents/{filename}/raw")
async def serve_document_raw(
    filename: str,
    payload: dict = Depends(require_authenticated),
):
    """
    Stream the raw file to the browser with the correct Content-Type.
    Path-traversal guarded — only files inside settings.DOCS_DIR are served.

    PDF  → renders natively in browser <iframe>/<object>
    md / txt → returned as text, rendered inline by the frontend
    docx → returned as binary download (browsers can't render docx inline)
    """
    if not settings.DOCUMENT_VIEWER_ENABLED:
        raise HTTPException(status_code=404, detail="Document viewer is disabled.")

    path = _safe_resolve(filename)
    suffix = path.suffix.lower()
    media_type = _MIME.get(suffix, "application/octet-stream")

    return FileResponse(
        path=str(path),
        media_type=media_type,
        filename=path.name,
    )


# ── Log a viewer open ──────────────────────────────────────────────────────────

@router.post("/documents/{filename}/view")
async def log_document_view(
    filename: str,
    payload: dict = Depends(require_authenticated),
    db: Session = Depends(get_db),
):
    """
    Called by the frontend DocumentViewer on every document open.
    Feeds the same behavioral analytics pipeline as chat accesses —
    the combined (chat + viewer) count toward the per-category threshold.

    Always returns {"ok": True} — analytics failure never breaks the viewer.
    """
    if not settings.DOCUMENT_VIEWER_ENABLED:
        return {"ok": True}

    # Validate filename is safe (must exist in DOCS_DIR to be loggable)
    try:
        _safe_resolve(filename)
    except HTTPException:
        return {"ok": True}   # invalid path — silently ignore, don't log

    employee_id = int(payload.get("sub", 0))
    if not employee_id:
        return {"ok": True}

    try:
        from backend.services.behavior_service import BehaviorService
        BehaviorService(db).record_view(employee_id, filename, session_id=None)
    except Exception as e:  # noqa: BLE001
        logger.warning("view analytics skipped for emp=%d file=%s: %s", employee_id, filename, e)

    return {"ok": True}