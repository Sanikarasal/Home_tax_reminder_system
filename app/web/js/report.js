/* ============================================================
   report.js — Tax Report calculation & export logic
   Matches Figma prototype report layout and metrics
   ============================================================ */

let currentPeriod = "yearly";
let currentStatusFilter = "all";

document.addEventListener("DOMContentLoaded", () => {
  renderSidebar("report");

  const today = new Date().toISOString().split("T")[0];
  const inputDate = document.getElementById("input-date");
  const inputMonth = document.getElementById("input-month");
  const selYear = document.getElementById("sel-year");

  if (inputDate) inputDate.value = today;
  if (inputMonth) inputMonth.value = today.substring(0, 7);
  if (selYear) selYear.value = today.substring(0, 4);

  // Period Tabs Click Handling
  const pTabs = document.querySelectorAll("#period-tabs .tab-btn");
  pTabs.forEach(btn => {
    btn.addEventListener("click", () => {
      pTabs.forEach(b => {
        b.classList.remove("active");
        b.style.background = "transparent";
      });
      btn.classList.add("active");
      btn.style.background = "#fff";
      setPeriod(btn.getAttribute("data-period") || "yearly");
    });
  });

  // Status Filter Group Click Handling
  const sBtns = document.querySelectorAll("#status-filter-group .tab-btn");
  sBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      sBtns.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      currentStatusFilter = btn.getAttribute("data-status") || "all";
      loadReportData();
    });
  });

  if (selYear) selYear.addEventListener("change", loadReportData);
  if (inputMonth) inputMonth.addEventListener("change", loadReportData);
  if (inputDate) inputDate.addEventListener("change", loadReportData);

  const btnExport = document.getElementById("btn-export-excel");
  if (btnExport) btnExport.addEventListener("click", handleExportExcel);

  loadReportData();
});

function handleExportExcel() {
  const pVal = getPeriodValue();
  const btn = document.getElementById("btn-export-excel");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "⏳ Generating Excel...";
  }

  eel.generate_report_excel(currentPeriod, pVal, currentStatusFilter)((res) => {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "📥 Export to Excel (.xlsx)";
    }

    if (!res || !res.success || !res.data) {
      showToast("Excel export failed: " + ((res && res.error) || "Error"), "error");
      return;
    }

    const a = document.createElement("a");
    a.href = res.data;
    a.download = res.filename || "Tax_Report.xlsx";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    showToast(`Excel file ${res.filename} generated successfully!`);
  });
}

function setPeriod(p) {
  currentPeriod = p;
  const selYear = document.getElementById("sel-year");
  const inMonth = document.getElementById("input-month");
  const inDate  = document.getElementById("input-date");

  if (selYear) selYear.style.display = (p === "yearly") ? "inline-block" : "none";
  if (inMonth) inMonth.style.display = (p === "monthly") ? "inline-block" : "none";
  if (inDate)  inDate.style.display  = (p === "daily") ? "inline-block" : "none";

  loadReportData();
}

function getPeriodValue() {
  if (currentPeriod === "yearly") return document.getElementById("sel-year")?.value || "";
  if (currentPeriod === "monthly") return document.getElementById("input-month")?.value || "";
  if (currentPeriod === "daily") return document.getElementById("input-date")?.value || "";
  return "";
}

function loadReportData() {
  const pVal = getPeriodValue();

  eel.get_report_data(currentPeriod, pVal, currentStatusFilter)((res) => {
    if (!res || !res.success) {
      showToast("Error loading report: " + ((res && res.error) || "Failed"), "error");
      return;
    }

    // Update KPI values
    const paidSumEl = document.getElementById("rep-paid-sum");
    const paidCountEl = document.getElementById("rep-paid-count");
    const unpaidSumEl = document.getElementById("rep-unpaid-sum");
    const unpaidCountEl = document.getElementById("rep-unpaid-count");
    const totalDueEl = document.getElementById("rep-total-due");

    if (paidSumEl) paidSumEl.textContent = formatCurrency(res.paid_sum);
    if (paidCountEl) paidCountEl.textContent = res.paid_count || 0;
    if (unpaidSumEl) unpaidSumEl.textContent = formatCurrency(res.unpaid_sum);
    if (unpaidCountEl) unpaidCountEl.textContent = res.unpaid_count || 0;
    if (totalDueEl) totalDueEl.textContent = formatCurrency((res.paid_sum || 0) + (res.unpaid_sum || 0));

    const recs = Array.isArray(res.records) ? res.records : [];
    const tableCount = document.getElementById("table-count");
    if (tableCount) tableCount.textContent = `Showing ${recs.length} record(s)`;

    const headingEl = document.getElementById("table-heading");
    if (headingEl) {
      headingEl.textContent = `Taxpayers Statement — ${
        currentPeriod === "yearly" ? "Year " + pVal :
        currentPeriod === "monthly" ? "Month " + pVal :
        currentPeriod === "daily" ? "Date " + pVal : "All Records"
      }`;
    }

    const tbody = document.getElementById("report-tbody");
    if (!tbody) return;

    if (!recs.length) {
      tbody.innerHTML = `<tr><td colspan="6" class="text-muted" style="text-align:center; padding: 48px;"><div style="font-size:32px;">📊</div><div style="margin-top:8px;">No records match the selected criteria.</div></td></tr>`;
      return;
    }

    tbody.innerHTML = recs.map((r) => {
      const isPaid = r.payment_status === "paid";
      const dateVal = isPaid ? (r.paid_date || "") : (r.due_date || "");
      const dateFormatted = dateVal ? formatDate(dateVal) : "—";
      const dateLabel = isPaid ? "Paid Date" : "Due Date";

      return `
        <tr>
          <td class="fw-600">${r.property_id}</td>
          <td class="fw-500">${r.name}</td>
          <td class="text-muted">${r.ward || '—'}</td>
          <td>${statusBadge(r.payment_status)}</td>
          <td>
            <div class="fw-600 fs-12 ${isPaid ? 'text-success' : 'text-primary'}">${dateFormatted}</div>
            <div class="fs-10 text-light">${dateLabel}</div>
          </td>
          <td class="right fw-700 ${isPaid ? 'text-success' : 'text-danger'}">${formatCurrency(r.base_amount)}</td>
        </tr>
      `;
    }).join("");
  });
}
