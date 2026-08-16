import { useState, useEffect, useRef } from "react"

type Status = "paid" | "unpaid" | "overdue"
type View = "dashboard" | "records" | "add" | "import" | "reminders" | "report" | "settings"
type ReportPeriod = "daily" | "monthly" | "yearly" | "all"

interface MessageLog {
  sentAt: string
  messageType: "reminder" | "overdue" | "penalty" | "rebate"
  totalAmountAtSend: number
}

interface TaxRecord {
  id: string
  name: string
  address: string
  propertyId: string
  amount: number
  paidDate?: string
  status: Status
  phone: string
  ward: string
  paid: boolean
  messageLogs: MessageLog[]
}

interface TaxCycleConfig {
  fromMonth: number
  toMonth: number
  dueDate: string
  rebateEnabled: boolean
  rebatePercent: number
  rebateDeadline: string
  penaltyType: "flat" | "percentage"
  penaltyValue: number
  penaltyStartDays: number
  preReminders: number[]
  postReminders: number[]
}

interface ReminderTemplates {
  reminder: { mr: string; en: string }
  overdue:  { mr: string; en: string }
  penalty:  { mr: string; en: string }
  rebate:   { mr: string; en: string }
}

const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"]

const defaultTaxCycle: TaxCycleConfig = {
  fromMonth: 1, toMonth: 3,
  dueDate: "2026-03-31",
  rebateEnabled: false, rebatePercent: 5, rebateDeadline: "2026-01-31",
  penaltyType: "percentage", penaltyValue: 2, penaltyStartDays: 1,
  preReminders: [30, 15, 7, 3, 1],
  postReminders: [3, 7, 15, 30],
}

const defaultTemplates: ReminderTemplates = {
  reminder: {
    mr: "प्रिय {name},\nआपल्या मालमत्ता कराची देय तारीख {dueDate} येत आहे.\nकृपया मूळ कर ₹{amount} वेळेत भरावा.\n— {gramPanchayat}",
    en: "Dear {name},\nYour property tax is due on {dueDate}.\nPlease pay ₹{amount} on time.\n— {gramPanchayat}",
  },
  overdue: {
    mr: "प्रिय {name},\nआपल्या मालमत्ता कराची देय तारीख ({dueDate}) उलटून गेली आहे.\nकृपया देय रक्कम ₹{total} त्वरित भरावी.\n— {gramPanchayat}",
    en: "Dear {name},\nYour property tax due date ({dueDate}) has passed.\nPlease pay total amount ₹{total} immediately.\n— {gramPanchayat}",
  },
  penalty: {
    mr: "प्रिय {name},\nआपल्या मालमत्ता कराची देय तारीख ({dueDate}) उलटून गेली आहे.\nमूळ कर: ₹{amount}\nदंड: ₹{penalty_amount}\nएकूण देय रक्कम: ₹{total}\nकृपया त्वरित भरा, अन्यथा दंड वाढत राहील.\n— {gramPanchayat}",
    en: "Dear {name},\nYour property tax due date ({dueDate}) has passed.\nBase Tax: ₹{amount}\nPenalty: ₹{penalty_amount}\nTotal Amount Due: ₹{total}\nPlease pay immediately to avoid further penalty.\n— {gramPanchayat}",
  },
  rebate: {
    mr: "प्रिय {name},\nआपला मालमत्ता कर {rebate_deadline} पूर्वी भरल्यास {rebate_percent}% सूट मिळेल.\nमूळ कर: ₹{amount}\nसूट नंतरची रक्कम: ₹{total}\nलवकर भरा आणि बचत करा!\n— {gramPanchayat}",
    en: "Dear {name},\nPay your property tax before {rebate_deadline} and get {rebate_percent}% early payment rebate!\nBase Tax: ₹{amount}\nAfter Rebate: ₹{total}\nDon't miss this discount.\n— {gramPanchayat}",
  },
}

// ── Utilities ──────────────────────────────────────────────────────────────────

function computeStatus(paid: boolean, dueDate: string): Status {
  if (paid) return "paid"
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const due = new Date(dueDate); due.setHours(0, 0, 0, 0)
  return due < today ? "overdue" : "unpaid"
}

function daysOverdue(dueDate: string): number {
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const due = new Date(dueDate); due.setHours(0, 0, 0, 0)
  return Math.max(0, Math.floor((today.getTime() - due.getTime()) / 86400000))
}

function computePenalty(r: TaxRecord, cycle: TaxCycleConfig): number {
  if (r.paid) return 0
  const days = daysOverdue(cycle.dueDate)
  if (days < cycle.penaltyStartDays) return 0
  const months = Math.max(1, Math.floor(days / 30))
  if (cycle.penaltyType === "flat") return cycle.penaltyValue * months
  return Math.round((r.amount * cycle.penaltyValue / 100) * months)
}

function computeRebate(r: TaxRecord, cycle: TaxCycleConfig): number {
  if (!cycle.rebateEnabled || !r.paid || !r.paidDate) return 0
  if (r.paidDate <= cycle.rebateDeadline) return Math.round(r.amount * cycle.rebatePercent / 100)
  return 0
}

function totalDue(r: TaxRecord, cycle: TaxCycleConfig): number {
  return r.amount + computePenalty(r, cycle)
}

function getScheduledDates(cycle: TaxCycleConfig): string[] {
  const base = new Date(cycle.dueDate)
  const pre = cycle.preReminders.map(d => {
    const dt = new Date(base); dt.setDate(dt.getDate() - d)
    return dt.toISOString().split("T")[0]
  })
  const post = cycle.postReminders.map(d => {
    const dt = new Date(base); dt.setDate(dt.getDate() + d)
    return dt.toISOString().split("T")[0]
  })
  return [...pre, ...post].sort()
}

function getReminderStageLabel(cycle: TaxCycleConfig): string | null {
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const due = new Date(cycle.dueDate); due.setHours(0, 0, 0, 0)
  const diffBefore = Math.round((due.getTime() - today.getTime()) / 86400000)
  const diffAfter  = Math.round((today.getTime() - due.getTime()) / 86400000)
  for (const d of cycle.preReminders)  if (diffBefore === d) return `${d} day${d === 1 ? "" : "s"} before due`
  for (const d of cycle.postReminders) if (diffAfter  === d) return `${d} day${d === 1 ? "" : "s"} overdue`
  return null
}

function fyLabel(cycle: TaxCycleConfig): string {
  const due = new Date(cycle.dueDate)
  const fy = due.getFullYear()
  return `FY ${fy - 1}–${String(fy).slice(2)}`
}

function formatDate(iso: string) {
  if (!iso) return ""
  return new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
}

function formatDateMr(iso: string) {
  if (!iso) return ""
  return new Date(iso).toLocaleDateString("mr-IN", { day: "2-digit", month: "long", year: "numeric" })
}

function formatDateTime(iso: string) {
  if (!iso) return ""
  return new Date(iso).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
}

function replaceAll(str: string, search: string, replacement: string): string {
  return str.split(search).join(replacement)
}

function renderMessageTemplate(
  tpl: { mr: string; en: string },
  r: TaxRecord,
  gramName: string,
  cycle: TaxCycleConfig,
) {
  const pen = computePenalty(r, cycle)
  const reb = computeRebate(r, cycle)
  const tot = r.paid ? r.amount - reb : totalDue(r, cycle)
  const replaceVars = (str: string) => {
    let s = str
    s = replaceAll(s, "{name}",           r.name)
    s = replaceAll(s, "{dueDate}",        formatDate(cycle.dueDate))
    s = replaceAll(s, "{dueDateMr}",      formatDateMr(cycle.dueDate))
    s = replaceAll(s, "{amount}",         r.amount.toLocaleString("en-IN"))
    s = replaceAll(s, "{penalty_amount}", pen.toLocaleString("en-IN"))
    s = replaceAll(s, "{penalty}",        pen.toLocaleString("en-IN"))
    s = replaceAll(s, "{rebate_deadline}", formatDate(cycle.rebateDeadline))
    s = replaceAll(s, "{rebate_percent}", String(cycle.rebatePercent))
    s = replaceAll(s, "{total}",          tot.toLocaleString("en-IN"))
    s = replaceAll(s, "{gramPanchayat}",  gramName)
    return s
  }
  return { mr: replaceVars(tpl.mr), en: replaceVars(tpl.en) }
}

// ── Sample Data ───────────────────────────────────────────────────────────────

const sampleData: TaxRecord[] = [
  { id: "1", name: "Ramesh Patil",     address: "Plot 12, Main Road, Shirsad",  propertyId: "GP/2024/001", amount: 2500, status: "overdue", phone: "9876543210", ward: "Ward 1", paid: false, messageLogs: [] },
  { id: "2", name: "Sunita Deshmukh", address: "House 45, Shivaji Nagar",       propertyId: "GP/2024/002", amount: 1800, status: "unpaid", phone: "9123456789", ward: "Ward 2", paid: false, messageLogs: [] },
  { id: "3", name: "Vijay Shinde",    address: "Gat No 7, Near Temple",          propertyId: "GP/2024/003", amount: 3200, status: "overdue", phone: "9988776655", ward: "Ward 1", paid: false, messageLogs: [] },
  { id: "4", name: "Meena Jadhav",    address: "Survey No 23, GP Road",          propertyId: "GP/2024/004", amount: 1200, status: "unpaid", phone: "9765432100", ward: "Ward 3", paid: false, messageLogs: [] },
  { id: "5", name: "Anil Kulkarni",   address: "Plot 88, Market Area",           propertyId: "GP/2024/005", amount: 4500, paidDate: "2026-01-20", status: "paid", phone: "9654321098", ward: "Ward 2", paid: true, messageLogs: [] },
]

