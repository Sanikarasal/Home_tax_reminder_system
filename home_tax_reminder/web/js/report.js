/* ============================================================
   report.js — Tax Report calculation & export logic
   ============================================================ */

let currentPeriod = "yearly";

document.addEventListener("DOMContentLoaded", () => {
  renderSidebar("report");

  const today = new Date().toISOString().split("T")[0];
  document.getElementById("input-date").value = today;
  document.getElementById("input-month").value = today.substring(0, 7);
  document.getElementById("sel-year").value = today.substring(0, 4);

  document.getElementById("btn-p-yearly").addEventListener("click", () => setPeriod("yearly"));
  document.getElementById("btn-p-monthly").addEventListener("click", () => setPeriod("monthly"));
  document.getElementById("btn-p-daily").addEventListener("click", () => setPeriod("daily"));
  document.getElementById("btn-p-all").addEventListener("click", () => setPeriod("all"));

  document.getElementById("sel-year").addEventListener("change", loadReportData);
  document.getElementById("input-month").addEventListener("change", loadReportData);
  document.getElementById("input-date").addEventListener("change", loadReportData);
  document.getElementById("sel-status").addEventListener("change", loadReportData);

  loadReportData();
});

function setPeriod(p) {
  currentPeriod = p;
  const periods = ["yearly", "monthly", "daily", "all"];
  periods.forEach(item => {
    const btn = document.getElementById(`btn-p-${item}`);
    btn.className = (item === p) ? "tab-btn active" : "tab-btn";
  });

  const selYear = document.getElementById("sel-year");
  const inMonth = document.getElementById("input-month");
  const inDate  = document.getElementById("input-date");

  selYear.style.display = p === "yearly" ? "inline-block" : "none";
  inMonth.style.display = p === "monthly" ? "inline-block" : "none";
  inDate.style.display  = p === "daily" ? "inline-block" : "none";

  loadReportData();
}

function getPeriodValue() {
  if (currentPeriod === "yearly") return document.getElementById("sel-year").value;
  if (currentPeriod === "monthly") return document.getElementById("input-month").value;
  if (currentPeriod === "daily") return document.getElementById("input-date").value;
  return "";
}

function loadReportData() {
  const pVal = getPeriodValue();
  const statusFilter = document.getElementById("sel-status").value;

  eel.get_report_data(currentPeriod, pVal, statusFilter)((res) => {
    if (!res.success) {
      showToast("Error loading report: " + res.error, "error");
      return;
    }

    // Update KPI values
    document.getElementById("rep-paid-sum").textContent = formatCurrency(res.paid_sum);
    document.getElementById("rep-paid-count").textContent = res.paid_count;
    document.getElementById("rep-unpaid-sum").textContent = formatCurrency(res.unpaid_sum);
    document.getElementById("rep-unpaid-count").textContent = res.unpaid_count;
    document.getElementById("rep-penalty-sum").textContent = formatCurrency(res.penalty_sum);
    document.getElementById("rep-total-due").textContent = formatCurrency(res.total_outstanding);

    const recs = res.records || [];
    document.getElementById("table-count").textContent = `${recs.length} record(s)`;

    const tbody = document.getElementById("report-tbody");
    if (!recs.length) {
      tbody.innerHTML = `<tr><td colspan="9" class="text-muted" style="text-align:center; padding: 24px;">No records match the selected period and status criteria.</td></tr>`;
      return;
    }

    tbody.innerHTML = recs.map(r => {
      const isPaid = r.payment_status === "paid";
      return `
        <tr>
          <td class="fw-600">${r.property_id}</td>
          <td>${r.name}</td>
          <td class="text-muted">${r.ward || '—'}</td>
          <td>${statusBadge(r.payment_status)}</td>
          <td class="fs-11 text-muted">${r.paid_date ? formatDate(r.paid_date) : '—'}</td>
          <td class="right">${formatCurrency(r.base_amount)}</td>
          <td class="right ${r.rebate > 0 ? 'text-success' : 'text-muted'}">${r.rebate > 0 ? '−' + formatCurrency(r.rebate) : '₹0'}</td>
          <td class="right ${r.penalty > 0 ? 'text-danger' : 'text-muted'}">${r.penalty > 0 ? '+' + formatCurrency(r.penalty) : '₹0'}</td>
          <td class="right fw-700 ${isPaid ? 'text-success' : 'text-danger'}">${formatCurrency(r.net_due)}</td>
        </tr>
      `;
    }).join("");
  });
}
