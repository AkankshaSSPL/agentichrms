"""
Enum definitions for PIN verification types.

Usage:
    from backend.enums.pin_type import PinType

    Employee(pin_type=PinType.SMS, ...)
    PINVerification(pin_type=PinType.REGISTRATION, ...)
"""

from enum import Enum


class PinType(str, Enum):
    SMS = "sms"
    DEFAULT = "default"
    LOGIN = "login"
    REGISTRATION = "registration"