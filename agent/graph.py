"""LangGraph Agent — full agentic HR assistant with all tools."""
import sys
import os
from langchain_openai import ChatOpenAI
from langchain_core.messages import SystemMessage, ToolMessage, HumanMessage, AIMessage
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

# Import the policy search tool directly
from tools.retrieval import search_policies

tools = get_all_tools()
llm = ChatOpenAI(model=AGENT_MODEL, api_key=OPENAI_API_KEY, temperature=0, streaming=True)
llm_with_tools = llm.bind_tools(tools)

# ── Full System Prompt (strengthened rules) ─────────────────────────────
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
2. ANY question related to company policies MUST use search_policies.  
   This includes:
   - Questions explicitly mentioning "policy", "rule", "benefit", "handbook", "guideline", "leave", "remote work", "WFH", "conduct", "HR procedures".
   - Questions about specific terms that could be part of a policy, even if the word "policy" is not used, such as:
     * "What is covenants not to compete?"
     * "Explain non‑compete"
     * "What is moonlighting?"
     * "Tell me about dress code"
     * "How many sick days do I get?"
     * "What is bereavement leave?"
     * "Maternity leave policy"
     * "Remote work rules"
   If the query mentions any topic that might be covered in company policy documents, you MUST call search_policies immediately.
3. If you are unsure whether the question is about company policy, call search_policies first before declining.
4. For personal employee data questions (like "how much leave do I have left?"), use check_leave_balance.
5. For questions about who is in a specific role/department, use lookup_employee.
6. For time-off or leave requests, use apply_leave.
7. Only decline if the question is clearly unrelated to HR or company operations (e.g., math, weather, geography, trivia, entertainment).  
   If there is any chance the question refers to company policy or HR matters, search_policies first.
8. When you receive search_policies results, extract the EXACT relevant sentences, quote the policy directly, and cite sources using: [Source: filename | Section: Name | Lines X-Y]
9. After you receive tool results, provide a clear, helpful answer based on that data. If the tool returns no relevant information, politely say you couldn't find an answer and suggest rephrasing or contacting HR directly.
10. If someone just greets you (hi, hello, etc.), respond warmly and ask how you can help.
11. When showing employee data or leave info, format it clearly with line breaks and structure.

IMPORTANT: When policy information has been provided in the conversation (as a "Relevant policy information" message), you MUST base your answer on that information and not call search_policies again unless the user asks a new question not covered by the provided info.
"""

def agent_node(state: AgentState):
    messages = state["messages"]

    # Ensure system prompt is present
    if not messages or not isinstance(messages[0], SystemMessage):
        messages.insert(0, SystemMessage(content=SYSTEM_PROMPT))

    # Get the latest user message
    user_msg = None
    for msg in reversed(messages):
        if isinstance(msg, HumanMessage):
            user_msg = msg.content
            break

    # ---- STEP 0: Direct decline for clearly non-HR queries ----
    if user_msg:
        # Expanded list of non-HR patterns
        non_hr_patterns = [
            "two plus two", "2+2", "what is 2+2", "what is two plus two",
            "capital of", "weather in", "who is the president", "math",
            "calculate", "plus", "minus", "times", "divided by", "equation",
            "solve", "trivia", "movie", "song", "sports", "india", "new delhi"
        ]
        lower = user_msg.lower()
        if any(pattern in lower for pattern in non_hr_patterns):
            # Return decline message immediately – no LLM call
            return {
                "messages": [
                    AIMessage(
                        content="I can only assist with HR-related queries. Please ask about company policies, leave, employees, or other HR topics."
                    )
                ]
            }

    # ---- STEP 1: Decide whether to retrieve policies (only for queries that passed) ----
    retrieve_policies = True
    if user_msg:
        # Additional keyword filter for borderline cases (optional)
        non_hr_keywords = [
            "math", "calculate", "weather", "geography",
            "trivia", "entertainment", "movie", "song", "sports"
        ]
        lower_query = user_msg.lower()
        if any(keyword in lower_query for keyword in non_hr_keywords):
            retrieve_policies = False

    # ---- STEP 2: Retrieve policy information if allowed ----
    if user_msg and retrieve_policies:
        try:
            policy_result = search_policies.invoke({"query": user_msg})
            if isinstance(policy_result, dict) and policy_result.get("answer"):
                answer_text = policy_result["answer"].strip()
                # Avoid injecting "no relevant documents" messages
                if answer_text and "no relevant" not in answer_text.lower():
                    sources = policy_result.get("sources", [])
                    source_str = "\n".join([f"- {s['filename']} (page {s.get('page', 'N/A')})" for s in sources])
                    retrieval_msg = SystemMessage(
                        content=f"Relevant policy information:\n{answer_text}\n\nSources:\n{source_str}\n\nUse this information to answer the user's question. Do not rely on your own knowledge. If the information fully answers the question, you do not need to call search_policies again."
                    )
                    # Insert after the main system prompt (position 1)
                    messages.insert(1, retrieval_msg)
        except Exception as e:
            print(f"Policy retrieval error: {e}")

    # ---- STEP 3: Invoke LLM with tools ----
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