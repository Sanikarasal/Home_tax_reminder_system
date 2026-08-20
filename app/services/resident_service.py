"""
services/resident_service.py
Full CRUD for the residents table + yearly payment tracking via resident_payments.
"""

import logging
import sqlite3
from datetime import date
from typing import Any
from database.db import get_connection, execute_write, execute_write_many, execute_write_txn

log = logging.getLogger(__name__)


# ═══════════════════════════════════════════════════════════════════════════════
# Residents (master data — name, property_id, ward, phone, address)
# ═══════════════════════════════════════════════════════════════════════════════

def get_all_residents(
    search: str = "",
    status_filter: str = "all",
    ward_filter: str = "all",
    sort_by: str = "name",
    sort_dir: str = "ASC",
    cycle_id: int | None = None,
) -> list[dict]:
    """
    Returns residents list.

    When cycle_id is provided, each resident row is augmented with payment
    fields from resident_payments for that cycle:
        payment_status, paid_date, base_amount (from payment), penalty_amount,
        carry_forward_from_cycle_id, carry_forward_fy_label

    When cycle_id is None, falls back to reading payment_status / paid_date
    directly from the residents table (legacy behaviour, kept so existing
    screens continue to work before full migration is complete).
    """
    conn = get_connection()

    if cycle_id is not None:
        # Join against resident_payments for the chosen cycle
        sql = """
            SELECT r.*,
                   COALESCE(rp.status, 'unpaid')        AS payment_status,
                   rp.paid_date                          AS paid_date,
                   COALESCE(rp.base_amount, r.base_amount) AS payment_base_amount,
                   COALESCE(rp.penalty_amount, 0)        AS penalty_amount,
                   rp.carry_forward_from_cycle_id        AS carry_forward_from_cycle_id,
                   cf.fy_label                           AS carry_forward_fy_label,
                   rp.id                                 AS payment_id
            FROM residents r
            LEFT JOIN resident_payments rp
                   ON rp.resident_id = r.id AND rp.cycle_id = ?
            LEFT JOIN tax_cycle_settings cf
                   ON cf.id = rp.carry_forward_from_cycle_id
            WHERE 1=1
        """
        params: list[Any] = [cycle_id]
    else:
        sql = "SELECT * FROM residents WHERE 1=1"
        params = []

    if search:
        sql += " AND (r.name LIKE ? OR r.property_id LIKE ? OR r.ward LIKE ? OR r.phone LIKE ?)" \
               if cycle_id is not None else \
               " AND (name LIKE ? OR property_id LIKE ? OR ward LIKE ? OR phone LIKE ?)"
        q = f"%{search}%"
        params.extend([q, q, q, q])

    if status_filter != "all":
        if cycle_id is not None:
            sql += " AND COALESCE(rp.status, 'unpaid')=?"
        else:
            sql += " AND payment_status=?"
        params.append(status_filter)

    if ward_filter != "all":
        sql += " AND r.ward=?" if cycle_id is not None else " AND ward=?"
        params.append(ward_filter)

    allowed_sort = {"name", "property_id", "ward", "base_amount", "payment_status", "created_at"}
    sort_col = sort_by if sort_by in allowed_sort else "name"
    sort_dir = "DESC" if sort_dir.upper() == "DESC" else "ASC"

    if cycle_id is not None:
        sql += f" ORDER BY r.{sort_col} {sort_dir}"
    else:
        sql += f" ORDER BY {sort_col} {sort_dir}"

    rows = conn.execute(sql, params).fetchall()
    return [dict(r) for r in rows]


def get_unpaid_residents() -> list[dict]:
    """
    Returns residents with payment_status='unpaid' from the residents table.
    Used by the reminder engine which relies on the legacy column.
    """
    conn = get_connection()
    rows = conn.execute(
        "SELECT * FROM residents WHERE payment_status='unpaid' ORDER BY name"
    ).fetchall()
    return [dict(r) for r in rows]


def get_resident_by_id(resident_id: int) -> dict | None:
    conn = get_connection()
    row = conn.execute("SELECT * FROM residents WHERE id=?", (resident_id,)).fetchone()
    return dict(row) if row else None


def get_resident_by_property_id(property_id: str) -> dict | None:
    q = (property_id or "").strip()
    if not q:
        return None
    row = get_connection().execute(
        "SELECT * FROM residents WHERE LOWER(TRIM(property_id))=LOWER(?)",
        (q,)
    ).fetchone()
    return dict(row) if row else None


