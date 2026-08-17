# Home Tax Reminder

Home Tax Reminder is a local Python/Eel application for managing home tax resident records, payment status, reminder templates, scheduled reminder checks, and Twilio SMS or WhatsApp reminder delivery.

## Repository Layout

- `app/` is the real product: Python backend, Eel frontend, SQLite schema, services, scheduler, and tests.
- `design-reference/` is a trimmed Figma Make React/Vite export kept only as a UI reference for future design or frontend work. It is not wired to `app/`.

## Run Locally

### Quick start (from repo root)

A launcher script at the repo root lets you start the app directly:

```powershell
python main.py
```

### Manual setup

1. Open a terminal in `app/`.
2. Create and activate a virtual environment:

```powershell
python -m venv venv
venv\Scripts\Activate.ps1
```

3. Install dependencies:

```powershell
pip install -r requirements.txt
```

4. Ensure `.env` exists (copy `.env.example` if needed, or edit the existing `.env`):

```powershell
Copy-Item .env.example .env   # if .env doesn't already exist
```

5. Edit `.env` as needed. Leave `DRY_RUN_MODE=true` while testing without sending real Twilio messages.

6. Start the app:

```powershell
python main.py
```

The SQLite database is created under `app/data/` at runtime.

## Running Tests

From inside `app/`:

```powershell
# Parse / Word import tests (no DB required)
venv\Scripts\python.exe tests\test_parse.py

# Full backend integration test suite
venv\Scripts\python.exe tests\test_backend_full.py
```

## Design Reference

The React/Vite files under `design-reference/` are source-only reference material from Figma Make. To inspect them separately, run the usual Node workflow inside that folder:

```powershell
npm install
npm run dev
```
