"""
migrations/001_resident_payments.py
====================================
One-time migration: creates resident_payments table and seeds it from the
existing residents.payment_status / paid_date columns using the current
active FY as the cycle_id.

SAFE TO RE-RUN — uses INSERT OR IGNORE so it will never duplicate rows.

After you confirm the output looks correct, drop the old columns manually:
    ALTER TABLE residents DROP COLUMN payment_status;
    ALTER TABLE residents DROP COLUMN paid_date;
(SQLite 3.35+ only. Older SQLite: recreate the table without those columns.)
"""

import sqlite3
import pathlib
import sys

# ── Resolve paths ─────────────────────────────────────────────────────────────
SCRIPT_DIR = pathlib.Path(__file__).parent          # HOME_TAX_REMINDER/app/migrations/
APP_DIR    = SCRIPT_DIR.parent                      # HOME_TAX_REMINDER/app/
ROOT_DIR   = APP_DIR.parent                         # HOME_TAX_REMINDER/
DB_PATH    = ROOT_DIR / "data" / "tax_reminder.db"

# Add the schema for resident_payments
RESIDENT_PAYMENTS_DDL = """
CREATE TABLE IF NOT EXISTS resident_payments (
    id                          INTEGER PRIMARY KEY AUTOINCREMENT,
    resident_id                 INTEGER NOT NULL REFERENCES residents(id) ON DELETE CASCADE,
    cycle_id                    INTEGER NOT NULL REFERENCES tax_cycle_settings(id),
    base_amount                 REAL    NOT NULL,
    penalty_amount              REAL    NOT NULL DEFAULT 0,
    status                      TEXT    NOT NULL CHECK(status IN ('paid','unpaid','overdue')),
    paid_date                   TEXT,
    carry_forward_from_cycle_id INTEGER REFERENCES tax_cycle_settings(id),
    created_at                  TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(resident_id, cycle_id)
);
CREATE INDEX IF NOT EXISTS idx_resident_payments_cycle    ON resident_payments(cycle_id);
CREATE INDEX IF NOT EXISTS idx_resident_payments_resident ON resident_payments(resident_id);
"""