def get_all_property_ids() -> list[str]:
    conn = get_connection()
    rows = conn.execute("SELECT property_id FROM residents").fetchall()
    return [r["property_id"] for r in rows]


def get_all_wards() -> list[str]:
    conn = get_connection()
    rows = conn.execute(
        "SELECT DISTINCT ward FROM residents WHERE ward != '' ORDER BY ward"
    ).fetchall()
    return [r["ward"] for r in rows]


def create_resident(data: dict) -> dict:
    """
    Insert a new resident. Raises ValueError on duplicate property_id.
    payment_status / paid_date on the residents row are kept for legacy
    compatibility with the reminder engine until columns are formally dropped.
    Returns the created resident dict.
    """
    conn = get_connection()
    pid = str(data.get("property_id", "")).strip()
    name = str(data.get("name", "")).strip()
    if not name or not pid:
        raise ValueError("Name and house/property number are required.")

    existing = conn.execute(
        "SELECT id FROM residents WHERE LOWER(TRIM(property_id))=LOWER(?)",
        (pid,)
    ).fetchone()
    if existing:
        raise ValueError(f"Property ID '{pid}' already exists.")

    paid = bool(data.get("paid", False)) or data.get("payment_status") == "paid"
    paid_date = data.get("paid_date", date.today().isoformat() if paid else None)

    row_id = execute_write(
        """INSERT INTO residents
           (name, property_id, ward, phone, address, base_amount, payment_status, paid_date)
           VALUES (?,?,?,?,?,?,?,?)""",
        (
            name,
            pid,
            str(data.get("ward", "")).strip(),
            str(data.get("phone", "")).strip(),
            str(data.get("address", "")).strip(),
            float(data.get("base_amount", 0)),
            "paid" if paid else "unpaid",
            paid_date if paid else None,
        )
    )
    log.info("Created resident id=%s property_id=%s", row_id, pid)
    return get_resident_by_id(row_id)


def update_resident(resident_id: int, data: dict) -> dict | None:
    """Update all mutable fields of a resident."""
    existing = get_resident_by_id(resident_id)
    if not existing:
        return None

    pid = str(data.get("property_id", existing["property_id"])).strip()
    name = str(data.get("name", existing["name"])).strip()
    if not name or not pid:
        raise ValueError("Name and property ID cannot be empty.")

    duplicate = get_resident_by_property_id(pid)
    if duplicate and duplicate["id"] != resident_id:
        raise ValueError(f"Property ID '{pid}' already exists.")

    paid = bool(data.get("paid", False)) or data.get("payment_status") == "paid"
    paid_date = data.get("paid_date") or (date.today().isoformat() if paid else None)

    execute_write(
        """UPDATE residents
           SET name=?, property_id=?, ward=?, phone=?, address=?,
               base_amount=?, payment_status=?, paid_date=?
           WHERE id=?""",
        (
            name,
            pid,
            str(data.get("ward", existing["ward"])).strip(),
            str(data.get("phone", existing["phone"])).strip(),
            str(data.get("address", existing["address"])).strip(),
            float(data.get("base_amount", existing["base_amount"])),
            "paid" if paid else "unpaid",
            paid_date if paid else None,
            resident_id,
        )
    )
    return get_resident_by_id(resident_id)


def delete_resident(resident_id: int) -> bool:
    rows = execute_write("DELETE FROM residents WHERE id=?", (resident_id,))
    log.info("Deleted resident id=%s", resident_id)
    return rows > 0


def mark_paid(resident_id: int, paid_date: str | None = None) -> dict | None:
    pd = paid_date or date.today().isoformat()
    execute_write(
        "UPDATE residents SET payment_status='paid', paid_date=? WHERE id=?",
        (pd, resident_id)
    )
    log.info("Marked paid (legacy): resident id=%s date=%s", resident_id, pd)
    return get_resident_by_id(resident_id)


def mark_unpaid(resident_id: int) -> dict | None:
    execute_write(
        "UPDATE residents SET payment_status='unpaid', paid_date=NULL WHERE id=?",
        (resident_id,)
    )
    return get_resident_by_id(resident_id)


