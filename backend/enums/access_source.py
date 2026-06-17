"""
Enum for the source of a document access — chat response or direct viewer open.
Mirrors document_category.py value-casing convention (UPPER).
"""

from enum import Enum


class AccessSource(str, Enum):
    CHAT   = "chat"
    VIEWER = "viewer"