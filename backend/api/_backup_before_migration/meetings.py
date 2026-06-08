"""
backend/api/meetings.py — Meetings CRUD API
Employees can create, view, and delete their own meetings.
These meetings are checked against leave requests for conflicts.
"""

from fastapi import APIRouter, HTTPException, Request, Depends
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime
from sqlalchemy.orm import Session

from backend.database.session import SessionLocal
from backend.database.models import Meeting, Employee, User
from backend.core.security import verify_token

router = APIRouter(prefix="/meetings", tags=["Meetings"])


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
    emp = db.query(Employee).filter(Employee.id == employee_id).first()
    if not emp:
        raise HTTPException(404, "Employee not found")
    return emp


class MeetingCreate(BaseModel):
    title: str
    meeting_date: str        # YYYY-MM-DD
    start_time: str          # HH:MM  (24h)
    end_time: str            # HH:MM  (24h)
    attendees: Optional[str] = ""


class MeetingResponse(BaseModel):
    id: int
    title: str
    meeting_date: str
    start_time: str
    end_time: str
    attendees: str
    organizer_id: int

    class Config:
        from_attributes = True


@router.get("/", response_model=List[MeetingResponse])
def get_meetings(request: Request, db: Session = Depends(get_db)):
    """Return all meetings for the logged-in employee."""
    emp = get_current_employee(request, db)
    meetings = (
        db.query(Meeting)
        .filter(Meeting.organizer_id == emp.id)
        .order_by(Meeting.meeting_date)
        .all()
    )
    result = []
    for m in meetings:
        result.append(MeetingResponse(
            id=m.id,
            title=m.title,
            meeting_date=m.meeting_date.strftime("%Y-%m-%d") if m.meeting_date else "",
            start_time=m.start_time.strftime("%H:%M") if m.start_time else "",
            end_time=m.end_time.strftime("%H:%M") if m.end_time else "",
            attendees=m.attendees or "",
            organizer_id=m.organizer_id,
        ))
    return result


@router.post("/", response_model=MeetingResponse)
def create_meeting(payload: MeetingCreate, request: Request, db: Session = Depends(get_db)):
    """Create a new meeting for the logged-in employee."""
    emp = get_current_employee(request, db)

    try:
        meeting_date = datetime.strptime(payload.meeting_date, "%Y-%m-%d")
        start_time = datetime.strptime(
            f"{payload.meeting_date} {payload.start_time}", "%Y-%m-%d %H:%M"
        )
        end_time = datetime.strptime(
            f"{payload.meeting_date} {payload.end_time}", "%Y-%m-%d %H:%M"
        )
    except ValueError:
        raise HTTPException(400, "Invalid date/time format. Use YYYY-MM-DD and HH:MM.")

    meeting = Meeting(
        title=payload.title,
        meeting_date=meeting_date,
        start_time=start_time,
        end_time=end_time,
        organizer_id=emp.id,
        attendees=payload.attendees or "",
    )
    db.add(meeting)
    db.commit()
    db.refresh(meeting)

    return MeetingResponse(
        id=meeting.id,
        title=meeting.title,
        meeting_date=meeting.meeting_date.strftime("%Y-%m-%d"),
        start_time=meeting.start_time.strftime("%H:%M") if meeting.start_time else "",
        end_time=meeting.end_time.strftime("%H:%M") if meeting.end_time else "",
        attendees=meeting.attendees or "",
        organizer_id=meeting.organizer_id,
    )


@router.put("/{meeting_id}", response_model=MeetingResponse)
def update_meeting(meeting_id: int, payload: MeetingCreate, request: Request, db: Session = Depends(get_db)):
    """Update (reschedule) an existing meeting — only if it belongs to the logged-in employee."""
    emp = get_current_employee(request, db)
    meeting = db.query(Meeting).filter(
        Meeting.id == meeting_id,
        Meeting.organizer_id == emp.id,
    ).first()
    if not meeting:
        raise HTTPException(404, "Meeting not found or not yours.")

    try:
        meeting_date = datetime.strptime(payload.meeting_date, "%Y-%m-%d")
        start_time = datetime.strptime(f"{payload.meeting_date} {payload.start_time}", "%Y-%m-%d %H:%M")
        end_time = datetime.strptime(f"{payload.meeting_date} {payload.end_time}", "%Y-%m-%d %H:%M")
    except ValueError:
        raise HTTPException(400, "Invalid date/time format. Use YYYY-MM-DD and HH:MM.")

    meeting.title = payload.title
    meeting.meeting_date = meeting_date
    meeting.start_time = start_time
    meeting.end_time = end_time
    meeting.attendees = payload.attendees or ""
    db.commit()
    db.refresh(meeting)

    return MeetingResponse(
        id=meeting.id,
        title=meeting.title,
        meeting_date=meeting.meeting_date.strftime("%Y-%m-%d"),
        start_time=meeting.start_time.strftime("%H:%M") if meeting.start_time else "",
        end_time=meeting.end_time.strftime("%H:%M") if meeting.end_time else "",
        attendees=meeting.attendees or "",
        organizer_id=meeting.organizer_id,
    )


@router.delete("/{meeting_id}")
def delete_meeting(meeting_id: int, request: Request, db: Session = Depends(get_db)):
    """Delete a meeting — only if it belongs to the logged-in employee."""
    emp = get_current_employee(request, db)
    meeting = db.query(Meeting).filter(
        Meeting.id == meeting_id,
        Meeting.organizer_id == emp.id,
    ).first()
    if not meeting:
        raise HTTPException(404, "Meeting not found or not yours.")
    db.delete(meeting)
    db.commit()
    return {"success": True}