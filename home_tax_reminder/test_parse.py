"""
test_parse.py
Standalone test for word_import_service.parse_text().
Run: python test_parse.py  (no DB, no Eel required)
"""

import sys, json, pathlib
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
sys.path.insert(0, str(pathlib.Path(__file__).parent))

from services.word_import_service import parse_text, check_duplicates

# ── Test Case 1: Canonical spec example ──────────────────────────────────────
CASE_1 = """
Name: Ramesh Patil
Property ID: GP/2024/001
Ward: Ward 1
Amount: 2500
Phone: 9876543210
Address: Plot 12, Main Road
"""

# ── Test Case 2: Currency symbol, comma, Mobile: alias, extra whitespace ─────
CASE_2 = """
Name:   Sunita Deshmukh
Property ID: GP/2024/002
Ward:Ward 2
Mobile: 9123456789
Address: House 45, Shivaji Nagar
Tax Amount: ₹1,800
"""

# ── Test Case 3: Missing Property ID → should be SKIPPED ─────────────────────
CASE_3 = """
Name: Vijay Shinde
Ward: Ward 1
Phone: 9988776655
Amount: 3200
Address: Gat No 7, Near Temple
"""

# ── Test Case 4: Hyphen separator + Devanagari field alias ───────────────────
CASE_4 = """
नाव - Meena Jadhav
Property ID - GP/2024/004
Ward - Ward 3
Phone - 9765432100
Amount - ₹2,600.50
"""

# ── Test Case 5: Multiple blocks in one paste, including Case 3 ───────────────
MULTI_BLOCK_PASTE = "\n".join([CASE_1.strip(), "", CASE_2.strip(), "", CASE_3.strip(), "", CASE_4.strip()])

# ── Check duplicate detection ─────────────────────────────────────────────────
EXISTING_IDS = ["GP/2024/001", "GP/2024/003"]   # 001 is a duplicate

def run():
    sep = "─" * 60

    # Individual block tests
    for label, text, expect_count in [
        ("Case 1 — Canonical spec example",           CASE_1, 1),
        ("Case 2 — Currency symbol + Mobile alias",   CASE_2, 1),
        ("Case 3 — Missing Property ID (should skip)",CASE_3, 0),
        ("Case 4 — Hyphen separator + Devanagari key",CASE_4, 1),
    ]:
        result = parse_text(text)
        status = "✓ PASS" if len(result) == expect_count else f"✗ FAIL (got {len(result)}, want {expect_count})"
        print(f"\n{sep}")
        print(f"  {label}")
        print(f"  Status: {status}")
        for rec in result:
            clean = {k: v for k, v in rec.items() if not k.startswith("_")}
            print(f"  Parsed: {json.dumps(clean, ensure_ascii=False, indent=4)}")

    # Multi-block paste test
    print(f"\n{sep}")
    print("  Multi-block paste (Cases 1+2+3+4)")
    multi = parse_text(MULTI_BLOCK_PASTE)
    print(f"  Blocks extracted: {len(multi)}  (expected 3 — case 3 skipped)")
    for rec in multi:
        clean = {k: v for k, v in rec.items() if not k.startswith("_")}
        print(f"    → {json.dumps(clean, ensure_ascii=False)}")

    # Duplicate detection test
    print(f"\n{sep}")
    print("  Duplicate detection (existing IDs: GP/2024/001, GP/2024/003)")
    new_recs, dup_recs = check_duplicates(multi, EXISTING_IDS)
    print(f"  New:        {len(new_recs)}  (expected 2: GP/2024/002 + GP/2024/004)")
    print(f"  Duplicates: {len(dup_recs)}  (expected 1: GP/2024/001)")
    for r in dup_recs:
        print(f"    ↳ DUPLICATE: {r['property_id']} — {r['name']}")

    print(f"\n{sep}")
    print("  All tests complete.\n")

if __name__ == "__main__":
    run()
