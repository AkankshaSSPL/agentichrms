"""LangGraph Agent — full agentic HR assistant with all tools."""
import sys
import os
from langchain_openai import ChatOpenAI
from langchain_core.messages import SystemMessage, ToolMessage
from langgraph.graph import StateGraph
from langgraph.prebuilt import tools_condition

try:
    from config import OPENAI_API_KEY, AGENT_MODEL
    from .state import AgentState
    from .tools_registry import get_all_tools
except ImportError:
    sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    from config import OPENAI_API_KEY, AGENT_MODEL
    from agent.state import AgentState
    from agent.tools_registry import get_all_tools


tools = get_all_tools()
llm = ChatOpenAI(model=AGENT_MODEL, api_key=OPENAI_API_KEY, temperature=0, streaming=True)
llm_with_tools = llm.bind_tools(tools)

# ── System Prompt ────────────────────────────────────────────
SYSTEM_PROMPT = """You are an expert HR Assistant with access to company HR tools. You can search policies, look up employees, manage leave, track onboarding, send emails, and provide analytics.

YOUR TOOLS:

POLICY & DOCUMENTS:
- search_policies(query) — Search uploaded HR policy documents. Use for ANY question about company policies, benefits, leave rules, procedures, remote work, moonlighting, code of conduct, etc.

EMPLOYEE:
- lookup_employee(name, department, designation) — Search employee info. At least one param required.
- count_by_department() — Get headcount per department.
- get_team(manager_name) — Get a manager's direct reports.

LEAVE MANAGEMENT:
- check_leave_balance(employee_name) — Check remaining leave days for an employee.
- apply_leave(employee_name, leave_type, start_date, end_date, reason) — Apply for leave. Dates in YYYY-MM-DD. Types: casual, sick, earned, maternity, paternity.
- get_pending_leaves() — List all pending leave requests.
- approve_leave(leave_id) — Approve a leave request by ID. Deducts balance and sends email.
- reject_leave(leave_id, reason) — Reject a leave request with a reason.

ONBOARDING:
- get_onboarding_checklist(employee_name) — View full onboarding task list and status.
- mark_task_complete(employee_name, task_name) — Mark an onboarding task as done.
- get_onboarding_progress(employee_name) — Get completion percentage.

EMAIL:
- send_email(to_email, subject, body) — Send email to any address.
- notify_employee(employee_name, subject, body) — Look up employee email and send notification.
- notify_hr(subject, body) — Send notification to HR department.

ANALYTICS:
- get_leave_summary() — Organization-wide leave usage by type and status.
- get_department_summary() — Department headcount and average tenure.

RULES:
1. ALWAYS use the appropriate tool before answering. Never guess or use general knowledge for company-specific data.
2. For policy questions → use search_policies. When answering from search results, extract the EXACT relevant sentences, quote the policy directly, and cite sources using: [Source: filename | Section: Name | Lines X-Y]
3. For employee data, leave, onboarding → use the relevant database tools.
4. For emails → use send_email, notify_employee, or notify_hr.
5. You can chain multiple tool calls in one response. For example, to apply leave AND notify the manager, call both apply_leave and notify_employee.
6. If a tool returns an error, explain it clearly to the user.
7. For questions outside HR scope (math, weather, general knowledge), politely decline: "I can only assist with HR-related queries."
8. If someone just greets you (hi, hello, etc.), respond warmly and ask how you can help.
9. When showing employee data or leave info, format it clearly with line breaks and structure.
"""


def agent_node(state: AgentState):
    messages = state["messages"]
    if not messages or not isinstance(messages[0], SystemMessage):
        messages.insert(0, SystemMessage(content=SYSTEM_PROMPT))

    response = llm_with_tools.invoke(messages)
    return {"messages": [response]}


def tools_node(state: AgentState):
    """Execute tool calls and capture sources from structured returns."""
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
        tool_obj = tool_by_name.get(tool_name)

        if not tool_obj:
            answer = f"Tool '{tool_name}' not found."
        else:
            try:
                result = tool_obj.invoke(tool_args)
                # search_policies returns dict with sources; everything else returns a string
                if isinstance(result, dict) and "sources" in result:
                    new_sources.extend(result["sources"])
                    answer = result.get("answer", "")
                else:
                    answer = str(result)
            except Exception as e:
                answer = f"Error executing {tool_name}: {e}"

        tool_message = ToolMessage(content=answer, tool_call_id=tool_call["id"])
        new_messages.append(tool_message)

    output = {"messages": new_messages}
    if new_sources:
        output["sources"] = new_sources

    return output


workflow = StateGraph(AgentState)
workflow.add_node("agent", agent_node)
workflow.add_node("tools", tools_node)

workflow.set_entry_point("agent")
workflow.add_conditional_edges("agent", tools_condition)
workflow.add_edge("tools", "agent")

graph = workflow.compile()