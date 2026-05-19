"""
agent.py  –  HR Assistant agent runner.

KEY CHANGE: The logged-in employee's email is injected into the system prompt
and prepended to every tool call that needs it, so the agent NEVER asks the
user for their name.
"""

from langchain.agents import AgentExecutor, create_openai_tools_agent
from langchain_openai import ChatOpenAI
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from backend.core.config import settings
from agent.tools_registry import get_all_tools


def build_agent(employee_email: str, employee_name: str) -> AgentExecutor:
    from datetime import date
    today = date.today().strftime("%A, %d %B %Y")  # e.g. Wednesday, 06 May 2026
    """
    Build an agent executor scoped to the currently logged-in employee.

    Args:
        employee_email: Email pulled from the active auth session.
        employee_name: Display name pulled from the active auth session.

    The system prompt embeds these so the LLM always passes them to tools that
    accept `employee_email`, avoiding any need to ask the user who they are.
    """

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

RULE 3 — CONFLICT RESPONSE:
  - If `apply_leave` returns conflict=True → your ONLY output must be the single word: CONFLICT_DETECTED
  - If `apply_leave` returns conflict=False → NEVER output "CONFLICT_DETECTED". Instead, say "Your leave request has been submitted successfully." or a similar confirmation.
  - Never mention conflicts or meetings unless the tool explicitly returned conflict=True.

RULE 4 — CANCEL: To cancel leave without a leave_id, call `cancel_latest_pending_leave`.

RULE 5 — POLICY: For policy questions, call `search_policies`.

RULE 6 — TONE: Be concise, friendly, and professional for non-leave responses.

RULE 7 — NEVER RE-EXECUTE: Only act on the CURRENT message. Never repeat or re-execute
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

    agent = create_openai_tools_agent(llm, get_all_tools(), prompt)
    return AgentExecutor(agent=agent, tools=get_all_tools(), verbose=True, return_intermediate_steps=True)