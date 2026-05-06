import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))

from tools.retrieval import search_policies

query = "What is the leave policy?"
result = search_policies(query)
print("Sources:", len(result.get("sources", [])))
print("Answer preview:", result.get("answer", "")[:300])