-- Home Tax Reminder Manager — SQLite Schema
-- All date fields use ISO 8601 text: 'YYYY-MM-DD'
-- Boolean fields use INTEGER 0/1

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ── Residents / Taxpayers ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS residents (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT    NOT NULL,
    property_id     TEXT    UNIQUE NOT NULL,
    ward            TEXT    DEFAULT '',
    phone           TEXT    NOT NULL,
    address         TEXT    DEFAULT '',
    base_amount     REAL    NOT NULL DEFAULT 0,
    payment_status  TEXT    NOT NULL DEFAULT 'unpaid',   -- 'unpaid' | 'paid'
    paid_date       TEXT,                                 -- ISO date, NULL if unpaid
    created_at      TEXT    DEFAULT (datetime('now'))
);

-- ── Tax Cycle Settings (one active row per FY) ───────────────────────────────
CREATE TABLE IF NOT EXISTS tax_cycle_settings (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    fy_label              TEXT    NOT NULL,                -- e.g. '2025-26'
    collection_from_month INTEGER DEFAULT 1,               -- 1-12
    collection_to_month   INTEGER DEFAULT 3,               -- 1-12
    due_date              TEXT    NOT NULL,                 -- ISO date
    rebate_enabled        INTEGER DEFAULT 0,               -- 0 | 1
    rebate_percent        REAL    DEFAULT 0,
    rebate_deadline       TEXT    DEFAULT '',              -- ISO date; < due_date
    penalty_type          TEXT    DEFAULT 'flat',          -- 'flat' | 'percent'
    penalty_value         REAL    DEFAULT 0,
    penalty_start_days    INTEGER DEFAULT 1,               -- days after due_date
    is_active             INTEGER DEFAULT 1,               -- only one active cycle
    created_at            TEXT    DEFAULT (datetime('now'))
);

-- ── Reminder Cadence (pre/post-due day offsets per cycle) ───────────────────
CREATE TABLE IF NOT EXISTS reminder_cadence (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    cycle_id    INTEGER NOT NULL REFERENCES tax_cycle_settings(id) ON DELETE CASCADE,
    stage_type  TEXT    NOT NULL,   -- 'pre_due' | 'post_due'
    days_offset INTEGER NOT NULL    -- e.g. 30, 15, 7, 3, 1
);

-- ── Bilingual Message Templates ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS message_templates (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    template_type TEXT    NOT NULL,   -- 'upcoming' | 'rebate' | 'overdue' | 'penalty'
    language      TEXT    NOT NULL,   -- 'mr' | 'en'
    body          TEXT    NOT NULL,
    UNIQUE (template_type, language)
);

-- ── Reminder Log (every send attempt, for dedup + failed-send dashboard) ─────
CREATE TABLE IF NOT EXISTS reminder_log (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    resident_id   INTEGER NOT NULL REFERENCES residents(id) ON DELETE CASCADE,
    cycle_id      INTEGER NOT NULL REFERENCES tax_cycle_settings(id),
    stage_type    TEXT    NOT NULL,   -- 'pre_due' | 'post_due' | 'rebate'
    days_offset   INTEGER NOT NULL,
    channel       TEXT    NOT NULL,   -- 'sms' | 'whatsapp'
    status        TEXT    NOT NULL,   -- 'sent' | 'failed'
    error_message TEXT    DEFAULT '', -- category string on failure, '' on success
    sent_at       TEXT    DEFAULT (datetime('now'))
);

-- ── Indexes ───────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_residents_status   ON residents(payment_status);
CREATE INDEX IF NOT EXISTS idx_residents_ward     ON residents(ward);
CREATE INDEX IF NOT EXISTS idx_log_resident       ON reminder_log(resident_id, cycle_id, stage_type, status);
CREATE INDEX IF NOT EXISTS idx_log_status         ON reminder_log(status);
CREATE INDEX IF NOT EXISTS idx_cadence_cycle      ON reminder_cadence(cycle_id);
CREATE INDEX IF NOT EXISTS idx_cycle_active       ON tax_cycle_settings(is_active);

-- ── App Metadata (GP office name, etc.) ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS app_settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL DEFAULT ''
);
