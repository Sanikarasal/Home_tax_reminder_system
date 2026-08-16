# Plan: Global Tax Cycle Configuration & Simplified Records

## Context

The app currently stores per-record due dates, reminder schedules, and penalty settings — making it hard for GP staff to update settings each financial year without touching each record individually. This change moves all of that to a single **Tax Cycle Configuration** in Settings. Per-record forms become simpler (7 fields only). All reminder scheduling, penalty calculation, and rebate logic derives from the global config.

---

## Key file

**Single file:** `src/App.tsx` (1,219 lines, all inline styles)

---

## 1 · New / Updated Types

### `TaxCycleConfig` (new interface, top of file)
```ts
interface TaxCycleConfig {
  fromMonth: number          // 1–12 (collection period start)
  toMonth: number            // 1–12 (collection period end)
  dueDate: string            // ISO date "2026-03-31"
  rebateEnabled: boolean
  rebatePercent: number
  rebateDeadline: string     // ISO date — must be before dueDate
  penaltyType: "flat" | "percentage"
  penaltyValue: number
  penaltyStartDays: number   // days after due date before penalty kicks in (default 1)
  preReminders: number[]     // days before due date [30,15,7,3,1]
  postReminders: number[]    // days after due date [3,7,15,30]
}
```

`defaultTaxCycle` constant with sensible defaults (FY Jan–Mar, due 31-Mar-2026, rebate off, 2%/month penalty, cadences [30,15,7,3,1] / [3,7,15,30]).

### `TaxRecord` (simplified — remove 6 fields)
Remove: `dueDate`, `reminderDates`, `reminderType`, `autoReminderDays`, `penaltyType`, `penaltyFlat`, `penaltyPercent`  
Keep: `id`, `name`, `address`, `propertyId`, `amount`, `paidDate?`, `status`, `phone`, `ward`, `paid`, `messageLogs`

### `ReminderTemplates` (add rebate template)
```ts
interface ReminderTemplates {
  reminder: { mr: string; en: string }
  overdue:  { mr: string; en: string }
  penalty:  { mr: string; en: string }
  rebate:   { mr: string; en: string }   // new
}
```

`defaultTemplates.rebate` — bilingual early-payment rebate nudge using `{rebate_deadline}` and `{rebate_percent}`.

### Types to remove
`ReminderType` and `PenaltyType` become unused — delete them.

---

## 2 · Updated Utility Functions

### `computeStatus(paid: boolean, dueDate: string): Status`
Same logic, but signature takes `dueDate` as argument (now always the global one).

### `computePenalty(r: TaxRecord, cycle: TaxCycleConfig): number`
- If paid → 0
- If `daysOverdue(cycle.dueDate) < cycle.penaltyStartDays` → 0
- flat: `cycle.penaltyValue * months`
- percentage: `round(r.amount * cycle.penaltyValue / 100 * months)`

### `computeRebate(r: TaxRecord, cycle: TaxCycleConfig): number` (new)
- If `!cycle.rebateEnabled || !r.paid || !r.paidDate` → 0
- If `r.paidDate <= cycle.rebateDeadline` → `round(r.amount * cycle.rebatePercent / 100)`
- else → 0

### `totalDue(r: TaxRecord, cycle: TaxCycleConfig): number`
`r.amount + computePenalty(r, cycle)`  (rebate subtracted separately for display)

### `getScheduledDates(cycle: TaxCycleConfig): string[]` (new)
Returns sorted array of ISO date strings for all pre- and post-due cadence dates.

### `getReminderStageLabel(cycle: TaxCycleConfig): string | null` (new)
Checks if today matches any cadence offset; returns human label like `"15 days before due"` or `"7 days overdue"`, else null.

### `renderMessageTemplate`
Add replacements for `{rebate_deadline}` → `formatDate(cycle.rebateDeadline)`, `{rebate_percent}` → `cycle.rebatePercent`, `{penalty_amount}` → `computePenalty(r, cycle)`.  
Signature: `renderMessageTemplate(tpl, r, gramName, cycle)`.

### `autoReminderDate` — keep (still used in SettingsView cadence preview)

---

## 3 · Sample Data

Update all 5 sample records to remove `dueDate`, `reminderDates`, `reminderType`, `autoReminderDays`, `penaltyType`, `penaltyFlat`, `penaltyPercent`. Change localStorage key to `gp_tax_records_v4` so old data is not loaded.

---

## 4 · `emptyRecord()`

Remove the 7 obsolete fields. Result: `{ name, address, propertyId, amount: 0, phone, ward, paid: false, messageLogs: [] }`.

---

## 5 · App Component

### New state
```ts
const [taxCycle, setTaxCycle] = useState<TaxCycleConfig>(() => {
  try { const s = localStorage.getItem("gp_tax_cycle_v1"); return s ? JSON.parse(s) : defaultTaxCycle }
  catch { return defaultTaxCycle }
})
```
Add `useEffect` to persist `taxCycle`.  
Remove `defaultAutodays` / `setDefaultAutodays` state.

### Updated derived state
```ts
const liveRecords = records.map(r => ({ ...r, status: computeStatus(r.paid, taxCycle.dueDate) }))
const reminderDue = liveRecords.filter(r => !r.paid && getReminderStageLabel(taxCycle) !== null)
```

`dueThisWeek` now compares against `taxCycle.dueDate` (single date).

### Updated `handleSave`
Remove `dueDate` from required-field check. Remove `computeStatus(form.dueDate, ...)` → use `computeStatus(form.paid, taxCycle.dueDate)`.

### Updated `handleFormChange`
Remove all reminder-date auto-calculation logic (dead code after form simplification).