// ── Nav ───────────────────────────────────────────────────────────────────────

const NAV_ITEMS: { id: View; label: string; icon: string }[] = [
  { id: "dashboard", label: "Dashboard",       icon: "⊞" },
  { id: "records",   label: "Tax Records",     icon: "☰" },
  { id: "add",       label: "Add Record",      icon: "+" },
  { id: "import",    label: "Import from Word",icon: "⊕" },
  { id: "reminders", label: "Reminders",       icon: "🔔" },
  { id: "report",    label: "Tax Report",      icon: "📊" },
  { id: "settings",  label: "Settings",        icon: "⚙" },
]

function emptyRecord(): Omit<TaxRecord, "id" | "status"> {
  return { name: "", address: "", propertyId: "", amount: 0, phone: "", ward: "", paid: false, messageLogs: [] }
}

// ── App ───────────────────────────────────────────────────────────────────────

export default function App() {
  const [view, setView] = useState<View>("dashboard")
  const [records, setRecords] = useState<TaxRecord[]>(() => {
    try { const s = localStorage.getItem("gp_tax_records_v4"); return s ? JSON.parse(s) : sampleData }
    catch { return sampleData }
  })
  const [templates, setTemplates] = useState<ReminderTemplates>(() => {
    try { const s = localStorage.getItem("gp_tax_templates_v2"); return s ? JSON.parse(s) : defaultTemplates }
    catch { return defaultTemplates }
  })
  const [taxCycle, setTaxCycle] = useState<TaxCycleConfig>(() => {
    try { const s = localStorage.getItem("gp_tax_cycle_v1"); return s ? JSON.parse(s) : defaultTaxCycle }
    catch { return defaultTaxCycle }
  })

  const [form, setForm] = useState(emptyRecord())
  const [editId, setEditId] = useState<string | null>(null)
  const [importText, setImportText] = useState("")
  const [importResult, setImportResult] = useState<string[]>([])
  const [search, setSearch] = useState("")
  const [filterStatus, setFilterStatus] = useState<"all" | Status>("all")
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null)
  const [gramName, setGramName] = useState("Gram Panchayat Office")
  const [showNotif, setShowNotif] = useState(true)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => { localStorage.setItem("gp_tax_records_v4",  JSON.stringify(records))   }, [records])
  useEffect(() => { localStorage.setItem("gp_tax_templates_v2", JSON.stringify(templates)) }, [templates])
  useEffect(() => { localStorage.setItem("gp_tax_cycle_v1",     JSON.stringify(taxCycle))  }, [taxCycle])
  useEffect(() => {
    if (toast) { const t = setTimeout(() => setToast(null), 3500); return () => clearTimeout(t) }
  }, [toast])

  const liveRecords = records.map(r => ({ ...r, status: computeStatus(r.paid, taxCycle.dueDate) }))
  const overdueList  = liveRecords.filter(r => r.status === "overdue")
  const dueThisWeek  = liveRecords.filter(r => {
    if (r.paid) return false
    const diff = (new Date(taxCycle.dueDate).getTime() - Date.now()) / 86400000
    return diff >= 0 && diff <= 7
  })
  const reminderDue = liveRecords.filter(r => !r.paid && getReminderStageLabel(taxCycle) !== null)

  function showToast(msg: string, type: "success" | "error" = "success") { setToast({ msg, type }) }

  function handleFormChange(field: keyof ReturnType<typeof emptyRecord>, value: unknown) {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  function handleSave() {
    if (!form.name || !form.propertyId || form.amount <= 0) {
      showToast("Please fill all required fields.", "error"); return
    }
    const isPaid   = form.paid
    const paidDate = isPaid ? (form.paidDate || new Date().toISOString().split("T")[0]) : undefined
    const rec = { ...form, paidDate, id: editId || Date.now().toString(), status: computeStatus(isPaid, taxCycle.dueDate) } as TaxRecord

    if (editId) {
      setRecords(prev => prev.map(r => r.id === editId ? rec : r))
      showToast("Record updated."); setEditId(null)
    } else {
      setRecords(prev => [...prev, rec])
      showToast("Record added.")
    }
    setForm(emptyRecord()); setView("records")
  }

  function handleEdit(r: TaxRecord) { setForm({ ...r }); setEditId(r.id); setView("add") }

  function handleMarkPaid(id: string) {
    const today = new Date().toISOString().split("T")[0]
    setRecords(prev => prev.map(r => r.id === id ? { ...r, paid: true, status: "paid", paidDate: today } : r))
    showToast("Marked as paid.")
  }

  function handleDelete(id: string) {
    if (confirm("Delete this record?")) {
      setRecords(prev => prev.filter(r => r.id !== id))
      showToast("Record deleted.")
    }
  }

  function handleSendMessage(id: string, msgType: MessageLog["messageType"]) {
    setRecords(prev => prev.map(r => {
      if (r.id !== id) return r
      const log: MessageLog = { sentAt: new Date().toISOString(), messageType: msgType, totalAmountAtSend: totalDue(r, taxCycle) }
      return { ...r, messageLogs: [...(r.messageLogs || []), log] }
    }))
    showToast("Reminder message logged.")
  }

  function parseImport() {
    const blocks = importText.split(/\n\s*\n/).filter(b => b.trim())
    const parsed: TaxRecord[] = []
    const log: string[] = []
    blocks.forEach((block, i) => {
      const get = (key: string) => { const m = block.match(new RegExp(`${key}\\s*[:\\-]\\s*(.+)`, "i")); return m ? m[1].trim() : "" }
      const name       = get("Name") || get("Taxpayer") || get("नाव")
      const propertyId = get("Property ID") || get("Property") || get("ID")
      const amount     = parseFloat(get("Amount") || "0")
      if (!name || !propertyId) { log.push(`Record ${i + 1}: Incomplete (Name/Property ID missing) — skipped`); return }
      const rec: TaxRecord = {
        id: Date.now().toString() + i, name,
        address: get("Address") || "", propertyId, amount,
        status: computeStatus(false, taxCycle.dueDate),
        phone: get("Phone") || get("Mobile") || "", ward: get("Ward") || "", paid: false, messageLogs: [],
      }
      parsed.push(rec)
      log.push(`Record ${i + 1}: ✓ ${name} — ₹${amount}`)
    })
    if (parsed.length > 0) { setRecords(prev => [...prev, ...parsed]); showToast(`${parsed.length} record(s) imported.`) }
    setImportResult(log)
  }

  const filtered = liveRecords.filter(r => {
    const q = search.toLowerCase()
    const matchQ = !q || r.name.toLowerCase().includes(q) || r.propertyId.toLowerCase().includes(q) || r.ward.toLowerCase().includes(q)
    const matchS = filterStatus === "all" || r.status === filterStatus
    return matchQ && matchS
  })

  return (
    <div style={{ display: "flex", height: "100vh", overflow: "hidden", fontFamily: "'Poppins', sans-serif", background: "#FFFBF5" }}>
      {/* Sidebar */}
      <aside style={{ width: 220, background: "#1C1409", display: "flex", flexDirection: "column", flexShrink: 0 }}>
        <div style={{ padding: "20px 18px 14px", borderBottom: "1px solid #2E1F0A" }}>
          <div style={{ color: "#F59E0B", fontWeight: 700, fontSize: 13 }}>{gramName}</div>
          <div style={{ color: "#8B6A4A", fontSize: 10, marginTop: 3, textTransform: "uppercase", letterSpacing: 0.5 }}>Property Tax Reminders</div>
        </div>
        <nav style={{ flex: 1, padding: "10px 8px", overflowY: "auto" }}>
          {NAV_ITEMS.map(item => (
            <button key={item.id} onClick={() => setView(item.id)} style={{
              display: "flex", alignItems: "center", gap: 10, width: "100%",
              padding: "9px 12px", borderRadius: 8, border: "none", cursor: "pointer",
              background: view === item.id ? "rgba(245,158,11,0.15)" : "transparent",
              color: view === item.id ? "#F59E0B" : "#8B6A4A",
              fontFamily: "'Poppins', sans-serif", fontSize: 13, fontWeight: view === item.id ? 600 : 400,
              textAlign: "left", marginBottom: 2, transition: "all 0.15s",
            }}>
              <span style={{ fontSize: 14, width: 18, textAlign: "center" }}>{item.icon}</span>
              <span style={{ flex: 1 }}>{item.label}</span>
              {item.id === "reminders" && reminderDue.length > 0 && (
                <span style={{ background: "#DC2626", color: "#fff", borderRadius: 99, fontSize: 10, padding: "1px 6px", fontWeight: 700 }}>{reminderDue.length}</span>
              )}
            </button>
          ))}
        </nav>
        <div style={{ padding: "12px 18px", borderTop: "1px solid #2E1F0A" }}>
          <div style={{ color: "#3A2510", fontSize: 10 }}>v3.0 • Home Tax System</div>
        </div>
      </aside>

      {/* Main */}
      <main style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <header style={{ background: "#fff", borderBottom: "1px solid #EDE5D8", padding: "12px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
          <h1 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: "#1C1409" }}>{NAV_ITEMS.find(n => n.id === view)?.label}</h1>
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            {overdueList.length > 0 && <div style={{ background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 8, padding: "5px 12px", fontSize: 12, color: "#DC2626", fontWeight: 500 }}>⚠ {overdueList.length} Overdue Taxpayers</div>}
            <div style={{ fontSize: 12, color: "#8B6A4A" }}>{new Date().toLocaleDateString("en-IN", { weekday: "short", day: "2-digit", month: "short", year: "numeric" })}</div>
          </div>
        </header>

        {showNotif && reminderDue.length > 0 && (
          <div style={{ background: "linear-gradient(90deg, #92400E, #B45309)", color: "#FEF3C7", padding: "9px 24px", display: "flex", alignItems: "center", gap: 12, fontSize: 12, flexShrink: 0 }}>
            <span>🔔</span>
            <div style={{ flex: 1 }}>
              <span style={{ fontWeight: 600 }}>{reminderDue.length} reminder(s) due today — {getReminderStageLabel(taxCycle)}: </span>
              {reminderDue.slice(0, 3).map(r => <span key={r.id} style={{ marginRight: 12, opacity: 0.9 }}>{r.name} — ₹{totalDue(r, taxCycle).toLocaleString("en-IN")}</span>)}
              {reminderDue.length > 3 && <span>+{reminderDue.length - 3} more</span>}
            </div>
            <button onClick={() => { setView("reminders"); setShowNotif(false) }} style={{ background: "rgba(255,255,255,0.15)", border: "1px solid rgba(255,255,255,0.3)", color: "#FEF3C7", borderRadius: 6, padding: "3px 10px", fontSize: 11, cursor: "pointer" }}>View Reminders</button>
            <button onClick={() => setShowNotif(false)} style={{ background: "none", border: "none", color: "#FEF3C7", cursor: "pointer", fontSize: 16, padding: 0 }}>✕</button>
          </div>
        )}

        <div style={{ flex: 1, overflowY: "auto", padding: "24px" }}>
          {view === "dashboard"  && <DashboardView records={liveRecords} overdueList={overdueList} dueThisWeek={dueThisWeek} taxCycle={taxCycle} setView={setView} onEdit={handleEdit} onMarkPaid={handleMarkPaid} />}
          {view === "records"    && <RecordsView records={filtered} search={search} setSearch={setSearch} filterStatus={filterStatus} setFilterStatus={setFilterStatus} taxCycle={taxCycle} onEdit={handleEdit} onDelete={handleDelete} onMarkPaid={handleMarkPaid} setView={setView} />}
          {view === "add"        && <AddRecordView form={form} onChange={handleFormChange} onSave={handleSave} onCancel={() => { setForm(emptyRecord()); setEditId(null); setView("records") }} isEdit={!!editId} />}
          {view === "import"     && <ImportView importText={importText} setImportText={setImportText} onParse={parseImport} importResult={importResult} fileRef={fileRef} />}
          {view === "reminders"  && <RemindersView records={liveRecords} reminderDue={reminderDue} templates={templates} setTemplates={setTemplates} gramName={gramName} taxCycle={taxCycle} onMarkPaid={handleMarkPaid} onEdit={handleEdit} onSend={handleSendMessage} />}
          {view === "report"     && <TaxReportView records={liveRecords} gramName={gramName} taxCycle={taxCycle} />}
          {view === "settings"   && <SettingsView gramName={gramName} setGramName={setGramName} taxCycle={taxCycle} setTaxCycle={setTaxCycle} records={records} setRecords={setRecords} showToast={showToast} />}
        </div>
      </main>

      {toast && (
        <div style={{ position: "fixed", bottom: 24, right: 24, zIndex: 9999, background: toast.type === "error" ? "#DC2626" : "#059669", color: "#fff", padding: "12px 20px", borderRadius: 10, boxShadow: "0 4px 20px rgba(0,0,0,0.2)", fontSize: 13, fontWeight: 500, maxWidth: 360 }}>
          {toast.msg}
        </div>
      )}
    </div>
  )
}

