"""LangGraph Agent — full agentic HR assistant with intelligent routing."""
import sys
import os
import logging
from langchain_openai import ChatOpenAI
from langchain_core.messages import SystemMessage, ToolMessage, HumanMessage, AIMessage
from langgraph.graph import StateGraph, END

logger = logging.getLogger(__name__)

try:
    from config import OPENAI_API_KEY, AGENT_MODEL
    from .state import AgentState
    from .tools_registry import get_all_tools
except ImportError:
    sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    from config import OPENAI_API_KEY, AGENT_MODEL
    from agent.state import AgentState
    from agent.tools_registry import get_all_tools

# Initialize tools and LLM
tools = get_all_tools()

# GAP-008 FIX: Removed the print(f"✅ Loaded tools: ...") debug statement
# that ran on every import. Tool count is now logged at DEBUG level so it
# only appears when the log level is explicitly set to DEBUG.
logger.debug("Loaded %d tools: %s", len(tools), [t.name for t in tools])

llm = ChatOpenAI(model=AGENT_MODEL, api_key=OPENAI_API_KEY, temperature=0, streaming=True)
llm_with_tools = llm.bind_tools(tools, tool_choice="auto")


def get_tool_descriptions() -> str:
    """Generate formatted tool descriptions for the system prompt."""
    descriptions = []
    for tool in tools:
        params = ""
        if hasattr(tool, "args_schema") and tool.args_schema:
            # GAP-049 FIX: Replace bare `except: pass` with a specific except
            # that logs a warning. Previously any error in schema parsing was
            # silently swallowed, hiding bugs in tool definitions and causing
            # the system prompt to omit parameter info without any indication.
            try:
                schema = tool.args_schema.schema()
                props = schema.get("properties", {})
                if props:
                    param_list = [
                        f"{k}: {v.get('type', 'any')}" for k, v in props.items()
                    ]
                    params = f" | Parameters: {', '.join(param_list)}"
            except Exception as exc:
                logger.warning(
                    "Could not read args_schema for tool '%s': %s", tool.name, exc
                )

        descriptions.append(f"- {tool.name}: {tool.description}{params}")
    return "\n".join(descriptions)


# ── System Prompt ─────────────────────────────────────────────────────────────
SYSTEM_PROMPT = """You are an HR Assistant for this company. You have access to the company's HR documents, employee database, and leave management system.

AVAILABLE TOOLS:
{tool_descriptions}

## DECISION RULES — follow in this exact order:

### STEP 1 — Check for a specific HR action tool first
Use the specific tool if the query is clearly one of these actions:

- **Look up an employee by name/department** → `lookup_employee`
- **Check someone's leave balance** → `check_leave_balance`
- **Apply for leave** → `apply_leave`
- **Approve a leave request** → `approve_leave`
- **Reject a leave request** → `reject_leave`
- **Get onboarding checklist or progress** → `get_onboarding_checklist` / `get_onboarding_progress`
- **Mark an onboarding task done** → `mark_task_complete`
- **Send an email or notification** — choose the right tool:
  - If a PERSON'S NAME is mentioned → `notify_employee(employee_name, subject, body)`
    - Triggers: "send mail to [name]", "email [name]", "notify [name]", "send [any type] mail to [name]"
    - Examples: "send onboarding mail to Rahul", "send leave mail to Priya", "email Amit about his salary"
    - This tool looks up the email from the database automatically — NEVER ask for an email address
    - If subject/body are missing, ask once then call the tool immediately
  - If an EMAIL ADDRESS like someone@domain.com is given → `send_email(to_email, subject, body)`
  - If the user wants to contact HR department → `notify_hr(subject, body)`
  - ⚠️ KEY RULE: ANY message containing "send mail", "send email", "notify", "email" + a person's name = `notify_employee`. Do NOT route to search_policies or any other tool.
- **Department headcount or leave stats** → `count_by_department` / `get_leave_summary` / `get_department_summary`

### STEP 2 — For EVERYTHING ELSE, use `search_policies`
If the query is NOT one of the specific actions above, ALWAYS call `search_policies`.

This includes ANY question about:
- Company policies, rules, procedures, guidelines, handbooks
- Legal/contractual terms in employment documents (covenants, NDA, confidentiality, non-compete, return of materials, intellectual property, indemnification)
- Leave types, maternity, paternity, sick leave, earned leave
- Remote work, WFH, office timings, dress code
- Salary, payroll, increments, appraisals, bonus, benefits, insurance
- Holidays, public holidays, festival holidays
- Onboarding process, training, probation
- Resignation, notice period, termination, exit process
- Code of conduct, ethics, harassment, grievance, whistle blower
- Travel, expenses, reimbursements
- IT assets, VPN, laptop, software usage
- Data protection, privacy, GDPR
- ANY term or clause found in a company document
- ANY question starting with "what is", "explain", "tell me about", "how does", "what are the rules for", "what does the policy say about"

### STEP 3 — Decline ONLY for clearly non-work topics
ONLY decline if the query is completely unrelated to any employment or company matter:
- Pure mathematics (e.g. "what is 15% of 340")
- Weather, sports scores, stock prices, cooking recipes, movie recommendations
- Personal advice unrelated to work

**NEVER decline** a query just because you don't recognise the specific term. If it could be in a company document, search for it.

## EMAIL EXECUTION RULES — critical, follow exactly:
1. When the user says "send [any] mail to [name]" — call `notify_employee` immediately with whatever subject/body you can infer from context.
2. If subject or body is missing, ask for BOTH in ONE single message: "Please provide the subject and body of the email."
3. As soon as the user provides subject and body — call the tool IMMEDIATELY. Do NOT ask any follow-up questions.
4. Never ask for the same information twice. Never loop.
5. If the user says "subject: X body: Y" in any format — extract X as subject and Y as body and call the tool right away.
6. When sending to an email address: call `send_email(to_email, subject, body)` immediately once you have all three values.

## RESPONSE FORMAT:
- Use the tool result to answer — do not add information from your own knowledge
- If search_policies returns no results, say: "I couldn't find information about this in the company documents. Please contact HR directly."
- Do NOT say "I can only assist with HR queries" when the user is asking about something that might be in a company document
- Format answers clearly with bullet points where appropriate
"""


