import sys
import os

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

sys.path.insert(0, os.path.abspath("app"))

from services import resident_service, settings_service

print("=== 1. ALL TAX CYCLES (FINANCIAL YEARS) ===")
cycles = settings_service.get_all_cycles()
for c in cycles:
    print(f"ID: {c['id']} | FY {c['fy_label']} | Due Date: {c['due_date']} | Active: {c['is_active']}")

print("\n=== 2. YEAR-WISE BREAKDOWN ===")
for c in cycles:
    p = resident_service.get_payments_by_cycle(c["id"])
    print(f"\n--- Financial Year {c['fy_label']} (Total: {len(p['paid']) + len(p['unpaid'])}) ---")
    print(f"  Paid ({len(p['paid'])}):")
    for r in p["paid"]:
        print(f"    ✓ {r['name']} ({r['property_id']}) - ₹{r['base_amount']} on {r['paid_date']}")
    print(f"  Unpaid / Overdue ({len(p['unpaid'])}):")
    for r in p["unpaid"]:
        carry = f" [Carry-forward from FY {r['carry_forward_fy_label']}]" if r["carry_forward_from_cycle_id"] else ""
        print(f"    ✗ {r['name']} ({r['property_id']}) - ₹{r['base_amount']} ({r['status'].upper()}){carry}")

print("\n=== 3. INDIVIDUAL RESIDENT PAYMENT HISTORY ===")
all_residents = resident_service.get_all_residents()
for r in all_residents[:3]:
    hist = resident_service.get_resident_payment_history(r["id"])
    print(f"\nPayment History for {r['name']} ({r['property_id']}):")
    for h in hist:
        carry = f" (Carry-forward from FY {h['carry_forward_fy_label']})" if h["carry_forward_from_cycle_id"] else ""
        paid_dt = f", Paid on {h['paid_date']}" if h['paid_date'] else ""
        print(f"  • FY {h['fy_label']} -> Status: {h['status'].upper()}, Amount: ₹{h['base_amount']}{paid_dt}{carry}")

print("\nVerification complete!")