def get_stats(cycle: dict | None = None) -> dict:
    """
    Returns aggregate stats. If cycle is provided, computes penalty totals.
    """
    from services.settings_service import calculate_penalty
    from datetime import date as date_cls

    conn = get_connection()

    total       = conn.execute("SELECT COUNT(*) FROM residents").fetchone()[0]
    paid_count  = conn.execute("SELECT COUNT(*) FROM residents WHERE payment_status='paid'").fetchone()[0]
    unpaid_count = total - paid_count

    paid_sum = conn.execute(
        "SELECT COALESCE(SUM(base_amount),0) FROM residents WHERE payment_status='paid'"
    ).fetchone()[0]

    unpaid_rows = conn.execute(
        "SELECT base_amount FROM residents WHERE payment_status='unpaid'"
    ).fetchall()

    pending_base = sum(r[0] for r in unpaid_rows)
    total_penalty = 0.0

    if cycle:
        due_str  = cycle.get("due_date", "")
        today    = date_cls.today()
        try:
            due_dt = date_cls.fromisoformat(due_str)
            days_overdue = max(0, (today - due_dt).days)
        except (ValueError, TypeError):
            days_overdue = 0

        for r in unpaid_rows:
            total_penalty += calculate_penalty(r[0], cycle, days_overdue)

    return {
        "total":         total,
        "paid":          paid_count,
        "unpaid":        unpaid_count,
        "paid_sum":      round(paid_sum, 2),
        "pending_base":  round(pending_base, 2),
        "total_penalty": round(total_penalty, 2),
        "total_due":     round(pending_base + total_penalty, 2),
    }


# ═══════════════════════════════════════════════════════════════════════════════
# Yearly Payment Tracking (resident_payments table)
# ═══════════════════════════════════════════════════════════════════════════════

def add_yearly_cycle(
    resident_id: int,
    cycle_id: int,
    base_amount: float,
) -> dict:
    """
    Creates a resident_payments row for resident_id + cycle_id.

    Before inserting, checks if the resident has any prior cycle with
    status IN ('unpaid', 'overdue'). If so, sets carry_forward_from_cycle_id
    to that prior cycle's id (most recent one).

    Relies on UNIQUE(resident_id, cycle_id) to reject double-creation.
    Returns {'success': True, 'payment': <row>} or {'success': False, 'error': <msg>}.
    """
    conn = get_connection()

    # Check resident exists
    resident = get_resident_by_id(resident_id)
    if not resident:
        return {"success": False, "error": f"Resident id={resident_id} not found."}

    # Find most recent prior unpaid/overdue cycle for carry-forward
    prior_unpaid = conn.execute(
        """SELECT rp.cycle_id, tc.fy_label
           FROM resident_payments rp
           JOIN tax_cycle_settings tc ON tc.id = rp.cycle_id
           WHERE rp.resident_id = ?
             AND rp.cycle_id != ?
             AND rp.status IN ('unpaid', 'overdue')
           ORDER BY tc.id DESC
           LIMIT 1""",
        (resident_id, cycle_id)
    ).fetchone()

    carry_forward_id = prior_unpaid["cycle_id"] if prior_unpaid else None

    try:
        row_id = execute_write(
            """INSERT INTO resident_payments
               (resident_id, cycle_id, base_amount, penalty_amount,
                status, paid_date, carry_forward_from_cycle_id)
               VALUES (?, ?, ?, 0, 'unpaid', NULL, ?)""",
            (resident_id, cycle_id, float(base_amount), carry_forward_id)
        )
        log.info(
            "add_yearly_cycle: created payment id=%s for resident=%s cycle=%s carry_forward=%s",
            row_id, resident_id, cycle_id, carry_forward_id
        )
        payment = get_payment_by_id(row_id)
        return {"success": True, "payment": payment}

    except sqlite3.IntegrityError as e:
        if "UNIQUE constraint failed" in str(e):
            return {
                "success": False,
                "error": f"A payment record already exists for resident {resident_id} in cycle {cycle_id}."
            }
        raise


def get_payment_by_id(payment_id: int) -> dict | None:
    conn = get_connection()
    row = conn.execute(
        """SELECT rp.*, r.name, r.property_id, r.phone, r.ward,
                  tc.fy_label,
                  cf.fy_label AS carry_forward_fy_label
           FROM resident_payments rp
           JOIN residents r ON r.id = rp.resident_id
           JOIN tax_cycle_settings tc ON tc.id = rp.cycle_id
           LEFT JOIN tax_cycle_settings cf ON cf.id = rp.carry_forward_from_cycle_id
           WHERE rp.id = ?""",
        (payment_id,)
    ).fetchone()
    return dict(row) if row else None


