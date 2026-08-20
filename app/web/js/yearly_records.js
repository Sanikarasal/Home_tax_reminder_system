/* ============================================================
   yearly_records.js — Year-wise paid/unpaid payment records
   ============================================================ */

let allCycles = [];
let selectedCycleId = null;

document.addEventListener("DOMContentLoaded", () => {
  renderSidebar("yearly_records");
  initHeaderDate();
  loadCycles();

  document.getElementById("year-select").addEventListener("change", (e) => {
    const val = parseInt(e.target.value, 10);
    if (!val) return;
    selectedCycleId = val;
    loadYearRecords(val);
  });
});

// ── Load available FY options ─────────────────────────────────────────────────

function loadCycles() {
  eel.get_all_cycles()((cycles) => {
    allCycles = Array.isArray(cycles) ? cycles : [];
    const sel = document.getElementById("year-select");
    sel.innerHTML = '<option value="">— Select FY —</option>';
    allCycles.forEach(c => {
      const opt = document.createElement("option");
      opt.value = c.id;
      opt.textContent = `FY ${c.fy_label}${c.is_active ? " (Active)" : ""}`;
      if (c.is_active) opt.selected = true;
      sel.appendChild(opt);
    });

    // Auto-load the active cycle
    const active = allCycles.find(c => c.is_active);
    if (active) {
      selectedCycleId = active.id;
      loadYearRecords(active.id);
    }
  });
}

// ── Load payment records for selected year ────────────────────────────────────

function loadYearRecords(cycleId) {
  const panels  = document.getElementById("yearly-panels");
  const noMsg   = document.getElementById("no-year-msg");
  const stats   = document.getElementById("year-stats");
  panels.style.display = "none";
  noMsg.style.display  = "none";

  eel.get_payments_by_year(cycleId)((result) => {
    const paid   = Array.isArray(result.paid)   ? result.paid   : [];
    const unpaid = Array.isArray(result.unpaid) ? result.unpaid : [];

    const overdueCount = unpaid.filter(r => r.is_overdue).length;
    const totalCount   = paid.length + unpaid.length;

    if (totalCount === 0) {
      noMsg.style.display = "flex";
      stats.style.display = "none";
      updateHeaderOverdue(0);
      return;
    }

    // Stats chips
    document.getElementById("chip-paid").textContent    = `${paid.length} Paid`;
    document.getElementById("chip-unpaid").textContent  = `${unpaid.length} Unpaid`;
    document.getElementById("chip-overdue").textContent = `${overdueCount} Overdue`;
    stats.style.display = "flex";

    // Header overdue badge
    updateHeaderOverdue(overdueCount);

    // Badges
    document.getElementById("paid-count-badge").textContent   = paid.length;
    document.getElementById("unpaid-count-badge").textContent = unpaid.length;

    // Render paid
    const paidContainer = document.getElementById("paid-list");
    paidContainer.innerHTML = paid.length
      ? paid.map(r => renderPaymentRow(r, true)).join("")
      : '<div class="no-data-msg">No paid records for this year.</div>';

    // Render unpaid
    const unpaidContainer = document.getElementById("unpaid-list");
    unpaidContainer.innerHTML = unpaid.length
      ? unpaid.map(r => renderPaymentRow(r, false)).join("")
      : '<div class="no-data-msg">✅ All residents have paid for this year!</div>';

    panels.style.display = "grid";
  });
}

// ── Render a single payment row ───────────────────────────────────────────────

function renderPaymentRow(r, isPaid) {
  const overdueBadge = (!isPaid && r.is_overdue)
    ? `<span class="badge-overdue">OVERDUE</span>`
    : "";

  const carryNote = r.carry_forward_from_cycle_id
    ? `<span class="carry-forward-note">⚠ Also overdue from FY ${r.carry_forward_fy_label || r.carry_forward_from_cycle_id}</span>`
    : "";

  const paidDateLine = isPaid && r.paid_date
    ? `<span>✓ Paid: ${formatDate(r.paid_date)}</span>` : "";

  const penaltyLine = (!isPaid && r.penalty_amount > 0)
    ? `<span class="text-danger">+ Penalty: ${formatCurrency(r.penalty_amount)}</span>` : "";

  const actionBtn = isPaid
    ? `<button class="btn btn-secondary btn-sm" onclick="handleMarkUnpaid(${r.resident_id},${r.cycle_id})">Revert</button>`
    : `<button class="btn btn-success btn-sm" onclick="handleMarkPaid(${r.resident_id},${r.cycle_id})">✓ Paid</button>`;

  return `
    <div class="py-row">
      <div class="py-row-info">
        <div class="py-row-name">${r.name} ${overdueBadge}</div>
        <div class="py-row-meta">
          <span>📋 ${r.property_id}</span>
          ${r.ward ? `<span>🏘 ${r.ward}</span>` : ""}
          ${r.phone ? `<span>📞 ${r.phone}</span>` : ""}
          ${paidDateLine}
          ${penaltyLine}
        </div>
        ${carryNote}
      </div>
      <div class="py-row-actions">
        <div class="py-row-amount">${formatCurrency(r.base_amount)}</div>
        ${actionBtn}
      </div>
    </div>
  `;
}

// ── Action handlers ───────────────────────────────────────────────────────────

function handleMarkPaid(residentId, cycleId) {
  if (!confirm("Mark this resident as Paid for this year?")) return;
  eel.mark_payment_paid_for_year(residentId, cycleId, "", 0)((res) => {
    if (res && res.success) {
      showToast("Marked as paid.");
      loadYearRecords(selectedCycleId);
    } else {
      showToast("Error: " + ((res && res.error) || "Failed"), "error");
    }
  });
}

function handleMarkUnpaid(residentId, cycleId) {
  if (!confirm("Revert to unpaid for this year?")) return;
  eel.mark_payment_unpaid_for_year(residentId, cycleId)((res) => {
    if (res && res.success) {
      showToast("Reverted to unpaid.");
      loadYearRecords(selectedCycleId);
    } else {
      showToast("Error: " + ((res && res.error) || "Failed"), "error");
    }
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function updateHeaderOverdue(count) {
  const alert = document.getElementById("header-overdue-alert");
  const span  = document.getElementById("header-overdue-count");
  if (!alert || !span) return;
  if (count > 0) {
    span.textContent = count;
    alert.style.display = "flex";
  } else {
    alert.style.display = "none";
  }
}

function initHeaderDate() {
  const el = document.getElementById("header-date");
  if (el) el.textContent = new Date().toLocaleDateString("en-IN", { day:"numeric", month:"short", year:"numeric" });
}
