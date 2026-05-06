"""
seed_meetings.py — Seeds test meetings for a specific employee by email.
Usage: venv\Scripts\python seed_meetings.py
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from backend.database.session import SessionLocal
from backend.database.models import Meeting, Employee
from datetime import datetime

# ✅ Hardcoded to Akanksha's email — change this if testing with another user
TARGET_EMAIL = "akankshak0505@gmail.com"

db = SessionLocal()
try:
    emp = db.query(Employee).filter(Employee.email == TARGET_EMAIL).first()
    if not emp:
        print(f"❌ No employee found with email: {TARGET_EMAIL}")
        sys.exit(1)

    print(f"✅ Seeding meetings for: {emp.name} (id={emp.id})")

    db.add_all([
        Meeting(
            title="Q2 Planning Meeting",
            meeting_date=datetime(2026, 5, 10, 10, 0),
            start_time=datetime(2026, 5, 10, 10, 0),
            end_time=datetime(2026, 5, 10, 11, 0),
            organizer_id=emp.id,
            attendees="manager@sveltoz.com",
        ),
        Meeting(
            title="Sprint Review",
            meeting_date=datetime(2026, 5, 11, 14, 0),
            start_time=datetime(2026, 5, 11, 14, 0),
            end_time=datetime(2026, 5, 11, 15, 0),
            organizer_id=emp.id,
            attendees="team@sveltoz.com",
        ),
        Meeting(
            title="Client Demo",
            meeting_date=datetime(2026, 5, 12, 9, 0),
            start_time=datetime(2026, 5, 12, 9, 0),
            end_time=datetime(2026, 5, 12, 10, 30),
            organizer_id=emp.id,
            attendees="client@example.com",
        ),
    ])
    db.commit()
    print(f"✅ Added 3 meetings for {emp.name} (id={emp.id})")
    print(f"\nNow log in as {TARGET_EMAIL} and apply for leave 2026-05-10 to 2026-05-12.")
    print("You should see the conflict warning with all 3 meetings listed.")

except Exception as e:
    db.rollback()
    print(f"❌ Error: {e}")
finally:
    db.close()