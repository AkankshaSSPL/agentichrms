"""Tool registry — exposes ALL HR tools to the agent."""
import sys
import os
from langchain_core.tools import BaseTool

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def get_all_tools() -> list[BaseTool]:
    """Returns every HR tool the agent can call."""
    import logging
    logger = logging.getLogger(__name__)
    tools = []

    try:
        from tools.retrieval import search_policies
        tools.append(search_policies)
    except Exception as e:
        logger.warning("Failed to load retrieval tools: %s", e)

    try:
        from tools.employee_tool import lookup_employee, count_by_department, get_team
        tools.extend([lookup_employee, count_by_department, get_team])
    except Exception as e:
        logger.warning("Failed to load employee tools: %s", e)

    try:
        from tools.email_tool import send_email, notify_employee, notify_hr
        tools.extend([send_email, notify_employee, notify_hr])
    except Exception as e:
        logger.warning("Failed to load email tools: %s", e)

    try:
        from tools.leave_tool import (
            check_leave_balance, apply_leave, get_pending_leaves,
            approve_leave, reject_leave,
        )
        tools.extend([check_leave_balance, apply_leave, get_pending_leaves,
                      approve_leave, reject_leave])
    except Exception as e:
        logger.warning("Failed to load leave tools: %s", e)

    try:
        from tools.onboarding_tool import (
            get_onboarding_checklist, mark_task_complete, get_onboarding_progress,
        )
        tools.extend([get_onboarding_checklist, mark_task_complete, get_onboarding_progress])
    except Exception as e:
        logger.warning("Failed to load onboarding tools: %s", e)

    try:
        from tools.analytics_tool import get_leave_summary, get_department_summary
        tools.extend([get_leave_summary, get_department_summary])
    except Exception as e:
        logger.warning("Failed to load analytics tools: %s", e)

    logger.info("Loaded %d tools successfully.", len(tools))
    return tools
