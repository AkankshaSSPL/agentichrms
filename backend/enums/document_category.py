"""
Enum definitions for HR document categories used in behavioral analytics.

Usage:
    from backend.enums.document_category import DocumentCategory

    # Tagging a document
    tag.category = DocumentCategory.SENSITIVE

    # Threshold lookups in BehaviorService
    if category == DocumentCategory.GENERAL:
        return  # untracked
"""

from enum import Enum


class DocumentCategory(str, Enum):
    SENSITIVE = "SENSITIVE"
    LEAVE_INTENT = "LEAVE_INTENT"
    EXIT_INTENT = "EXIT_INTENT"
    GROWTH = "GROWTH"
    GENERAL = "GENERAL"
    POSH = "POSH"  # Workplace Conduct / POSH

    # Human-readable labels (used in emails, UI messages)
    @property
    def label(self) -> str:
        return {
            DocumentCategory.SENSITIVE: "Sensitive",
            DocumentCategory.LEAVE_INTENT: "Leave Intent",
            DocumentCategory.EXIT_INTENT: "Exit Intent",
            DocumentCategory.GROWTH: "Growth & Development",
            DocumentCategory.GENERAL: "General",
            DocumentCategory.POSH: "Workplace Conduct / POSH",
        }[self]