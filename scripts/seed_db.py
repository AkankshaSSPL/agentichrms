"""
seed_db.py — Populate employees + users tables for face recognition login.

Run from your project root:
    python seed_db.py

What it does:
  1. Creates all tables (safe if they already exist).
  2. Upserts employee rows — updates phone if the email already exists.
  3. Sets a default 6-digit login PIN (123456) for every seeded employee, stored
     hashed in `permanent_pin_hash`. Existing custom PINs are left untouched.
  4. Creates a linked User row (hashed password) for each employee.
  5. Skips rows that are already fully seeded so it's safe to re-run.

Login (PIN flow): email/phone + the 6-digit PIN below. Change DEFAULT_PIN to
rotate the seeded PIN for fresh users.

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
ROOT = Path(__file__).resolve().parent.parent  # project root (one level up from scripts/)
sys.path.insert(0, str(ROOT))

from backend.database.session import SessionLocal, engine, Base
from backend.database.models import Employee, User, Role

# bcrypt for password hashing — already a FastAPI dependency
from passlib.context import CryptContext

pwd_ctx = CryptContext(schemes=["bcrypt"], deprecated="auto")

# Default login PIN given to every seeded employee (stored hashed in
# Employee.permanent_pin_hash). Used by the PIN login flow (login-with-pin).
# Must be exactly 6 digits. Existing custom PINs are NOT overwritten on re-run.
DEFAULT_PIN = "123456"


# ══════════════════════════════════════════════════════════════════════════════
# EDIT THIS LIST — one dict per employee
# phone     → E.164 format  (+91XXXXXXXXXX for India, +1XXXXXXXXXX for US)
# password  → plain text here; stored as bcrypt hash in DB
# ══════════════════════════════════════════════════════════════════════════════

EMPLOYEES = [
    # {
    #     "name":        "Akansha Kulkarni",
    #     "email":       "akulkarni@sveltoz.com",
    #     "phone":       "+918554876505",
    #    #     "department":  "Engineering",
    #     "designation": "Software Engineer",
    #     "password":    "Akansha@123",
    # },
    {
        "name":        "Nikita Bhilare",
        "email":       "nbhilare@sveltoz.com",
        "phone":       "+918999375372", # Your verified Twilio number
        "department":  "Engineering",
        "designation": "QA Engineer",
        "password":    "Nikita@123",
    },
    {
        "name":        "Mayur Pathe",
        "email":       "mpathe@sveltoz.com",
        "phone":       "+919359256204", # Your verified Twilio number
        "department":  "Engineering",
        "designation": "QA Engineer",
        "password":    "Mayur@123",
    },
       {
        "name":        "Gunesh Kulkarni",
        "email":       "gkulkarni@sveltoz.com",
        "phone":       "+919168555476", # Your verified Twilio number
        "department":  "Engineering",
        "designation": "QA Engineer",
        "password":    "Gunesh@123",
    },
    {
        "name":        "Rahul Verma",
        "email":       "rahul.verma@company.com",
        "phone":       "+919876543211",
        "department":  "Engineering",
        "designation": "Senior Developer",
        "password":    "Rahul@123",
    },
    {
        "name":        "Priya Nair",
        "email":       "priya.nair@company.com",
        "phone":       "+919876543212",
        "department":  "HR",
        "designation": "HR Manager",
        "password":    "Priya@123",
        "role":        "hr",             # ← HR role
    },
    {
        "name":        "Akansha Kulkarni",
        "email":       "akulkarni@sveltoz.com",
        "phone":       "+918554876505",
        "department":  "Engineering",
        "designation": "Software Engineer",
        "password":    "Priya@123",
    },
    # ── Add more employees below ───────────────────────────────────────────────
    # {
    #     "name":        "Amit Joshi",
    #     "email":       "amit.joshi@company.com",
    #     "phone":       "+919876543213",
    #    #     "department":  "Finance",
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

    # ── 1b. Seed roles table (idempotent) ──────────────────────────────────────
    ROLES = [
        {"name": "admin",    "description": "Full system access"},
        {"name": "hr",       "description": "HR management access — approve/reject leaves, manage employees"},
        {"name": "employee", "description": "Standard employee access — chat, apply leave, view policies"},
    ]
    role_map = {}  # name → id
    for r in ROLES:
        existing = db.query(Role).filter(Role.name == r["name"]).first()
        if not existing:
            new_role = Role(name=r["name"], description=r["description"])
            db.add(new_role)
            db.commit()
            db.refresh(new_role)
            role_map[r["name"]] = new_role.id
            print(f"  ✅  Role created : {r['name']}")
        else:
            role_map[r["name"]] = existing.id
            print(f"  ⏭️  Role exists  : {r['name']}")
    print()

    try:
        for data in EMPLOYEES:
            name       = data["name"]
            email      = data["email"]
            phone      = data["phone"]
            department = data.get("department", "")
            designation= data.get("designation", "")
            password   = data["password"]

            # Validate phone format
            validate_e164(phone, name)

            # ── 2. Upsert Employee ─────────────────────────────────────────────
            emp = db.query(Employee).filter(Employee.email == email).first()

            if emp:
                # Update phone if it changed
                changed = False
                if emp.phone != phone:
                    emp.phone = phone
                    changed = True
                # Backfill the default PIN only if this employee has none yet —
                # never overwrite a PIN the user has since customised.
                if not emp.permanent_pin_hash:
                    emp.permanent_pin_hash = pwd_ctx.hash(DEFAULT_PIN)
                    emp.pin_set_at = datetime.utcnow()
                    changed = True
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
                    department=department,
                    designation=designation,
                    status="active",
                    join_date=datetime.utcnow(),
                    face_registered=False,
                    phone_verified=False,
                    phone_country_code=phone[:3] if phone.startswith("+") else "+91",
                    role_id=role_map.get(data.get("role", "employee"), role_map["employee"]),
                    permanent_pin_hash=pwd_ctx.hash(DEFAULT_PIN),
                    pin_set_at=datetime.utcnow(),
                )
                db.add(emp)
                db.flush()   # get emp.id before creating User
                print(f"  ✅  Inserted   : {name} ({email})  phone={phone}  "
                      f"role={data.get('role','employee')}  pin={DEFAULT_PIN}")
                seeded += 1

            # ── 3. Upsert linked User ──────────────────────────────────────────
            # username must be unique — derive from first name + employee_id suffix
            base_username = data.get("username") or name.split()[0]
            username = f"{base_username}_{emp.id}"
            role_str = data.get("role", "employee")

            user = db.query(User).filter(User.employee_id == emp.id).first()
            if not user:
                user = User(
                    employee_id=emp.id,
                    username=username,
                    password_hash=pwd_ctx.hash(password),
                    role=role_str,
                    face_registered=False,
                    is_active=True,
                    is_verified=False,
                    face_login_enabled=False,
                )
                db.add(user)
                print(f"             ↳ User account created (username={username}).")

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