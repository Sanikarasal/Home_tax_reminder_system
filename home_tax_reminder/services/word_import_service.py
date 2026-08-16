"""
word_import_service.py
Parses pasted text blocks (copied from Word docs) into resident dicts.
Safe to import and test standalone — no DB dependency in parse_text().
"""

import re
from typing import Any

# Canonical field aliases (all lowercase for matching)
FIELD_MAP: dict[str, list[str]] = {
    "name":        ["name", "taxpayer", "taxpayer name", "नाव"],
    "property_id": ["property id", "property", "id", "prop id", "property_id"],
    "ward":        ["ward"],
    "phone":       ["phone", "mobile", "mob", "mobile no", "phone no",
                    "contact", "contact no"],
    "address":     ["address", "addr"],
    "base_amount": ["amount", "tax amount", "base amount", "tax",
                    "base_amount", "रक्कम"],
}


def _clean_amount(raw: str) -> float:
    """Strip ₹, commas, spaces, letters — return float. Returns 0.0 on failure."""
    cleaned = re.sub(r"[^\d.]", "", raw)
    try:
        return float(cleaned)
    except ValueError:
        return 0.0


def parse_text(raw_text: str) -> list[dict[str, Any]]:
    """
    Split raw pasted text into blocks (separated by one or more blank lines).
    Each block is parsed line-by-line using 'Key: Value' or 'Key - Value' format.
    Returns only records that have at minimum name + property_id.
    Missing fields are stored as empty strings / 0.0.
    """
    # Split on one-or-more blank lines
    blocks = re.split(r"\n\s*\n", raw_text.strip())
    results: list[dict[str, Any]] = []

    for block_idx, block in enumerate(blocks):
        record: dict[str, Any] = {
            "name":        "",
            "property_id": "",
            "ward":        "",
            "phone":       "",
            "address":     "",
            "base_amount": 0.0,
            "_block_index": block_idx,       # kept for import review UI
            "_raw_block":   block.strip(),   # kept for duplicate merge UI
        }

        for line in block.strip().splitlines():
            line = line.strip()
            if not line:
                continue

            # Match   Key: Value   or   Key - Value
            m = re.match(r"^(.+?)\s*[:\-]\s*(.+)$", line, re.IGNORECASE)
            if not m:
                continue

            raw_key = m.group(1).strip().lower()
            value   = m.group(2).strip()

            matched_field = None
            for field, aliases in FIELD_MAP.items():
                if raw_key in aliases:
                    matched_field = field
                    break

            if matched_field is None:
                continue  # unrecognised key — skip silently

            if matched_field == "base_amount":
                record[matched_field] = _clean_amount(value)
            else:
                record[matched_field] = value

        # Only keep records that have the two required fields
        if record["name"] and record["property_id"]:
            results.append(record)

    return results


def check_duplicates(
    parsed_list: list[dict],
    existing_property_ids: list[str],
) -> tuple[list[dict], list[dict]]:
    """
    Separate parsed records into:
      - new_records:       property_id not in existing set → safe to insert
      - duplicate_records: property_id already exists → needs admin review
    existing_property_ids should come from resident_service.get_all_property_ids().
    """
    existing_set = set(pid.strip().lower() for pid in existing_property_ids)
    new_records: list[dict] = []
    duplicate_records: list[dict] = []

    for rec in parsed_list:
        if rec["property_id"].strip().lower() in existing_set:
            duplicate_records.append(rec)
        else:
            new_records.append(rec)

    return new_records, duplicate_records


# ── DB-facing functions (used by main.py @eel.expose wrappers) ────────────────

def confirm_import(new_records: list[dict]) -> dict:
    """
    Insert confirmed-new records into the DB.
    Called only after check_duplicates() — never auto-inserts duplicates.
    Returns {"inserted": N, "errors": [...]}
    """
    from database.db import execute_write_many
    statements: list[tuple] = []
    errors: list[str] = []

    for rec in new_records:
        if not rec.get("name") or not rec.get("property_id"):
            errors.append(f"Skipped incomplete record: {rec.get('_raw_block', '')[:40]}")
            continue
        statements.append((
            """INSERT INTO residents
               (name, property_id, ward, phone, address, base_amount, payment_status)
               VALUES (?, ?, ?, ?, ?, ?, 'unpaid')""",
            (
                rec["name"],
                rec["property_id"],
                rec.get("ward", ""),
                rec.get("phone", ""),
                rec.get("address", ""),
                rec.get("base_amount", 0.0),
            )
        ))

    if statements:
        execute_write_many(statements)

    return {"inserted": len(statements), "errors": errors}


def merge_resident(existing_id: int, new_data: dict) -> dict:
    """
    Staff-approved overwrite of an existing resident's mutable fields.
    Does NOT touch payment_status or paid_date.
    """
    from database.db import execute_write
    execute_write(
        """UPDATE residents
           SET name=?, ward=?, phone=?, address=?, base_amount=?
           WHERE id=?""",
        (
            new_data.get("name", ""),
            new_data.get("ward", ""),
            new_data.get("phone", ""),
            new_data.get("address", ""),
            new_data.get("base_amount", 0.0),
            existing_id,
        )
    )
    return {"merged": True, "id": existing_id}
