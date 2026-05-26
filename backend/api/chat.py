from fastapi import APIRouter, HTTPException, Depends, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import List, Optional
from sqlalchemy.orm import Session
from datetime import datetime
from backend.database.session import SessionLocal
from backend.database.models import ChatSession, ChatMessage, Employee, User, Notification, NameChangeRequest
from backend.core.security import verify_token
from agent.agent import build_agent
import json, re

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
            return JSONResponse(content={
                "answer": "",
                "conflict": True,
                "meetings": conflict_payload.get("meetings", []),
                "pending_leave": conflict_payload.get("pending_leave"),
                "sources": [],
                "steps": [],
            })

        # ── NAME CHANGE INTENT detection ─────────────────────────────────────
        nc_match = re.search(r'NAME_CHANGE_INTENT:\s*(\{.*?\})', answer, re.DOTALL)
        if nc_match:
            try:
                nc_data = json.loads(nc_match.group(1))
                new_name = nc_data.get("new_name", "").strip()
                reason   = nc_data.get("reason", "other").strip()

                if new_name:
                    # Create the NameChangeRequest record directly
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

                    # Notify all HR/admin
                    from backend.database.models import Role
                    try:
                        hr_emps = db.query(Employee).join(Role).filter(
                            Role.name.in_(["hr", "admin"])
                        ).all()
                        for hr in hr_emps:
                            db.add(Notification(
                                employee_id=hr.id,
                                title=" Name Change Request",
                                message=f"{employee.name} has requested a name change to '{new_name}' ({reason}). No document yet.",
                                is_read=False,
                                created_at=datetime.utcnow(),
                            ))
                        db.commit()
                    except Exception as ne:
                        print(f"⚠️ HR notify failed: {ne}")
                        db.rollback()

                    # Notify employee
                    try:
                        db.add(Notification(
                            employee_id=employee.id,
                            title=" Name Change Request Submitted",
                            message=f"Your request to change your name to '{new_name}' has been submitted to HR for review.",
                            is_read=False,
                            created_at=datetime.utcnow(),
                        ))
                        db.commit()
                    except Exception as ne:
                        print(f" Employee notify failed: {ne}")
                        db.rollback()

                    # Strip the tag from the visible answer
                    clean_answer = re.sub(r'NAME_CHANGE_INTENT:\s*\{.*?\}', '', answer, flags=re.DOTALL).strip()
                    if not clean_answer:
                        clean_answer = f"I've submitted your name change request from **{employee.name}** to **{new_name}** to HR for approval. You'll be notified once HR reviews it."

                    return JSONResponse(content={
                        "answer": clean_answer,
                        "name_change_request": {
                            "id": ncr.id,
                            "old_name": employee.name,
                            "new_name": new_name,
                            "reason": reason,
                            "status": "pending",
                        },
                        "sources": [],
                        "steps": [],
                    })
            except Exception as e:
                print(f" Name change processing error: {e}")
                # Fall through to normal answer

        # Fallback if agent returns empty (unlikely now)
        if not answer or answer.strip() == "":
            answer = "I'm sorry, I cannot answer that right now. Please try again."

        return ChatResponse(answer=answer, sources=sources, steps=steps)

    except HTTPException:
        raise
    except Exception as e:
        print(f" Chat error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# ── Session endpoints (unchanged) ─────────────────────────────────────────────
# ... (keep all your existing session endpoints exactly as they are) ...