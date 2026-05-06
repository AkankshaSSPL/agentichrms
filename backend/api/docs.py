"""
Documents API — returns document count from ChromaDB for the frontend status bar.
"""
from fastapi import APIRouter, HTTPException
from chromadb import PersistentClient
from backend.core.config import settings

router = APIRouter(tags=["Documents"])


@router.get("/documents")
async def list_documents():
    """
    Return one entry per unique source document so the frontend's
    `d.documents.length` shows the real file count, not always "1".

    Previously returned a single-item list regardless of how many docs
    were ingested, so the sidebar always displayed "1 docs".
    """
    try:
        client = PersistentClient(path=str(settings.CHROMA_DIR))
        collection = client.get_collection(settings.CHROMA_COLLECTION_NAME)

        # Pull all metadata — we only need the 'source' field
        result = collection.get(include=["metadatas"])
        metadatas = result.get("metadatas") or []
        # Deduplicate by source filename
        seen = set()
        documents = []
        for meta in metadatas:
            source = meta.get("source", "unknown")
            if source not in seen:
                seen.add(source)
                documents.append({"filename": source})

        return {"documents": documents}

    except Exception as e:
        print(f"ChromaDB error in /documents: {e}")
        # Return empty list rather than crashing — sidebar shows "0 docs"
        return {"documents": []}


@router.get("/documents/{filename}")
async def get_document_status(filename: str):
    """Check if a specific document exists in the docs folder."""
    import os
    file_path = os.path.join(settings.DOCS_DIR, filename)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Document not found")
    return {"filename": filename, "status": "available"}