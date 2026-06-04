"""
Enum definitions for chat message roles.

Usage:
    from backend.enums.chat_role import ChatRole

    ChatMessage(role=ChatRole.USER, ...)

    if msg.role == ChatRole.ASSISTANT:
        ...

    # Filtering history
    if msg.get("role") in (ChatRole.USER, ChatRole.ASSISTANT):
        ...
"""

from enum import Enum


class ChatRole(str, Enum):
    USER = "user"
    ASSISTANT = "assistant"
    SYSTEM = "system"