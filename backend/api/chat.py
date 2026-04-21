# backend/api/chat.py
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from langchain_core.messages import HumanMessage
from agent.graph import graph
from typing import List, Optional

router = APIRouter(prefix="/chat", tags=["Chat"])

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

@router.post("/", response_model=ChatResponse)
async def chat_endpoint(payload: ChatRequest):
    try:
        result = graph.invoke({
            "messages": [HumanMessage(content=payload.message)],
            "sources": []
        })
        messages = result.get("messages", [])
        answer = messages[-1].content if messages else "No response"
        sources = result.get("sources", [])
        steps = result.get("steps", [])
        return ChatResponse(answer=answer, sources=sources, steps=steps)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))