// ── Dashboard ─────────────────────────────────────────────────────────────────
function DashboardView({ records, overdueList, dueThisWeek, taxCycle, setView, onEdit, onMarkPaid }: {
  records: TaxRecord[]; overdueList: TaxRecord[]; dueThisWeek: TaxRecord[];
  taxCycle: TaxCycleConfig; setView: (v: View) => void;
  onEdit: (r: TaxRecord) => void; onMarkPaid: (id: string) => void;
}) {
  const totalPending   = records.filter(r => !r.paid).reduce((s, r) => s + totalDue(r, taxCycle), 0)
  const totalCollected = records.filter(r => r.paid).reduce((s, r) => s + r.amount, 0)
  const totalPenalty   = records.filter(r => !r.paid).reduce((s, r) => s + computePenalty(r, taxCycle), 0)

  const cycleStr = `${fyLabel(taxCycle)} · Collection: ${MONTH_NAMES[taxCycle.fromMonth - 1].slice(0,3)}–${MONTH_NAMES[taxCycle.toMonth - 1].slice(0,3)} · Due ${formatDate(taxCycle.dueDate)}${taxCycle.rebateEnabled ? ` · Rebate till ${formatDate(taxCycle.rebateDeadline)}` : ""}`

  return (
    <div>
      {/* Cycle context banner */}
      <div style={{ background: "#FEF3C7", border: "1px solid #FDE68A", borderRadius: 8, padding: "8px 14px", marginBottom: 20, fontSize: 12, color: "#92400E", fontWeight: 500 }}>
        📅 {cycleStr}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 24 }}>
        {[
          { label: "Total Records",  value: records.length,                          color: "#1C1409", bg: "#fff",     border: "#EDE5D8" },
          { label: "Overdue",        value: overdueList.length,                      color: "#DC2626", bg: "#FEF2F2", border: "#FECACA" },
          { label: "Due This Week",  value: dueThisWeek.length,                      color: "#D97706", bg: "#FFFBEB", border: "#FDE68A" },
          { label: "Paid",           value: records.filter(r => r.paid).length,      color: "#059669", bg: "#F0FDF4", border: "#A7F3D0" },
        ].map(s => (
          <div key={s.label} style={{ background: s.bg, border: `1px solid ${s.border}`, borderRadius: 12, padding: "18px 20px" }}>
            <div style={{ fontSize: 30, fontWeight: 700, color: s.color }}>{s.value}</div>
            <div style={{ fontSize: 13, color: "#5C4030", fontWeight: 500, marginTop: 2 }}>{s.label}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, marginBottom: 28 }}>
        <div style={{ background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 12, padding: "16px 20px" }}>
          <div style={{ fontSize: 11, color: "#DC2626", fontWeight: 600, textTransform: "uppercase", letterSpacing: 1 }}>Pending (incl. penalty)</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: "#991B1B", marginTop: 4 }}>₹{totalPending.toLocaleString("en-IN")}</div>
        </div>
        <div style={{ background: "#FFF7ED", border: "1px solid #FED7AA", borderRadius: 12, padding: "16px 20px" }}>
          <div style={{ fontSize: 11, color: "#C2410C", fontWeight: 600, textTransform: "uppercase", letterSpacing: 1 }}>Total Penalty Accrued</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: "#9A3412", marginTop: 4 }}>₹{totalPenalty.toLocaleString("en-IN")}</div>
        </div>
        <div style={{ background: "#F0FDF4", border: "1px solid #A7F3D0", borderRadius: 12, padding: "16px 20px" }}>
          <div style={{ fontSize: 11, color: "#059669", fontWeight: 600, textTransform: "uppercase", letterSpacing: 1 }}>Collected</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: "#065F46", marginTop: 4 }}>₹{totalCollected.toLocaleString("en-IN")}</div>
        </div>
      </div>

      {overdueList.length > 0 && (
        <div style={{ marginBottom: 28 }}>
          <SectionHead title="Overdue Taxpayers" count={overdueList.length} />
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {overdueList.map(r => <RecordCard key={r.id} record={r} taxCycle={taxCycle} onEdit={onEdit} onMarkPaid={onMarkPaid} />)}
          </div>
        </div>
      )}

      {dueThisWeek.length > 0 && (
        <div>
          <SectionHead title="Due This Week" count={dueThisWeek.length} />
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {dueThisWeek.map(r => <RecordCard key={r.id} record={r} taxCycle={taxCycle} onEdit={onEdit} onMarkPaid={onMarkPaid} />)}
          </div>
        </div>
      )}

      {overdueList.length === 0 && dueThisWeek.length === 0 && (
        <div style={{ textAlign: "center", padding: "56px 24px", color: "#8B6A4A" }}>
          <div style={{ fontSize: 40 }}>✓</div>
          <div style={{ fontSize: 15, fontWeight: 600, color: "#1C1409", marginTop: 8 }}>All clear!</div>
          <div style={{ fontSize: 13, marginTop: 4 }}>No overdue or upcoming dues this week.</div>
        </div>
      )}
    </div>
  )
}

