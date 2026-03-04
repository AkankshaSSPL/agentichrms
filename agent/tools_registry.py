"""Tool registry — exposes ALL HR tools to the agent."""
import sys
import os
from langchain_core.tools import BaseTool

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def get_all_tools() -> list[BaseTool]:
    """Returns every HR tool the agent can call."""
    from tools.retrieval import search_policies
    from tools.employee_tool import lookup_employee, count_by_department, get_team
    from tools.email_tool import send_email, notify_employee, notify_hr
    from tools.leave_tool import (
        check_leave_balance, apply_leave, get_pending_leaves,
        approve_leave, reject_leave,
    )
    from tools.onboarding_tool import (
        get_onboarding_checklist, mark_task_complete, get_onboarding_progress,
    )
    from tools.analytics_tool import get_leave_summary, get_department_summary

    return [
        # Policy / RAG
        search_policies,
        # Employee
        lookup_employee,
        count_by_department,
        get_team,
        # Email
        send_email,
        notify_employee,
        notify_hr,
        # Leave
        check_leave_balance,
        apply_leave,
        get_pending_leaves,
        approve_leave,
        reject_leave,
        # Onboarding
        get_onboarding_checklist,
        mark_task_complete,
        get_onboarding_progress,
        # Analytics
        get_leave_summary,
        get_department_summary,
    ]
