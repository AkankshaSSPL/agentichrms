"""
backend/api/meetings.py — Meetings CRUD API
Employees can create, view, and delete their own meetings.
These meetings are checked against leave requests for conflicts.
"""

from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, validator
from sqlalchemy.orm import Session

from backend.core.security import verify_token
from backend.database.models import Employee, Meeting
from backend.database.session import get_db

router = APIRouter(prefix="/meetings", tags=["Meetings"])




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

    @validator("title")
    def title_not_blank(cls, v):
        if not v.strip():
            raise ValueError("Meeting title cannot be blank")
        return v.strip()

    @validator("meeting_date")
    def date_format(cls, v):
        try:
            from datetime import date, datetime
            parsed = datetime.strptime(v, "%Y-%m-%d").date()
            if parsed < date.today():
                raise ValueError("Meeting date cannot be in the past")
        except ValueError as e:
            if "does not match format" in str(e) or "time data" in str(e):
                raise ValueError("Date must be in YYYY-MM-DD format")
            raise
        return v

    @validator("end_time")
    def end_after_start(cls, v, values):
        start = values.get("start_time")
        if start:
            try:
                from datetime import datetime
                s = datetime.strptime(start, "%H:%M")
                e = datetime.strptime(v, "%H:%M")
                if e <= s:
                    raise ValueError("End time must be after start time")
            except ValueError as err:
                if "does not match format" in str(err) or "time data" in str(err):
                    raise ValueError("Time must be in HH:MM format (24h)")
                raise
        return v


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