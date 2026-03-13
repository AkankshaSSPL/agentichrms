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
SYSTEM_PROMPT = """You are an expert HR Assistant with access to specific company tools. Your job is to select and use the CORRECT tool for each query.


AVAILABLE TOOLS:
{tool_descriptions}

TOOL SELECTION GUIDE:

1️⃣ **POLICY QUESTIONS** → Use `search_policies`
   - Any question about company rules, benefits, procedures, handbooks
   - "What is...", "Explain...", "Tell me about..." + policy topics
   - Examples: leave policy, remote work rules, code of conduct, moonlighting

2️⃣ **EMPLOYEE DATA** → Use `lookup_employee`
   - Finding people, org chart info, contact details
   - "Who is...", "Find...", "Lookup...", "Details for..."
   - Examples: "Who is the head of Engineering?", "Find John Smith"

3️⃣ **LEAVE BALANCES** → Use `check_leave_balance`
   - Personal leave remaining, vacation days left
   - "How much leave...", "Check my balance...", "Remaining days..."
   - Requires: employee_name

4️⃣ **APPLY FOR LEAVE** → Use `apply_leave`
   - Submitting new leave requests
   - "Apply for...", "Request leave...", "I want to take..."
   - Requires: employee_name, leave_type, start_date, end_date, reason

5️⃣ **APPROVE/REJECT LEAVES** → Use `approve_leave` / `reject_leave`
   - Manager actions on pending requests
   - "Approve...", "Reject...", "Sign off on..."
   - Requires: leave_id

6️⃣ **ONBOARDING** → Use `get_onboarding_checklist` / `mark_task_complete` / `get_onboarding_progress`
   - New hire tracking, task management
   - "Onboarding status...", "Mark task...", "Checklist for..."

7️⃣ **EMAILS** → Use `send_email` / `notify_employee` / `notify_hr`
   - Sending notifications
   - "Send email...", "Notify...", "Alert..."

8️⃣ **ANALYTICS** → Use `get_leave_summary` / `get_department_summary`
   - Reports and statistics
   - "Show stats...", "Department summary...", "Leave report..."

⚠️ **CRITICAL RULES**:
- DO NOT use `search_policies` for employee-specific data like leave balances or applying leave
- DO NOT use `search_policies` when a specific tool exists for the action
- Use the MOST SPECIFIC tool available
- If no tool fits, decline politely

DECLINE ONLY FOR:
- Math problems, weather, general trivia, entertainment, sports, news
- Response: "I can only assist with HR-related queries. Please ask about company policies, leave, employees, onboarding, or workplace matters."

When providing answers:
- Cite policy sources: [Source: filename | Section: X]
- Format data clearly with bullet points and line breaks
- If tool returns no data, say "I couldn't find that information" and suggest contacting HR
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