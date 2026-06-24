"""
Documents API

GET    /documents                  — list viewable documents from DOCS_DIR on disk
GET    /documents/categories       — list available document categories
GET    /documents/{filename}       — check existence in DOCS_DIR
GET    /documents/{filename}/raw   — stream the file (auth required, path-traversal guarded)
POST   /documents/{filename}/view  — log a viewer open into the analytics pipeline (non-fatal)
POST   /documents/upload           — upload + ingest a document (HR + Admin only)
DELETE /documents/{filename}       — delete a document (HR + Admin only)
"""

import logging
import os
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from backend.core.config import settings
from backend.core.permissions import require_authenticated, require_permission
from backend.database.session import SessionLocal
from backend.enums import DocumentCategory

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
    safe_name = os.path.basename(filename)
    if safe_name != filename or "\x00" in filename:
        raise HTTPException(status_code=400, detail="Invalid filename.")

    docs_dir = Path(settings.DOCS_DIR).resolve()
    candidate = (docs_dir / safe_name).resolve()

    try:
        candidate.relative_to(docs_dir)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid filename.")

    if not candidate.exists():
        raise HTTPException(status_code=404, detail="Document not found.")

    return candidate


# ── List documents ─────────────────────────────────────────────────────────────

_VIEWABLE_EXTENSIONS = set(_MIME.keys())  # .pdf, .md, .txt, .docx


@router.get("/documents")
async def list_documents(payload: dict = Depends(require_authenticated)):
    """Return one entry per viewable document file in settings.DOCS_DIR."""
    try:
        docs_dir = Path(settings.DOCS_DIR)
        if not docs_dir.exists():
            return {"documents": []}

        documents = []
        for entry in sorted(docs_dir.iterdir()):
            if not entry.is_file():
                continue
            if entry.suffix.lower() not in _VIEWABLE_EXTENSIONS:
                continue
            documents.append({
                "filename": entry.name,
                "size_bytes": entry.stat().st_size,
            })

        return {"documents": documents}
    except Exception as e:  # noqa: BLE001
        logger.warning("Error listing documents from DOCS_DIR: %s", e)
        return {"documents": []}


# ── List categories ────────────────────────────────────────────────────────────

@router.get("/documents/categories")
async def list_categories(payload: dict = Depends(require_authenticated)):
    """Return all valid document category values."""
    return {"categories": [c.value for c in DocumentCategory]}


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
    Stream the raw file with the correct Content-Type.
    Path-traversal guarded — only files inside settings.DOCS_DIR are served.
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
    Always returns {"ok": True} — analytics failure never breaks the viewer.
    """
    if not settings.DOCUMENT_VIEWER_ENABLED:
        return {"ok": True}

    try:
        _safe_resolve(filename)
    except HTTPException:
        return {"ok": True}

    employee_id = int(payload.get("sub", 0))
    if not employee_id:
        return {"ok": True}

    try:
        from backend.services.behavior_service import BehaviorService
        BehaviorService(db).record_view(employee_id, filename, session_id=None)
    except Exception as e:  # noqa: BLE001
        logger.warning("view analytics skipped for emp=%d file=%s: %s", employee_id, filename, e)

    return {"ok": True}


# ── Upload document (HR + Admin only) ─────────────────────────────────────────

_ALLOWED_UPLOAD_EXTENSIONS = {".pdf", ".md", ".txt", ".docx"}
_MAX_UPLOAD_MB = 20


@router.post("/documents/upload")
async def upload_document(
    file: UploadFile = File(...),
    category: str = Form("general"),
    payload: dict = Depends(require_permission("documents.upload")),
    db: Session = Depends(get_db),
):
    """
    Upload a document to DOCS_DIR and rebuild the BM25 index.
    Allowed: HR and Admin only (documents.upload permission).
    Accepted formats: PDF, MD, TXT, DOCX (max 20 MB).
    Optionally tag the document with a category via the 'category' form field.
    """
    original_name = file.filename or ""
    safe_name = os.path.basename(original_name)
    suffix = Path(safe_name).suffix.lower()

    if not safe_name or suffix not in _ALLOWED_UPLOAD_EXTENSIONS:
        raise HTTPException(
            status_code=422,
            detail=f"Unsupported file type '{suffix}'. Allowed: PDF, MD, TXT, DOCX.",
        )

    data = await file.read()
    if len(data) > _MAX_UPLOAD_MB * 1024 * 1024:
        raise HTTPException(
            status_code=413,
            detail=f"File exceeds the {_MAX_UPLOAD_MB} MB limit.",
        )

    docs_dir = Path(settings.DOCS_DIR)
    docs_dir.mkdir(parents=True, exist_ok=True)
    dest = docs_dir / safe_name

    with open(dest, "wb") as fh:
        fh.write(data)
    logger.info("Document uploaded: %s (%d bytes)", safe_name, len(data))

    # ── Auto-tag if a valid category was supplied ──────────────────────────
    tag_result = None
    if category and category.lower() != "general":
        try:
            from backend.services.behavior_service import BehaviorService
            BehaviorService(db).set_tag(safe_name, category.lower())
            tag_result = category.lower()
        except Exception as exc:  # noqa: BLE001
            logger.warning("Auto-tag failed for %s: %s", safe_name, exc)

    # ── Rebuild BM25 index ─────────────────────────────────────────────────
    try:
        from rag.bm25_index import rebuild as bm25_rebuild
        bm25_rebuild()
        ingested = True
        ingest_error = None
    except Exception as exc:  # noqa: BLE001
        logger.warning("BM25 rebuild failed after upload of %s: %s", safe_name, exc)
        ingested = False
        ingest_error = str(exc)

    return {
        "filename": safe_name,
        "size_bytes": len(data),
        "category": tag_result,
        "ingested": ingested,
        "ingest_error": ingest_error,
    }


# ── Delete document (HR + Admin only) ─────────────────────────────────────────

@router.delete("/documents/{filename}")
async def delete_document(
    filename: str,
    payload: dict = Depends(require_permission("documents.delete")),
    db: Session = Depends(get_db),
):
    """
    Delete a document from DOCS_DIR, remove its behavior tag, and rebuild
    the BM25 index. Allowed: HR and Admin only (documents.delete permission).
    """
    path = _safe_resolve(filename)

    # Remove behavioral tag if present
    try:
        from backend.repositories.behavior_repository import BehaviorRepository
        BehaviorRepository(db).delete_tag(filename)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Could not remove behavior tag for %s: %s", filename, exc)

    # Delete file from disk
    try:
        path.unlink()
        logger.info("Document deleted: %s", filename)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Could not delete file: {exc}") from exc

    # Rebuild BM25 index
    try:
        from rag.bm25_index import rebuild as bm25_rebuild
        bm25_rebuild()
    except Exception as exc:  # noqa: BLE001
        logger.warning("BM25 rebuild failed after deletion of %s: %s", filename, exc)

    return {"filename": filename, "deleted": True}