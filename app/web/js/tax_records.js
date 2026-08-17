/* ============================================================
   tax_records.js — Tax Records screen logic
   Matches Figma prototype controls, pills, and dynamic calculations
   ============================================================ */

let activeCycle = null;
let currentFilterStatus = "all";

document.addEventListener("DOMContentLoaded", () => {
  renderSidebar("tax_records");
  loadCycle();
  loadRecords();

  const searchInput = document.getElementById("search-input");
  if (searchInput) {
    searchInput.addEventListener("input", debounce(loadRecords, 250));
  }

  // Pill click handlers
  const pillBtns = document.querySelectorAll("#status-pill-group .tab-btn");
  pillBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      pillBtns.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      currentFilterStatus = btn.getAttribute("data-status") || "all";
      loadRecords();
    });
  });
});

function loadCycle() {
  eel.get_active_cycle()((cycle) => {
    activeCycle = cycle;
    const el = document.getElementById("cycle-banner");
    if (!el) return;
    if (!cycle) {
      el.textContent = "⚠️ No active tax cycle configured. Go to Settings → Tax Cycle Configuration.";
      el.style.background = "#FEF2F2";
      el.style.borderColor = "#FECACA";
      el.style.color = "#DC2626";
      return;
    }
    const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const fromM = months[(cycle.collection_from_month || 1) - 1];
    const toM   = months[(cycle.collection_to_month || 3) - 1];
    let str = `📅 FY ${cycle.fy_label} · Tax due by ${formatDate(cycle.due_date)}`;
    if (cycle.rebate_enabled) {
      str += ` · Rebate ${cycle.rebate_percent}% if paid by ${formatDate(cycle.rebate_deadline)}`;
    }
    el.textContent = str;
  });
}

function calculatePenaltyLocal(baseAmount, cycle) {
  if (!cycle || !cycle.due_date) return 0;
  const dueDt = new Date(cycle.due_date);
  const today = new Date();
  const diffDays = Math.max(0, Math.floor((today - dueDt) / (1000 * 60 * 60 * 24)));
  if (diffDays < (cycle.penalty_start_days || 1)) return 0;
  const monthsLate = Math.ceil(diffDays / 30);
  if (cycle.penalty_type === "percent") {
    return Math.round(baseAmount * ((cycle.penalty_value || 0) / 100) * monthsLate);
  }
  return (cycle.penalty_value || 0) * monthsLate;
}

function calculateRebateLocal(baseAmount, cycle) {
  if (!cycle || !cycle.rebate_enabled || !cycle.rebate_deadline) return 0;
  const today = new Date().toISOString().split("T")[0];
  if (today <= cycle.rebate_deadline) {
    return Math.round(baseAmount * ((cycle.rebate_percent || 0) / 100));
  }
  return 0;
}

function loadRecords() {
  const q = document.getElementById("search-input") ? document.getElementById("search-input").value.trim() : "";

  eel.get_all_residents(q, "all", "all", "name", "ASC")((residents) => {
    eel.get_active_cycle()((cycle) => {
      activeCycle = cycle;
      const resList = Array.isArray(residents) ? residents : [];
      const today = new Date(); today.setHours(0,0,0,0);
      const dueDt = cycle && cycle.due_date ? new Date(cycle.due_date) : null;
      if (dueDt) dueDt.setHours(0,0,0,0);

      // Overdue alert in top header
      const overdueList = resList.filter(r => r.payment_status === "unpaid" && dueDt && dueDt < today);
      const overdueAlert = document.getElementById("header-overdue-alert");
      const overdueCount = document.getElementById("header-overdue-count");
      if (overdueAlert && overdueCount) {
        if (overdueList.length > 0) {
          overdueCount.textContent = overdueList.length;
          overdueAlert.style.display = "flex";
        } else {
          overdueAlert.style.display = "none";
        }
      }

      // Filter by pill selection
      const filtered = resList.filter(r => {
        const isOverdue = r.payment_status === "unpaid" && dueDt && dueDt < today;
        if (currentFilterStatus === "paid") return r.payment_status === "paid";
        if (currentFilterStatus === "unpaid") return r.payment_status === "unpaid" && !isOverdue;
        if (currentFilterStatus === "overdue") return isOverdue;
        return true;
      });

      const container = document.getElementById("records-container");
      if (!container) return;

      if (!filtered.length) {
        container.innerHTML = `
          <div class="empty-state">
            <div class="empty-icon">📋</div>
            <div class="empty-title">No records found</div>
            <div class="empty-sub">Try adjusting your search filters or add a new record.</div>
          </div>
        `;
        return;
      }

      container.innerHTML = filtered.map(r => renderRecordItem(r, cycle)).join("");
    });
  });
}