def get_payments_by_cycle(cycle_id: int) -> dict:
    """
    Returns {'paid': [...], 'unpaid': [...]} for a given cycle.
    Unpaid rows include is_overdue flag (status == 'overdue').
    """
    conn = get_connection()
    rows = conn.execute(
        """SELECT rp.*,
                  r.name, r.property_id, r.phone, r.ward, r.address,
                  tc.fy_label,
                  cf.fy_label AS carry_forward_fy_label
           FROM resident_payments rp
           JOIN residents r ON r.id = rp.resident_id
           JOIN tax_cycle_settings tc ON tc.id = rp.cycle_id
           LEFT JOIN tax_cycle_settings cf ON cf.id = rp.carry_forward_from_cycle_id
           WHERE rp.cycle_id = ?
           ORDER BY r.name""",
        (cycle_id,)
    ).fetchall()

    paid   = []
    unpaid = []
    for row in rows:
        d = dict(row)
        d["is_overdue"] = d["status"] == "overdue"
        if d["status"] == "paid":
            paid.append(d)
        else:
            unpaid.append(d)

    return {"paid": paid, "unpaid": unpaid}


def get_resident_payment_history(resident_id: int) -> list[dict]:
    """
    Returns all resident_payments rows for a single resident, ordered by FY.
    Each row includes fy_label and carry_forward_fy_label for display.
    """
    conn = get_connection()
    rows = conn.execute(
        """SELECT rp.*,
                  tc.fy_label,
                  tc.due_date,
                  cf.fy_label AS carry_forward_fy_label
           FROM resident_payments rp
           JOIN tax_cycle_settings tc ON tc.id = rp.cycle_id
           LEFT JOIN tax_cycle_settings cf ON cf.id = rp.carry_forward_from_cycle_id
           WHERE rp.resident_id = ?
           ORDER BY tc.id ASC""",
        (resident_id,)
    ).fetchall()
    return [dict(r) for r in rows]


def mark_payment_paid(
    resident_id: int,
    cycle_id: int,
    paid_date: str | None = None,
    penalty_amount: float = 0.0,
) -> dict:
    """
    Marks a resident_payments row as paid. Also keeps the legacy residents
    row in sync (so the reminder engine skips them correctly).
    """
    pd = paid_date or date.today().isoformat()

    def _txn(conn):
        # Update resident_payments
        conn.execute(
            """UPDATE resident_payments
               SET status='paid', paid_date=?, penalty_amount=?
               WHERE resident_id=? AND cycle_id=?""",
            (pd, float(penalty_amount), resident_id, cycle_id)
        )
        # Keep legacy residents table in sync
        conn.execute(
            "UPDATE residents SET payment_status='paid', paid_date=? WHERE id=?",
            (pd, resident_id)
        )

    execute_write_txn(_txn)
    log.info("mark_payment_paid: resident=%s cycle=%s date=%s", resident_id, cycle_id, pd)

    conn = get_connection()
    row = conn.execute(
        "SELECT * FROM resident_payments WHERE resident_id=? AND cycle_id=?",
        (resident_id, cycle_id)
    ).fetchone()
    return dict(row) if row else {}


def mark_payment_unpaid(resident_id: int, cycle_id: int) -> dict:
    """Reverts a resident_payments row to unpaid. Also syncs legacy residents row."""
    def _txn(conn):
        conn.execute(
            """UPDATE resident_payments
               SET status='unpaid', paid_date=NULL
               WHERE resident_id=? AND cycle_id=?""",
            (resident_id, cycle_id)
        )
        conn.execute(
            "UPDATE residents SET payment_status='unpaid', paid_date=NULL WHERE id=?",
            (resident_id,)
        )

    execute_write_txn(_txn)
    log.info("mark_payment_unpaid: resident=%s cycle=%s", resident_id, cycle_id)

    conn = get_connection()
    row = conn.execute(
        "SELECT * FROM resident_payments WHERE resident_id=? AND cycle_id=?",
        (resident_id, cycle_id)
    ).fetchone()
    return dict(row) if row else {}


def mark_payment_overdue(resident_id: int, cycle_id: int, penalty_amount: float = 0.0) -> dict:
    """Marks a resident_payments row as overdue (e.g. triggered by scheduler)."""
    execute_write(
        """UPDATE resident_payments
           SET status='overdue', penalty_amount=?
           WHERE resident_id=? AND cycle_id=?""",
        (float(penalty_amount), resident_id, cycle_id)
    )
    conn = get_connection()
    row = conn.execute(
        "SELECT * FROM resident_payments WHERE resident_id=? AND cycle_id=?",
        (resident_id, cycle_id)
    ).fetchone()
    return dict(row) if row else {}
