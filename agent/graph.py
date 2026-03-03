"""LangGraph Agent with strict HR-only guardrails."""
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

# STRICT System Prompt - Policy-only RAG
SYSTEM_PROMPT = """You are a STRICT HR Policy Assistant. You ONLY answer questions about company HR policies based on uploaded documents.

CRITICAL RULES:
1. For ANY question about company policies, benefits, leave rules, procedures, onboarding guidelines, or workplace regulations, you MUST call the search_policies tool first. Do NOT answer from your own knowledge.
2. If the search_policies tool returns relevant documents, answer ONLY using that content. ALWAYS cite sources using: [Source: filename | Section: Name | Lines X-Y]
3. If the search_policies tool returns NO relevant documents, you MUST respond EXACTLY:
   "I cannot find relevant information in the available policy documents. Please ensure the relevant HR document is uploaded or rephrase your question."
   Do NOT fabricate or guess an answer.
4. If someone greets you (hi, hello, hey, good morning, etc.), respond EXACTLY:
   "How should I help you today?"
5. For ANY question that is NOT about HR policies (e.g., database queries, headcount, leave balances, employee lookups, general knowledge, math, weather, sports), you MUST respond EXACTLY:
   "I can only assist with HR-related queries based on company policy documents. This question appears to be outside my scope."
6. You have ONLY ONE tool: search_policies. You cannot look up employee data, leave balances, department counts, or any database information. If asked, refuse with the message in rule 5.
7. NEVER use your general knowledge to answer. ONLY use information from the search_policies tool results.

Examples of questions to REFUSE (use refusal message from rule 5):
- "Headcount by department"
- "Leave balance for Rahul"
- "Who is the CEO?"
- "What is the capital of India?"
- "What is 2+2?"

Examples of questions to ANSWER (using search_policies):
- "What is the maternity leave policy?"
- "How many sick days do I get?"
- "What is the remote work policy?"
- "What is the moonlighting disclosure?"
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
        return {"messages": []}  # nothing to do

    tool_calls = last_message.tool_calls
    tool_by_name = {tool.name: tool for tool in tools}

    new_messages = []
    new_sources = []          # will hold sources from this round

    for tool_call in tool_calls:
        tool_name = tool_call["name"]
        tool_args = tool_call["args"]
        tool = tool_by_name.get(tool_name)

        if not tool:
            answer = f"Tool '{tool_name}' not found."
        else:
            try:
                result = tool.invoke(tool_args)   # returns string OR dict (for search_policies)
                # Check if this tool returned sources
                if isinstance(result, dict) and "sources" in result:
                    new_sources.extend(result["sources"])
                    answer = result.get("answer", "")
                else:
                    answer = result
            except Exception as e:
                answer = f"Error executing tool {tool_name}: {e}"

        # Create a ToolMessage for the LLM
        tool_message = ToolMessage(content=str(answer), tool_call_id=tool_call["id"])
        new_messages.append(tool_message)

    # Prepare state update
    output = {"messages": new_messages}
    if new_sources:
        output["sources"] = new_sources   # replace sources with this round's

    return output


workflow = StateGraph(AgentState)
workflow.add_node("agent", agent_node)
workflow.add_node("tools", tools_node)

workflow.set_entry_point("agent")
workflow.add_conditional_edges("agent", tools_condition)
workflow.add_edge("tools", "agent")

graph = workflow.compile()