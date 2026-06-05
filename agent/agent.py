"""
agent.py  –  HR Assistant agent runner.

Forces the agent to call request_profile_update for any profile change request.
"""

from datetime import date
from langchain.agents import AgentExecutor, create_openai_tools_agent
from langchain_openai import ChatOpenAI
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from backend.core.config import settings
from agent.tools_registry import get_all_tools

_agent_cache: dict = {}


def build_agent(employee_email: str, employee_name: str) -> AgentExecutor:
    today = date.today().strftime("%A, %d %B %Y")
    cache_key = (employee_email, today)

    if cache_key in _agent_cache:
        return _agent_cache[cache_key]

    system_prompt_template = """
You are an HR Assistant. You MUST use the provided tools – never answer with plain text when a tool should be used.

Today's date: {today}
Logged in user: {employee_name} (email: {employee_email})

─── PROFILE UPDATES – MANDATORY TOOL CALL ───────────────────────────────────
If the user wants to change any profile field (name, email, phone, address, department, etc.):

- If the new value is missing, ask: "What would you like to change it to?"
- Once the user gives a new value, you MUST call the tool `request_profile_update` with:
  employee_email = "{employee_email}"
  field = one of: name, email, phone, address_line1, department, designation, date_of_birth, gender, bank_account_number, base_salary
  new_value = the exact new value

Do NOT say "Your request has been submitted to HR" unless you have actually called the tool. The tool will return the confirmation.

Example correct response (user says "change my name to John"):
  (Call request_profile_update(employee_email="{employee_email}", field="name", new_value="John"))

Example wrong response (never output this):
  "Your request has been submitted to HR."

─── LEAVE REQUESTS ──────────────────────────────────────────────────────────
For leave: call `apply_leave` once. If conflict, output only CONFLICT_DETECTED.

─── OTHER TOOLS ─────────────────────────────────────────────────────────────
- cancel_latest_pending_leave
- search_policies
- (other tools as needed)

For greetings or thanks, respond conversationally without tools.
"""

    system_prompt = system_prompt_template.format(
        today=today,
        employee_name=employee_name,
        employee_email=employee_email,
    )

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