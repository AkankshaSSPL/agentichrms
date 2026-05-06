from fastapi import APIRouter, HTTPException, Depends, Request
from pydantic import BaseModel
from typing import List, Optional
from sqlalchemy.orm import Session
from backend.database.session import SessionLocal
from backend.database.models import ChatSession, ChatMessage, Employee, User
from backend.core.security import verify_token
from tools.retrieval import search_policies
from agent.agent import build_agent
from langchain_core.messages import HumanMessage, AIMessage

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

        # ── Load conversation history from database (using session_id) ──
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

        # ── Build agent (already scoped to employee) ──
        executor = build_agent(
            employee_email=employee.email,
            employee_name=employee.name,
        )

        # ── Invoke with the full history + current message ──
        result = executor.invoke({
            "input": payload.message,
            "chat_history": chat_history,   # now properly loaded from DB
        })

        answer = result.get("output", "")
        sources = result.get("sources", [])
        steps = result.get("steps", [])

        # ── Conflict intercept ─────────────────────────────────────────────────
        # Agent outputs "CONFLICT_DETECTED" when apply_leave finds a meeting clash.
        # We extract the full conflict payload from intermediate steps and return
        # it as structured JSON so the frontend popup fires — no text in chat.
        if answer and "CONFLICT_DETECTED" in answer.strip():
            import json
            meetings = []
            pending_leave = None
            intermediate = result.get("intermediate_steps", [])
            for action, observation in intermediate:
                tool_name = getattr(action, "tool", "")
                if tool_name == "apply_leave":
                    if isinstance(observation, str):
                        try:
                            observation = json.loads(observation)
                        except Exception:
                            pass
                    if isinstance(observation, dict) and observation.get("conflict"):
                        meetings = observation.get("meetings", [])
                        pending_leave = observation.get("pending_leave")
                        break
            from fastapi.responses import JSONResponse
            return JSONResponse(content={
                "answer": "",
                "conflict": True,
                "meetings": meetings,
                "pending_leave": pending_leave,
                "sources": [],
                "steps": [],
            })
        # ── End conflict intercept ─────────────────────────────────────────────

        # Fallback if agent returns empty
        if not answer or answer.strip() == "":
            print("⚠️ Agent returned empty – falling back to search_policies")
            direct_result = search_policies(payload.message)
            answer = direct_result.get("answer", "No response from policies.")
            sources = direct_result.get("sources", [])
            answer = f"[Direct from policies]\n\n{answer}"

        return ChatResponse(answer=answer, sources=sources, steps=steps)

    except HTTPException:
        raise
    except Exception as e:
        print(f"❌ Chat error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# ── Session endpoints ─────────────────────────────────────────────────────────
class SessionTitleUpdate(BaseModel):
    title: str

class PinSessionRequest(BaseModel):
    is_pinned: bool

class SessionResponse(BaseModel):
    id: int
    title: str
    created_at: str
    is_pinned: bool = False

class MessageResponse(BaseModel):
    id: int
    role: str
    content: str
    created_at: str

@router.get("/sessions")
def get_sessions(request: Request, db: Session = Depends(get_db)):
    employee = get_current_employee(request, db)
    user = db.query(User).filter(User.employee_id == employee.id).first()
    if not user:
        raise HTTPException(404, "User not found")
    sessions = db.query(ChatSession).filter(ChatSession.user_id == user.id).all()
    return [
        SessionResponse(
            id=s.id,
            title=s.title or "New Chat",
            created_at=s.created_at.isoformat(),
            is_pinned=s.is_pinned if hasattr(s, 'is_pinned') else False
        )
        for s in sessions
    ]

@router.post("/sessions")
def create_session(request: Request, db: Session = Depends(get_db)):
    employee = get_current_employee(request, db)
    user = db.query(User).filter(User.employee_id == employee.id).first()
    if not user:
        raise HTTPException(404, "User not found")
    new_session = ChatSession(user_id=user.id, title="New Chat")
    db.add(new_session)
    db.commit()
    db.refresh(new_session)
    return {
        "id": new_session.id,
        "title": new_session.title,
        "created_at": new_session.created_at.isoformat(),
        "is_pinned": False
    }

@router.patch("/sessions/{session_id}/title")
def update_session_title(
    session_id: int,
    payload: SessionTitleUpdate,
    request: Request,
    db: Session = Depends(get_db),
):
    employee = get_current_employee(request, db)
    user = db.query(User).filter(User.employee_id == employee.id).first()
    if not user:
        raise HTTPException(404, "User not found")
    session = db.query(ChatSession).filter(
        ChatSession.id == session_id,
        ChatSession.user_id == user.id,
    ).first()
    if not session:
        raise HTTPException(404, "Session not found")
    session.title = payload.title[:80]
    db.commit()
    return {"id": session.id, "title": session.title}

@router.patch("/sessions/{session_id}/pin")
def set_pin(
    session_id: int,
    payload: PinSessionRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    employee = get_current_employee(request, db)
    user = db.query(User).filter(User.employee_id == employee.id).first()
    if not user:
        raise HTTPException(404, "User not found")
    session = db.query(ChatSession).filter(
        ChatSession.id == session_id,
        ChatSession.user_id == user.id,
    ).first()
    if not session:
        raise HTTPException(404, "Session not found")
    session.is_pinned = payload.is_pinned
    db.commit()
    return {"id": session.id, "is_pinned": session.is_pinned}

@router.delete("/sessions/{session_id}")
def delete_session(
    session_id: int,
    request: Request,
    db: Session = Depends(get_db),
):
    employee = get_current_employee(request, db)
    user = db.query(User).filter(User.employee_id == employee.id).first()
    if not user:
        raise HTTPException(404, "User not found")
    session = db.query(ChatSession).filter(
        ChatSession.id == session_id,
        ChatSession.user_id == user.id,
    ).first()
    if not session:
        raise HTTPException(404, "Session not found")
    db.delete(session)
    db.commit()
    return {"success": True}

@router.get("/sessions/{session_id}/messages")
def get_messages(
    session_id: int,
    request: Request,
    db: Session = Depends(get_db),
):
    employee = get_current_employee(request, db)
    user = db.query(User).filter(User.employee_id == employee.id).first()
    if not user:
        raise HTTPException(404, "User not found")
    session = db.query(ChatSession).filter(
        ChatSession.id == session_id,
        ChatSession.user_id == user.id,
    ).first()
    if not session:
        raise HTTPException(404, "Session not found")
    msgs = db.query(ChatMessage).filter(ChatMessage.session_id == session_id).order_by(ChatMessage.created_at).all()
    return [
        MessageResponse(
            id=m.id,
            role=m.role,
            content=m.content,
            created_at=m.created_at.isoformat(),
        )
        for m in msgs
    ]

@router.post("/sessions/{session_id}/messages")
async def save_message(
    session_id: int,
    request: Request,
    db: Session = Depends(get_db),
):
    data = await request.json()
    role = data.get("role")
    content = data.get("content")
    if not role or not content:
        raise HTTPException(400, "Missing role or content")
    session = db.query(ChatSession).filter(ChatSession.id == session_id).first()
    if not session:
        raise HTTPException(404, "Session not found")
    new_msg = ChatMessage(session_id=session_id, role=role, content=content)
    db.add(new_msg)
    db.commit()
    return {"success": True}