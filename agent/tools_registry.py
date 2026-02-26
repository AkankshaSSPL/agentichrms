"""Registry to auto-discover all tools in the tools/ directory."""
import pkgutil
import importlib
import inspect
import sys
import os
from langchain_core.tools import BaseTool

# Add parent dir to path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

def get_all_tools() -> list[BaseTool]:
    """Scans the 'tools' package and returns all functions decorated with @hr_tool."""
    tools = []
    tools_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "tools")
    
    # Iterate over all modules in tools/
    for _, name, _ in pkgutil.iter_modules([tools_path]):
        if name == "base" or name.startswith("__"):
            continue
            
        module_name = f"tools.{name}"
        try:
            module = importlib.import_module(module_name)
            
            # Find all BaseTool instances (which @hr_tool creates)
            for _, obj in inspect.getmembers(module):
                if isinstance(obj, BaseTool):
                    tools.append(obj)
                    
        except ImportError as e:
            print(f"Error importing {module_name}: {e}")
            
    return tools
