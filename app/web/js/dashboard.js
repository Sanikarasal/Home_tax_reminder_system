/* ============================================================
   dashboard.js — Dashboard screen logic
   Matches Figma prototype structure and dynamics
   ============================================================ */

let activeCycleData = null;

document.addEventListener("DOMContentLoaded", () => {
  renderSidebar("dashboard");
  loadCycle();
  loadDashboardData();
  loadSchedulerStatus();
  loadFailedSends();

  document.getElementById("btn-trigger-job").addEventListener("click", triggerJob);
});

function loadCycle() {
  eel.get_active_cycle()((cycle) => {
    activeCycleData = cycle;
    const el = document.getElementById("cycle-banner");
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
    let str = `📅 FY ${cycle.fy_label} · Collection: ${fromM}–${toM} · Due ${formatDate(cycle.due_date)}`;
    if (cycle.rebate_enabled) {
      str += ` · Rebate ${cycle.rebate_percent}% till ${formatDate(cycle.rebate_deadline)}`;
    }
    el.textContent = str;
  });
}

function loadDashboardData() {
  eel.get_resident_stats()((stats) => {
    document.getElementById("stat-total").textContent        = (stats && stats.total) || 0;
    document.getElementById("stat-paid").textContent         = (stats && stats.paid) || 0;
    document.getElementById("stat-pending-sum").textContent  = formatCurrency(stats ? stats.total_due : 0);
    document.getElementById("stat-penalty").textContent      = formatCurrency(stats ? stats.total_penalty : 0);
    document.getElementById("stat-collected").textContent    = formatCurrency(stats ? stats.paid_sum : 0);
  });

  eel.get_all_residents("", "all", "all", "name", "ASC")((residents) => {
    eel.get_active_cycle()((cycle) => {
      activeCycleData = cycle;
      const resList = Array.isArray(residents) ? residents : [];
      const today = new Date();
      today.setHours(0,0,0,0);
      const dueDt = cycle && cycle.due_date ? new Date(cycle.due_date) : null;
      if (dueDt) dueDt.setHours(0,0,0,0);

      const overdueList = resList.filter(r => r.payment_status === "unpaid" && dueDt && dueDt < today);
      const dueThisWeekList = resList.filter(r => {
        if (r.payment_status !== "unpaid" || !dueDt) return false;
        const diff = (dueDt.getTime() - today.getTime()) / 86400000;
        return diff >= 0 && diff <= 7;
      });
      const unpaidList = resList.filter(r => r.payment_status === "unpaid");

      // Overdue alert in top header
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

      // Update KPI counters
      document.getElementById("stat-overdue").textContent = overdueList.length;
      document.getElementById("stat-due-week").textContent = dueThisWeekList.length;

      // Render Overdue Section
      const overdueSec = document.getElementById("overdue-section");
      const overdueContainer = document.getElementById("overdue-list");
      const overdueBadge = document.getElementById("overdue-count-badge");
      if (overdueList.length > 0) {
        overdueSec.style.display = "block";
        overdueBadge.textContent = overdueList.length;
        overdueContainer.innerHTML = overdueList.map(r => renderResidentCard(r, cycle, true)).join("");
      } else {
        overdueSec.style.display = "none";
      }

      // Render Unpaid Section
      const unpaidContainer = document.getElementById("unpaid-list");
      document.getElementById("unpaid-count-badge").textContent = unpaidList.length;
      if (!unpaidList.length) {
        unpaidContainer.innerHTML = `
          <div class="empty-state">
            <div class="empty-icon">✓</div>
            <div class="empty-title">All clear!</div>
            <div class="empty-sub">No unpaid residents found.</div>
          </div>
        `;
      } else {
        unpaidContainer.innerHTML = unpaidList.map(r => renderResidentCard(r, cycle, false)).join("");
      }
    });
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

function renderResidentCard(r, cycle, isForcedOverdue = false) {
  const today = new Date(); today.setHours(0,0,0,0);
  const dueDt = cycle && cycle.due_date ? new Date(cycle.due_date) : null;
  if (dueDt) dueDt.setHours(0,0,0,0);
  const isOverdue = isForcedOverdue || (r.payment_status === "unpaid" && dueDt && dueDt < today);

  const penalty = isOverdue ? calculatePenaltyLocal(r.base_amount, cycle) : 0;
  const rebate  = !isOverdue && r.payment_status === "unpaid" ? calculateRebateLocal(r.base_amount, cycle) : 0;
  const netDue  = r.payment_status === "paid" ? r.base_amount : r.base_amount + penalty;

  const cardClass = r.payment_status === "paid" ? "record-card paid" : isOverdue ? "record-card overdue" : "record-card";
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
          ${r.paid_date ? `<span class="text-success">Paid: ${formatDate(r.paid_date)}</span>` : ''}
        </div>
      </div>
      <div class="record-card-amount">
        ${penalty > 0 || rebate > 0 ? `<div class="record-card-base">${formatCurrency(r.base_amount)}</div>` : ''}
        <div class="record-card-total">${formatCurrency(netDue)}</div>
        <div class="record-card-actions">
          <button class="btn btn-success btn-sm" onclick="handleMarkPaid(${r.id})">✓ Mark Paid</button>
          <a href="add_record.html?id=${r.id}" class="btn btn-secondary btn-sm">✏ Edit</a>
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
      loadDashboardData();
    } else {
      showToast("Failed to mark paid: " + ((res && res.error) || "Error"), "error");
    }
  });
}

function loadSchedulerStatus() {
  eel.get_scheduler_status_js()((status) => {
    const el = document.getElementById("scheduler-status");
    if (!el) return;
    if (!status || !status.running) {
      el.textContent = "Status: Idle / Stopped";
      return;
    }
    const nextRun = status.next_run ? formatDateTime(status.next_run) : "Daily at 09:00 IST";
    el.textContent = `Status: Active · Next scheduled run: ${nextRun}`;
  });
}

function triggerJob() {
  const btn = document.getElementById("btn-trigger-job");
  btn.disabled = true;
  btn.textContent = "Sending...";
  eel.trigger_daily_check()((res) => {
    btn.disabled = false;
    btn.textContent = "⚡ Trigger Reminders Now";
    if (res && res.status === "done") {
      const r = res.result || {};
      showToast(`Reminder run complete: ${r.sent || 0} sent, ${r.skipped || 0} skipped, ${r.failed || 0} failed.`);
      loadFailedSends();
      loadDashboardData();
    } else {
      showToast("Trigger failed: " + ((res && res.error) || "Error"), "error");
    }
  });
}

function loadFailedSends() {
  eel.get_failed_sends()((fails) => {
    const container = document.getElementById("failed-sends-container");
    if (!container) return;
    if (!fails || !fails.length) {
      container.style.display = "none";
      return;
    }
    container.style.display = "block";
    container.innerHTML = `
      <div class="card" style="background:#FEF2F2; border-color:#FECACA; padding: 14px 18px;">
        <div class="flex-center" style="justify-content:space-between;">
          <div class="fw-600 text-danger">⚠ ${fails.length} Failed Reminder Send(s)</div>
          <a href="reminders.html" class="btn btn-danger btn-sm">View Failed Sends</a>
        </div>
      </div>
    `;
  });
}
