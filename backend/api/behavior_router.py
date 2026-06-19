"""
Behavioral Analytics Router — Admin only (tag management).
Thin layer: receives request, delegates to BehaviorService, returns response.
"""
import logging
from typing import Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.core.permissions import require_permission
from backend.database.session import get_db
from backend.services.behavior_service import BehaviorService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/behavior", tags=["Behavioral Analytics"])


# ── Request schemas ───────────────────────────────────────────────────────────

class TagRequest(BaseModel):
    filename: str
    category: str


# ── Tag endpoints (Admin only) ────────────────────────────────────────────────

@router.get("/tags")
def list_tags(
    payload: dict = Depends(require_permission("behavior.manage")),
    db: Session = Depends(get_db),
):
    """List all document → category tag mappings."""
    return BehaviorService(db).list_tags()


@router.put("/tags")
def set_tag(
    req: TagRequest,
    payload: dict = Depends(require_permission("behavior.manage")),
    db: Session = Depends(get_db),
):
    """Create or update a document → category tag mapping."""
    return BehaviorService(db).set_tag(req.filename, req.category)


@router.get("/documents")
def list_documents(
    payload: dict = Depends(require_permission("behavior.manage")),
    db: Session = Depends(get_db),
):
    """
    List all tagged documents with their current category.
    Used by the admin tagging UI.
    """
    return BehaviorService(db).list_tags()