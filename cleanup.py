from backend.database.session import SessionLocal
from backend.database.models import Employee, User

db = SessionLocal()
try:
    # Delete existing records that conflict
    db.query(User).filter(User.email == "akulkarni@sveltoz.com").delete()
    db.query(Employee).filter(Employee.username == "Akansha").delete()
    db.commit()
    print("✅ Old records cleared. You can now run seed_db.py")
except Exception as e:
    db.rollback()
    print(f"❌ Error: {e}")
finally:
    db.close()