// ── Records View ──────────────────────────────────────────────────────────────
function RecordsView({ records, search, setSearch, filterStatus, setFilterStatus, taxCycle, onEdit, onDelete, onMarkPaid, setView }: {
  records: TaxRecord[]; search: string; setSearch: (s: string) => void;
  filterStatus: "all" | Status; setFilterStatus: (s: "all" | Status) => void;
  taxCycle: TaxCycleConfig;
  onEdit: (r: TaxRecord) => void; onDelete: (id: string) => void;
  onMarkPaid: (id: string) => void; setView: (v: View) => void;
}) {
  return (
    <div>
      {/* Global due date banner */}
      <div style={{ background: "#FEF3C7", border: "1px solid #FDE68A", borderRadius: 8, padding: "8px 14px", marginBottom: 14, fontSize: 12, color: "#92400E", fontWeight: 500 }}>
        📅 {fyLabel(taxCycle)} · Tax due by {formatDate(taxCycle.dueDate)}
        {taxCycle.rebateEnabled && <span style={{ marginLeft: 12, color: "#059669" }}>· Rebate {taxCycle.rebatePercent}% if paid by {formatDate(taxCycle.rebateDeadline)}</span>}
      </div>

      <div style={{ display: "flex", gap: 10, marginBottom: 14, alignItems: "center", flexWrap: "wrap" }}>
        <input placeholder="Search by name, property ID, ward..." value={search} onChange={e => setSearch(e.target.value)} style={inputStyle({ flex: "1", minWidth: 220 })} />
        {(["all", "unpaid", "overdue", "paid"] as const).map(s => (
          <button key={s} onClick={() => setFilterStatus(s)} style={{ padding: "7px 14px", borderRadius: 8, border: "1.5px solid", borderColor: filterStatus === s ? "#D97706" : "#EDE5D8", background: filterStatus === s ? "#FEF3C7" : "#fff", color: filterStatus === s ? "#92400E" : "#6B5040", fontSize: 12, fontWeight: 500, cursor: "pointer" }}>
            {s === "all" ? "All" : s === "unpaid" ? "Unpaid" : s === "overdue" ? "Overdue" : "Paid"}
          </button>
        ))}
        <button onClick={() => setView("report")} style={{ ...btnStyle("secondary"), display: "flex", alignItems: "center", gap: 6 }}>📊 Tax Report</button>
        <button onClick={() => setView("add")} style={btnStyle("primary")}>+ Add New</button>
      </div>
      {records.length === 0
        ? <div style={{ textAlign: "center", padding: "48px", color: "#8B6A4A" }}><div style={{ fontSize: 36 }}>📋</div><div style={{ marginTop: 8 }}>No records found</div></div>
        : <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>{records.map(r => <RecordCard key={r.id} record={r} taxCycle={taxCycle} onEdit={onEdit} onMarkPaid={onMarkPaid} onDelete={onDelete} />)}</div>
      }
    </div>
  )
}

