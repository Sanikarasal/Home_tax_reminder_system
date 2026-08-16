/* ============================================================
   tax_records.js — Tax Records screen logic
   ============================================================ */

let activeCycle = null;

document.addEventListener("DOMContentLoaded", () => {
  renderSidebar("tax_records");
  loadCycle();
  loadWards();
  loadRecords();

  document.getElementById("search-input").addEventListener("input", debounce(loadRecords, 300));
  document.getElementById("status-filter").addEventListener("change", loadRecords);
  document.getElementById("ward-filter").addEventListener("change", loadRecords);
});

function loadCycle() {
  eel.get_active_cycle()((cycle) => {
    activeCycle = cycle;
    const el = document.getElementById("cycle-banner");
    if (!cycle) {
      el.textContent = "⚠️ No active tax cycle configured.";
      return;
    }
    let str = `📅 FY ${cycle.fy_label} · Tax due by ${formatDate(cycle.due_date)}`;
    if (cycle.rebate_enabled) {
      str += ` · Rebate ${cycle.rebate_percent}% till ${formatDate(cycle.rebate_deadline)}`;
    }
    el.textContent = str;
  });
}

function loadWards() {
  eel.get_all_wards()((wards) => {
    const sel = document.getElementById("ward-filter");
    sel.innerHTML = '<option value="all">All Wards</option>' +
      wards.map(w => `<option value="${w}">${w}</option>`).join("");
  });
}

function loadRecords() {
  const q = document.getElementById("search-input").value;
  const status = document.getElementById("status-filter").value;
  const ward = document.getElementById("ward-filter").value;

  eel.get_all_residents(q, status, ward, "name", "ASC")((residents) => {
    const container = document.getElementById("records-container");
    if (!residents.length) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">📋</div>
          <div class="empty-title">No records found</div>
          <div class="empty-sub">Try adjusting your search filters or add a new record.</div>
        </div>
      `;
      return;
    }
    container.innerHTML = residents.map(r => renderRecordItem(r)).join("");
  });
}

function renderRecordItem(r) {
  const isPaid = r.payment_status === "paid";
  const cardClass = isPaid ? "record-card paid" : "record-card";
  return `
    <div class="${cardClass}">
      <div class="record-card-info">
        <div class="flex-center gap-8">
          <span class="record-card-name">${r.name}</span>
          ${statusBadge(r.payment_status)}
          ${r.paid_date ? `<span class="fs-11 text-success">Paid on: ${formatDate(r.paid_date)}</span>` : ''}
        </div>
        <div class="record-card-meta">
          <span>📋 ${r.property_id}</span>
          ${r.ward ? `<span>🏘 ${r.ward}</span>` : ''}
          ${r.phone ? `<span>📞 ${r.phone}</span>` : ''}
          ${r.address ? `<span>📍 ${r.address}</span>` : ''}
        </div>
      </div>
      <div class="record-card-amount">
        <div class="record-card-total">${formatCurrency(r.base_amount)}</div>
        <div class="record-card-actions">
          ${isPaid
            ? `<button class="btn btn-secondary btn-sm" onclick="handleMarkUnpaid(${r.id})">Mark Unpaid</button>`
            : `<button class="btn btn-success btn-sm" onclick="handleMarkPaid(${r.id})">✓ Mark Paid</button>`
          }
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
    if (res.success) {
      showToast("Marked as paid.");
      loadRecords();
    } else {
      showToast("Error: " + res.error, "error");
    }
  });
}

function handleMarkUnpaid(id) {
  if (!confirm("Revert this tax record to Unpaid?")) return;
  eel.mark_unpaid(id)((res) => {
    if (res.success) {
      showToast("Reverted to unpaid.");
      loadRecords();
    } else {
      showToast("Error: " + res.error, "error");
    }
  });
}

function handleDelete(id) {
  if (!confirm("Are you sure you want to delete this resident record?")) return;
  eel.delete_resident(id)((res) => {
    if (res.success) {
      showToast("Record deleted.");
      loadRecords();
    } else {
      showToast("Failed to delete: " + res.error, "error");
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