### Updated `parseImport`
Remove `dueDateRaw` extraction and `dueDate` requirement. Required: `name` + `propertyId` only. No longer sets `reminderDates`, `reminderType`, `autoReminderDays`, `penaltyType`, etc.

### Updated `handleSendMessage`
Pass `taxCycle` to `totalDue(r, taxCycle)`.

### View wiring
Pass `taxCycle` and `setTaxCycle` to `SettingsView`.  
Pass `taxCycle` to `DashboardView`, `RecordsView`, `RemindersView`, `TaxReportView`, `AddRecordView`.

---

## 6 · View Changes

### `DashboardView`
- Receive `taxCycle: TaxCycleConfig`
- Add cycle context line below existing header area (inside the view, top): `"FY 2025–26 · Collection: Jan–Mar · Due 31 Mar 2026 · Rebate till 31 Jan 2026"` — computed from `taxCycle`
- All `computePenalty(r)` / `totalDue(r)` calls → add `taxCycle` arg

### `RecordsView`
- Receive `taxCycle: TaxCycleConfig`
- Add banner above the search row: `"FY 2025–26 · Tax due by 31 Mar 2026"` (amber pill)

### `RecordCard`
- Receive `taxCycle: TaxCycleConfig`
- Remove `"Due: {formatDate(r.dueDate)}"` span
- Remove `"Reminders: ..."` span
- Add cadence badge in info row: call `getReminderStageLabel(taxCycle)` — if non-null, show `"🔔 {label}"` in amber
- Fix `computePenalty(r)` / `totalDue(r)` → add `taxCycle` arg

### `TaxReportView`
- Receive `taxCycle: TaxCycleConfig`
- Add **Rebate** column in table (between Base Tax and Penalty): `computeRebate(r, taxCycle)` — shown green for paid early payers, `₹0` otherwise
- Update table header: `Property ID | Name | Ward | Status | Base Tax | Rebate | Penalty | Net Amount`
- Update KPI cards: add a 5th card "Rebate Given" (sum of rebate for paid records) if `taxCycle.rebateEnabled`
- Fix all `computePenalty`/`totalDue` calls to pass `taxCycle`

### `RemindersView`
- Receive `taxCycle: TaxCycleConfig`
- Add 4th tab `"rebate"` with label `"🎁 Rebate Reminder"` — drives template preview
- Update `selectedType` type to include `"rebate"`
- Update template variable hint to show `{rebate_deadline}`, `{rebate_percent}`, `{penalty_amount}`
- In "Due Reminders Today" cards: add `getReminderStageLabel(taxCycle)` badge
- In "All Scheduled Reminders": replace per-record `reminderDates` sort with shared `getScheduledDates(taxCycle)`; show next upcoming scheduled date as "Next reminder"
- Fix all `computePenalty`/`totalDue` calls

### `AddRecordView`
Remove entirely: Due Date field, Penalty Type section, Reminder Type section (all helper functions `addReminderSlot`, `removeReminderSlot`, etc. can be deleted).  
Resulting form: **Name \* | Property ID \* | Ward | Phone | Address | Base Tax Amount \* | Payment Status**  
Two-column grid, same visual style.

### `ImportView`
Remove `"Due Date: 15/08/2026"` line from the example format `<pre>` block.

### `SettingsView`
- Receive `taxCycle: TaxCycleConfig`, `setTaxCycle`
- Remove "Default Auto-Reminder Gap" slider section
- Add new card **"Tax Cycle Configuration"** (below GP Office Details, before Statistics):
  - Collection Period: two `<select>` month dropdowns (Jan–Dec), value from `taxCycle.fromMonth` / `toMonth`
  - Due Date: `<input type="date">`, value from `taxCycle.dueDate`; info note "All residents share this due date"
  - Rebate section: toggle button Enabled/Disabled; if enabled → Rebate % input + Rebate valid till date picker; info "Must be before main Due Date"
  - Penalty section: type selector (Flat ₹/month vs % of Amount/month), value input, "starts N days after due date" input
  - Reminder Cadence: two editable pill-lists — pre-due (days before) and post-due (days after) with + Add/remove ✕ buttons
  - **[Save Tax Cycle]** button at the bottom of this card that calls `setTaxCycle(localDraft)` and shows a toast
  - Local draft state inside `SettingsView` to allow editing without immediately committing

- Statistics card: update `computeStatus(r.dueDate, r.paid)` → `computeStatus(r.paid, taxCycle.dueDate)` and pass `taxCycle` to penalty/total functions

---

## 7 · Helper FY Label Utility

```ts
function fyLabel(cycle: TaxCycleConfig): string {
  const due = new Date(cycle.dueDate)
  const fy = due.getFullYear()
  return `FY ${fy - 1}–${String(fy).slice(2)}`
}
```

Used in Dashboard cycle banner and RecordsView banner.

---

## 8 · Verification

1. **Build check**: The Vite dev server is already running. After saving `App.tsx`, confirm no red compile errors in the preview.
2. **Settings → Tax Cycle Config**: open Settings, fill in due date / rebate / penalty / cadence, click Save — toast appears, banner on Dashboard and Records updates.
3. **Dashboard**: cycle banner shows "FY 2025–26 · Collection: Jan–Mar · Due 31 Mar 2026"; stat cards compute penalty from global config.
4. **Add Record**: form has exactly 7 fields; saving works without entering a due date.
5. **Tax Records**: amber banner shows global due date; cards have no per-card due date; cadence badge appears when today matches a cadence day.
6. **Reminders**: 4 tabs visible; Rebate tab shows bilingual rebate template; template variables `{rebate_deadline}` render correctly.
7. **Tax Report**: table has Rebate column; KPI shows rebate if enabled; print still works.
8. **Import**: example format has no "Due Date" line; imported records save without error.
