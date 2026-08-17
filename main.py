"""
main.py — Root-level launcher for Home Tax Reminder.

Run from the repo root:
    python main.py

This launcher:
  1. Sets the working directory to app/ so relative paths (eel.init("web"),
     data/tax_reminder.db, .env, app.log) resolve accurately.
  2. Runs app/main.py as __main__ to start the Eel UI and APScheduler.
"""

import os
import sys
import runpy

_launcher_dir = os.path.dirname(os.path.abspath(__file__))
_app_dir = os.path.join(_launcher_dir, "app")

if not os.path.isdir(_app_dir):
    print(f"ERROR: Could not find app/ folder at: {_app_dir}")
    sys.exit(1)

os.chdir(_app_dir)

if _app_dir not in sys.path:
    sys.path.insert(0, _app_dir)

runpy.run_path(os.path.join(_app_dir, "main.py"), run_name="__main__")
