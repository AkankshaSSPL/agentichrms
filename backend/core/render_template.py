"""
Template renderer — loads Jinja2 HTML email templates from
backend/core/templates/ and renders them with the provided context.

Usage
-----
from backend.core.render_template import render_template

html = render_template(
    "leave_approved.html",
    employee_name="Alice",
    leave_type="Annual",
    start_date="2025-07-01",
    end_date="2025-07-05",
    total_days=5,
    approved_by="hr@company.com",
)
"""

from pathlib import Path
from jinja2 import Environment, FileSystemLoader, select_autoescape, TemplateNotFound

# ── Resolve the templates directory relative to this file ────────────────────
_TEMPLATES_DIR = Path(__file__).parent / "templates"

_env = Environment(
    loader=FileSystemLoader(str(_TEMPLATES_DIR)),
    autoescape=select_autoescape(["html"]),  # XSS-safe by default
    trim_blocks=True,
    lstrip_blocks=True,
)


def render_template(template_name: str, **context: object) -> str:
    """
    Render *template_name* with the given keyword arguments as context.

    Parameters
    ----------
    template_name : str
        Filename inside ``backend/core/templates/`` (e.g. ``"leave_approved.html"``).
    **context : object
        Variables made available inside the template via ``{{ variable_name }}``.

    Returns
    -------
    str
        Fully rendered HTML string, ready to pass as the ``html`` argument
        to ``send_email()``.

    Raises
    ------
    FileNotFoundError
        If the template file does not exist in the templates directory.
    """
    try:
        tmpl = _env.get_template(template_name)
    except TemplateNotFound:
        raise FileNotFoundError(
            f"Email template '{template_name}' not found in {_TEMPLATES_DIR}. "
            f"Available templates: {[p.name for p in _TEMPLATES_DIR.glob('*.html')]}"
        )
    return tmpl.render(**context)