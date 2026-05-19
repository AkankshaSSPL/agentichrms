"""
Notifications API Route
GET  /api/notifications/             — List employee's notifications
POST /api/notifications/{id}/read    — Mark selected notification as read
POST /api/notifications/read-all     — Mark all notifications as read
"""

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import datetime
from pydantic import BaseModel
from backend.database.session import SessionLocal
from backend.database.models import Employee, Notification
from backend.core.security import verify_token

router = APIRouter(prefix="/notifications", tags=["Notifications"])

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def get_current_employee(request: Request, db: Session = Depends(get_db)):
    auth = request.headers.get("Authorization")
    if not auth or not auth.startswith("Bearer "):
        raise HTTPException(401, "Missing token")
    token = auth.split(" ")[1]
    payload = verify_token(token)
    if not payload:
        raise HTTPException(401, "Invalid token")
    employee_id = int(payload.get("sub"))
    employee = db.query(Employee).filter(Employee.id == employee_id).first()
    if not employee:
        raise HTTPException(404, "Employee not found")
    return employee

class NotificationResponse(BaseModel):
    id: int
    employee_id: int
    title: str
    message: str
    is_read: bool
    created_at: datetime

    class Config:
        from_attributes = True

@router.get("/", response_model=List[NotificationResponse])
def get_notifications(
    request: Request,
    only_unread: bool = False,
    db: Session = Depends(get_db)
):
    emp = get_current_employee(request, db)
    query = db.query(Notification).filter(Notification.employee_id == emp.id)
    if only_unread:
        query = query.filter(Notification.is_read == False)
    return query.order_by(Notification.created_at.desc()).all()

@router.post("/{notif_id}/read")
def mark_as_read(notif_id: int, request: Request, db: Session = Depends(get_db)):
    emp = get_current_employee(request, db)
    notif = db.query(Notification).filter(
        Notification.id == notif_id,
        Notification.employee_id == emp.id
    ).first()
    if not notif:
        raise HTTPException(404, "Notification not found")
    
    notif.is_read = True
    db.commit()
    return {"success": True, "message": "Notification marked as read"}

@router.post("/read-all")
def mark_all_as_read(request: Request, db: Session = Depends(get_db)):
    emp = get_current_employee(request, db)
    unread_notifications = db.query(Notification).filter(
        Notification.employee_id == emp.id,
        Notification.is_read == False
    ).all()
    
    for notif in unread_notifications:
        notif.is_read = True
    
    db.commit()
    return {"success": True, "count": len(unread_notifications)}