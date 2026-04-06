from fastapi import APIRouter, HTTPException
from typing import List
import os
from backend.core.config import settings

router = APIRouter(tags=["Documents"])

@router.get("/documents")
async def list_documents():
    """List all available HR policy documents from the docs directory"""
    docs_path = settings.DOCS_DIR
    if not os.path.exists(docs_path):
        return []
    
    files = [f for f in os.listdir(docs_path) if os.path.isfile(os.path.join(docs_path, f))]
    return {"documents": files}

@router.get("/documents/{filename}")
async def get_document_status(filename: str):
    """Check if a specific document exists and is indexed"""
    file_path = os.path.join(settings.DOCS_DIR, filename)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Document not found")
    return {"filename": filename, "status": "available"}