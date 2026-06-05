"""Shared base model with audit timestamps and soft deletes."""

from sqlalchemy import Column, DateTime, func
from backend.database.session import Base


class BaseModel(Base):
    __abstract__ = True

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), onupdate=func.now(), server_default=func.now(), nullable=False)
    deleted_at = Column(DateTime(timezone=True), nullable=True)