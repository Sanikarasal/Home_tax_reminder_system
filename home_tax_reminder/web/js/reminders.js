/* ============================================================
   reminders.js — Reminders automation & history screen logic
   ============================================================ */

let activeCycle = null;
let allUnpaidResidents = [];

document.addEventListener("DOMContentLoaded", () => {
  renderSidebar("reminders");
  loadCycle();
  loadDueList();
  loadFailedSends();

  document.getElementById("btn-trigger-daily").addEventListener("click", handleTriggerDaily);

  // Tab switching
  document.getElementById("tab-btn-due").addEventListener("click", () => switchTab("due"));
  document.getElementById("tab-btn-failed").addEventListener("click", () => switchTab("failed"));
  document.getElementById("tab-btn-history").addEventListener("click", () => switchTab("history"));
  document.getElementById("tab-btn-preview").addEventListener("click", () => switchTab("preview"));

  document.getElementById("preview-resident-select").addEventListener("change", updateLivePreview);
  document.getElementById("preview-template-type").addEventListener("change", updateLivePreview);
  document.getElementById("btn-refresh-preview").addEventListener("click", updateLivePreview);
});

function switchTab(tab) {
  const tabs = ["due", "failed", "history", "preview"];
  tabs.forEach(t => {
    const btn = document.getElementById(`tab-btn-${t}`);
    const content = document.getElementById(`tab-content-${t}`);
    if (t === tab) {
      btn.className = "tab-btn active";
      content.style.display = "block";
    } else {
      btn.className = "tab-btn";
      content.style.display = "none";
    }
  });

  if (tab === "history") loadHistory();
  if (tab === "failed") loadFailedSends();
  if (tab === "preview") initPreviewDropdown();
}

function loadCycle() {
  eel.get_active_cycle()((cycle) => {
    activeCycle = cycle;
    const el = document.getElementById("cycle-banner");
    if (!cycle) {
      el.textContent = "⚠️ No active tax cycle configured. Reminders require an active cycle.";
      return;
    }
    let str = `📅 FY ${cycle.fy_label} · Tax Due: ${formatDate(cycle.due_date)}`;
    if (cycle.rebate_enabled) {
      str += ` · Early Rebate: ${cycle.rebate_percent}% till ${formatDate(cycle.rebate_deadline)}`;
    }
    if (cycle.penalty_value > 0) {
      str += ` · Penalty: ${cycle.penalty_type === 'percent' ? cycle.penalty_value + '%' : '₹' + cycle.penalty_value} / month`;
    }
    el.textContent = str;
  });
}

