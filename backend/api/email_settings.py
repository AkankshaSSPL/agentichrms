"""
Email Settings API — admin only
- GET  /email-settings/logs        → paginated email log
- GET  /email-settings/config      → current SMTP config (no passwords)
- POST /email-settings/test        → send a test email
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime

from backend.database.session import SessionLocal
from backend.database.models import EmailLog
from backend.core.security import require_role
from backend.core.config import settings
from backend.core.email import send_email

router = APIRouter(prefix="/email-settings", tags=["Email Settings"])


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# ── Email log ─────────────────────────────────────────────────────────────────
class EmailLogResponse(BaseModel):
    id: int
    recipient: str
    subject: str
    body_preview: Optional[str]
    status: str
    error: Optional[str]
    sent_at: str
    triggered_by: Optional[str]

    class Config:
        from_attributes = True


@router.get("/logs", response_model=List[EmailLogResponse])
def get_email_logs(
    skip: int = 0,
    limit: int = 50,
    payload: dict = Depends(require_role(["admin"])),
    db: Session = Depends(get_db),
):
    logs = (
        db.query(EmailLog)
        .order_by(EmailLog.sent_at.desc())
        .offset(skip)
        .limit(limit)
        .all()
    )
    return [
        EmailLogResponse(
            id=l.id,
            recipient=l.recipient,
            subject=l.subject,
            body_preview=l.body_preview,
            status=l.status,
            error=l.error,
            sent_at=l.sent_at.isoformat() if l.sent_at else "",
            triggered_by=l.triggered_by,
        )
        for l in logs
    ]


# ── SMTP config (read-only, no secrets) ──────────────────────────────────────
@router.get("/config")
def get_smtp_config(
    payload: dict = Depends(require_role(["admin"])),
):
    return {
        "host": settings.EMAIL_HOST,
        "port": settings.EMAIL_PORT,
        "user": settings.EMAIL_USER or "",
        "configured": bool(settings.EMAIL_USER and settings.EMAIL_PASS),
        "hr_email": settings.HR_EMAIL or "",
        "admin_email": settings.ADMIN_EMAIL or "",
    }


# ── Test email ────────────────────────────────────────────────────────────────
class TestEmailRequest(BaseModel):
    to: str


@router.post("/test")
def send_test_email(
    req: TestEmailRequest,
    payload: dict = Depends(require_role(["admin"])),
    db: Session = Depends(get_db),
):
    send_email(
        to=req.to,
        subject="✅ HRMS Test Email",
        body=(
            "This is a test email from your Agentic HRMS system.\n\n"
            "If you received this, your SMTP configuration is working correctly.\n\n"
            f"Sent at: {datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S UTC')}"
        ),
        triggered_by="test",
        db=db,
    )
    return {"message": f"Test email sent to {req.to}"}