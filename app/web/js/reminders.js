/* ============================================================
   reminders.js — Reminders automation & history screen logic
   Matches Figma prototype template preview and dispatch flow
   ============================================================ */

let activeCycle = null;
let currentTemplateType = "upcoming";
let allTemplates = {};
let unpaidTaxpayers = [];

document.addEventListener("DOMContentLoaded", () => {
  renderSidebar("reminders");
  loadCycle();
  loadTemplates();
  loadDueList();
  loadFailedSends();

  const triggerBtn = document.getElementById("btn-trigger-daily");
  if (triggerBtn) triggerBtn.addEventListener("click", handleTriggerDaily);

  // Template Type Tabs
  const tmplTabs = document.querySelectorAll("#template-type-tabs .tab-btn");
  tmplTabs.forEach(btn => {
    btn.addEventListener("click", () => {
      tmplTabs.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      currentTemplateType = btn.getAttribute("data-type") || "upcoming";
      const label = document.getElementById("editing-template-label");
      if (label) label.textContent = currentTemplateType.toUpperCase();
      populateEditor();
      updatePreview();
    });
  });

  // Toggle Template Editor
  const toggleBtn = document.getElementById("btn-toggle-editor");
  const drawer = document.getElementById("template-editor-drawer");
  if (toggleBtn && drawer) {
    toggleBtn.addEventListener("click", () => {
      const isHidden = drawer.style.display === "none";
      drawer.style.display = isHidden ? "block" : "none";
      toggleBtn.textContent = isHidden ? "Hide Template Editor" : "⚙ Edit Reminder Templates";
      if (isHidden) populateEditor();
    });
  }

  // Save Template
  const saveBtn = document.getElementById("btn-save-template");
  if (saveBtn) {
    saveBtn.addEventListener("click", handleSaveTemplate);
  }

  // Reset Templates
  const resetBtn = document.getElementById("btn-reset-templates");
  if (resetBtn) {
    resetBtn.addEventListener("click", handleResetTemplates);
  }

  // View Sub-Tabs
  const viewTabs = document.querySelectorAll("#reminders-view-tabs .tab-btn");
  viewTabs.forEach(btn => {
    btn.addEventListener("click", () => {
      viewTabs.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      const v = btn.getAttribute("data-view") || "due";
      document.getElementById("view-content-due").style.display = (v === "due") ? "block" : "none";
      document.getElementById("view-content-failed").style.display = (v === "failed") ? "block" : "none";
      document.getElementById("view-content-history").style.display = (v === "history") ? "block" : "none";
      if (v === "history") loadHistory();
      if (v === "failed") loadFailedSends();
    });
  });
});

function loadCycle() {
  eel.get_active_cycle()((cycle) => {
    activeCycle = cycle;
    const el = document.getElementById("cycle-banner");
    if (!el) return;
    if (!cycle) {
      el.textContent = "⚠️ No active tax cycle configured. Reminders require an active cycle.";
      return;
    }
    el.textContent = `📅 Cadence active from due date: ${formatDate(cycle.due_date)}`;
  });
}

function loadTemplates() {
  eel.get_all_templates()((tmpls) => {
    allTemplates = tmpls || {};
    populateEditor();
    updatePreview();
  });
}

function populateEditor() {
  const mr = (allTemplates[currentTemplateType] && allTemplates[currentTemplateType].mr) || "";
  const mrInput = document.getElementById("editor-body-mr");
  if (mrInput) mrInput.value = mr;
}

function updatePreview() {
  const sampleTaxpayer = unpaidTaxpayers[0] || { id: 1 };
  eel.preview_message(sampleTaxpayer.id || 1, currentTemplateType, "mr")((mr) => {
    const el = document.getElementById("preview-body-mr");
    if (el) el.textContent = mr || "—";
  });
}

function handleSaveTemplate() {
  const mr = document.getElementById("editor-body-mr")?.value || "";

  eel.update_template(currentTemplateType, "mr", mr)(() => {
    showToast("Marathi template updated successfully!");
    loadTemplates();
  });
}

function handleResetTemplates() {
  if (!confirm("Reset all message templates to system defaults?")) return;
  eel.reset_templates()((res) => {
    if (res && res.success) {
      showToast("Templates reset to defaults.");
      loadTemplates();
    } else {
      showToast("Reset failed: " + ((res && res.error) || "Error"), "error");
    }
  });
}

