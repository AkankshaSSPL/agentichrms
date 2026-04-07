"""
add_missing_columns.py — Adds all new columns to existing tables safely.
Run once from project root:  python add_missing_columns.py
Each ALTER is wrapped in a try/except so re-running is safe.
"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))

from sqlalchemy import text
from backend.database.session import engine

COLUMNS = [
    # employees table
    ("employees", "employee_code",          "VARCHAR UNIQUE"),
    ("employees", "date_of_birth",          "TIMESTAMP"),
    ("employees", "onboarding_completed",   "BOOLEAN DEFAULT FALSE"),
    ("employees", "profile_completed",      "BOOLEAN DEFAULT FALSE"),
    ("employees", "email_verified",         "BOOLEAN DEFAULT FALSE"),
    ("employees", "email_verified_at",      "TIMESTAMP"),
    ("employees", "phone_verified",         "BOOLEAN DEFAULT FALSE"),
    ("employees", "phone_verified_at",      "TIMESTAMP"),
    ("employees", "phone_country_code",     "VARCHAR(5) DEFAULT '+91'"),
    ("employees", "username",               "VARCHAR(100) UNIQUE"),
    ("employees", "face_embedding",         "BYTEA"),
    ("employees", "face_registered",        "BOOLEAN DEFAULT FALSE"),
    ("employees", "face_enrollment_date",   "TIMESTAMP"),

    # users table
    ("users", "is_verified",            "BOOLEAN DEFAULT FALSE"),
    ("users", "is_approved",            "BOOLEAN DEFAULT TRUE"),
    ("users", "face_login_enabled",     "BOOLEAN DEFAULT FALSE"),
    ("users", "two_factor_enabled",     "BOOLEAN DEFAULT FALSE"),
    ("users", "last_login",             "TIMESTAMP"),
    ("users", "last_login_ip",          "VARCHAR(45)"),
    ("users", "failed_login_attempts",  "INTEGER DEFAULT 0"),
    ("users", "account_locked",         "BOOLEAN DEFAULT FALSE"),
    ("users", "locked_until",           "TIMESTAMP"),
    ("users", "preferred_login_method", "VARCHAR(20) DEFAULT 'password'"),
    ("users", "face_registered",        "BOOLEAN DEFAULT FALSE"),

    # pin_verifications table
    ("pin_verifications", "pin_type", "VARCHAR(20) DEFAULT 'login'"),
]

CREATE_TABLES = [
    """
    CREATE TABLE IF NOT EXISTS face_login_attempts (
        id SERIAL PRIMARY KEY,
        employee_id INTEGER REFERENCES employees(id),
        attempt_time TIMESTAMP DEFAULT NOW(),
        success BOOLEAN NOT NULL,
        confidence_score FLOAT,
        ip_address VARCHAR(45),
        user_agent TEXT,
        failure_reason VARCHAR(255),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        deleted_at TIMESTAMP WITH TIME ZONE
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS pin_verifications (
        id SERIAL PRIMARY KEY,
        employee_id INTEGER NOT NULL REFERENCES employees(id),
        pin_code VARCHAR(6) NOT NULL,
        phone_number VARCHAR(20) NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        verified BOOLEAN DEFAULT FALSE,
        attempts INTEGER DEFAULT 0,
        max_attempts INTEGER DEFAULT 3,
        pin_type VARCHAR(20) DEFAULT 'login',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        deleted_at TIMESTAMP WITH TIME ZONE
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS registration_tokens (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        token VARCHAR(255) UNIQUE NOT NULL,
        token_type VARCHAR(50) NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        used BOOLEAN DEFAULT FALSE,
        used_at TIMESTAMP,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        deleted_at TIMESTAMP WITH TIME ZONE
    )
    """,
]

def run():
    with engine.connect() as conn:
        # ── 1. Create missing tables ───────────────────────────────────────────
        print("── Creating missing tables ──")
        for ddl in CREATE_TABLES:
            table_name = ddl.strip().split()[5]  # extract table name
            try:
                conn.execute(text(ddl))
                conn.commit()
                print(f"  ✅ Table ready: {table_name}")
            except Exception as e:
                conn.rollback()
                print(f"  ⚠️  {table_name}: {e}")

        # ── 2. Add missing columns ─────────────────────────────────────────────
        print("\n── Adding missing columns ──")
        for table, column, col_type in COLUMNS:
            try:
                conn.execute(text(
                    f'ALTER TABLE {table} ADD COLUMN IF NOT EXISTS "{column}" {col_type}'
                ))
                conn.commit()
                print(f"  ✅ {table}.{column}")
            except Exception as e:
                conn.rollback()
                print(f"  ⚠️  {table}.{column}: {e}")

    print("\n✅ Done. Restart uvicorn now.\n")

if __name__ == "__main__":
    run()