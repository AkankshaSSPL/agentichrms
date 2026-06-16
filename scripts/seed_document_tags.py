"""
seed_document_tags.py — Populate document_tags with default filename → category mappings.

Run from your project root (after alembic upgrade head):
    python scripts/seed_document_tags.py

What it does:
  1. Upserts each filename → category pair into document_tags (safe to re-run).
  2. Never deletes existing tags — admin re-tagging via PUT /behavior/tags is preserved.
  3. Filenames must match exactly what ChromaDB stores as `source_file` metadata.
     Verify in rag/ingest_docs.py if unsure.

To add more documents, extend DEFAULT_DOCUMENT_CATEGORIES below.
Admins can re-tag any document later via PUT /api/behavior/tags.
"""

import sys
from pathlib import Path

# ── Make sure the project root is on sys.path ──────────────────────────────────
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from backend.database.session import SessionLocal
from backend.database.models.behavior_analytics import DocumentTag
from backend.enums import DocumentCategory

# ══════════════════════════════════════════════════════════════════════════════
# DEFAULT CATEGORY MAP
# Keys   → filename as stored in ChromaDB source_file metadata (bare filename)
# Values → DocumentCategory enum value
# GENERAL documents are included for completeness but will never trigger alerts
# ══════════════════════════════════════════════════════════════════════════════

DEFAULT_DOCUMENT_CATEGORIES: dict[str, DocumentCategory] = {
    # Sensitive — NDA, HR manuals, internal policy drafts
    "NDA letter head copy.pdf":              DocumentCategory.SENSITIVE,
    "HR Manual draft 10-02-2026 - Madhuri.pdf": DocumentCategory.SENSITIVE,
    "HR manual draft.md":                    DocumentCategory.SENSITIVE,
    "HR Policy Review and Recommendations.pdf": DocumentCategory.SENSITIVE,
    "Synise Handbook.pdf":                   DocumentCategory.SENSITIVE,

    # Leave intent — leave and WFH policies
    "leave_policy.md":                       DocumentCategory.LEAVE_INTENT,
    "leave_policy.txt":                      DocumentCategory.LEAVE_INTENT,
    "wfh_policy.md":                         DocumentCategory.LEAVE_INTENT,
    "remote_work_policy.md":                 DocumentCategory.LEAVE_INTENT,
    "remote_work_policy.docx":               DocumentCategory.LEAVE_INTENT,

    # Growth — onboarding and employee development
    "onboarding_guide.md":                   DocumentCategory.GROWTH,
    "employee_handbook.md":                  DocumentCategory.GROWTH,

    # General — holidays, conduct (tracked in logs but never alert-triggering)
    "Holiday List 2026 3.pdf":               DocumentCategory.GENERAL,
    "Holiday List for the Year 2025.pdf":    DocumentCategory.GENERAL,
    "code_of_conduct.txt":                   DocumentCategory.GENERAL,
    "expense_policy.xlsx":                   DocumentCategory.GENERAL,
}


# ══════════════════════════════════════════════════════════════════════════════
# Seed logic
# ══════════════════════════════════════════════════════════════════════════════

def seed():
    db = SessionLocal()
    inserted = 0
    updated = 0
    skipped = 0

    try:
        print("Seeding document_tags...\n")

        for filename, category in DEFAULT_DOCUMENT_CATEGORIES.items():
            existing = db.query(DocumentTag).filter(DocumentTag.filename == filename).first()

            if existing:
                if existing.category != category.value:
                    existing.category = category.value
                    db.commit()
                    print(f"  🔄  Updated  : {filename}  →  {category.value}")
                    updated += 1
                else:
                    print(f"  ⏭️  Skipped  : {filename}  ({category.value})")
                    skipped += 1
            else:
                tag = DocumentTag(filename=filename, category=category.value)
                db.add(tag)
                db.commit()
                print(f"  ✅  Inserted : {filename}  →  {category.value}")
                inserted += 1

    except Exception as exc:
        db.rollback()
        print(f"\n❌ Seed failed: {exc}")
        raise
    finally:
        db.close()

    print(f"\n{'─'*50}")
    print(f"  Inserted : {inserted}")
    print(f"  Updated  : {updated}")
    print(f"  Skipped  : {skipped}")
    print(f"{'─'*50}")
    print("\n✅ Document tag seeding complete.\n")


if __name__ == "__main__":
    seed()