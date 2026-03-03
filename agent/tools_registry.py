"""Registry – only exposes the policy search tool to the agent."""
import sys
import os
from langchain_core.tools import BaseTool

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def get_all_tools() -> list[BaseTool]:
    """Returns only the search_policies tool (policy-only assistant)."""
    from tools.retrieval import search_policies
    return [search_policies]
