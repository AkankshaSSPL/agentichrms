"""
Nudge status enum for behavioral nudges.
"""

from enum import Enum


class NudgeStatus(str, Enum):
    PENDING = "PENDING"      # detected, not yet shown to employee
    DELIVERED = "DELIVERED"  # shown in chat, remains for reference
    DISMISSED = "DISMISSED"  # employee closed / acted upon