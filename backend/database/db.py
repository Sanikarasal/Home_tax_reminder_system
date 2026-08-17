"""
backend/database/db.py
SQLite connection management with:
  - WAL journal mode
  - Module-level threading.Lock for all write operations
  - Thread-local read connections
  - init_db() that seeds default data on first run
"""

import sqlite3
import threading
import pathlib
import logging
from config import DATABASE_PATH

log = logging.getLogger(__name__)

# ── Concurrency primitives ────────────────────────────────────────────────────
_write_lock = threading.Lock()   # Serialises ALL write operations
_local = threading.local()       # Thread-local storage for read connections


def _db_path() -> str:
    p = pathlib.Path(DATABASE_PATH)
    p.parent.mkdir(parents=True, exist_ok=True)
    return str(p)


def get_connection() -> sqlite3.Connection:
    """
    Returns a thread-local read connection.
    WAL mode allows concurrent readers — no lock needed here.
    """
    if not hasattr(_local, "conn") or _local.conn is None:
        _local.conn = sqlite3.connect(_db_path(), check_same_thread=False)
        _local.conn.row_factory = sqlite3.Row
        _local.conn.execute("PRAGMA journal_mode=WAL")
        _local.conn.execute("PRAGMA foreign_keys=ON")
    return _local.conn


