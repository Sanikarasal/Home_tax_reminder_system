"""
services/resident_service.py
Full CRUD for the residents table.
"""

import logging
from datetime import date
from typing import Any
from database.db import get_connection, execute_write, execute_write_many

log = logging.getLogger(__name__)


def get_all_residents(
    search: str = "",
    status_filter: str = "all",
    ward_filter: str = "all",
    sort_by: str = "name",
    sort_dir: str = "ASC",
) -> list[dict]:
    conn = get_connection()
    sql = "SELECT * FROM residents WHERE 1=1"
    params: list[Any] = []

    if search:
        sql += " AND (name LIKE ? OR property_id LIKE ? OR ward LIKE ? OR phone LIKE ?)"
        q = f"%{search}%"
        params.extend([q, q, q, q])

    if status_filter != "all":
        sql += " AND payment_status=?"
        params.append(status_filter)

    if ward_filter != "all":
        sql += " AND ward=?"
        params.append(ward_filter)

    allowed_sort = {"name", "property_id", "ward", "base_amount", "payment_status", "created_at"}
    sort_col = sort_by if sort_by in allowed_sort else "name"
    sort_dir = "DESC" if sort_dir.upper() == "DESC" else "ASC"
    sql += f" ORDER BY {sort_col} {sort_dir}"

    rows = conn.execute(sql, params).fetchall()
    return [dict(r) for r in rows]


def get_unpaid_residents() -> list[dict]:
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
    if property_id is None:
        return None
    q = str(property_id).strip()
    if not q:
        return None
    conn = get_connection()
    row = conn.execute(
        "SELECT * FROM residents WHERE LOWER(TRIM(property_id)) = LOWER(?) LIMIT 1",
        (q,),
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
    Returns the created resident dict.
    """
    # Check duplicate property_id
    conn = get_connection()
    existing = conn.execute(
        "SELECT id FROM residents WHERE property_id=?",
        (data.get("property_id", "").strip(),)
    ).fetchone()
    if existing:
        raise ValueError(f"Property ID '{data['property_id']}' already exists.")

    paid = bool(data.get("paid", False)) or data.get("payment_status") == "paid"
    paid_date = data.get("paid_date", date.today().isoformat() if paid else None)

    row_id = execute_write(
        """INSERT INTO residents
           (name, property_id, ward, phone, address, base_amount, payment_status, paid_date)
           VALUES (?,?,?,?,?,?,?,?)""",
        (
            data.get("name", "").strip(),
            data.get("property_id", "").strip(),
            data.get("ward", "").strip(),
            data.get("phone", "").strip(),
            data.get("address", "").strip(),
            float(data.get("base_amount", 0)),
            "paid" if paid else "unpaid",
            paid_date if paid else None,
        )
    )
    log.info("Created resident id=%s property_id=%s", row_id, data.get("property_id"))
    return get_resident_by_id(row_id)


def update_resident(resident_id: int, data: dict) -> dict | None:
    """Update all mutable fields of a resident.

    Uses `data.get(key) or existing[...]` semantics so an explicit `None`
    from JS falls back to the previously stored value instead of crashing
    on `.strip()` or float conversion.
    """
    existing = get_resident_by_id(resident_id)
    if not existing:
        return None

    paid = bool(data.get("paid", False)) or data.get("payment_status") == "paid"
    paid_date = data.get("paid_date") or (date.today().isoformat() if paid else None)

    name = (data.get("name") or existing["name"] or "").strip()
    property_id = (data.get("property_id") or existing["property_id"] or "").strip()
    ward = (data.get("ward") or existing["ward"] or "").strip()
    phone = (data.get("phone") or existing["phone"] or "").strip()
    address = (data.get("address") or existing["address"] or "").strip()

    if data.get("base_amount") is not None:
        base_amount = float(data["base_amount"])
    else:
        base_amount = float(existing["base_amount"])

    execute_write(
        """UPDATE residents
           SET name=?, property_id=?, ward=?, phone=?, address=?,
               base_amount=?, payment_status=?, paid_date=?
           WHERE id=?""",
        (
            name,
            property_id,
            ward,
            phone,
            address,
            base_amount,
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
    log.info("Marked paid: resident id=%s date=%s", resident_id, pd)
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
