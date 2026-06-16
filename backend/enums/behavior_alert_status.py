"""
Enum definitions for behavioral alert lifecycle states.

Usage:
    from backend.enums.behavior_alert_status import BehaviorAlertStatus

    alert.status = BehaviorAlertStatus.OPEN
    if alert.status == BehaviorAlertStatus.RESOLVED:
        ...
"""

from enum import Enum


class BehaviorAlertStatus(str, Enum):
    OPEN = "OPEN"
    RESOLVED = "RESOLVED"

    @property
    def label(self) -> str:
        return {
            BehaviorAlertStatus.OPEN: "Open",
            BehaviorAlertStatus.RESOLVED: "Resolved",
        }[self]