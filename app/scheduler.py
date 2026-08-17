"""
scheduler.py
APScheduler BackgroundScheduler — one daily job at REMINDER_HOUR:REMINDER_MINUTE.
Started from main.py; runs inside the Eel process alongside the UI thread.
"""

import logging
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from config import REMINDER_HOUR, REMINDER_MINUTE

log = logging.getLogger(__name__)

_scheduler: BackgroundScheduler | None = None


def _run_job() -> None:
    """Wrapper so APScheduler can import this without circular deps."""
    from services.reminder_engine import run_daily_check
    try:
        result = run_daily_check()
        log.info("Scheduled job result: %s", result)
    except Exception as e:
        log.exception("Scheduled job raised an exception: %s", e)


def start_scheduler() -> None:
    global _scheduler
    if _scheduler and _scheduler.running:
        log.warning("Scheduler already running — ignoring start_scheduler() call")
        return

    _scheduler = BackgroundScheduler(
        job_defaults={"misfire_grace_time": 3600},  # run up to 1h late if machine was asleep
    )
    _scheduler.add_job(
        func=_run_job,
        trigger=CronTrigger(hour=REMINDER_HOUR, minute=REMINDER_MINUTE, timezone="Asia/Kolkata"),
        id="daily_reminder",
        replace_existing=True,
    )
    _scheduler.start()
    log.info("APScheduler started. Daily job at %02d:%02d IST", REMINDER_HOUR, REMINDER_MINUTE)


def stop_scheduler() -> None:
    global _scheduler
    if _scheduler and _scheduler.running:
        _scheduler.shutdown(wait=False)
        log.info("APScheduler stopped")


def get_scheduler_status() -> dict:
    if not _scheduler:
        return {"running": False, "next_run": None}
    jobs = _scheduler.get_jobs()
    next_run = None
    if jobs:
        nr = jobs[0].next_run_time
        next_run = nr.isoformat() if nr else None
    return {
        "running":  _scheduler.running,
        "next_run": next_run,
        "job_count": len(jobs),
    }


def trigger_now() -> dict:
    """Manually trigger the daily job immediately (for testing from UI)."""
    from services.reminder_engine import run_daily_check
    try:
        result = run_daily_check()
        return {"status": "done", "result": result}
    except Exception as e:
        log.exception("Manual trigger failed: %s", e)
        return {"status": "error", "error": str(e)}