def run_migration():
    if not DB_PATH.exists():
        print(f"ERROR: Database not found at {DB_PATH}")
        sys.exit(1)

    print(f"Database: {DB_PATH}")
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")

    # ── Step 1: Create resident_payments table ────────────────────────────────
    print("\n[Step 1] Creating resident_payments table if not exists...")
    conn.executescript(RESIDENT_PAYMENTS_DDL)
    conn.commit()
    print("         Done.")

    # ── Step 2: Get active cycle ──────────────────────────────────────────────
    print("\n[Step 2] Fetching active tax cycle...")
    cycle_row = conn.execute(
        "SELECT id, fy_label FROM tax_cycle_settings WHERE is_active=1 ORDER BY id DESC LIMIT 1"
    ).fetchone()

    if not cycle_row:
        print("         WARNING: No active tax cycle found.")
        active_cycle_id = None
        fy_label = "N/A"
    else:
        active_cycle_id = cycle_row["id"]
        fy_label = cycle_row["fy_label"]
    print(f"         Active cycle: id={active_cycle_id}, fy_label={fy_label}")

    if active_cycle_id is None:
        print("\nABORTED: Cannot migrate without an active cycle. Configure one in Settings first.")
        conn.close()
        sys.exit(1)

    # ── Step 3: Count residents with a non-null payment_status ───────────────
    print("\n[Step 3] Inspecting residents table...")

    col_names = [c[1] for c in conn.execute("PRAGMA table_info(residents)").fetchall()]
    if "payment_status" not in col_names:
        print("         residents.payment_status column not found.")
        print("         Migration already ran or schema mismatch. Skipping seed step.")
        print_counts(conn)
        conn.close()
        return

    all_residents = conn.execute(
        "SELECT id, name, property_id, base_amount, payment_status, paid_date FROM residents"
    ).fetchall()

    residents_with_status = [r for r in all_residents if r["payment_status"]]
    residents_null_status  = [r for r in all_residents if not r["payment_status"]]
    ambiguous = []

    print(f"         Total residents:               {len(all_residents)}")
    print(f"         With payment_status:           {len(residents_with_status)}")
    print(f"         With NULL/empty payment_status: {len(residents_null_status)}")

    if residents_null_status:
        print("\n         WARNING: residents with no payment_status (will be inserted as 'unpaid'):")
        for r in residents_null_status:
            print(f"           - id={r['id']} | {r['name']} | property_id={r['property_id']}")
            ambiguous.append(dict(r))

    # ── Step 4: Seed resident_payments ───────────────────────────────────────
    print(f"\n[Step 4] Seeding resident_payments for cycle_id={active_cycle_id} ({fy_label})...")

    inserted = 0
    skipped  = 0
    errors   = []

    for r in all_residents:
        raw_status = (r["payment_status"] or "").strip().lower()
        if raw_status not in ("paid", "unpaid", "overdue"):
            raw_status = "unpaid"
        paid_date = r["paid_date"] if raw_status == "paid" else None
        base_amount = r["base_amount"] if r["base_amount"] else 0.0

        try:
            conn.execute(
                """INSERT OR IGNORE INTO resident_payments
                   (resident_id, cycle_id, base_amount, penalty_amount,
                    status, paid_date, carry_forward_from_cycle_id)
                   VALUES (?, ?, ?, 0, ?, ?, NULL)""",
                (r["id"], active_cycle_id, base_amount, raw_status, paid_date)
            )
            changes = conn.execute("SELECT changes()").fetchone()[0]
            if changes:
                inserted += 1
            else:
                skipped += 1
        except Exception as e:
            errors.append({"resident_id": r["id"], "name": r["name"], "error": str(e)})

    conn.commit()

    print(f"         Inserted: {inserted}")
    print(f"         Skipped (already existed): {skipped}")
    if errors:
        print(f"\n         ERRORS ({len(errors)}):")
        for err in errors:
            print(f"           - resident_id={err['resident_id']} ({err['name']}): {err['error']}")

    # ── Step 5: Verification ──────────────────────────────────────────────────
    print_counts(conn)

    # ── Step 6: Manual confirmation reminder ─────────────────────────────────
    print("\n" + "="*60)
    print("MANUAL CONFIRMATION REQUIRED before dropping old columns:")
    print("")
    print("  1. Review the counts above - they should match.")
    print("  2. Run the app and verify yearly records page looks correct.")
    print("  3. ONLY THEN run in SQLite CLI (requires SQLite 3.35+):")
    print("       ALTER TABLE residents DROP COLUMN payment_status;")
    print("       ALTER TABLE residents DROP COLUMN paid_date;")
    print("")
    print("  The old columns are currently LEFT IN PLACE (unused by new code).")
    print("="*60)

    if ambiguous:
        print("\nWARNING: Ambiguous records (listed above) were inserted as 'unpaid'.")
        print("  Review these manually and update their status if needed.")

    conn.close()


def print_counts(conn):
    total_residents = conn.execute("SELECT COUNT(*) FROM residents").fetchone()[0]
    total_payments  = conn.execute("SELECT COUNT(*) FROM resident_payments").fetchone()[0]
    paid_count      = conn.execute("SELECT COUNT(*) FROM resident_payments WHERE status='paid'").fetchone()[0]
    unpaid_count    = conn.execute("SELECT COUNT(*) FROM resident_payments WHERE status='unpaid'").fetchone()[0]
    overdue_count   = conn.execute("SELECT COUNT(*) FROM resident_payments WHERE status='overdue'").fetchone()[0]

    print("\n-- Row-count Verification --")
    print(f"  residents total:           {total_residents}")
    print(f"  resident_payments total:   {total_payments}")
    print(f"    -> paid:    {paid_count}")
    print(f"    -> unpaid:  {unpaid_count}")
    print(f"    -> overdue: {overdue_count}")

    match = "MATCH OK" if total_payments == total_residents else "MISMATCH - investigate before proceeding"
    print(f"\n  Count comparison:          {match}")
    print("----------------------------")


if __name__ == "__main__":
    run_migration()