// ── Record Card ───────────────────────────────────────────────────────────────
function RecordCard({ record: r, taxCycle, onEdit, onMarkPaid, onDelete }: {
  record: TaxRecord; taxCycle: TaxCycleConfig;
  onEdit: (r: TaxRecord) => void; onMarkPaid: (id: string) => void; onDelete?: (id: string) => void;
}) {
  const penalty = computePenalty(r, taxCycle)
  const rebate  = computeRebate(r, taxCycle)
  const total   = r.paid ? r.amount - rebate : totalDue(r, taxCycle)
  const sc      = STATUS_COLORS[r.status]
  const stageLabel = getReminderStageLabel(taxCycle)

  return (
    <div style={{ background: "#fff", borderTop: "1px solid #EDE5D8", borderRight: "1px solid #EDE5D8", borderBottom: "1px solid #EDE5D8", borderLeft: `4px solid ${r.status === "overdue" ? "#DC2626" : r.status === "paid" ? "#059669" : "#D97706"}`, borderRadius: 10, padding: "14px 18px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontWeight: 600, fontSize: 14, color: "#1C1409" }}>{r.name}</span>
            <span style={{ background: sc.bg, color: sc.text, border: `1px solid ${sc.border}`, borderRadius: 99, fontSize: 10, padding: "1px 8px", fontWeight: 600 }}>{sc.label}</span>
            {penalty > 0 && <span style={{ background: "#FFF7ED", color: "#C2410C", border: "1px solid #FED7AA", borderRadius: 99, fontSize: 10, padding: "1px 8px", fontWeight: 600 }}>+₹{penalty.toLocaleString("en-IN")} penalty</span>}
            {rebate  > 0 && <span style={{ background: "#F0FDF4", color: "#059669",  border: "1px solid #A7F3D0", borderRadius: 99, fontSize: 10, padding: "1px 8px", fontWeight: 600 }}>−₹{rebate.toLocaleString("en-IN")} rebate</span>}
            {!r.paid && stageLabel && <span style={{ background: "#FFFBEB", color: "#D97706", border: "1px solid #FDE68A", borderRadius: 99, fontSize: 10, padding: "1px 8px", fontWeight: 600 }}>🔔 {stageLabel}</span>}
          </div>
          <div style={{ display: "flex", gap: 14, marginTop: 4, flexWrap: "wrap" }}>
            <span style={{ fontSize: 11, color: "#8B6A4A" }}>📋 {r.propertyId}</span>
            {r.ward  && <span style={{ fontSize: 11, color: "#8B6A4A" }}>🏘 {r.ward}</span>}
            {r.phone && <span style={{ fontSize: 11, color: "#8B6A4A" }}>📞 {r.phone}</span>}
            {r.paid && r.paidDate && <span style={{ fontSize: 11, color: "#059669" }}>Paid: {formatDate(r.paidDate)}</span>}
          </div>
          {(r.messageLogs || []).length > 0 && (
            <div style={{ fontSize: 10, color: "#059669", marginTop: 3 }}>
              ✉ Last reminder sent: {formatDateTime((r.messageLogs || []).slice(-1)[0].sentAt)} ({(r.messageLogs || []).length} time{(r.messageLogs || []).length > 1 ? "s" : ""})
            </div>
          )}
        </div>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div style={{ fontSize: 11, color: "#8B6A4A", textDecoration: (penalty > 0 || rebate > 0) ? "line-through" : "none" }}>₹{r.amount.toLocaleString("en-IN")}</div>
          <div style={{ fontSize: 17, fontWeight: 700, color: r.status === "paid" ? "#059669" : "#DC2626" }}>₹{total.toLocaleString("en-IN")}</div>
          <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", marginTop: 6, flexWrap: "wrap" }}>
            {!r.paid && <button onClick={() => onMarkPaid(r.id)} style={btnStyle("success", "sm")}>✓ Mark Paid</button>}
            <button onClick={() => onEdit(r)} style={btnStyle("secondary", "sm")}>✏ Edit</button>
            {onDelete && <button onClick={() => onDelete(r.id)} style={btnStyle("danger", "sm")}>✕</button>}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Tax Report View ───────────────────────────────────────────────────────────
function TaxReportView({ records, gramName, taxCycle }: { records: TaxRecord[]; gramName: string; taxCycle: TaxCycleConfig }) {
  const [period, setPeriod] = useState<ReportPeriod>("yearly")
  const [statusFilter, setStatusFilter] = useState<"all" | "paid" | "unpaid">("all")

  const todayIso = new Date().toISOString().split("T")[0]
  const [selectedDate,  setSelectedDate]  = useState(todayIso)
  const [selectedMonth, setSelectedMonth] = useState(todayIso.substring(0, 7))
  const [selectedYear,  setSelectedYear]  = useState(todayIso.substring(0, 4))

  const periodFiltered = records.filter(r => {
    const targetDate = r.paid ? (r.paidDate || taxCycle.dueDate) : taxCycle.dueDate
    if (!targetDate) return true
    if (period === "daily")   return targetDate === selectedDate
    if (period === "monthly") return targetDate.startsWith(selectedMonth)
    if (period === "yearly")  return targetDate.startsWith(selectedYear)
    return true
  })

  const finalFiltered = periodFiltered.filter(r => {
    if (statusFilter === "paid")   return r.paid
    if (statusFilter === "unpaid") return !r.paid
    return true
  })

  const paidRecords   = periodFiltered.filter(r => r.paid)
  const unpaidRecords = periodFiltered.filter(r => !r.paid)

  const paidBaseSum     = paidRecords.reduce((s, r) => s + r.amount, 0)
  const totalRebateGiven = paidRecords.reduce((s, r) => s + computeRebate(r, taxCycle), 0)
  const unpaidBaseSum   = unpaidRecords.reduce((s, r) => s + r.amount, 0)
  const unpaidPenaltySum = unpaidRecords.reduce((s, r) => s + computePenalty(r, taxCycle), 0)
  const unpaidTotalSum  = unpaidRecords.reduce((s, r) => s + totalDue(r, taxCycle), 0)

  return (
    <div>
      <div style={{ background: "#fff", border: "1px solid #EDE5D8", borderRadius: 12, padding: "16px 20px", marginBottom: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
          <div style={{ fontWeight: 600, fontSize: 15, color: "#1C1409" }}>📊 Tax Collection & Unpaid Dues Report — {gramName}</div>
          <button onClick={() => window.print()} style={{ ...btnStyle("primary", "sm"), display: "flex", alignItems: "center", gap: 6 }}>🖨 Print / Export PDF</button>
        </div>

        <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ display: "flex", gap: 4, background: "#F5EFE5", padding: 3, borderRadius: 8 }}>
            {(["yearly", "monthly", "daily", "all"] as const).map(p => (
              <button key={p} onClick={() => setPeriod(p)} style={{ padding: "6px 14px", borderRadius: 6, border: "none", background: period === p ? "#fff" : "transparent", color: period === p ? "#1C1409" : "#6B5040", fontWeight: period === p ? 600 : 400, fontSize: 12, cursor: "pointer", boxShadow: period === p ? "0 1px 3px rgba(0,0,0,0.1)" : "none" }}>
                {p === "yearly" ? "Yearly" : p === "monthly" ? "Monthly" : p === "daily" ? "Daily" : "All Time"}
              </button>
            ))}
          </div>

          {period === "daily"   && <input type="date"  value={selectedDate}  onChange={e => setSelectedDate(e.target.value)}  style={inputStyle({ width: 160 })} />}
          {period === "monthly" && <input type="month" value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)} style={inputStyle({ width: 160 })} />}
          {period === "yearly"  && (
            <select value={selectedYear} onChange={e => setSelectedYear(e.target.value)} style={inputStyle({ width: 120 })}>
              {["2024","2025","2026","2027"].map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          )}

          <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
            {(["all", "paid", "unpaid"] as const).map(sf => (
              <button key={sf} onClick={() => setStatusFilter(sf)} style={{ padding: "6px 12px", borderRadius: 8, border: "1px solid", borderColor: statusFilter === sf ? "#D97706" : "#EDE5D8", background: statusFilter === sf ? "#FEF3C7" : "#fff", color: statusFilter === sf ? "#92400E" : "#6B5040", fontSize: 12, fontWeight: statusFilter === sf ? 600 : 400, cursor: "pointer" }}>
                {sf === "all" ? "All" : sf === "paid" ? "Paid" : "Unpaid"}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* KPI Cards */}
      <div style={{ display: "grid", gridTemplateColumns: taxCycle.rebateEnabled ? "repeat(5, 1fr)" : "repeat(4, 1fr)", gap: 14, marginBottom: 24 }}>
        <div style={{ background: "#F0FDF4", border: "1px solid #A7F3D0", borderRadius: 12, padding: "16px" }}>
          <div style={{ fontSize: 11, color: "#059669", fontWeight: 600, textTransform: "uppercase" }}>Paid Tax Collected</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: "#065F46", marginTop: 4 }}>₹{paidBaseSum.toLocaleString("en-IN")}</div>
          <div style={{ fontSize: 11, color: "#047857", marginTop: 2 }}>{paidRecords.length} Taxpayer(s) Paid</div>
        </div>
        {taxCycle.rebateEnabled && (
          <div style={{ background: "#F0FDF4", border: "1px solid #6EE7B7", borderRadius: 12, padding: "16px" }}>
            <div style={{ fontSize: 11, color: "#059669", fontWeight: 600, textTransform: "uppercase" }}>Rebate Given</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: "#065F46", marginTop: 4 }}>₹{totalRebateGiven.toLocaleString("en-IN")}</div>
            <div style={{ fontSize: 11, color: "#047857", marginTop: 2 }}>{taxCycle.rebatePercent}% early payment</div>
          </div>
        )}
        <div style={{ background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 12, padding: "16px" }}>
          <div style={{ fontSize: 11, color: "#DC2626", fontWeight: 600, textTransform: "uppercase" }}>Unpaid Outstanding</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: "#991B1B", marginTop: 4 }}>₹{unpaidBaseSum.toLocaleString("en-IN")}</div>
          <div style={{ fontSize: 11, color: "#B91C1C", marginTop: 2 }}>{unpaidRecords.length} Taxpayer(s) Unpaid</div>
        </div>
        <div style={{ background: "#FFF7ED", border: "1px solid #FED7AA", borderRadius: 12, padding: "16px" }}>
          <div style={{ fontSize: 11, color: "#C2410C", fontWeight: 600, textTransform: "uppercase" }}>Penalty Amount</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: "#9A3412", marginTop: 4 }}>₹{unpaidPenaltySum.toLocaleString("en-IN")}</div>
          <div style={{ fontSize: 11, color: "#EA580C", marginTop: 2 }}>Added to late dues</div>
        </div>
        <div style={{ background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 12, padding: "16px" }}>
          <div style={{ fontSize: 11, color: "#D97706", fontWeight: 600, textTransform: "uppercase" }}>Total Outstanding</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: "#92400E", marginTop: 4 }}>₹{unpaidTotalSum.toLocaleString("en-IN")}</div>
          <div style={{ fontSize: 11, color: "#B45309", marginTop: 2 }}>Base + penalty</div>
        </div>
      </div>

      {/* Table */}
      <div style={{ background: "#fff", border: "1px solid #EDE5D8", borderRadius: 12, overflow: "hidden" }}>
        <div style={{ padding: "14px 18px", borderBottom: "1px solid #EDE5D8", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontWeight: 600, fontSize: 13, color: "#1C1409" }}>
            Taxpayers Statement — {period === "yearly" ? `Year ${selectedYear}` : period === "monthly" ? `Month ${selectedMonth}` : period === "daily" ? `Date ${selectedDate}` : "All Records"}
          </div>
          <div style={{ fontSize: 11, color: "#8B6A4A" }}>Showing {finalFiltered.length} record(s)</div>
        </div>

        {finalFiltered.length === 0
          ? <div style={{ textAlign: "center", padding: 48, color: "#8B6A4A" }}><div style={{ fontSize: 32 }}>📊</div><div style={{ marginTop: 8 }}>No records matching criteria</div></div>
          : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, textAlign: "left" }}>
              <thead>
                <tr style={{ background: "#F5EFE5", color: "#6B5040", borderBottom: "1px solid #EDE5D8" }}>
                  <th style={{ padding: "10px 14px" }}>Property ID</th>
                  <th style={{ padding: "10px 14px" }}>Taxpayer Name</th>
                  <th style={{ padding: "10px 14px" }}>Ward</th>
                  <th style={{ padding: "10px 14px" }}>Status</th>
                  <th style={{ padding: "10px 14px", textAlign: "right" }}>Base Tax</th>
                  {taxCycle.rebateEnabled && <th style={{ padding: "10px 14px", textAlign: "right" }}>Rebate</th>}
                  <th style={{ padding: "10px 14px", textAlign: "right" }}>Penalty</th>
                  <th style={{ padding: "10px 14px", textAlign: "right" }}>Net Amount</th>
                </tr>
              </thead>
              <tbody>
                {finalFiltered.map((r, idx) => {
                  const pen = computePenalty(r, taxCycle)
                  const reb = computeRebate(r, taxCycle)
                  const net = r.paid ? r.amount - reb : totalDue(r, taxCycle)
                  return (
                    <tr key={r.id} style={{ borderBottom: "1px solid #F5EFE5", background: idx % 2 === 0 ? "#fff" : "#FFFBF5" }}>
                      <td style={{ padding: "10px 14px", fontWeight: 600, color: "#1C1409" }}>{r.propertyId}</td>
                      <td style={{ padding: "10px 14px", fontWeight: 500 }}>{r.name}</td>
                      <td style={{ padding: "10px 14px", color: "#6B5040" }}>{r.ward || "—"}</td>
                      <td style={{ padding: "10px 14px" }}><StatusBadge status={r.status} /></td>
                      <td style={{ padding: "10px 14px", textAlign: "right" }}>₹{r.amount.toLocaleString("en-IN")}</td>
                      {taxCycle.rebateEnabled && (
                        <td style={{ padding: "10px 14px", textAlign: "right", color: reb > 0 ? "#059669" : "#8B6A4A" }}>
                          {reb > 0 ? `−₹${reb.toLocaleString("en-IN")}` : "₹0"}
                        </td>
                      )}
                      <td style={{ padding: "10px 14px", textAlign: "right", color: pen > 0 ? "#C2410C" : "#8B6A4A" }}>
                        {pen > 0 ? `+₹${pen.toLocaleString("en-IN")}` : "₹0"}
                      </td>
                      <td style={{ padding: "10px 14px", textAlign: "right", fontWeight: 700, color: r.paid ? "#059669" : "#DC2626" }}>
                        ₹{net.toLocaleString("en-IN")}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )
        }
      </div>
    </div>
  )
}

// ── Reminders View ────────────────────────────────────────────────────────────
type TemplateTab = "reminder" | "overdue" | "penalty" | "rebate"

