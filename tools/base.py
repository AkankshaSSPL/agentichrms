"""Base class for HR tools compatible with LangGraph."""
from langchain_core.tools import tool

# Decorator to register tools
def hr_tool(func):
    """Decorator to mark a function as an HR tool for the agent."""
    return tool(func)
