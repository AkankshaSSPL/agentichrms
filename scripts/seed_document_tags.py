#!/usr/bin/env python
"""
Seed document tags for behavioral analytics.
Idempotent: can be run multiple times.
"""

import os
import sys
from pathlib import Path

# Add project root to PYTHONPATH
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from backend.database.session import SessionLocal
from backend.repositories.behavior_repository import BehaviorRepository
from backend.enums import DocumentCategory

DOCS_DIR = Path(__file__).resolve().parent.parent / "data" / "docs"

# Define documents to upsert: (filename, category)
DOCUMENTS = [
    ("anti_harassment_policy.md", DocumentCategory.POSH),
    ("exit_resignation_policy.md", DocumentCategory.EXIT_INTENT),
    # If you have other existing docs that should be tagged, add them here.
    # For example, if you want to retag "code_of_conduct.txt" as POSH:
    # ("code_of_conduct.txt", DocumentCategory.POSH),
]

def main():
    db = SessionLocal()
    repo = BehaviorRepository(db)
    for filename, category in DOCUMENTS:
        filepath = DOCS_DIR / filename
        if not filepath.exists():
            print(f"Warning: {filename} not found in {DOCS_DIR}")
            continue
        # Upsert tag
        repo.upsert_tag(filename, category.value)
        print(f"Tagged {filename} -> {category.value}")
    db.close()
    print("Done.")

if __name__ == "__main__":
    main()