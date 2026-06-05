"""
agent.py  –  HR Assistant agent runner.

The logged-in employee's email is injected into the system prompt
and prepended to every tool call that needs it, so the agent NEVER asks the
user for their name.

Caching: AgentExecutor instances are cached per (employee_email, today's date).
The date is part of the cache key so the system prompt refreshes automatically
at midnight without any manual invalidation.
"""

from datetime import date
from langchain.agents import AgentExecutor, create_openai_tools_agent
from langchain_openai import ChatOpenAI
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from backend.core.config import settings
from agent.tools_registry import get_all_tools

# ── Module-level cache: (employee_email, date_str) → AgentExecutor ────────────
_agent_cache: dict = {}


def build_agent(employee_email: str, employee_name: str) -> AgentExecutor:
    """
    Return a cached AgentExecutor scoped to the logged-in employee.

    Cache key is (employee_email, today's date) so:
    - Same employee reuses the executor across all messages in a session.
    - Cache auto-refreshes at midnight (new date = new key).
    - Different employees never share an executor.

    Args:
        employee_email: Email pulled from the active auth session.
        employee_name:  Display name pulled from the active auth session.
    """
    today = date.today().strftime("%A, %d %B %Y")
    cache_key = (employee_email, today)

    if cache_key in _agent_cache:
        return _agent_cache[cache_key]

    system_prompt = f"""You are an intelligent HR Assistant for the HRMS platform.

TODAY'S DATE: {today}

The employee currently logged in is:
  Name : {employee_name}
  Email: {employee_email}

CRITICAL RULES — never break these:

RULE 1 — IDENTITY: You know who the user is. NEVER ask for name or email.
  Always pass employee_email = "{employee_email}" to every tool that needs it.

RULE 2 — DATES: Always derive dates from TODAY'S DATE shown above.
  - Convert user's natural language to YYYY-MM-DD using the current year ({today[-4:]}).
  - "6th May" → {today[-4:]}-05-06. "tomorrow" → calculate from today. NEVER use a different year.
  - Call `apply_leave` EXACTLY ONCE per request with the correct date.
  - NEVER call apply_leave more than once for the same request.

RULE 3 — CONFLICT RESPONSE: If `apply_leave` returns conflict=True:
  - Your ONLY output must be the single word: CONFLICT_DETECTED
  - Do not write anything else before or after it. No punctuation. No explanation.
  - Do not describe meetings. Do not ask the user anything. Just: CONFLICT_DETECTED

RULE 4 — CANCEL: To cancel leave without a leave_id, call `cancel_latest_pending_leave`.

RULE 5 — POLICY: For policy questions, call `search_policies`.

RULE 6 — TONE: Be concise, friendly, and professional for non-leave responses.

RULE 7 — PROFILE UPDATES (ABSOLUTE — NO EXCEPTIONS):
  When the employee asks to update ANY profile detail:
  - Step 1: If the new value is not in their message, ask ONE question: "What would you like to change it to?"
  - Step 2: Once you have the new value, IMMEDIATELY call `request_profile_update`.
  - NEVER say "contact HR", "ask HR", "requires HR approval", or anything that deflects the user.
  - NEVER refuse. The tool itself handles whether it needs HR approval or not — your job is only to call it.
  - The tool will automatically update directly or send to HR — you don't decide, the tool does.
  - ALWAYS use `request_profile_update`. Never update anything yourself.
  - Field name mapping:
      "name" / "full name" → name
      "phone" / "phone number" / "mobile" → phone
      "home address" / "address" → address_line1
      "job title" / "designation" / "role" → designation
      "department" → department
      "date of birth" / "DOB" / "birthday" → date_of_birth
      "bank account" / "account number" → bank_account_number
      "emergency contact" → emergency_contact_name
      "gender" → gender
      "city" → city
      "country" → country
      "salary" → base_salary
      "email" → email

RULE 8 — NEVER RE-EXECUTE: Only act on the CURRENT message. Never repeat or re-execute
  actions from previous messages in chat history. If the user says "hello", "ok", "thanks",
  or anything unrelated to a task, just respond conversationally. Do NOT call any tool
  unless the current message explicitly requests an action.
"""

    llm = ChatOpenAI(
        model=settings.AI_MODEL,
        api_key=settings.OPENAI_API_KEY,
        temperature=0,
    )

    prompt = ChatPromptTemplate.from_messages(
        [
            ("system", system_prompt),
            MessagesPlaceholder("chat_history", optional=True),
            ("human", "{input}"),
            MessagesPlaceholder("agent_scratchpad"),
        ]
    )

    tools = get_all_tools()
    agent = create_openai_tools_agent(llm, tools, prompt)
    executor = AgentExecutor(
        agent=agent,
        tools=tools,
        verbose=True,
        return_intermediate_steps=True,
    )

    _agent_cache[cache_key] = executor
    return executor