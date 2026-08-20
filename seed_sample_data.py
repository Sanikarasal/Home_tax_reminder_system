"""
seed_sample_data.py
Populates realistic sample data across multiple financial years (2023-24, 2024-25, 2025-26)
to demonstrate yearly payment tracking, carry-forward overdue flags, and payment history.
"""

import sqlite3
import pathlib
import sys
import os

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

ROOT_DIR = pathlib.Path(__file__).parent
DB_PATHS = [
    ROOT_DIR / "data" / "tax_reminder.db",
    ROOT_DIR / "app" / "data" / "tax_reminder.db"
]

def seed_db(db_path: pathlib.Path):
    db_path.parent.mkdir(parents=True, exist_ok=True)
    print(f"\n=======================================================")
    print(f"Seeding Database: {db_path}")
    print(f"=======================================================")

    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    conn.execute("PRAGMA journal_mode = WAL;")

    # Ensure schema tables exist
    schema_file = ROOT_DIR / "app" / "database" / "schema.sql"
    if schema_file.exists():
        conn.executescript(schema_file.read_text(encoding="utf-8"))
        conn.commit()

    print("Clearing existing residents and payments data...")
    conn.execute("DELETE FROM resident_payments")
    conn.execute("DELETE FROM reminder_log")
    conn.execute("DELETE FROM residents")
    conn.execute("DELETE FROM reminder_cadence")
    conn.execute("DELETE FROM tax_cycle_settings")
    conn.commit()

    print("\n--- 1. Creating Tax Cycles (Financial Years) ---")
    cycles = [
        {
            "fy_label": "2023-24",
            "collection_from_month": 1,
            "collection_to_month": 3,
            "due_date": "2024-03-31",
            "rebate_enabled": 1,
            "rebate_percent": 5.0,
            "rebate_deadline": "2024-01-31",
            "penalty_type": "flat",
            "penalty_value": 100.0,
            "penalty_start_days": 1,
            "is_active": 0
        },
        {
            "fy_label": "2024-25",
            "collection_from_month": 1,
            "collection_to_month": 3,
            "due_date": "2025-03-31",
            "rebate_enabled": 1,
            "rebate_percent": 5.0,
            "rebate_deadline": "2025-01-31",
            "penalty_type": "flat",
            "penalty_value": 150.0,
            "penalty_start_days": 1,
            "is_active": 0
        },
        {
            "fy_label": "2025-26",
            "collection_from_month": 1,
            "collection_to_month": 3,
            "due_date": "2026-03-31",
            "rebate_enabled": 1,
            "rebate_percent": 5.0,
            "rebate_deadline": "2026-01-31",
            "penalty_type": "percent",
            "penalty_value": 10.0,
            "penalty_start_days": 1,
            "is_active": 1
        }
    ]

    cycle_ids = {}
    for c in cycles:
        cur = conn.execute("""
            INSERT INTO tax_cycle_settings 
            (fy_label, collection_from_month, collection_to_month, due_date,
             rebate_enabled, rebate_percent, rebate_deadline, penalty_type,
             penalty_value, penalty_start_days, is_active)
            VALUES (:fy_label, :collection_from_month, :collection_to_month, :due_date,
                    :rebate_enabled, :rebate_percent, :rebate_deadline, :penalty_type,
                    :penalty_value, :penalty_start_days, :is_active)
        """, c)
        cid = cur.lastrowid
        cycle_ids[c["fy_label"]] = cid
        print(f"Created Tax Cycle {c['fy_label']} (ID: {cid}, Active: {c['is_active']})")

        # Cadence offsets
        for offset in [30, 15, 7, 3, 1]:
            conn.execute("INSERT INTO reminder_cadence (cycle_id, stage_type, days_offset) VALUES (?, 'pre_due', ?)", (cid, offset))
        for offset in [3, 7, 15, 30]:
            conn.execute("INSERT INTO reminder_cadence (cycle_id, stage_type, days_offset) VALUES (?, 'post_due', ?)", (cid, offset))

    print("\n--- 2. Creating Residents (Master Details) ---")
    residents_data = [
        {
            "name": "Ramesh Dattatray Patil (रमेश पाटील)",
            "property_id": "GP/W1/001",
            "ward": "Ward 1 (गावठाण)",
            "phone": "9822101010",
            "address": "House No. 12, Main Bazar Road",
            "base_amount": 2400.0,
            "current_status": "paid",
            "paid_date": "2026-01-20"
        },
        {
            "name": "Sunita Sanjay Deshmukh (सुनिता देशमुख)",
            "property_id": "GP/W1/002",
            "ward": "Ward 1 (गावठाण)",
            "phone": "9822202020",
            "address": "House No. 24, Near Maruti Temple",
            "base_amount": 1800.0,
            "current_status": "unpaid",
            "paid_date": None
        },
        {
            "name": "Vijay Ananda Shinde (विजय शिंदे)",
            "property_id": "GP/W2/001",
            "ward": "Ward 2 (शिवाजी नगर)",
            "phone": "9822303030",
            "address": "Plot No. 45, Shivaji Chowk",
            "base_amount": 3200.0,
            "current_status": "unpaid",
            "paid_date": None
        },
        {
            "name": "Anand Babanrao Jadhav (आनंद जाधव)",
            "property_id": "GP/W2/002",
            "ward": "Ward 2 (शिवाजी नगर)",
            "phone": "9822404040",
            "address": "Lane 3, Behind School",
            "base_amount": 2100.0,
            "current_status": "paid",
            "paid_date": "2026-02-10"
        },
        {
            "name": "Priya Rajesh Kulkarni (प्रिया कुलकर्णी)",
            "property_id": "GP/W3/001",
            "ward": "Ward 3 (गणेश कॉलनी)",
            "phone": "9822505050",
            "address": "Bungalow 7, Ganesh Colony",
            "base_amount": 3500.0,
            "current_status": "unpaid",
            "paid_date": None
        },
        {
            "name": "Ganesh Tukaram Pawar (गणेश पवार)",
            "property_id": "GP/W3/002",
            "ward": "Ward 3 (गणेश कॉलनी)",
            "phone": "9822606060",
            "address": "Gat No. 112, Farm Road",
            "base_amount": 1500.0,
            "current_status": "overdue",
            "paid_date": None
        },
        {
            "name": "Sneha Rahul More (स्नेहा मोरे)",
            "property_id": "GP/W4/001",
            "ward": "Ward 4 (आंबेडकर नगर)",
            "phone": "9822707070",
            "address": "House No. 89, Near Water Tank",
            "base_amount": 2800.0,
            "current_status": "paid",
            "paid_date": "2026-01-15"
        },
        {
            "name": "Kailas Bhimrao Gaikwad (कैलास गायकवाड)",
            "property_id": "GP/W4/002",
            "ward": "Ward 4 (आंबेडकर नगर)",
            "phone": "9822808080",
            "address": "House No. 104, Station Road",
            "base_amount": 2000.0,
            "current_status": "unpaid",
            "paid_date": None
        }
    ]

    res_ids = {}
    for r in residents_data:
        cur = conn.execute("""
            INSERT INTO residents 
            (name, property_id, ward, phone, address, base_amount, payment_status, paid_date)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            r["name"], r["property_id"], r["ward"], r["phone"], r["address"],
            r["base_amount"], r["current_status"], r["paid_date"]
        ))
        rid = cur.lastrowid
        res_ids[r["property_id"]] = rid
        print(f"Created Resident {r['name']} ({r['property_id']}) -> ID: {rid}")

    print("\n--- 3. Creating Year-wise Payment Records (resident_payments) ---")
    
    payments = [
        # 1. Ramesh Patil: Consistent on-time payer in all years
        {"res": "GP/W1/001", "fy": "2023-24", "amount": 2200, "penalty": 0, "status": "paid", "paid_date": "2024-01-25", "carry": None},
        {"res": "GP/W1/001", "fy": "2024-25", "amount": 2300, "penalty": 0, "status": "paid", "paid_date": "2025-01-18", "carry": None},
        {"res": "GP/W1/001", "fy": "2025-26", "amount": 2400, "penalty": 0, "status": "paid", "paid_date": "2026-01-20", "carry": None},

        # 2. Sunita Deshmukh: Paid 2023-24, Missed 2024-25 (Overdue), Unpaid 2025-26 (Carrying forward 2024-25!)
        {"res": "GP/W1/002", "fy": "2023-24", "amount": 1600, "penalty": 0, "status": "paid", "paid_date": "2024-02-14", "carry": None},
        {"res": "GP/W1/002", "fy": "2024-25", "amount": 1700, "penalty": 150, "status": "overdue", "paid_date": None, "carry": None},
        {"res": "GP/W1/002", "fy": "2025-26", "amount": 1800, "penalty": 0, "status": "unpaid", "paid_date": None, "carry": "2024-25"},

        # 3. Vijay Shinde: Missed 2023-24 (overdue), Paid 2024-25, Unpaid 2025-26 (due now)
        {"res": "GP/W2/001", "fy": "2023-24", "amount": 3000, "penalty": 100, "status": "overdue", "paid_date": None, "carry": None},
        {"res": "GP/W2/001", "fy": "2024-25", "amount": 3100, "penalty": 0, "status": "paid", "paid_date": "2025-03-20", "carry": "2023-24"},
        {"res": "GP/W2/001", "fy": "2025-26", "amount": 3200, "penalty": 0, "status": "unpaid", "paid_date": None, "carry": "2023-24"},

        # 4. Anand Jadhav: Built house in 2024-25. Paid 2024-25, Paid 2025-26
        {"res": "GP/W2/002", "fy": "2024-25", "amount": 2000, "penalty": 0, "status": "paid", "paid_date": "2025-02-05", "carry": None},
        {"res": "GP/W2/002", "fy": "2025-26", "amount": 2100, "penalty": 0, "status": "paid", "paid_date": "2026-02-10", "carry": None},

        # 5. Priya Kulkarni: Paid 2023-24, Paid 2024-25, Unpaid 2025-26
        {"res": "GP/W3/001", "fy": "2023-24", "amount": 3300, "penalty": 0, "status": "paid", "paid_date": "2024-03-10", "carry": None},
        {"res": "GP/W3/001", "fy": "2024-25", "amount": 3400, "penalty": 0, "status": "paid", "paid_date": "2025-03-15", "carry": None},
        {"res": "GP/W3/001", "fy": "2025-26", "amount": 3500, "penalty": 0, "status": "unpaid", "paid_date": None, "carry": None},

        # 6. Ganesh Pawar: Chronic Defaulter - Overdue 2023-24, Overdue 2024-25, Overdue 2025-26
        {"res": "GP/W3/002", "fy": "2023-24", "amount": 1300, "penalty": 100, "status": "overdue", "paid_date": None, "carry": None},
        {"res": "GP/W3/002", "fy": "2024-25", "amount": 1400, "penalty": 150, "status": "overdue", "paid_date": None, "carry": "2023-24"},
        {"res": "GP/W3/002", "fy": "2025-26", "amount": 1500, "penalty": 150, "status": "overdue", "paid_date": None, "carry": "2024-25"},

        # 7. Sneha More: Paid early all years
        {"res": "GP/W4/001", "fy": "2023-24", "amount": 2600, "penalty": 0, "status": "paid", "paid_date": "2024-01-10", "carry": None},
        {"res": "GP/W4/001", "fy": "2024-25", "amount": 2700, "penalty": 0, "status": "paid", "paid_date": "2025-01-12", "carry": None},
        {"res": "GP/W4/001", "fy": "2025-26", "amount": 2800, "penalty": 0, "status": "paid", "paid_date": "2026-01-15", "carry": None},

        # 8. Kailas Gaikwad: Paid 2023-24, Missed 2024-25 (overdue), Unpaid 2025-26
        {"res": "GP/W4/002", "fy": "2023-24", "amount": 1800, "penalty": 0, "status": "paid", "paid_date": "2024-03-01", "carry": None},
        {"res": "GP/W4/002", "fy": "2024-25", "amount": 1900, "penalty": 150, "status": "overdue", "paid_date": None, "carry": None},
        {"res": "GP/W4/002", "fy": "2025-26", "amount": 2000, "penalty": 0, "status": "unpaid", "paid_date": None, "carry": "2024-25"}
    ]

    for p in payments:
        rid = res_ids[p["res"]]
        cid = cycle_ids[p["fy"]]
        carry_id = cycle_ids[p["carry"]] if p["carry"] else None

        conn.execute("""
            INSERT INTO resident_payments 
            (resident_id, cycle_id, base_amount, penalty_amount, status, paid_date, carry_forward_from_cycle_id)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (rid, cid, p["amount"], p["penalty"], p["status"], p["paid_date"], carry_id))

        print(f"  -> Payment: Resident #{rid} ({p['res']}) | FY {p['fy']} | ₹{p['amount']} | Status: {p['status'].upper()} | Carry: {p['carry']}")

    conn.commit()
    conn.close()
    print(f"✅ Finished seeding {db_path}!")

def seed():
    for db_path in DB_PATHS:
        seed_db(db_path)
    print("\n🎉 All databases seeded successfully!")

if __name__ == "__main__":
    seed()
