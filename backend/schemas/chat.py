from pydantic import BaseModel
from typing import List, Optional

class ChatRequest(BaseModel):
    message: str
    session_id: Optional[int] = None

class Source(BaseModel):
    source_file: str
    section: str
    content: str = ""

class ChatResponse(BaseModel):
    answer: str
    sources: List[Source] = []
    steps: List[dict] = []