function renderRecordItem(r, cycle) {
  const today = new Date(); today.setHours(0,0,0,0);
  const dueDt = cycle && cycle.due_date ? new Date(cycle.due_date) : null;
  if (dueDt) dueDt.setHours(0,0,0,0);
  const isOverdue = r.payment_status === "unpaid" && dueDt && dueDt < today;

  const isPaid = r.payment_status === "paid";
  const penalty = isOverdue ? calculatePenaltyLocal(r.base_amount, cycle) : 0;
  const rebate  = !isOverdue && !isPaid ? calculateRebateLocal(r.base_amount, cycle) : 0;
  const netDue  = isPaid ? r.base_amount : r.base_amount + penalty;

  const cardClass = isPaid ? "record-card paid" : isOverdue ? "record-card overdue" : "record-card";
  const displayStatus = isOverdue ? "overdue" : r.payment_status;

  return `
    <div class="${cardClass}">
      <div class="record-card-info">
        <div class="flex-center gap-8" style="flex-wrap: wrap;">
          <span class="record-card-name">${r.name}</span>
          ${statusBadge(displayStatus)}
          ${penalty > 0 ? `<span class="pill-penalty">+${formatCurrency(penalty)} penalty</span>` : ''}
          ${rebate > 0 ? `<span class="pill-rebate">−${formatCurrency(rebate)} rebate</span>` : ''}
        </div>
        <div class="record-card-meta">
          <span>📋 ${r.property_id}</span>
          ${r.ward ? `<span>🏘 ${r.ward}</span>` : ''}
          ${r.phone ? `<span>📞 ${r.phone}</span>` : ''}
          ${isPaid && r.paid_date ? `<span class="text-success">Paid: ${formatDate(r.paid_date)}</span>` : ''}
        </div>
      </div>
      <div class="record-card-amount">
        ${penalty > 0 || rebate > 0 ? `<div class="record-card-base">${formatCurrency(r.base_amount)}</div>` : ''}
        <div class="record-card-total">${formatCurrency(netDue)}</div>
        <div class="record-card-actions">
          ${isPaid
            ? `<button class="btn btn-secondary btn-sm" onclick="handleMarkUnpaid(${r.id})">Mark Unpaid</button>`
            : `<button class="btn btn-success btn-sm" onclick="handleMarkPaid(${r.id})">✓ Mark Paid</button>`
          }
          <button class="btn btn-secondary btn-sm" onclick="handleSendReminder(${r.id})">🔔 Remind</button>
          <a href="add_record.html?id=${r.id}" class="btn btn-secondary btn-sm">✏ Edit</a>
          <button class="btn btn-danger btn-sm" onclick="handleDelete(${r.id})">✕</button>
        </div>
      </div>
    </div>
  `;
}

function handleMarkPaid(id) {
  if (!confirm("Mark this tax record as Paid?")) return;
  eel.mark_paid(id)((res) => {
    if (res && res.success) {
      showToast("Marked as paid.");
      loadRecords();
    } else {
      showToast("Error: " + ((res && res.error) || "Failed"), "error");
    }
  });
}

function handleMarkUnpaid(id) {
  if (!confirm("Revert this tax record to Unpaid?")) return;
  eel.mark_unpaid(id)((res) => {
    if (res && res.success) {
      showToast("Reverted to unpaid.");
      loadRecords();
    } else {
      showToast("Error: " + ((res && res.error) || "Failed"), "error");
    }
  });
}

function handleDelete(id) {
  if (!confirm("Are you sure you want to delete this resident record?")) return;
  eel.delete_resident(id)((res) => {
    if (res && res.success) {
      showToast("Record deleted.");
      loadRecords();
    } else {
      showToast("Failed to delete: " + ((res && res.error) || "Failed"), "error");
    }
  });
}

function handleSendReminder(id) {
  if (!confirm("Send a reminder to this resident?")) return;
  eel.send_reminder_now(id, "pre_due", true)((res) => {
    if (res && res.status === "sent") {
      const isDry = res.marathi && res.marathi.dry_run;
      showToast(isDry ? "Reminder prepared (dry run mode)." : "Reminder sent successfully.");
    } else if (res && res.status === "skipped") {
      showToast("Reminder skipped: " + (res.reason || "already sent"), "info");
    } else {
      showToast("Failed to send reminder: " + ((res && (res.error || res.status)) || "Error"), "error");
    }
  });
}

function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => { clearTimeout(timeout); func(...args); };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}
