/* ============================================================
   dashboard.js — Dashboard screen logic
   ============================================================ */

document.addEventListener("DOMContentLoaded", () => {
  renderSidebar("dashboard");
  document.getElementById("header-date").textContent = new Date().toLocaleDateString("en-IN", {
    weekday: "short", day: "2-digit", month: "short", year: "numeric"
  });

  loadCycle();
  loadStats();
  loadUnpaidList();
  loadSchedulerStatus();
  loadFailedSends();

  document.getElementById("btn-trigger-job").addEventListener("click", triggerJob);
});

function loadCycle() {
  eel.get_active_cycle()((cycle) => {
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

function loadStats() {
  eel.get_resident_stats()((stats) => {
    document.getElementById("stat-total").textContent        = stats.total;
    document.getElementById("stat-unpaid").textContent       = stats.unpaid;
    document.getElementById("stat-paid").textContent         = stats.paid;
    document.getElementById("stat-pending-sum").textContent   = formatCurrency(stats.total_due);
    document.getElementById("stat-pending-base").textContent  = formatCurrency(stats.pending_base);
    document.getElementById("stat-penalty").textContent       = formatCurrency(stats.total_penalty);
    document.getElementById("stat-collected").textContent     = formatCurrency(stats.paid_sum);
  });
}

function loadUnpaidList() {
  eel.get_all_residents("", "unpaid", "all", "name", "ASC")((residents) => {
    const container = document.getElementById("unpaid-list");
    document.getElementById("unpaid-count-badge").textContent = residents.length;

    if (!residents.length) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">✓</div>
          <div class="empty-title">All clear!</div>
          <div class="empty-sub">No unpaid residents found.</div>
        </div>
      `;
      return;
    }

    eel.get_active_cycle()((cycle) => {
      container.innerHTML = residents.map(r => renderResidentCard(r, cycle)).join("");
    });
  });
}

function renderResidentCard(r, cycle) {
  const isOverdue = r.payment_status === "overdue" || (cycle && new Date() > new Date(cycle.due_date));
  const cardClass = isOverdue ? "record-card overdue" : "record-card";
  return `
    <div class="${cardClass}">
      <div class="record-card-info">
        <div class="flex-center gap-8">
          <span class="record-card-name">${r.name}</span>
          ${statusBadge(r.payment_status)}
        </div>
        <div class="record-card-meta">
          <span>📋 ${r.property_id}</span>
          ${r.ward ? `<span>🏘 ${r.ward}</span>` : ''}
          ${r.phone ? `<span>📞 ${r.phone}</span>` : ''}
        </div>
      </div>
      <div class="record-card-amount">
        <div class="record-card-total">${formatCurrency(r.base_amount)}</div>
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
    if (res.success) {
      showToast("Marked as paid.");
      loadStats();
      loadUnpaidList();
    } else {
      showToast("Failed to mark paid: " + res.error, "error");
    }
  });
}

function loadSchedulerStatus() {
  eel.get_scheduler_status_js()((status) => {
    const el = document.getElementById("scheduler-status");
    if (!status.running) {
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
    if (res.status === "done") {
      const r = res.result;
      showToast(`Reminder run complete: ${r.sent} sent, ${r.skipped} skipped, ${r.failed} failed.`);
      loadFailedSends();
    } else {
      showToast("Trigger failed: " + res.error, "error");
    }
  });
}

function loadFailedSends() {
  eel.get_failed_sends()((fails) => {
    const container = document.getElementById("failed-sends-container");
    if (!fails || !fails.length) {
      container.style.display = "none";
      return;
    }
    container.style.display = "block";
    container.innerHTML = `
      <div class="card" style="background:#FEF2F2; border-color:#FECACA;">
        <div class="flex-center" style="justify-content:space-between;">
          <div class="fw-600 text-danger">⚠ ${fails.length} Failed Reminder Send(s)</div>
          <a href="reminders.html" class="btn btn-danger btn-sm">View Failed Sends</a>
        </div>
      </div>
    `;
  });
}
