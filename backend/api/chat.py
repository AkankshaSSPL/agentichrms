from fastapi import APIRouter, HTTPException, Depends, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import List, Optional
from sqlalchemy.orm import Session
from datetime import datetime
from backend.database.session import SessionLocal
from backend.database.models import ChatSession, ChatMessage, Employee, User, Notification, NameChangeRequest, Role
from backend.core.security import verify_token
from agent.agent import build_agent
import json, re

router = APIRouter(prefix="/chat", tags=["Chat"])

# ── Keywords for name change detection ──
NAME_CHANGE_KEYWORDS = [
    "change my name", "update my name", "new name", "got married",
    "i got married", "after marriage", "legal name", "name change",
    "married name", "changed my name", "my name is now", "rename me"
]

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

# ── Helper: extract new name and reason from user message ──
def extract_name_change_info(user_message: str, current_name: str) -> tuple:
    """Returns (new_name, reason) or (None, None) if not found."""
    msg_lower = user_message.lower()
    if not any(kw in msg_lower for kw in NAME_CHANGE_KEYWORDS):
        return None, None

    # Extract new name: look for "my name is X", "new name X", or standalone capitalized name
    new_name = None
    # Only extract name if explicitly stated with a clear pattern
    m = re.search(
        r"(?:my name is|new name is?|change.*?to|update.*?to|call me|rename me to|name.*?(?:is|to|be))\s+([A-Z][a-zA-Z]+(?: [A-Z][a-zA-Z]+)+)",
        user_message, re.IGNORECASE
    )
    if m:
        new_name = m.group(1).strip()
    if not new_name or new_name.lower() == current_name.lower():
        return None, None

    # Extract reason
    reason = "marriage"
    for kw in ["marriage", "married", "legal", "correction", "divorce"]:
        if kw in msg_lower:
            reason = kw
            break
    return new_name, reason

# ── Helper: create name change request ──
def create_name_change_request(employee: Employee, new_name: str, reason: str, db: Session):
    # Check for duplicate pending
    existing = db.query(NameChangeRequest).filter(
        NameChangeRequest.employee_id == employee.id,
        NameChangeRequest.status.in_(["pending", "awaiting_document"])
    ).first()
    if existing:
        return None

    ncr = NameChangeRequest(
        employee_id=employee.id,
        old_name=employee.name,
        new_name=new_name,
        reason=reason,
        document_provided=False,
        status="pending",
    )
    db.add(ncr)
    db.commit()
    db.refresh(ncr)

    # Notify all HR/admins
    try:
        hr_roles = db.query(Role).filter(Role.name.in_(["hr", "admin"])).all()
        hr_ids = [r.id for r in hr_roles]
        hr_employees = db.query(Employee).filter(Employee.role_id.in_(hr_ids)).all()
        for hr in hr_employees:
            db.add(Notification(
                employee_id=hr.id,
                title="📝 Name Change Request",
                message=f"{employee.name} has requested a name change to '{new_name}'. Reason: {reason}. No document yet.",
                is_read=False,
                created_at=datetime.utcnow(),
            ))
        db.commit()
    except Exception as e:
        print(f"HR notification failed: {e}")
        db.rollback()

    return ncr

@router.post("/", response_model=ChatResponse)
async def chat_endpoint(payload: ChatRequest, request: Request, db: Session = Depends(get_db)):
    try:
        employee = get_current_employee(request, db)

        # ── NAME CHANGE DETECTION (from user message, before agent) ──
        new_name, reason = extract_name_change_info(payload.message, employee.name)
        if new_name:
            ncr = create_name_change_request(employee, new_name, reason, db)
            reply_name = str(new_name).replace('{', '(').replace('}', ')')
            old_name = str(employee.name).replace('{', '(').replace('}', ')')
            if ncr:
                answer = f"Your request to change your name from {old_name} to {reply_name} has been submitted to HR for approval. They will review it and notify you."
                return JSONResponse(content={
                    "answer": answer,
                    "name_change_request": {
                        "id": ncr.id,
                        "old_name": old_name,
                        "new_name": reply_name,
                        "reason": reason,
                        "status": "pending",
                    },
                    "sources": [],
                    "steps": [],
                })
            else:
                return JSONResponse(content={
                    "answer": "You already have a pending name change request. HR will review it shortly.",
                    "sources": [],
                    "steps": [],
                })

        # Normal chat flow with agent
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

        # Sanitize to prevent LangChain template injection from any DB value
        safe_name = str(employee.name).replace('{', '(').replace('}', ')')

        # Sanitize chat history — escape any { } in message content so
        # LangChain's ChatPromptTemplate doesn't treat them as variables
        def sanitize(text: str) -> str:
            return text.replace('{', '{{').replace('}', '}}')

        safe_history = [
            {"role": m["role"], "content": sanitize(m["content"])}
            for m in chat_history
        ]

        executor = build_agent(
            employee_email=employee.email,
            employee_name=safe_name,
        )

        result = executor.invoke({
            "input": payload.message,
            "chat_history": safe_history,
        })

        answer = result.get("output", "")
        sources = result.get("sources", [])
        steps = result.get("steps", [])

        # Conflict detection (leave request)
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

        return ChatResponse(answer=answer, sources=sources, steps=steps)

    except HTTPException:
        raise
    except Exception as e:
        print(f"❌ Chat error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# ── Session endpoints (keep your existing ones unchanged) ──
# ... (copy your existing session endpoints here)