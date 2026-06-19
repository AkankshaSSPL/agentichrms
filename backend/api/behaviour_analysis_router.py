"""
backend/api/behaviour_analysis_router.py
──────────────────────────────────────────
Admin-only endpoints for on-demand AI behaviour analysis.

  POST /behaviour-analysis/{employee_id}          — trigger a fresh analysis run
  GET  /behaviour-analysis/{employee_id}           — latest stored snapshot (or null)
  GET  /behaviour-analysis                         — dashboard overview (all employees)
  GET  /behaviour-analysis/overview                — org-wide aggregate stats for charts
  GET  /behaviour-analysis/{employee_id}/history    — past snapshots for one employee (trend line)

All endpoints require "behaviour.analyze" — ADMIN role only.

NOTE: route order matters here. Fixed-path routes ("", "/overview") and the
"/{employee_id}/history" route must be declared before the bare
"/{employee_id}" route, or FastAPI will try to match "overview" as an
employee_id and fail with a 422.
"""

import logging

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from backend.core.permissions import require_permission
from backend.database.session import get_db
from backend.services.behaviour_analysis_service import BehaviourAnalysisService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/behaviour-analysis", tags=["Behaviour Analysis"])


@router.get("")
def get_dashboard(
    payload: dict = Depends(require_permission("behaviour.analyze")),
    db: Session = Depends(get_db),
):
    """Dashboard overview — latest analysis snapshot per employee."""
    return BehaviourAnalysisService(db).get_dashboard()


@router.get("/overview")
def get_overview(
    payload: dict = Depends(require_permission("behaviour.analyze")),
    db: Session = Depends(get_db),
):
    """Org-wide aggregate stats (mood/confidence/trend breakdown, top traits) for dashboard charts."""
    return BehaviourAnalysisService(db).get_overview()


@router.get("/{employee_id}/history")
def get_history(
    employee_id: int,
    payload: dict = Depends(require_permission("behaviour.analyze")),
    db: Session = Depends(get_db),
):
    """Past snapshots for one employee, oldest-first, for a trend line."""
    return BehaviourAnalysisService(db).get_history(employee_id)


@router.get("/{employee_id}")
def get_analysis(
    employee_id: int,
    payload: dict = Depends(require_permission("behaviour.analyze")),
    db: Session = Depends(get_db),
):
    """Return the latest stored snapshot for one employee, or null."""
    result = BehaviourAnalysisService(db).get_detail(employee_id)
    return result if result else {"status": "no_data"}


@router.post("/{employee_id}")
def run_analysis(
    employee_id: int,
    payload: dict = Depends(require_permission("behaviour.analyze")),
    db: Session = Depends(get_db),
):
    """
    Trigger a fresh AI analysis of this employee's chat history.
    On-demand only — never runs automatically.
    """
    admin_id = int(payload["sub"])
    return BehaviourAnalysisService(db).analyze(employee_id, admin_id)