"""
agent.py  —  HR Assistant agent runner.

Forces the agent to call request_profile_update for any profile change request.

EXECUTOR LIFECYCLE
──────────────────
AgentExecutor is stateless (tools hold no per-request state) so it is safe to
cache for the duration of one calendar day per user.  The previous cache used a
plain dict that grew without bound; this version caps it at MAX_CACHE_SIZE
entries and evicts the oldest entry when the cap is hit.

The cache key is (employee_email, date_string).  A new day or a server restart
produces a fresh executor, which is correct — the system prompt embeds today's
date.  Role changes take effect on the next API call through the DB-read in the
permission layer; the agent prompt itself does not encode the role.
"""

from collections import OrderedDict
from datetime import date
from langchain.agents import AgentExecutor, create_openai_tools_agent
from langchain_openai import ChatOpenAI
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from backend.core.config import settings
from agent.tools_registry import get_all_tools

# LRU-style bounded cache: evicts oldest when full.
MAX_CACHE_SIZE = 200
_agent_cache: OrderedDict = OrderedDict()


def build_agent(employee_email: str, employee_name: str) -> AgentExecutor:
    today = date.today().strftime("%A, %d %B %Y")
    cache_key = (employee_email, today)

    if cache_key in _agent_cache:
        # Move to end so it counts as recently used
        _agent_cache.move_to_end(cache_key)
        return _agent_cache[cache_key]

    system_prompt_template = """
You are an HR Assistant. You MUST use the provided tools – never answer with plain text when a tool should be used.

Today's date: {today}
Logged in user: {employee_name} (email: {employee_email})

─── PROFILE UPDATES – MANDATORY TOOL CALL ───────────────────────────────────
If the user wants to change any profile field, you MUST call `request_profile_update`.
NEVER say "contact HR" or "I cannot modify that" — the tool handles routing automatically.

Fields the employee can update DIRECTLY (no HR approval needed):
  phone, phone_country_code,
  address_line1, address_line2, city, state, country,
  emergency_contact_name, emergency_contact_phone, emergency_contact_relation,
  bank_name, bank_branch, account_holder_name,
  date_of_birth, gender

Fields that go to HR for approval (tool submits the request automatically):
  name, email, department, designation, manager_id, employment_type,
  bank_account_number, base_salary, status, role_id

Rules:
- If the new value is missing, ask: "What would you like to change it to?"
- Once the user gives a new value, call `request_profile_update` with:
    employee_email = "{employee_email}"
    field          = the exact field name from the lists above
    new_value      = the exact new value the user provided
- Do NOT say "Your request has been submitted" unless you have actually called the tool.
- Do NOT tell the user to contact HR — just call the tool and let it handle it.

Examples:
  User: "change my emergency contact name to Niki"
  → Call request_profile_update(employee_email="{employee_email}", field="emergency_contact_name", new_value="Niki")

  User: "update my city to Pune"
  → Call request_profile_update(employee_email="{employee_email}", field="city", new_value="Pune")

  User: "change my name to John Smith"
  → Call request_profile_update(employee_email="{employee_email}", field="name", new_value="John Smith")
  (This goes to HR approval automatically — the tool handles it.)"

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

    # Evict oldest entry if at capacity
    if len(_agent_cache) >= MAX_CACHE_SIZE:
        _agent_cache.popitem(last=False)

    _agent_cache[cache_key] = executor
    return executor