function loadDueList() {
  eel.get_all_residents("", "unpaid", "all", "name", "ASC")((residents) => {
    unpaidTaxpayers = Array.isArray(residents) ? residents : [];
    const countEl = document.getElementById("count-due");
    if (countEl) countEl.textContent = unpaidTaxpayers.length;

    const container = document.getElementById("due-list");
    if (!container) return;

    if (!unpaidTaxpayers.length) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">✓</div>
          <div class="empty-title">No pending reminders</div>
          <div class="empty-sub">All taxpayers are up-to-date with property tax payments.</div>
        </div>
      `;
      return;
    }

    eel.get_active_cycle()((cycle) => {
      activeCycle = cycle;
      updatePreview();
      container.innerHTML = unpaidTaxpayers.map(r => renderDueCard(r, cycle)).join("");
    });
  });
}

function renderDueCard(r, cycle) {
  const today = new Date(); today.setHours(0,0,0,0);
  const dueDt = cycle && cycle.due_date ? new Date(cycle.due_date) : null;
  if (dueDt) dueDt.setHours(0,0,0,0);
  const isOverdue = dueDt && dueDt < today;
  const stage = isOverdue ? "post_due" : "pre_due";

  return `
    <div class="record-card ${isOverdue ? 'overdue' : ''}">
      <div class="record-card-info">
        <div class="flex-center gap-8" style="flex-wrap: wrap;">
          <span class="record-card-name">${r.name}</span>
          ${statusBadge(isOverdue ? "overdue" : "unpaid")}
        </div>
        <div class="record-card-meta">
          <span>📋 ${r.property_id}</span>
          ${r.ward ? `<span>🏘 ${r.ward}</span>` : ''}
          ${r.phone ? `<span>📞 ${r.phone}</span>` : ''}
          <span>Due Date: <strong>${formatDate(cycle ? cycle.due_date : '')}</strong></span>
        </div>
      </div>
      <div class="record-card-amount">
        <div class="record-card-total">${formatCurrency(r.base_amount)}</div>
        <div class="record-card-actions">
          <button class="btn btn-primary btn-sm" onclick="handleSendNow(${r.id}, '${stage}', false)">📨 Send Reminder</button>
          <button class="btn btn-secondary btn-sm" onclick="handleSendNow(${r.id}, '${stage}', true)" title="Bypass duplicate send check">Force Send</button>
          <button class="btn btn-success btn-sm" onclick="handleMarkPaid(${r.id})">✓ Paid</button>
        </div>
      </div>
    </div>
  `;
}

function handleSendNow(residentId, stageType, force) {
  const actionLabel = force ? "Force Send reminder" : "Send reminder";
  if (!confirm(`${actionLabel} to this taxpayer now?`)) return;

  eel.send_reminder_now(residentId, stageType, force)((res) => {
    if (res && res.status === "sent") {
      showToast("Reminder sent successfully!");
      loadDueList();
      loadFailedSends();
    } else if (res && res.status === "skipped") {
      showToast(`Reminder skipped: ${res.reason || 'already sent for this stage'}`, "info");
    } else {
      showToast(`Send failed: ${(res && (res.error || res.reason)) || 'Error'}`, "error");
      loadFailedSends();
    }
  });
}

function handleMarkPaid(id) {
  if (!confirm("Mark this record as Paid?")) return;
  eel.mark_paid(id)((res) => {
    if (res && res.success) {
      showToast("Marked as paid.");
      loadDueList();
    } else {
      showToast("Error: " + ((res && res.error) || "Failed"), "error");
    }
  });
}

function handleTriggerDaily() {
  const btn = document.getElementById("btn-trigger-daily");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Running Daily Check...";
  }

  eel.trigger_daily_check()((res) => {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "⚡ Trigger Daily Check Now";
    }
    if (res && res.status === "done") {
      const r = res.result || {};
      showToast(`Daily check complete: ${r.sent || 0} sent, ${r.skipped || 0} skipped, ${r.failed || 0} failed.`);
      loadDueList();
      loadFailedSends();
    } else {
      showToast("Trigger failed: " + ((res && res.error) || "Error"), "error");
    }
  });
}

function loadFailedSends() {
  eel.get_failed_sends()((failed) => {
    const fails = Array.isArray(failed) ? failed : [];
    const countEl = document.getElementById("count-failed");
    if (countEl) countEl.textContent = fails.length;

    const container = document.getElementById("failed-list");
    if (!container) return;

    if (!fails.length) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">✓</div>
          <div class="empty-title">No failed deliveries</div>
          <div class="empty-sub">All reminder messages sent smoothly without errors.</div>
        </div>
      `;
      return;
    }

    container.innerHTML = fails.map(f => `
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
    if (res && res.status === "sent") {
      showToast("Message resent successfully!");
      loadFailedSends();
    } else {
      showToast(`Retry failed: ${(res && (res.error || res.reason)) || 'Error'}`, "error");
      loadFailedSends();
    }
  });
}

function loadHistory() {
  eel.get_reminder_log(0)((logs) => {
    const list = Array.isArray(logs) ? logs : [];
    const tbody = document.getElementById("history-tbody");
    if (!tbody) return;

    if (!list.length) {
      tbody.innerHTML = `<tr><td colspan="7" class="text-muted" style="text-align:center; padding: 32px;"><div style="font-size:32px;">🔔</div><div style="margin-top:8px;">No reminder logs recorded yet.</div></td></tr>`;
      return;
    }

    tbody.innerHTML = list.map(l => `
      <tr>
        <td>${formatDateTime(l.sent_at)}</td>
        <td class="fw-600">${l.name || '—'}</td>
        <td>${l.property_id || '—'}</td>
        <td><span class="badge ${l.stage_type === 'post_due' ? 'badge-overdue' : 'badge-unpaid'}">${l.stage_type}</span></td>
        <td>${(l.channel || 'SMS').toUpperCase()}</td>
        <td><span class="badge ${l.status === 'sent' ? 'badge-paid' : 'badge-overdue'}">${l.status}</span></td>
        <td class="fs-11 ${l.status === 'failed' ? 'text-danger' : 'text-muted'}">${l.error_message || '—'}</td>
      </tr>
    `).join("");
  });
}
