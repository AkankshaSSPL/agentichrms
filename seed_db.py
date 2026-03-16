"""Create and populate the mock HR SQLite database.

GAP-017 FIX: Running this script unconditionally dropped all tables with no
confirmation, making accidental production data loss trivially easy.
Now requires the ALLOW_SEED=true environment variable, and additionally
prompts for confirmation if the database already has employee records.
"""
import sqlite3
import os
import sys
from config import DB_PATH


def main():
    # GAP-017 FIX: Hard guard — must explicitly opt in to destructive seed
    if os.getenv("ALLOW_SEED", "false").lower() != "true":
        print(
            "ERROR: This script drops ALL tables and destroys all data.\n"
            "Set ALLOW_SEED=true in your environment to proceed.\n"
            "Example: ALLOW_SEED=true python seed_db.py"
        )
        sys.exit(1)

    # Secondary guard: confirm if the DB already has data
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    if os.path.exists(DB_PATH):
        try:
            probe = sqlite3.connect(DB_PATH)
            existing = probe.execute(
                "SELECT COUNT(*) FROM employees"
            ).fetchone()[0]
            probe.close()
            if existing > 0:
                answer = input(
                    f"Database already has {existing} employee record(s). "
                    "This will DESTROY all data. Type 'yes' to continue: "
                )
                if answer.strip().lower() != "yes":
                    print("Aborted.")
                    sys.exit(0)
        except sqlite3.OperationalError:
            pass  # Table doesn't exist yet — safe to proceed

    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()

    # Drop in dependency order
    c.execute("DROP TABLE IF EXISTS employee_onboarding")
    c.execute("DROP TABLE IF EXISTS onboarding_tasks")
    c.execute("DROP TABLE IF EXISTS leaves")
    c.execute("DROP TABLE IF EXISTS leave_balances")
    c.execute("DROP TABLE IF EXISTS employees")

    c.execute("""CREATE TABLE employees (
        id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT,
        department TEXT, designation TEXT, manager TEXT,
        join_date TEXT, phone TEXT, status TEXT DEFAULT 'active')""")

    c.execute("""CREATE TABLE leave_balances (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        employee_id INTEGER NOT NULL,
        leave_type TEXT NOT NULL,
        days_remaining INTEGER NOT NULL,
        FOREIGN KEY (employee_id) REFERENCES employees(id),
        UNIQUE(employee_id, leave_type))""")

    c.execute("""CREATE TABLE leaves (
        id INTEGER PRIMARY KEY AUTOINCREMENT, employee_id INTEGER,
        leave_type TEXT, start_date TEXT,
        end_date TEXT, status TEXT DEFAULT 'Pending',
        reason TEXT, rejection_reason TEXT,
        applied_on TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (employee_id) REFERENCES employees(id))""")

    c.execute("""CREATE TABLE onboarding_tasks (
        id INTEGER PRIMARY KEY, task_name TEXT NOT NULL,
        category TEXT, description TEXT, is_mandatory INTEGER DEFAULT 1)""")

    c.execute("""CREATE TABLE employee_onboarding (
        id INTEGER PRIMARY KEY AUTOINCREMENT, employee_id INTEGER,
        task_id INTEGER, status TEXT DEFAULT 'Pending', completed_at TEXT,
        FOREIGN KEY (employee_id) REFERENCES employees(id),
        FOREIGN KEY (task_id) REFERENCES onboarding_tasks(id))""")

    employees = [
        (1, "Rahul Sharma",      "rahul@company.com",   "Engineering", "Senior Engineer",    "Priya Patel",   "2022-03-15", "9876543210", "active"),
        (2, "Priya Patel",       "priya@company.com",   "Engineering", "Engineering Manager", "Vikram Singh",  "2020-01-10", "9876543211", "active"),
        (3, "Amit Kumar",        "amit@company.com",    "Engineering", "Junior Engineer",     "Priya Patel",   "2024-01-20", "9876543212", "active"),
        (4, "Neha Gupta",        "neha@company.com",    "Product",     "Product Manager",     "Vikram Singh",  "2021-06-01", "9876543213", "active"),
        (5, "Vikram Singh",      "vikram@company.com",  "Engineering", "VP Engineering",      None,            "2019-08-01", "9876543214", "active"),
        (6, "Ananya Reddy",      "ananya@company.com",  "HR",          "HR Manager",          "Vikram Singh",  "2020-11-15", "9876543215", "active"),
        (7, "Karthik Nair",      "karthik@company.com", "Engineering", "DevOps Engineer",     "Priya Patel",   "2023-02-28", "9876543216", "active"),
        (8, "Sneha Desai",       "sneha@company.com",   "Sales",       "Sales Manager",       "Vikram Singh",  "2021-09-10", "9876543217", "active"),
        (9, "Rajesh Iyer",       "rajesh@company.com",  "Finance",     "Finance Analyst",     "Vikram Singh",  "2022-07-20", "9876543218", "active"),
        (10,"Divya Menon",       "divya@company.com",   "Product",     "UX Designer",         "Neha Gupta",    "2023-04-01", "9876543219", "active"),
        (11,"Arjun Verma",       "arjun@company.com",   "Engineering", "Backend Engineer",    "Priya Patel",   "2023-08-15", "9876543220", "active"),
        (12,"Meera Joshi",       "meera@company.com",   "HR",          "HR Executive",        "Ananya Reddy",  "2024-02-01", "9876543221", "active"),
        (13,"Suresh Pillai",     "suresh@company.com",  "Sales",       "Sales Executive",     "Sneha Desai",   "2023-06-10", "9876543222", "active"),
        (14,"Pooja Agarwal",     "pooja@company.com",   "Finance",     "Accountant",          "Rajesh Iyer",   "2022-12-01", "9876543223", "active"),
        (15,"Manish Tiwari",     "manish@company.com",  "Engineering", "QA Engineer",         "Priya Patel",   "2023-10-01", "9876543224", "active"),
        (16,"Riya Saxena",       "riya@company.com",    "Product",     "Product Analyst",     "Neha Gupta",    "2024-01-15", "9876543225", "active"),
        (17,"Deepak Choudhary",  "deepak@company.com",  "Engineering", "Frontend Engineer",   "Priya Patel",   "2023-05-20", "9876543226", "active"),
        (18,"Kavita Rao",        "kavita@company.com",  "HR",          "Recruiter",           "Ananya Reddy",  "2023-11-01", "9876543227", "active"),
        (19,"Sanjay Mishra",     "sanjay@company.com",  "Sales",       "Business Dev",        "Sneha Desai",   "2024-03-01", "9876543228", "active"),
        (20,"Lakshmi Venkat",    "lakshmi@company.com", "Engineering", "Data Engineer",       "Priya Patel",   "2024-06-15", "9876543229", "active"),
    ]
    c.executemany("INSERT INTO employees VALUES (?,?,?,?,?,?,?,?,?)", employees)

    leave_types = {
        "casual": 12, "sick": 10, "earned": 15, "maternity": 182, "paternity": 15
    }
    for emp in employees:
        for l_type, days in leave_types.items():
            c.execute(
                "INSERT INTO leave_balances (employee_id, leave_type, days_remaining) VALUES (?,?,?)",
                (emp[0], l_type, days),
            )

    # Adjust balances for employees with seeded leave history
    c.execute("UPDATE leave_balances SET days_remaining=10 WHERE employee_id=1 AND leave_type='casual'")
    c.execute("UPDATE leave_balances SET days_remaining=9  WHERE employee_id=3 AND leave_type='sick'")

    leaves = [
        (1, "casual", "2024-12-25", "2024-12-26", "Approved", "Year-end vacation"),
        (3, "sick",   "2024-12-20", "2024-12-20", "Approved", "Fever"),
        (4, "earned", "2025-01-06", "2025-01-10", "Pending",  "Family trip"),
    ]
    for emp_id, l_type, start, end, status, reason in leaves:
        c.execute(
            "INSERT INTO leaves (employee_id,leave_type,start_date,end_date,status,reason) "
            "VALUES (?,?,?,?,?,?)",
            (emp_id, l_type, start, end, status, reason),
        )

    tasks = [
        (1,  "Submit ID Proof",           "HR",         "Submit Aadhaar/Passport copy to HR",         1),
        (2,  "Submit PAN Card",            "HR",         "Submit PAN card copy",                       1),
        (3,  "Bank Details Form",          "HR",         "Fill out bank account details for salary",   1),
        (4,  "Sign Employment Agreement",  "HR",         "Sign the employment agreement",              1),
        (5,  "Collect Laptop",             "IT Setup",   "Collect laptop from IT helpdesk",            1),
        (6,  "Setup Email",                "IT Setup",   "Set up corporate email account",             1),
        (7,  "Install Software",           "IT Setup",   "Install Slack, Jira, VS Code",               1),
        (8,  "VPN Setup",                  "IT Setup",   "Connect to company VPN",                     1),
        (9,  "Security Training",          "Compliance", "Complete InfoSec awareness training",        1),
        (10, "Anti-Harassment Training",   "Compliance", "Complete anti-harassment training",          1),
        (11, "Code of Conduct",            "Compliance", "Read and acknowledge CoC",                   1),
        (12, "Team Standup",               "Team",       "Attend first team standup meeting",          0),
        (13, "Manager 1:1",                "Team",       "One-on-one with reporting manager",          1),
        (14, "Health Insurance",           "HR",         "Register for health insurance",              1),
    ]
    c.executemany("INSERT INTO onboarding_tasks VALUES (?,?,?,?,?)", tasks)

    # GAP-046 FIX: Assign onboarding tasks to ALL 20 employees, not just 3.
    # Previously employees 1, 2, 4-5, 7-15, 17-19 had zero onboarding records,
    # so any onboarding query for them returned "No onboarding data found" —
    # making the tool appear broken for 85% of employees.
    #
    # Seeding rules:
    #   - Employee 3: first 4 tasks completed (original data preserved)
    #   - Employees hired before 2023: all 14 tasks completed (fully onboarded)
    #   - Employees hired 2023+: tasks 1-8 completed, rest pending (in progress)
    #   - Employees hired 2024+: all pending (just joined)

    import datetime
    recent_cutoff = datetime.date(2024, 1, 1)
    mid_cutoff = datetime.date(2023, 1, 1)

    for emp in employees:
        emp_id = emp[0]
        join_str = emp[6]  # join_date column
        join_date = datetime.date.fromisoformat(join_str)

        for task in tasks:
            task_id = task[0]

            if emp_id == 3:
                # Original seed: first 4 tasks done
                status = "Completed" if task_id <= 4 else "Pending"
                completed_at = "2024-01-25" if status == "Completed" else None
            elif join_date < mid_cutoff:
                # Veteran employees: fully onboarded
                status = "Completed"
                completed_at = join_str
            elif join_date < recent_cutoff:
                # Mid-tenure: first 8 tasks done
                status = "Completed" if task_id <= 8 else "Pending"
                completed_at = join_str if status == "Completed" else None
            else:
                # New joiners: all pending
                status = "Pending"
                completed_at = None

            c.execute(
                "INSERT INTO employee_onboarding (employee_id,task_id,status,completed_at) "
                "VALUES (?,?,?,?)",
                (emp_id, task_id, status, completed_at),
            )

    conn.commit()
    conn.close()
    print(f"✅ Database created at {DB_PATH}")
    print(
        f"   20 employees | {20 * len(leave_types)} leave balances | "
        f"{len(leaves)} leave records | {len(tasks)} onboarding tasks | "
        f"{20 * len(tasks)} onboarding assignments"
    )


if __name__ == "__main__":
    main()