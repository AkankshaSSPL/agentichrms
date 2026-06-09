from backend.enums import ChatRole
from fastapi import APIRouter, HTTPException, Depends, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import List, Optional
from sqlalchemy.orm import Session
from datetime import datetime
from backend.database.session import get_db
from backend.database.models import ChatSession, ChatMessage, Employee, User, Notification
from backend.core.security import verify_token
from agent.agent import build_agent
from langchain_core.messages import HumanMessage, AIMessage
import json, re

router = APIRouter(prefix="/chat", tags=["Chat"])

@router.get("/ping")
async def ping():
    return {"message": "pong"}


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

# ── Chat endpoint ─────────────────────────────────────────────────────────────
@router.post("/", response_model=ChatResponse)
async def chat_endpoint(payload: ChatRequest, request: Request, db: Session = Depends(get_db)):
    try:
        employee = get_current_employee(request, db)

        chat_history = []
        if payload.session_id:
            # Load last 20 messages from DB — authoritative source of truth
            db_messages = db.query(ChatMessage).filter(
                ChatMessage.session_id == payload.session_id
            ).order_by(ChatMessage.created_at).limit(20).all()
            for msg in db_messages:
                if msg.role == ChatRole.USER:
                    chat_history.append({"role": ChatRole.USER, "content": msg.content})
                elif msg.role == ChatRole.ASSISTANT:
                    chat_history.append({"role": ChatRole.ASSISTANT, "content": msg.content})
        elif payload.history:
            # Fallback: use frontend-supplied history when no session_id present
            for m in payload.history:
                role = m.get("role", "")
                if role in (ChatRole.USER, ChatRole.ASSISTANT):
                    chat_history.append({"role": role, "content": m.get("content", "")})

        safe_name = str(employee.name).replace('{', '(').replace('}', ')')
        def sanitize(text: str) -> str:
            return text.replace('{', '{{').replace('}', '}}')

        # LangChain requires message objects — raw dicts are silently ignored,
        # which caused the agent to lose context on every turn.
        lc_history = []
        for m in chat_history:
            text = sanitize(m["content"])
            if m["role"] == ChatRole.USER:
                lc_history.append(HumanMessage(content=text))
            elif m["role"] == ChatRole.ASSISTANT:
                lc_history.append(AIMessage(content=text))

        executor = build_agent(
            employee_email=employee.email,
            employee_name=safe_name,
        )

        result = executor.invoke({
            "input": payload.message,
            "chat_history": lc_history,
        })

        answer = result.get("output", "")
        sources = result.get("sources", [])
        steps = result.get("steps", [])

        # Conflict detection
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
            return JSONResponse(content={
                "answer": "",
                "conflict": True,
                "meetings": conflict_payload.get("meetings", []),
                "pending_leave": conflict_payload.get("pending_leave"),
                "sources": [],
                "steps": [],
            })

        if not answer or answer.strip() == "":
            answer = "I'm sorry, I cannot answer that right now. Please try again."

        # Save messages if session exists
        if payload.session_id:
            user_msg = ChatMessage(session_id=payload.session_id, role=ChatRole.USER, content=payload.message)
            db.add(user_msg)
            assistant_msg = ChatMessage(session_id=payload.session_id, role=ChatRole.ASSISTANT, content=answer)
            db.add(assistant_msg)
            db.commit()

        return ChatResponse(answer=answer, sources=sources, steps=steps)

    except HTTPException:
        raise
    except Exception as e:
        print(f"❌ Chat error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# ── Session management endpoints (matching your model) ──────────────────────
@router.get("/sessions")
def list_sessions(request: Request, db: Session = Depends(get_db)):
    employee = get_current_employee(request, db)
    user = db.query(User).filter(User.employee_id == employee.id).first()
    if not user:
        raise HTTPException(404, "User not found")
    sessions = db.query(ChatSession).filter(
        ChatSession.user_id == user.id,
        ChatSession.deleted_at.is_(None)  # soft delete filter
    ).order_by(ChatSession.is_pinned.desc(), ChatSession.created_at.desc()).all()
    return [
        {
            "id": s.id,
            "title": s.session_title,       # use session_title, not title
            "is_pinned": s.is_pinned,
            "created_at": s.created_at,
        }
        for s in sessions
    ]

@router.post("/sessions")
def create_session(request: Request, db: Session = Depends(get_db)):
    employee = get_current_employee(request, db)
    user = db.query(User).filter(User.employee_id == employee.id).first()
    if not user:
        raise HTTPException(404, "User not found")
    new_session = ChatSession(
        user_id=user.id,
        session_title="New Chat",
        is_active=True,
        is_pinned=False,
    )
    db.add(new_session)
    db.commit()
    db.refresh(new_session)
    return {
        "id": new_session.id,
        "title": new_session.session_title,
        "is_pinned": new_session.is_pinned,
        "created_at": new_session.created_at,
    }

@router.get("/sessions/{session_id}/messages")
def get_session_messages(session_id: int, request: Request, db: Session = Depends(get_db)):
    employee = get_current_employee(request, db)
    user = db.query(User).filter(User.employee_id == employee.id).first()
    if not user:
        raise HTTPException(404, "User not found")
    session = db.query(ChatSession).filter(
        ChatSession.id == session_id,
        ChatSession.user_id == user.id,
        ChatSession.deleted_at.is_(None)
    ).first()
    if not session:
        raise HTTPException(404, "Session not found")
    messages = db.query(ChatMessage).filter(
        ChatMessage.session_id == session_id
    ).order_by(ChatMessage.created_at).all()
    return [
        {"role": m.role, "content": m.content, "created_at": m.created_at}
        for m in messages
    ]

@router.patch("/sessions/{session_id}/title")
def update_session_title(session_id: int, payload: dict, request: Request, db: Session = Depends(get_db)):
    employee = get_current_employee(request, db)
    user = db.query(User).filter(User.employee_id == employee.id).first()
    if not user:
        raise HTTPException(404, "User not found")
    session = db.query(ChatSession).filter(
        ChatSession.id == session_id,
        ChatSession.user_id == user.id,
        ChatSession.deleted_at.is_(None)
    ).first()
    if not session:
        raise HTTPException(404, "Session not found")
    new_title = payload.get("title")
    if new_title:
        session.session_title = new_title[:60]
        db.commit()
    return {"title": session.session_title}

@router.patch("/sessions/{session_id}/pin")
def toggle_pin_session(session_id: int, payload: dict, request: Request, db: Session = Depends(get_db)):
    employee = get_current_employee(request, db)
    user = db.query(User).filter(User.employee_id == employee.id).first()
    if not user:
        raise HTTPException(404, "User not found")
    session = db.query(ChatSession).filter(
        ChatSession.id == session_id,
        ChatSession.user_id == user.id,
        ChatSession.deleted_at.is_(None)
    ).first()
    if not session:
        raise HTTPException(404, "Session not found")
    is_pinned = payload.get("is_pinned", False)
    session.is_pinned = is_pinned
    db.commit()
    return {"is_pinned": session.is_pinned}

@router.delete("/sessions/{session_id}")
def delete_session(session_id: int, request: Request, db: Session = Depends(get_db)):
    employee = get_current_employee(request, db)
    user = db.query(User).filter(User.employee_id == employee.id).first()
    if not user:
        raise HTTPException(404, "User not found")
    session = db.query(ChatSession).filter(
        ChatSession.id == session_id,
        ChatSession.user_id == user.id,
        ChatSession.deleted_at.is_(None)
    ).first()
    if not session:
        raise HTTPException(404, "Session not found")
    # Soft delete
    session.deleted_at = datetime.utcnow()
    db.commit()
    return {"message": "Session deleted"}