function loadDueList() {
  eel.get_all_residents("", "unpaid", "all", "name", "ASC")((residents) => {
    allUnpaidResidents = residents;
    document.getElementById("count-due").textContent = residents.length;
    const container = document.getElementById("due-list");

    if (!residents.length) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">✓</div>
          <div class="empty-title">No unpaid taxpayers due for reminders</div>
        </div>
      `;
      return;
    }

    eel.get_active_cycle()((cycle) => {
      container.innerHTML = residents.map(r => renderDueCard(r, cycle)).join("");
    });
  });
}

function renderDueCard(r, cycle) {
  const isOverdue = cycle && new Date() > new Date(cycle.due_date);
  const stage = isOverdue ? "post_due" : "pre_due";
  const stageBadge = isOverdue
    ? '<span class="badge badge-overdue">Overdue / Penalty Stage</span>'
    : '<span class="badge badge-unpaid">Pre-Due Stage</span>';

  return `
    <div class="record-card ${isOverdue ? 'overdue' : ''}">
      <div class="record-card-info">
        <div class="flex-center gap-8">
          <span class="record-card-name">${r.name}</span>
          ${stageBadge}
        </div>
        <div class="record-card-meta">
          <span>📋 ${r.property_id}</span>
          ${r.ward ? `<span>🏘 ${r.ward}</span>` : ''}
          <span>📞 ${r.phone}</span>
        </div>
      </div>
      <div class="record-card-amount">
        <div class="record-card-total">${formatCurrency(r.base_amount)}</div>
        <div class="record-card-actions">
          <button class="btn btn-primary btn-sm" onclick="handleSendNow(${r.id}, '${stage}', false)">✉ Send Reminder</button>
          <button class="btn btn-secondary btn-sm" onclick="handleSendNow(${r.id}, '${stage}', true)" title="Bypass duplicate send check">Force Send</button>
        </div>
      </div>
    </div>
  `;
}

function handleSendNow(residentId, stageType, force) {
  const actionLabel = force ? "Force Send reminder" : "Send reminder";
  if (!confirm(`${actionLabel} to this taxpayer now?`)) return;

  eel.send_reminder_now(residentId, stageType, force)((res) => {
    if (res.status === "sent") {
      showToast("Reminder sent successfully!");
      loadDueList();
      loadFailedSends();
    } else if (res.status === "skipped") {
      showToast(`Reminder skipped: ${res.reason || 'already sent for this stage'}`, "info");
    } else {
      showToast(`Send failed: ${res.error || res.reason || 'unknown error'}`, "error");
      loadFailedSends();
    }
  });
}

function handleTriggerDaily() {
  const btn = document.getElementById("btn-trigger-daily");
  btn.disabled = true;
  btn.textContent = "Running Daily Check...";

  eel.trigger_daily_check()((res) => {
    btn.disabled = false;
    btn.textContent = "⚡ Trigger Daily Check Now";
    if (res.status === "done") {
      const r = res.result;
      showToast(`Daily check complete: ${r.sent} sent, ${r.skipped} skipped, ${r.failed} failed.`);
      loadDueList();
      loadFailedSends();
    } else {
      showToast("Trigger failed: " + res.error, "error");
    }
  });
}

function loadFailedSends() {
  eel.get_failed_sends()((failed) => {
    document.getElementById("count-failed").textContent = failed ? failed.length : 0;
    const container = document.getElementById("failed-list");

    if (!failed || !failed.length) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">✓</div>
          <div class="empty-title">No failed deliveries</div>
          <div class="empty-sub">All reminder messages sent smoothly without errors.</div>
        </div>
      `;
      return;
    }

    container.innerHTML = failed.map(f => `
      <div class="record-card overdue">
        <div class="record-card-info">
          <div class="flex-center gap-8">
            <span class="record-card-name">${f.name || 'Unknown'}</span>
            <span class="badge badge-overdue">Failed</span>
            <span class="fs-11 text-muted">${formatDateTime(f.sent_at)}</span>
          </div>
          <div class="record-card-meta">
            <span>📋 ${f.property_id || '—'}</span>
            <span>📞 ${f.phone || '—'}</span>
            <span class="text-danger fw-600">Error: ${f.error_message || 'Delivery failed'}</span>
          </div>
        </div>
        <div class="record-card-actions">
          <button class="btn btn-danger btn-sm" onclick="handleRetry(${f.id})">🔄 Retry Send</button>
        </div>
      </div>
    `).join("");
  });
}

function handleRetry(logId) {
  eel.retry_failed_send(logId)((res) => {
    if (res.status === "sent") {
      showToast("Message resent successfully!");
      loadFailedSends();
    } else {
      showToast(`Retry failed: ${res.error || res.reason || 'error'}`, "error");
      loadFailedSends();
    }
  });
}

function loadHistory() {
  eel.get_reminder_log(0)((logs) => {
    const tbody = document.getElementById("history-tbody");
    if (!logs || !logs.length) {
      tbody.innerHTML = `<tr><td colspan="7" class="text-muted" style="text-align:center; padding: 24px;">No reminder logs recorded yet.</td></tr>`;
      return;
    }

    tbody.innerHTML = logs.map(l => `
      <tr>
        <td>${formatDateTime(l.sent_at)}</td>
        <td class="fw-600">${l.name || '—'}</td>
        <td>${l.property_id || '—'}</td>
        <td><span class="badge ${l.stage_type === 'post_due' ? 'badge-overdue' : 'badge-unpaid'}">${l.stage_type}</span></td>
        <td>${l.channel.toUpperCase()}</td>
        <td><span class="badge ${l.status === 'sent' ? 'badge-paid' : 'badge-overdue'}">${l.status}</span></td>
        <td class="fs-11 ${l.status === 'failed' ? 'text-danger' : 'text-muted'}">${l.error_message || '—'}</td>
      </tr>
    `).join("");
  });
}

function initPreviewDropdown() {
  const sel = document.getElementById("preview-resident-select");
  if (sel.options.length === 0 && allUnpaidResidents.length > 0) {
    sel.innerHTML = allUnpaidResidents.map(r => `<option value="${r.id}">${r.name} (${r.property_id})</option>`).join("");
    updateLivePreview();
  }
}

function updateLivePreview() {
  const residentId = document.getElementById("preview-resident-select").value;
  const templateType = document.getElementById("preview-template-type").value;
  if (!residentId) return;

  eel.preview_message(Number(residentId), templateType, "mr")((mr) => {
    document.getElementById("preview-body-mr").textContent = mr || "—";
  });

  eel.preview_message(Number(residentId), templateType, "en")((en) => {
    document.getElementById("preview-body-en").textContent = en || "—";
  });
}
