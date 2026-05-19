from fastapi import APIRouter, HTTPException, Depends, Request
from pydantic import BaseModel
from typing import List, Optional
from sqlalchemy.orm import Session
from backend.database.session import SessionLocal
from backend.database.models import ChatSession, ChatMessage, Employee, User
from backend.core.security import verify_token
from agent.agent import build_agent
import json

router = APIRouter(prefix="/chat", tags=["Chat"])

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def get_current_employee(request: Request, db: Session = Depends(get_db)):
    auth = request.headers.get("Authorization")
    if not auth or not auth.startswith("Bearer "):
        raise HTTPException(401, "Missing token")
    token = auth.split(" ")[1]
    payload = verify_token(token)
    if not payload:
        raise HTTPException(401, "Invalid token")
    employee_id = int(payload.get("sub"))
    employee = db.query(Employee).filter(Employee.id == employee_id).first()
    if not employee:
        raise HTTPException(404, "Employee not found")
    return employee

# ── Chat endpoint ─────────────────────────────────────────────────────────────
class ChatRequest(BaseModel):
    message: str
    session_id: Optional[int] = None
    history: Optional[List[dict]] = []

class Source(BaseModel):
    source_file: str
    section: str
    content: str = ""

class ChatResponse(BaseModel):
    answer: str
    sources: List[Source] = []
    steps: List[dict] = []

@router.post("/", response_model=ChatResponse)
async def chat_endpoint(payload: ChatRequest, request: Request, db: Session = Depends(get_db)):
    try:
        employee = get_current_employee(request, db)

        # Load conversation history from database
        chat_history = []
        if payload.session_id:
            db_messages = db.query(ChatMessage).filter(
                ChatMessage.session_id == payload.session_id
            ).order_by(ChatMessage.created_at).limit(20).all()
            for msg in db_messages:
                if msg.role == "user":
                    chat_history.append({"role": "user", "content": msg.content})
                elif msg.role == "assistant":
                    chat_history.append({"role": "assistant", "content": msg.content})

        executor = build_agent(
            employee_email=employee.email,
            employee_name=employee.name,
        )

        result = executor.invoke({
            "input": payload.message,
            "chat_history": chat_history,
        })

        answer = result.get("output", "")
        sources = result.get("sources", [])
        steps = result.get("steps", [])

        # ── CONFLICT DETECTION – structured data only ──
        # We ignore the answer string and rely solely on intermediate_steps.
        conflict_payload = None
        intermediate = result.get("intermediate_steps", [])
        for action, observation in intermediate:
            tool_name = getattr(action, "tool", "")
            if tool_name == "apply_leave":
                if isinstance(observation, str):
                    try:
                        observation = json.loads(observation)
                    except Exception:
                        pass
                if isinstance(observation, dict) and observation.get("conflict") is True:
                    conflict_payload = {
                        "conflict": True,
                        "meetings": observation.get("meetings", []),
                        "pending_leave": observation.get("pending_leave"),
                    }
                    break

        if conflict_payload:
            from fastapi.responses import JSONResponse
            return JSONResponse(content={
                "answer": "",
                "conflict": True,
                "meetings": conflict_payload.get("meetings", []),
                "pending_leave": conflict_payload.get("pending_leave"),
                "sources": [],
                "steps": [],
            })

        # Fallback if agent returns empty (unlikely now)
        if not answer or answer.strip() == "":
            answer = "I'm sorry, I cannot answer that right now. Please try again."

        return ChatResponse(answer=answer, sources=sources, steps=steps)

    except HTTPException:
        raise
    except Exception as e:
        print(f"❌ Chat error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# ── Session endpoints (unchanged) ─────────────────────────────────────────────
# ... (keep all your existing session endpoints exactly as they are) ...