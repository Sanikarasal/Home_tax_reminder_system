"""
services/template_service.py
CRUD for bilingual message templates.
"""

import logging
from database.db import get_connection, execute_write

log = logging.getLogger(__name__)

VALID_TYPES = {"upcoming", "rebate", "overdue", "penalty"}
VALID_LANGS = {"mr", "en"}


def get_all_templates() -> list[dict]:
    conn = get_connection()
    rows = conn.execute(
        "SELECT * FROM message_templates ORDER BY template_type, language"
    ).fetchall()
    return [dict(r) for r in rows]


def get_template(template_type: str, language: str) -> dict | None:
    conn = get_connection()
    row = conn.execute(
        "SELECT * FROM message_templates WHERE template_type=? AND language=?",
        (template_type, language)
    ).fetchone()
    return dict(row) if row else None


def get_template_body(template_type: str, language: str) -> str:
    t = get_template(template_type, language)
    return t["body"] if t else ""


def update_template(template_type: str, language: str, body: str) -> bool:
    if template_type not in VALID_TYPES or language not in VALID_LANGS:
        return False
    execute_write(
        """INSERT INTO message_templates (template_type, language, body)
           VALUES (?,?,?)
           ON CONFLICT(template_type, language) DO UPDATE SET body=excluded.body""",
        (template_type, language, body)
    )
    log.info("Template updated: %s/%s", template_type, language)
    return True


def get_templates_as_dict() -> dict:
    """Returns {template_type: {language: body}} nested dict for easy JS use."""
    templates = get_all_templates()
    result: dict = {}
    for t in templates:
        tt = t["template_type"]
        if tt not in result:
            result[tt] = {}
        result[tt][t["language"]] = t["body"]
    return result


def render_template(
    template_type: str,
    language: str,
    variables: dict,
) -> str:
    """
    Renders a template body by substituting {placeholder} variables.
    variables dict should include all known placeholders.
    """
    body = get_template_body(template_type, language)
    if not body:
        return ""
    for key, val in variables.items():
        body = body.replace("{" + key + "}", str(val))
    return body


def reset_to_defaults() -> None:
    """Restores all templates to the seeded defaults."""
    from database.db import _DEFAULT_TEMPLATES, execute_write_many
    stmts = [
        ("""INSERT INTO message_templates (template_type, language, body)
            VALUES (?,?,?)
            ON CONFLICT(template_type, language) DO UPDATE SET body=excluded.body""",
         (t, l, b))
        for t, l, b in _DEFAULT_TEMPLATES
    ]
    execute_write_many(stmts)
    log.info("Templates reset to defaults")
