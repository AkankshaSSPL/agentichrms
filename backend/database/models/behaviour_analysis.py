"""
Behaviour Analysis model — admin-only, on-demand AI snapshot of an employee's
inferred mood/personality/traits from their chat history.

One row per analysis run (history is kept — gives "last analysed" + trend).
No raw chat content is ever stored here — only the model's inferred summary.
"""

from sqlalchemy import Column, ForeignKey, Integer, String, Text
from sqlalchemy.orm import relationship

from backend.database.models.base import BaseModel


class BehaviourAnalysis(BaseModel):
    """
    A single AI-generated behavioural snapshot for one employee.

    traits is stored as a JSON-encoded list (Text column) — kept as plain
    Text rather than a JSON column type for cross-DB portability (matches
    the project's existing String/Text convention elsewhere).
    """
    __tablename__ = "behaviour_analyses"

    id = Column(Integer, primary_key=True, index=True)

    employee_id = Column(Integer, ForeignKey("employees.id"), index=True, nullable=False)
    analyzed_by_employee_id = Column(Integer, ForeignKey("employees.id"), nullable=False)

    mood = Column(String(100), nullable=True)
    personality = Column(Text, nullable=True)
    traits = Column(Text, nullable=True)                   # JSON-encoded list[str]
    attitude_trend = Column(String(100), nullable=True)
    observations = Column(Text, nullable=True)
    suggested_talking_points = Column(Text, nullable=True)  # JSON-encoded list[str]
    confidence = Column(String(20), nullable=True)

    message_count = Column(Integer, nullable=False, default=0)
    model = Column(String(50), nullable=True)

    employee = relationship("Employee", foreign_keys=[employee_id])
    analyzed_by = relationship("Employee", foreign_keys=[analyzed_by_employee_id])