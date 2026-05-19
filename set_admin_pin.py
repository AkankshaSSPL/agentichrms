import sys
import getpass
sys.path.append('.')

from backend.database.session import SessionLocal
from backend.database.models import Employee
from backend.core.security import get_password_hash

def main():
    email = input("Admin email: ").strip()
    pin = getpass.getpass("Enter new 6-digit PIN: ").strip()
    if len(pin) != 6 or not pin.isdigit():
        print("PIN must be exactly 6 digits.")
        return

    db = SessionLocal()
    admin = db.query(Employee).filter(Employee.email == email).first()
    if not admin:
        print(f"No employee found with email {email}")
        return

    admin.permanent_pin_hash = get_password_hash(pin)
    db.commit()
    print(f"PIN set for {admin.email}")
    db.close()

if __name__ == "__main__":
    main()