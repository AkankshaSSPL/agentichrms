"""LangGraph Agent with strict HR-only guardrails."""
import sys
import os
from langchain_openai import ChatOpenAI
from langchain_core.messages import SystemMessage
from langgraph.graph import StateGraph
from langgraph.prebuilt import ToolNode, tools_condition

try:
    from config import OPENAI_API_KEY, AGENT_MODEL
    from .state import AgentState
    from .tools_registry import get_all_tools
    from tools.retrieval import get_last_retrieved_sources
except ImportError:
    sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    from config import OPENAI_API_KEY, AGENT_MODEL
    from agent.state import AgentState
    from agent.tools_registry import get_all_tools
    from tools.retrieval import get_last_retrieved_sources


tools = get_all_tools()
llm = ChatOpenAI(model=AGENT_MODEL, api_key=OPENAI_API_KEY, temperature=0, streaming=True)
llm_with_tools = llm.bind_tools(tools)

# STRICT System Prompt - HR ONLY
SYSTEM_PROMPT = """You are a STRICT HR Policy Assistant. Your ONLY purpose is to answer questions based on uploaded HR policy documents.

CRITICAL RULES:
1. ONLY answer questions related to HR policies, employee benefits, leave management, company policies, onboarding, or workplace guidelines.
2. If the question is NOT HR-related (e.g., general knowledge, geography, math, weather, sports, etc.), you MUST decline:
   "I can only assist with HR-related queries based on company policy documents. This question appears to be outside my scope."
3. If NO relevant documents are found in the search results, respond:
   "I cannot find relevant information in the available policy documents. Please ensure the relevant HR document is uploaded or rephrase your question."
4. NEVER use your general knowledge to answer. ONLY use information from the provided policy documents.
5. ALWAYS cite sources using: [Source: filename | Section: Name | Lines X-Y]
6. If documents exist but don't contain the answer, say:
   "The available policy documents do not contain information about this topic."

Examples of questions to DECLINE:
- "What is the capital of India?"
- "Who won the World Cup?"
- "What is 2+2?"
- "What is the weather today?"

Examples of questions to ANSWER:
- "What is the maternity leave policy?"
- "How many sick days do I get?"
- "What is the remote work policy?"
- "How do I request time off?"
"""

def agent_node(state: AgentState):
    messages = state["messages"]
    if not messages or not isinstance(messages[0], SystemMessage):
        messages.insert(0, SystemMessage(content=SYSTEM_PROMPT))
    
    response = llm_with_tools.invoke(messages)
    return {"messages": [response]}


def tools_node(state: AgentState):
    tool_node = ToolNode(tools)
    result = tool_node.invoke(state)
    
    sources = get_last_retrieved_sources()
    if sources:
        result["sources"] = sources
    
    return result


workflow = StateGraph(AgentState)
workflow.add_node("agent", agent_node)
workflow.add_node("tools", tools_node)

workflow.set_entry_point("agent")
workflow.add_conditional_edges("agent", tools_condition)
workflow.add_edge("tools", "agent")

graph = workflow.compile()