def _writer_conn() -> sqlite3.Connection:
    """Opens a fresh connection for writes — closed after each execute_write call."""
    conn = sqlite3.connect(_db_path(), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def execute_write(sql: str, params: tuple = ()) -> int:
    """
    Executes a single write statement, serialised through _write_lock.
    Returns lastrowid for INSERTs, rowcount otherwise.
    """
    with _write_lock:
        conn = _writer_conn()
        try:
            cur = conn.execute(sql, params)
            conn.commit()
            return cur.lastrowid or cur.rowcount
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()


def execute_write_many(statements: list[tuple]) -> None:
    """
    Executes multiple (sql, params) pairs in a single transaction,
    with a single lock acquisition — for bulk imports.
    Each element: (sql_string, params_tuple)
    """
    with _write_lock:
        conn = _writer_conn()
        try:
            for sql, params in statements:
                conn.execute(sql, params)
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()


# ── Seed data ─────────────────────────────────────────────────────────────────

_DEFAULT_TEMPLATES = [
    # upcoming
    ("upcoming", "mr",
     "प्रिय {name},\nआपल्या मालमत्ता कराची देय तारीख {due_date} येत आहे.\nकृपया मूळ कर ₹{amount} वेळेत भरावा.\n— {gram_panchayat}"),
    ("upcoming", "en",
     "Dear {name},\nYour property tax of ₹{amount} is due on {due_date}.\nPlease pay on time to avoid penalties.\n— {gram_panchayat}"),

    # rebate
    ("rebate", "mr",
     "प्रिय {name},\n{rebate_deadline} पूर्वी कर भरल्यास {rebate_percent}% सूट मिळेल.\nमूळ कर: ₹{amount} | सूट नंतरची रक्कम: ₹{total}\nलवकर भरा!\n— {gram_panchayat}"),
    ("rebate", "en",
     "Dear {name},\nPay your property tax before {rebate_deadline} and get {rebate_percent}% rebate!\nBase Tax: ₹{amount} | After Rebate: ₹{total}\nDon't miss this offer.\n— {gram_panchayat}"),

    # overdue
    ("overdue", "mr",
     "प्रिय {name},\nआपल्या मालमत्ता कराची देय तारीख ({due_date}) उलटून गेली आहे.\nकृपया देय रक्कम ₹{total} त्वरित भरावी.\n— {gram_panchayat}"),
    ("overdue", "en",
     "Dear {name},\nYour property tax was due on {due_date} and is now overdue.\nPlease pay ₹{total} immediately.\n— {gram_panchayat}"),

    # penalty
    ("penalty", "mr",
     "प्रिय {name},\nमालमत्ता कराची देय तारीख ({due_date}) उलटल्यावर दंड लागू झाला आहे.\nमूळ कर: ₹{amount}\nदंड: ₹{penalty_amount}\nएकूण देय: ₹{total}\nत्वरित भरणा करा.\n— {gram_panchayat}"),
    ("penalty", "en",
     "Dear {name},\nYour property tax due date ({due_date}) has passed.\nBase Tax: ₹{amount} | Penalty: ₹{penalty_amount} | Total Due: ₹{total}\nPlease pay immediately to stop further penalties.\n— {gram_panchayat}"),
]

_DEFAULT_CYCLE = {
    "fy_label":             "2025-26",
    "collection_from_month": 1,
    "collection_to_month":   3,
    "due_date":             "2026-03-31",
    "rebate_enabled":        0,
    "rebate_percent":        5.0,
    "rebate_deadline":      "2026-01-31",
    "penalty_type":         "flat",
    "penalty_value":         0.0,
    "penalty_start_days":    1,
    "is_active":             1,
}

_DEFAULT_CADENCE_PRE  = [30, 15, 7, 3, 1]
_DEFAULT_CADENCE_POST = [3, 7, 15, 30]

_DEFAULT_APP_SETTINGS = {
    "gram_panchayat_name": "Gram Panchayat Office",
    "gp_taluka":           "",
    "gp_district":         "",
}


def init_db() -> None:
    """
    Reads schema.sql and executes it.
    Seeds default cycle, cadence, templates, and app settings on first run.
    Safe to call multiple times — uses IF NOT EXISTS guards.
    """
    schema_path = pathlib.Path(__file__).parent / "schema.sql"
    schema_sql = schema_path.read_text(encoding="utf-8")

    with _write_lock:
        conn = _writer_conn()
        try:
            # Schema (IF NOT EXISTS guards — idempotent)
            conn.executescript(schema_sql)
            conn.commit()

            # Seed templates (INSERT OR IGNORE uses UNIQUE constraint)
            for tmpl_type, lang, body in _DEFAULT_TEMPLATES:
                conn.execute(
                    "INSERT OR IGNORE INTO message_templates (template_type, language, body) VALUES (?,?,?)",
                    (tmpl_type, lang, body)
                )

            # Seed app settings
            for key, val in _DEFAULT_APP_SETTINGS.items():
                conn.execute(
                    "INSERT OR IGNORE INTO app_settings (key, value) VALUES (?,?)",
                    (key, val)
                )

            # Seed default cycle only if none exists
            row = conn.execute("SELECT COUNT(*) FROM tax_cycle_settings").fetchone()
            if row[0] == 0:
                cur = conn.execute(
                    """INSERT INTO tax_cycle_settings
                       (fy_label, collection_from_month, collection_to_month,
                        due_date, rebate_enabled, rebate_percent, rebate_deadline,
                        penalty_type, penalty_value, penalty_start_days, is_active)
                       VALUES (:fy_label,:collection_from_month,:collection_to_month,
                                :due_date,:rebate_enabled,:rebate_percent,:rebate_deadline,
                                :penalty_type,:penalty_value,:penalty_start_days,:is_active)""",
                    _DEFAULT_CYCLE
                )
                cycle_id = cur.lastrowid
                for d in _DEFAULT_CADENCE_PRE:
                    conn.execute(
                        "INSERT INTO reminder_cadence (cycle_id,stage_type,days_offset) VALUES (?,?,?)",
                        (cycle_id, "pre_due", d)
                    )
                for d in _DEFAULT_CADENCE_POST:
                    conn.execute(
                        "INSERT INTO reminder_cadence (cycle_id,stage_type,days_offset) VALUES (?,?,?)",
                        (cycle_id, "post_due", d)
                    )

            conn.commit()
            log.info("Database initialised successfully at %s", DATABASE_PATH)
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()