def agent_node(state: AgentState):
    """Agent decides which tool to use based on query context."""
    messages = state["messages"]

    # Prepend system prompt if not already present
    if not messages or not isinstance(messages[0], SystemMessage):
        tool_desc = get_tool_descriptions()
        full_prompt = SYSTEM_PROMPT.format(tool_descriptions=tool_desc)
        messages.insert(0, SystemMessage(content=full_prompt))

    response = llm_with_tools.invoke(messages)

    # GAP-008 FIX: Removed the print() debug statements for tool calls and
    # direct responses. Replaced with logger.debug() so they only appear
    # when DEBUG logging is enabled — never in normal production output.
    if hasattr(response, "tool_calls") and response.tool_calls:
        logger.debug("Tool calls selected: %s", [tc["name"] for tc in response.tool_calls])
    else:
        logger.debug("Direct response (no tool calls)")

    return {"messages": [response]}


def tools_node(state: AgentState):
    """Execute tool calls and collect any RAG sources."""
    last_message = state["messages"][-1]

    if not hasattr(last_message, "tool_calls") or not last_message.tool_calls:
        return {"messages": []}

    tool_calls = last_message.tool_calls
    tool_by_name = {t.name: t for t in tools}

    new_messages = []
    new_sources = []

    for tool_call in tool_calls:
        tool_name = tool_call["name"]
        tool_args = tool_call["args"]
        tool_id = tool_call["id"]

        # GAP-008 FIX: Removed print() debug statement — replaced with logger.debug()
        logger.debug("Executing: %s(%s)", tool_name, tool_args)

        tool_obj = tool_by_name.get(tool_name)

        if not tool_obj:
            answer = f"Error: Tool '{tool_name}' not found."
        else:
            try:
                result = tool_obj.invoke(tool_args)
                if isinstance(result, dict):
                    answer = result.get("answer", str(result))
                    if "sources" in result:
                        new_sources.extend(result["sources"])
                else:
                    answer = str(result)
            except Exception as e:
                logger.exception("Error executing tool '%s'", tool_name)
                answer = f"Error in {tool_name}: {str(e)}"

        new_messages.append(ToolMessage(content=answer, tool_call_id=tool_id))

    output = {"messages": new_messages}
    if new_sources:
        output["sources"] = new_sources

    return output


def route_logic(state: AgentState):
    """Route back to tools if the LLM made tool calls, otherwise end."""
    last_message = state["messages"][-1]
    if hasattr(last_message, "tool_calls") and last_message.tool_calls:
        return "tools"
    return END


# ── Build graph ───────────────────────────────────────────────────────────────
workflow = StateGraph(AgentState)
workflow.add_node("agent", agent_node)
workflow.add_node("tools", tools_node)

workflow.set_entry_point("agent")
workflow.add_conditional_edges("agent", route_logic, {"tools": "tools", END: END})
workflow.add_edge("tools", "agent")

# Compile
graph = workflow.compile()

# GAP-008 FIX: The entire diagnostic block that was appended at the bottom
# (re-importing get_all_tools, reprinting all tool names, overwriting the
# module-level `tools` variable) has been removed. It ran on every import,
# doubled tool-initialization time, polluted stdout in production, and