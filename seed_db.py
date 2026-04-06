"""
seed_db.py — Populate employees + users tables for face recognition login.

Run from your project root:
    python seed_db.py

What it does:
  1. Creates all tables (safe if they already exist).
  2. Upserts employee rows — updates phone/username if the email already exists.
  3. Creates a linked User row (hashed password) for each employee.
  4. Skips rows that are already fully seeded so it's safe to re-run.

Phone numbers MUST be E.164 format: +<country_code><number>
  India   → +91XXXXXXXXXX   (10 digits after +91)
  US/CA   → +1XXXXXXXXXX    (10 digits after +1)
"""

import sys
import os
from datetime import datetime
from pathlib import Path

# ── Make sure the project root is on sys.path ──────────────────────────────────
# Adjust this if your folder structure differs
ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from backend.database.session import SessionLocal, engine, Base
from backend.database.models import Employee, User

# bcrypt for password hashing — already a FastAPI dependency
from passlib.context import CryptContext

pwd_ctx = CryptContext(schemes=["bcrypt"], deprecated="auto")


# ══════════════════════════════════════════════════════════════════════════════
# EDIT THIS LIST — one dict per employee
# username  → must EXACTLY match the folder name in your face dataset
# phone     → E.164 format  (+91XXXXXXXXXX for India, +1XXXXXXXXXX for US)
# password  → plain text here; stored as bcrypt hash in DB
# ══════════════════════════════════════════════════════════════════════════════

EMPLOYEES = [
    # {
    #     "name":        "Akansha Kulkarni",
    #     "email":       "akulkarni@sveltoz.com",
    #     "phone":       "+918554876505",
    #     "username":    "Akansha",
    #     "department":  "Engineering",
    #     "designation": "Software Engineer",
    #     "password":    "Akansha@123",
    # },
    {
        "name":        "Nikita Bhilare",
        "email":       "nbhilare@sveltoz.com",
        "phone":       "+918999375372", # Your verified Twilio number
        "username":    "Nikita",        # This MUST match the folder name below
        "department":  "Engineering",
        "designation": "QA Engineer",
        "password":    "Nikita@123",
    },
    {
        "name":        "Mayur Pathe",
        "email":       "mpathe@sveltoz.com",
        "phone":       "+919359256204", # Your verified Twilio number
        "username":    "Mayur",        # This MUST match the folder name below
        "department":  "Engineering",
        "designation": "QA Engineer",
        "password":    "Mayur@123",
    },
       {
        "name":        "Gunesh Kulkarni",
        "email":       "gkulkarni@sveltoz.com",
        "phone":       "+919168555476", # Your verified Twilio number
        "username":    "Gunesh",        # This MUST match the folder name below
        "department":  "Engineering",
        "designation": "QA Engineer",
        "password":    "Gunesh@123",
    },
    {
        "name":        "Rahul Verma",
        "email":       "rahul.verma@company.com",
        "phone":       "+919876543211",
        "username":    "Rahul",
        "department":  "Engineering",
        "designation": "Senior Developer",
        "password":    "Rahul@123",
    },
    {
        "name":        "Priya Nair",
        "email":       "priya.nair@company.com",
        "phone":       "+919876543212",
        "username":    "Priya",
        "department":  "HR",
        "designation": "HR Manager",
        "password":    "Priya@123",
    },
    # ── Add more employees below ───────────────────────────────────────────────
    # {
    #     "name":        "Amit Joshi",
    #     "email":       "amit.joshi@company.com",
    #     "phone":       "+919876543213",
    #     "username":    "Amit",          # ← dataset folder name
    #     "department":  "Finance",
    #     "designation": "Accountant",
    #     "password":    "Amit@123",
    # },
]


# ══════════════════════════════════════════════════════════════════════════════
# Helpers
# ══════════════════════════════════════════════════════════════════════════════

def validate_e164(phone: str, name: str) -> bool:
    """Warn if a phone number doesn't look like E.164."""
    if not phone.startswith("+") or not phone[1:].isdigit() or len(phone) < 8:
        print(f"  ⚠️  WARNING: '{phone}' for {name} may not be valid E.164. "
              "Twilio requires +<country_code><number>.")
        return False
    return True


def seed():
    # ── 1. Create tables if missing ────────────────────────────────────────────
    Base.metadata.create_all(bind=engine)
    print("✅ Tables verified / created.\n")

    db = SessionLocal()
    seeded = 0
    updated = 0
    skipped = 0

    try:
        for data in EMPLOYEES:
            name       = data["name"]
            email      = data["email"]
            phone      = data["phone"]
            username   = data["username"]
            department = data.get("department", "")
            designation= data.get("designation", "")
            password   = data["password"]

            # Validate phone format
            validate_e164(phone, name)

            # ── 2. Upsert Employee ─────────────────────────────────────────────
            emp = db.query(Employee).filter(Employee.email == email).first()

            if emp:
                # Update phone + username in case they changed
                changed = False
                if emp.phone != phone:
                    emp.phone = phone;  changed = True
                if emp.username != username:
                    emp.username = username; changed = True
                if changed:
                    db.commit()
                    print(f"  🔄  Updated   : {name} ({email})")
                    updated += 1
                else:
                    print(f"  ⏭️  Skipped   : {name} — already up to date")
                    skipped += 1
            else:
                emp = Employee(
                    name=name,
                    email=email,
                    phone=phone,
                    username=username,
                    department=department,
                    designation=designation,
                    status="active",
                    join_date=datetime.utcnow(),
                    face_registered=False,
                    phone_verified=False,
                    phone_country_code=phone[:3] if phone.startswith("+") else "+91",
                )
                db.add(emp)
                db.flush()   # get emp.id before creating User
                print(f"  ✅  Inserted   : {name} ({email})  phone={phone}")
                seeded += 1

            # ── 3. Upsert linked User ──────────────────────────────────────────
            user = db.query(User).filter(User.email == email).first()
            if not user:
                user = User(
                    employee_id=emp.id,
                    email=email,
                    password_hash=pwd_ctx.hash(password),
                    face_registered=False,
                    is_active=True,
                )
                db.add(user)
                print(f"             ↳ User account created.")

        db.commit()

    except Exception as exc:
        db.rollback()
        print(f"\n❌ Seed failed: {exc}")
        raise
    finally:
        db.close()

    print(f"\n{'─'*50}")
    print(f"  Seeded : {seeded}")
    print(f"  Updated: {updated}")
    print(f"  Skipped: {skipped}")
    print(f"{'─'*50}")
    print("\n✅ Seeding complete. Remember to run `alembic upgrade head` first if tables are missing.\n")


if __name__ == "__main__":
    seed()