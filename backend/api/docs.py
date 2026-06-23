"""
Documents API

GET  /documents               — list viewable documents from DOCS_DIR on disk
GET  /documents/{filename}   — check existence in DOCS_DIR
GET  /documents/{filename}/raw  — stream the file (auth required, path-traversal guarded)
POST /documents/{filename}/view — log a viewer open into the analytics pipeline (non-fatal)
POST /documents/upload        — upload + ingest a document (HR + Admin only)
"""

import logging
import os
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from backend.core.config import settings
from backend.core.permissions import require_authenticated, require_permission
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
            documents.append({"filename": entry.name})

        return {"documents": documents}
    except Exception as e:  # noqa: BLE001
        logger.warning("Error listing documents from DOCS_DIR: %s", e)
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
    payload: dict = Depends(require_permission("documents.upload")),
):
    """
    Upload a document to DOCS_DIR and ingest it into ChromaDB.
    Allowed: HR and Admin only (documents.upload permission).
    Accepted formats: PDF, MD, TXT, DOCX (max 20 MB).
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

    try:
        _ingest_file(dest, safe_name)
        ingested = True
        ingest_error = None
    except Exception as exc:  # noqa: BLE001
        logger.warning("ChromaDB ingest failed for %s: %s", safe_name, exc)
        ingested = False
        ingest_error = str(exc)

    return {
        "filename": safe_name,
        "size_bytes": len(data),
        "ingested": ingested,
        "ingest_error": ingest_error,
    }


def _ingest_file(path: Path, filename: str) -> None:
    """
    Chunk a single file and upsert into ChromaDB.
    Mirrors tools_registry.py: same SentenceTransformer model, same collection.
    Deletes old chunks first so re-uploading replaces content cleanly.
    """
    import chromadb
    from sentence_transformers import SentenceTransformer

    suffix = path.suffix.lower()

    # ── Extract text ──────────────────────────────────────────────────────
    if suffix == ".pdf":
        try:
            import pypdf
            reader = pypdf.PdfReader(str(path))
            pages = [page.extract_text() or "" for page in reader.pages]
            raw_text = "\n".join(pages)
        except Exception as exc:
            raise RuntimeError(f"PDF extraction failed: {exc}") from exc

    elif suffix == ".docx":
        try:
            import docx
            doc = docx.Document(str(path))
            paragraphs = [p.text for p in doc.paragraphs]
            raw_text = "\n".join(paragraphs)
        except Exception as exc:
            raise RuntimeError(f"DOCX extraction failed: {exc}") from exc

    elif suffix in (".md", ".txt"):
        raw_text = path.read_text(encoding="utf-8", errors="replace")

    else:
        raise ValueError(f"Unsupported extension: {suffix}")

    if not raw_text.strip():
        raise ValueError("File produced no extractable text.")

    # ── Chunk ─────────────────────────────────────────────────────────────
    chunk_size = 500
    overlap = 100
    chunks = []
    start = 0
    while start < len(raw_text):
        chunk = raw_text[start:start + chunk_size].strip()
        if chunk:
            chunks.append(chunk)
        start += chunk_size - overlap

    if not chunks:
        raise ValueError("File produced no text chunks after processing.")

    # ── Embed ─────────────────────────────────────────────────────────────
    model = SentenceTransformer(settings.EMBEDDING_MODEL)
    embeddings = model.encode(chunks).tolist()

    # ── Upsert into ChromaDB ──────────────────────────────────────────────
    chroma_client = chromadb.PersistentClient(path=str(settings.CHROMA_DIR))
    try:
        col = chroma_client.get_collection(settings.CHROMA_COLLECTION_NAME)
    except Exception:
        col = chroma_client.create_collection(settings.CHROMA_COLLECTION_NAME)

    # Delete old chunks so re-upload replaces content cleanly
    try:
        existing = col.get(where={"source": filename})
        if existing and existing.get("ids"):
            col.delete(ids=existing["ids"])
            logger.info("Deleted %d old chunks for %s", len(existing["ids"]), filename)
    except Exception as exc:
        logger.warning("Could not delete old chunks for %s: %s", filename, exc)

    ids = [f"{filename}__chunk_{i}" for i in range(len(chunks))]
    metadatas = [{"source": filename, "chunk": i} for i in range(len(chunks))]

    col.upsert(
        ids=ids,
        embeddings=embeddings,
        documents=chunks,
        metadatas=metadatas,
    )
    logger.info("Ingested %d chunks for %s into ChromaDB", len(chunks), filename)