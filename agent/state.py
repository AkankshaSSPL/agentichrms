from typing import TypedDict, List, Annotated, Dict, Any, Sequence
from langchain_core.messages import BaseMessage
import operator

class AgentState(TypedDict):
    messages: Annotated[Sequence[BaseMessage], operator.add]
    sources: Annotated[List[Dict[str, Any]], operator.add]   # accumulate within a query