function RemindersView({ records, reminderDue, templates, setTemplates, gramName, taxCycle, onMarkPaid, onEdit, onSend }: {
  records: TaxRecord[]; reminderDue: TaxRecord[];
  templates: ReminderTemplates; setTemplates: React.Dispatch<React.SetStateAction<ReminderTemplates>>;
  gramName: string; taxCycle: TaxCycleConfig;
  onMarkPaid: (id: string) => void; onEdit: (r: TaxRecord) => void;
  onSend: (id: string, type: MessageLog["messageType"]) => void;
}) {
  const [showEditTemplates, setShowEditTemplates] = useState(false)
  const [selectedType, setSelectedType] = useState<TemplateTab>("reminder")

  const sampleTaxpayer = records.find(r => !r.paid) || records[0] || sampleData[0]
  const sampleMsg = renderMessageTemplate(templates[selectedType], sampleTaxpayer, gramName, taxCycle)

  const scheduledDates = getScheduledDates(taxCycle)
  const nextDate = scheduledDates.find(d => d >= new Date().toISOString().split("T")[0]) || scheduledDates[scheduledDates.length - 1] || ""
  const stageLabel = getReminderStageLabel(taxCycle)

  const TABS: { key: TemplateTab; label: string }[] = [
    { key: "reminder", label: "📅 Upcoming Reminder" },
    { key: "overdue",  label: "⚠ Overdue Notice" },
    { key: "penalty",  label: "💰 Penalty Notice" },
    { key: "rebate",   label: "🎁 Rebate Reminder" },
  ]

  return (
    <div>
      {/* Template Section */}
      <div style={{ background: "#fff", border: "1px solid #EDE5D8", borderRadius: 12, padding: "18px 20px", marginBottom: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div>
            <div style={{ fontWeight: 600, fontSize: 14, color: "#1C1409" }}>🔔 Bilingual Reminder Template Settings & Sample Preview</div>
            <div style={{ fontSize: 11, color: "#8B6A4A", marginTop: 2 }}>Variables: {"{name}"}, {"{dueDate}"}, {"{amount}"}, {"{penalty_amount}"}, {"{rebate_deadline}"}, {"{rebate_percent}"}, {"{total}"}, {"{gramPanchayat}"}</div>
          </div>
          <button onClick={() => setShowEditTemplates(e => !e)} style={btnStyle("secondary", "sm")}>
            {showEditTemplates ? "Hide Template Editor" : "⚙ Edit Reminder Templates"}
          </button>
        </div>

        <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
          {TABS.map(t => (
            <button key={t.key} onClick={() => setSelectedType(t.key)} style={{
              padding: "6px 14px", borderRadius: 8, border: "1.5px solid",
              borderColor: selectedType === t.key ? "#D97706" : "#EDE5D8",
              background: selectedType === t.key ? "#FEF3C7" : "#fff",
              color: selectedType === t.key ? "#92400E" : "#6B5040",
              fontSize: 12, fontWeight: selectedType === t.key ? 600 : 400, cursor: "pointer",
            }}>{t.label}</button>
          ))}
        </div>

        {showEditTemplates && (
          <div style={{ background: "#FFFBF5", border: "1px solid #F5EFE5", borderRadius: 10, padding: "14px", marginBottom: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: "#6B5040", marginBottom: 8 }}>
              Editing Template: <span style={{ color: "#D97706" }}>{selectedType.toUpperCase()}</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <label style={{ display: "block", fontSize: 10, fontWeight: 600, color: "#92400E", marginBottom: 4 }}>Marathi Template Text</label>
                <textarea rows={5} value={templates[selectedType].mr}
                  onChange={e => { const text = e.target.value; setTemplates(prev => ({ ...prev, [selectedType]: { ...prev[selectedType], mr: text } })) }}
                  style={{ ...inputStyle(), fontFamily: "'Noto Sans Devanagari', sans-serif", fontSize: 12, resize: "vertical" }} />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 10, fontWeight: 600, color: "#0369A1", marginBottom: 4 }}>English Template Text</label>
                <textarea rows={5} value={templates[selectedType].en}
                  onChange={e => { const text = e.target.value; setTemplates(prev => ({ ...prev, [selectedType]: { ...prev[selectedType], en: text } })) }}
                  style={{ ...inputStyle(), fontFamily: "'Poppins', sans-serif", fontSize: 12, resize: "vertical" }} />
              </div>
            </div>
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <MsgBox label="मराठी नमुना संदेश (Marathi Sample)" labelColor="#92400E" bg="#FFFBEB" border="#FDE68A" text={sampleMsg.mr} devanagari />
          <MsgBox label="English Sample Message" labelColor="#0369A1" bg="#F0F9FF" border="#BAE6FD" text={sampleMsg.en} />
        </div>
      </div>

      {/* Due Reminders Today */}
      {reminderDue.length > 0 && (
        <div style={{ marginBottom: 28 }}>
          <SectionHead title="Due Reminders Today" count={reminderDue.length} subtitle={stageLabel ? `Cadence stage: ${stageLabel}` : "Taxpayers due for reminder dispatch today"} />
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {reminderDue.map(r => {
              const pen = computePenalty(r, taxCycle)
              const mt: MessageLog["messageType"] = pen > 0 ? "penalty" : r.status === "overdue" ? "overdue" : "reminder"
              return (
                <div key={r.id} style={{ background: "#fff", borderTop: "1px solid #EDE5D8", borderRight: "1px solid #EDE5D8", borderBottom: "1px solid #EDE5D8", borderLeft: `4px solid ${r.status === "overdue" ? "#DC2626" : "#D97706"}`, borderRadius: 10, padding: "14px 18px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontWeight: 600, fontSize: 14 }}>{r.name}</span>
                        {stageLabel && <span style={{ background: "#FFFBEB", color: "#D97706", border: "1px solid #FDE68A", borderRadius: 99, fontSize: 10, padding: "1px 8px", fontWeight: 600 }}>🔔 {stageLabel}</span>}
                      </div>
                      <div style={{ fontSize: 11, color: "#8B6A4A", marginTop: 2 }}>{r.propertyId}{r.ward && ` • ${r.ward}`}{r.phone && ` • 📞 ${r.phone}`}</div>
                      <div style={{ fontSize: 11, color: "#8B6A4A", marginTop: 1 }}>
                        Due: <strong>{formatDate(taxCycle.dueDate)}</strong> &nbsp;|&nbsp; Amount: <strong style={{ color: "#DC2626" }}>₹{totalDue(r, taxCycle).toLocaleString("en-IN")}</strong>
                        {pen > 0 && <span style={{ color: "#C2410C" }}> (incl. ₹{pen.toLocaleString("en-IN")} penalty)</span>}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                      <button onClick={() => onSend(r.id, mt)} style={btnStyle("primary", "sm")}>📨 Log Sent</button>
                      <button onClick={() => onMarkPaid(r.id)} style={btnStyle("success", "sm")}>✓ Paid</button>
                      <button onClick={() => onEdit(r)} style={btnStyle("secondary", "sm")}>✏ Edit</button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* All Scheduled Reminders */}
      <SectionHead title="All Scheduled Reminders" subtitle={`Global cadence from due date ${formatDate(taxCycle.dueDate)}`} />
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {records.filter(r => !r.paid).map(r => (
          <div key={r.id} style={{ background: "#fff", border: "1px solid #EDE5D8", borderRadius: 8, padding: "12px 16px", display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 120, flexShrink: 0 }}>
              <div style={{ fontSize: 10, color: "#8B6A4A" }}>Next reminder</div>
              <div style={{ fontSize: 11, fontWeight: 600, color: "#D97706" }}>{formatDate(nextDate)}</div>
            </div>
            <div style={{ flex: 1 }}>
              <span style={{ fontWeight: 600, fontSize: 13 }}>{r.name}</span>
              <div style={{ fontSize: 11, color: "#8B6A4A", marginTop: 2 }}>{r.propertyId} · Ward: {r.ward || "—"} · Due: {formatDate(taxCycle.dueDate)}</div>
            </div>
            <div style={{ fontWeight: 700, color: "#1C1409", fontSize: 14, flexShrink: 0 }}>₹{totalDue(r, taxCycle).toLocaleString("en-IN")}</div>
            <StatusBadge status={r.status} />
            <button onClick={() => onSend(r.id, "reminder")} style={btnStyle("secondary", "sm")}>📨 Log Sent</button>
          </div>
        ))}
        {records.filter(r => !r.paid).length === 0 && (
          <div style={{ textAlign: "center", padding: 40, color: "#8B6A4A" }}><div style={{ fontSize: 32 }}>🔔</div><div style={{ marginTop: 8 }}>No pending reminders</div></div>
        )}
      </div>
    </div>
  )
}

// ── Add Record (simplified) ───────────────────────────────────────────────────
function AddRecordView({ form, onChange, onSave, onCancel, isEdit }: {
  form: Omit<TaxRecord, "id" | "status">
  onChange: (f: keyof ReturnType<typeof emptyRecord>, v: unknown) => void
  onSave: () => void; onCancel: () => void; isEdit: boolean;
}) {
  return (
    <div style={{ maxWidth: 680 }}>
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: "#1C1409" }}>{isEdit ? "Edit Record" : "New Tax Record"}</div>
        <div style={{ fontSize: 12, color: "#8B6A4A", marginTop: 2 }}>* Required fields · Due date and penalty are set globally in Settings → Tax Cycle Configuration</div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <FormField label="Taxpayer Name *">
          <input style={inputStyle()} value={form.name} onChange={e => onChange("name", e.target.value)} placeholder="Full name in English" />
        </FormField>
        <FormField label="Property ID *">
          <input style={inputStyle()} value={form.propertyId} onChange={e => onChange("propertyId", e.target.value)} placeholder="GP/2024/001" />
        </FormField>
        <FormField label="Ward">
          <input style={inputStyle()} value={form.ward} onChange={e => onChange("ward", e.target.value)} placeholder="Ward 1" />
        </FormField>
        <FormField label="Phone Number">
          <input style={inputStyle()} value={form.phone} onChange={e => onChange("phone", e.target.value)} placeholder="9876543210" maxLength={10} />
        </FormField>
        <FormField label="Address" fullWidth>
          <input style={inputStyle()} value={form.address} onChange={e => onChange("address", e.target.value)} placeholder="Plot No, Street, Village" />
        </FormField>
        <FormField label="Base Tax Amount (₹) *">
          <input style={inputStyle()} type="number" value={form.amount || ""} onChange={e => onChange("amount", parseFloat(e.target.value) || 0)} placeholder="2500" min={0} />
        </FormField>
        <FormField label="Payment Status">
          <div style={{ display: "flex", gap: 8 }}>
            {([false, true] as const).map(v => (
              <button key={String(v)} onClick={() => onChange("paid", v)} style={{ flex: 1, padding: "8px", borderRadius: 8, border: `1.5px solid ${form.paid === v ? (v ? "#059669" : "#DC2626") : "#EDE5D8"}`, background: form.paid === v ? (v ? "#F0FDF4" : "#FEF2F2") : "#fff", color: form.paid === v ? (v ? "#059669" : "#DC2626") : "#6B5040", cursor: "pointer", fontSize: 12, fontWeight: 500 }}>
                {v ? "✓ Paid" : "✗ Unpaid"}
              </button>
            ))}
          </div>
        </FormField>
      </div>

      <div style={{ display: "flex", gap: 10, marginTop: 24 }}>
        <button onClick={onSave} style={btnStyle("primary")}>{isEdit ? "✓ Save Changes" : "✓ Add Record"}</button>
        <button onClick={onCancel} style={btnStyle("secondary")}>Cancel</button>
      </div>
    </div>
  )
}

// ── Import View ───────────────────────────────────────────────────────────────
function ImportView({ importText, setImportText, onParse, importResult }: {
  importText: string; setImportText: (s: string) => void;
  onParse: () => void; importResult: string[]; fileRef: React.RefObject<HTMLInputElement | null>;
}) {
  return (
    <div style={{ maxWidth: 720 }}>
      <div style={{ background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 10, padding: "14px 18px", marginBottom: 20 }}>
        <div style={{ fontWeight: 600, color: "#92400E", marginBottom: 4, fontSize: 13 }}>📄 Import Data from Word Document</div>
        <div style={{ fontSize: 12, color: "#6B5040" }}>Copy text from your Word file and paste below. Separate each taxpayer with a blank line. Due date is now set globally in Settings.</div>
      </div>
      <div style={{ background: "#fff", border: "1px solid #EDE5D8", borderRadius: 10, padding: "16px", marginBottom: 16 }}>
        <div style={{ fontWeight: 600, fontSize: 12, color: "#6B5040", marginBottom: 8 }}>Example Format:</div>
        <pre style={{ background: "#FFFBF5", border: "1px solid #EDE5D8", borderRadius: 8, padding: "12px", fontSize: 11, color: "#4A3020", lineHeight: 1.8, fontFamily: "monospace", margin: 0 }}>{`Name: Ramesh Patil
Property ID: GP/2024/001
Ward: Ward 1
Amount: 2500
Phone: 9876543210
Address: Plot 12, Main Road`}</pre>
      </div>
      <textarea value={importText} onChange={e => setImportText(e.target.value)} placeholder="Paste text from Word file here..." style={{ width: "100%", height: 220, border: "1.5px solid #EDE5D8", borderRadius: 10, padding: "12px 14px", fontSize: 13, fontFamily: "monospace", resize: "vertical", background: "#fff", color: "#1C1409", outline: "none", marginBottom: 12, boxSizing: "border-box" }} />
      <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
        <button onClick={onParse} style={btnStyle("primary")} disabled={!importText.trim()}>⊕ Import Records</button>
        <button onClick={() => setImportText("")} style={btnStyle("secondary")}>Clear</button>
      </div>
      {importResult.length > 0 && (
        <div style={{ background: "#fff", border: "1px solid #EDE5D8", borderRadius: 10, padding: "16px" }}>
          <div style={{ fontWeight: 600, fontSize: 13, color: "#1C1409", marginBottom: 10 }}>Import Result</div>
          {importResult.map((line, i) => (
            <div key={i} style={{ padding: "6px 10px", borderRadius: 6, marginBottom: 4, fontSize: 12, background: line.includes("✓") ? "#F0FDF4" : "#FEF2F2", color: line.includes("✓") ? "#065F46" : "#991B1B" }}>{line}</div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Settings ──────────────────────────────────────────────────────────────────
function SettingsView({ gramName, setGramName, taxCycle, setTaxCycle, records, setRecords, showToast }: {
  gramName: string; setGramName: (s: string) => void;
  taxCycle: TaxCycleConfig; setTaxCycle: (c: TaxCycleConfig) => void;
  records: TaxRecord[]; setRecords: (r: TaxRecord[]) => void;
  showToast: (msg: string, type?: "success" | "error") => void;
}) {
  const [draft, setDraft] = useState<TaxCycleConfig>(() => ({ ...taxCycle }))

  function saveCycle() {
    if (!draft.dueDate) { showToast("Please set a due date.", "error"); return }
    if (draft.rebateEnabled && draft.rebateDeadline >= draft.dueDate) { showToast("Rebate deadline must be before due date.", "error"); return }
    setTaxCycle(draft)
    showToast("Tax Cycle Configuration saved.")
  }

  function updateDraft(field: keyof TaxCycleConfig, value: unknown) {
    setDraft(prev => ({ ...prev, [field]: value }))
  }

  function updatePreReminder(i: number, val: number) {
    const arr = [...draft.preReminders]; arr[i] = val; updateDraft("preReminders", arr)
  }
  function removePreReminder(i: number) { updateDraft("preReminders", draft.preReminders.filter((_, idx) => idx !== i)) }
  function addPreReminder() { updateDraft("preReminders", [...draft.preReminders, 5]) }

  function updatePostReminder(i: number, val: number) {
    const arr = [...draft.postReminders]; arr[i] = val; updateDraft("postReminders", arr)
  }
  function removePostReminder(i: number) { updateDraft("postReminders", draft.postReminders.filter((_, idx) => idx !== i)) }
  function addPostReminder() { updateDraft("postReminders", [...draft.postReminders, 7]) }

  const totalPaid    = records.filter(r => r.paid).reduce((s, r) => s + r.amount, 0)
  const totalPending = records.filter(r => !r.paid).reduce((s, r) => s + totalDue(r, taxCycle), 0)
  const totalPenalty = records.filter(r => !r.paid).reduce((s, r) => s + computePenalty(r, taxCycle), 0)

  const pillStyle = (active: boolean): React.CSSProperties => ({
    padding: "6px 14px", borderRadius: 8, border: `1.5px solid ${active ? "#D97706" : "#EDE5D8"}`,
    background: active ? "#FEF3C7" : "#fff", color: active ? "#92400E" : "#6B5040",
    fontSize: 12, fontWeight: 500, cursor: "pointer",
  })

  return (
    <div style={{ maxWidth: 640 }}>
      {/* GP Office Details */}
      <div style={{ background: "#fff", border: "1px solid #EDE5D8", borderRadius: 12, padding: "20px", marginBottom: 20 }}>
        <div style={{ fontWeight: 600, fontSize: 14, color: "#1C1409", marginBottom: 16 }}>Gram Panchayat Office Details</div>
        <FormField label="Gram Panchayat Name (English)">
          <input style={inputStyle()} value={gramName} onChange={e => setGramName(e.target.value)} />
        </FormField>
      </div>

      {/* Tax Cycle Configuration */}
      <div style={{ background: "#fff", border: "1.5px solid #D97706", borderRadius: 12, padding: "20px", marginBottom: 20 }}>
        <div style={{ fontWeight: 600, fontSize: 14, color: "#1C1409", marginBottom: 4 }}>Tax Cycle Configuration</div>
        <div style={{ fontSize: 12, color: "#8B6A4A", marginBottom: 20 }}>Global settings applied to all records — update once each financial year.</div>

        {/* Collection Period */}
        <div style={{ marginBottom: 20 }}>
          <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#6B5040", marginBottom: 8 }}>Collection Period</label>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <select value={draft.fromMonth} onChange={e => updateDraft("fromMonth", parseInt(e.target.value))} style={inputStyle({ width: 150 })}>
              {MONTH_NAMES.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
            </select>
            <span style={{ fontSize: 12, color: "#8B6A4A" }}>to</span>
            <select value={draft.toMonth} onChange={e => updateDraft("toMonth", parseInt(e.target.value))} style={inputStyle({ width: 150 })}>
              {MONTH_NAMES.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
            </select>
          </div>
        </div>

        {/* Due Date */}
        <div style={{ marginBottom: 20 }}>
          <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#6B5040", marginBottom: 8 }}>Due Date</label>
          <input type="date" value={draft.dueDate} onChange={e => updateDraft("dueDate", e.target.value)} style={inputStyle({ width: 200 })} />
          <div style={{ fontSize: 11, color: "#8B6A4A", marginTop: 4 }}>ⓘ All residents share this single due date</div>
        </div>

        {/* Rebate */}
        <div style={{ marginBottom: 20, background: "#FFFBF5", border: "1px solid #F5EFE5", borderRadius: 10, padding: "14px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
            <div style={{ fontWeight: 600, fontSize: 13, color: "#1C1409" }}>Rebate (Early Payment Discount)</div>
            <button onClick={() => updateDraft("rebateEnabled", !draft.rebateEnabled)} style={{ ...pillStyle(draft.rebateEnabled), padding: "3px 12px" }}>
              {draft.rebateEnabled ? "ON" : "OFF"}
            </button>
          </div>
          {draft.rebateEnabled && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <FormField label="Rebate %">
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <input type="number" min={0} max={100} step={0.5} value={draft.rebatePercent} onChange={e => updateDraft("rebatePercent", parseFloat(e.target.value) || 0)} style={inputStyle({ width: 100 })} />
                  <span style={{ fontSize: 12, color: "#8B6A4A" }}>%</span>
                </div>
              </FormField>
              <FormField label="Rebate valid till">
                <input type="date" value={draft.rebateDeadline} onChange={e => updateDraft("rebateDeadline", e.target.value)} style={inputStyle()} />
              </FormField>
              <div style={{ gridColumn: "1 / -1", fontSize: 11, color: "#8B6A4A" }}>ⓘ Rebate deadline must be before the main Due Date</div>
            </div>
          )}
        </div>

        {/* Penalty */}
        <div style={{ marginBottom: 20 }}>
          <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#6B5040", marginBottom: 8 }}>Penalty (Late Payment)</label>
          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            {(["flat", "percentage"] as const).map(t => (
              <button key={t} onClick={() => updateDraft("penaltyType", t)} style={{ ...pillStyle(draft.penaltyType === t), flex: 1 }}>
                {t === "flat" ? "₹ Flat / Month" : "% of Amount / Month"}
              </button>
            ))}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 12, color: "#6B5040" }}>Value:</span>
              <input type="number" min={0} step={draft.penaltyType === "percentage" ? 0.5 : 1} value={draft.penaltyValue}
                onChange={e => updateDraft("penaltyValue", parseFloat(e.target.value) || 0)}
                style={inputStyle({ width: 100 })} />
              <span style={{ fontSize: 12, color: "#8B6A4A" }}>{draft.penaltyType === "flat" ? "₹/month" : "%/month"}</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 12, color: "#6B5040" }}>Starts:</span>
              <input type="number" min={1} value={draft.penaltyStartDays} onChange={e => updateDraft("penaltyStartDays", parseInt(e.target.value) || 1)} style={inputStyle({ width: 70 })} />
              <span style={{ fontSize: 12, color: "#8B6A4A" }}>days after due date</span>
            </div>
          </div>
        </div>

        {/* Reminder Cadence */}
        <div style={{ marginBottom: 20 }}>
          <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#6B5040", marginBottom: 8 }}>Reminder Cadence</label>
          <div style={{ background: "#FFFBF5", border: "1px solid #F5EFE5", borderRadius: 8, padding: "12px 14px", marginBottom: 10 }}>
            <div style={{ fontSize: 11, color: "#92400E", fontWeight: 600, marginBottom: 8 }}>Pre-due reminders (days before due date)</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
              {draft.preReminders.map((d, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 4, background: "#FEF3C7", border: "1px solid #FDE68A", borderRadius: 20, padding: "3px 8px 3px 10px" }}>
                  <input type="number" min={1} max={365} value={d} onChange={e => updatePreReminder(i, parseInt(e.target.value) || 1)}
                    style={{ width: 42, border: "none", background: "transparent", fontSize: 12, fontWeight: 600, color: "#92400E", outline: "none", fontFamily: "'Poppins', sans-serif" }} />
                  <span style={{ fontSize: 11, color: "#B45309" }}>d</span>
                  <button onClick={() => removePreReminder(i)} style={{ background: "none", border: "none", cursor: "pointer", color: "#B45309", fontSize: 12, padding: 0, lineHeight: 1 }}>✕</button>
                </div>
              ))}
              <button onClick={addPreReminder} style={{ ...btnStyle("secondary", "sm"), borderRadius: 20, fontSize: 11 }}>+ Add</button>
            </div>
          </div>
          <div style={{ background: "#FFFBF5", border: "1px solid #F5EFE5", borderRadius: 8, padding: "12px 14px" }}>
            <div style={{ fontSize: 11, color: "#DC2626", fontWeight: 600, marginBottom: 8 }}>Post-due (overdue) reminders (days after due date)</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
              {draft.postReminders.map((d, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 4, background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 20, padding: "3px 8px 3px 10px" }}>
                  <input type="number" min={1} max={365} value={d} onChange={e => updatePostReminder(i, parseInt(e.target.value) || 1)}
                    style={{ width: 42, border: "none", background: "transparent", fontSize: 12, fontWeight: 600, color: "#DC2626", outline: "none", fontFamily: "'Poppins', sans-serif" }} />
                  <span style={{ fontSize: 11, color: "#B91C1C" }}>d</span>
                  <button onClick={() => removePostReminder(i)} style={{ background: "none", border: "none", cursor: "pointer", color: "#B91C1C", fontSize: 12, padding: 0, lineHeight: 1 }}>✕</button>
                </div>
              ))}
              <button onClick={addPostReminder} style={{ ...btnStyle("secondary", "sm"), borderRadius: 20, fontSize: 11 }}>+ Add</button>
            </div>
          </div>
        </div>

        <button onClick={saveCycle} style={btnStyle("primary")}>✓ Save Tax Cycle</button>
      </div>

      {/* Statistics */}
      <div style={{ background: "#fff", border: "1px solid #EDE5D8", borderRadius: 12, padding: "20px", marginBottom: 20 }}>
        <div style={{ fontWeight: 600, fontSize: 14, color: "#1C1409", marginBottom: 12 }}>Statistics</div>
        {[
          { label: "Total Records",              value: records.length,                color: "#1C1409" },
          { label: "Overdue",                    value: records.filter(r => computeStatus(r.paid, taxCycle.dueDate) === "overdue").length, color: "#DC2626" },
          { label: "Total Penalty Accrued",      value: `₹${totalPenalty.toLocaleString("en-IN")}`,  color: "#C2410C" },
          { label: "Total Pending (incl. penalty)", value: `₹${totalPending.toLocaleString("en-IN")}`, color: "#D97706" },
          { label: "Total Collected",            value: `₹${totalPaid.toLocaleString("en-IN")}`,     color: "#059669" },
        ].map(s => (
          <div key={s.label} style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderBottom: "1px solid #F5EFE5" }}>
            <span style={{ fontSize: 13, color: "#6B5040" }}>{s.label}</span>
            <span style={{ fontWeight: 700, fontSize: 14, color: s.color }}>{s.value}</span>
          </div>
        ))}
      </div>

      {/* Danger Zone */}
      <div style={{ background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 12, padding: "16px 20px" }}>
        <div style={{ fontWeight: 600, fontSize: 13, color: "#DC2626", marginBottom: 8 }}>⚠ Danger Zone</div>
        <button onClick={() => { if (confirm("Delete ALL records?")) { setRecords([]); localStorage.removeItem("gp_tax_records_v4") } }} style={btnStyle("danger")}>Clear All Records</button>
      </div>
    </div>
  )
}

// ── Shared helpers ────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<Status, { bg: string; border: string; text: string; label: string }> = {
  overdue: { bg: "#FEF2F2", border: "#FCA5A5", text: "#DC2626", label: "Overdue" },
  unpaid:  { bg: "#FFFBEB", border: "#FDE68A", text: "#D97706", label: "Unpaid" },
  paid:    { bg: "#F0FDF4", border: "#A7F3D0", text: "#059669", label: "Paid" },
}

function MsgBox({ label, labelColor, bg, border, text, devanagari }: { label: string; labelColor: string; bg: string; border: string; text: string; devanagari?: boolean }) {
  return (
    <div style={{ background: bg, border: `1px solid ${border}`, borderRadius: 8, padding: "12px 14px" }}>
      <div style={{ fontSize: 9, fontWeight: 600, color: labelColor, marginBottom: 5, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</div>
      <pre style={{ fontFamily: devanagari ? "'Noto Sans Devanagari', sans-serif" : "'Poppins', sans-serif", fontSize: 12, color: "#1C1409", whiteSpace: "pre-wrap", margin: 0, lineHeight: 1.8 }}>{text}</pre>
    </div>
  )
}

function SectionHead({ title, subtitle, count }: { title: string; subtitle?: string; count?: number }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontWeight: 600, fontSize: 14, color: "#1C1409" }}>{title}</span>
        {count !== undefined && <span style={{ background: "#EDE5D8", color: "#6B5040", borderRadius: 99, fontSize: 10, padding: "1px 7px", fontWeight: 600 }}>{count}</span>}
      </div>
      {subtitle && <div style={{ fontSize: 11, color: "#8B6A4A", marginTop: 1 }}>{subtitle}</div>}
    </div>
  )
}

function StatusBadge({ status }: { status: Status }) {
  const s = STATUS_COLORS[status]
  return <span style={{ background: s.bg, color: s.text, border: `1px solid ${s.border}`, borderRadius: 99, fontSize: 10, padding: "2px 10px", fontWeight: 600, flexShrink: 0 }}>{s.label}</span>
}

function FormField({ label, children, fullWidth }: { label: string; children: React.ReactNode; fullWidth?: boolean }) {
  return (
    <div style={{ gridColumn: fullWidth ? "1 / -1" : undefined }}>
      <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#6B5040", marginBottom: 5 }}>{label}</label>
      {children}
    </div>
  )
}

function inputStyle(extra?: React.CSSProperties): React.CSSProperties {
  return { width: "100%", border: "1.5px solid #EDE5D8", borderRadius: 8, padding: "8px 12px", fontSize: 13, background: "#fff", color: "#1C1409", outline: "none", fontFamily: "'Poppins', sans-serif", boxSizing: "border-box", ...extra }
}

type BtnVariant = "primary" | "secondary" | "success" | "danger"
type BtnSize = "sm" | "md"

function btnStyle(variant: BtnVariant, size: BtnSize = "md"): React.CSSProperties {
  const pad = size === "sm" ? "5px 10px" : "9px 18px"
  const fs  = size === "sm" ? 11 : 13
  const colors: Record<BtnVariant, { bg: string; color: string; border: string }> = {
    primary:   { bg: "#D97706", color: "#fff",    border: "#D97706" },
    secondary: { bg: "#fff",    color: "#6B5040", border: "#EDE5D8" },
    success:   { bg: "#059669", color: "#fff",    border: "#059669" },
    danger:    { bg: "#DC2626", color: "#fff",    border: "#DC2626" },
  }
  const c = colors[variant]
  return { padding: pad, borderRadius: 8, border: `1.5px solid ${c.border}`, background: c.bg, color: c.color, fontSize: fs, fontWeight: 600, cursor: "pointer", fontFamily: "'Poppins', sans-serif", whiteSpace: "nowrap" }
}
