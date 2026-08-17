/* ============================================================
   settings.js — Tax Cycle & Cadence & Office Configuration
   Matches Figma prototype settings controls and interaction
   ============================================================ */

let activeCycleData = null;
let preReminders = [30, 15, 7, 3, 1];
let postReminders = [3, 7, 15, 30];

document.addEventListener("DOMContentLoaded", () => {
  renderSidebar("settings");

  // Rebate Pill Toggle
  const rebateBtn = document.getElementById("btn-rebate-toggle");
  const rebateFields = document.getElementById("rebate-fields");
  const rebateChk = document.getElementById("rebate_enabled");

  if (rebateBtn && rebateChk && rebateFields) {
    rebateBtn.addEventListener("click", () => {
      const isEnabled = !rebateChk.checked;
      rebateChk.checked = isEnabled;
      rebateBtn.textContent = isEnabled ? "ON" : "OFF";
      if (isEnabled) {
        rebateBtn.classList.add("active");
      } else {
        rebateBtn.classList.remove("active");
      }
      rebateFields.style.display = isEnabled ? "grid" : "none";
    });
  }

  // Penalty Type Switcher
  const btnFlat = document.getElementById("btn-pen-flat");
  const btnPct = document.getElementById("btn-pen-pct");
  const penaltyTypeInput = document.getElementById("penalty_type");
  const penaltyUnit = document.getElementById("penalty-unit-label");

  if (btnFlat && btnPct && penaltyTypeInput) {
    btnFlat.addEventListener("click", () => {
      btnFlat.classList.add("active");
      btnPct.classList.remove("active");
      penaltyTypeInput.value = "flat";
      if (penaltyUnit) penaltyUnit.textContent = "₹/month";
    });
    btnPct.addEventListener("click", () => {
      btnPct.classList.add("active");
      btnFlat.classList.remove("active");
      penaltyTypeInput.value = "percent";
      if (penaltyUnit) penaltyUnit.textContent = "%/month";
    });
  }

  // Cadence Add Handlers
  const btnAddPre = document.getElementById("btn-add-pre");
  if (btnAddPre) {
    btnAddPre.addEventListener("click", () => {
      const input = document.getElementById("input-add-pre");
      const val = parseInt(input?.value || "0");
      if (!isNaN(val) && val > 0 && !preReminders.includes(val)) {
        preReminders.push(val);
        preReminders.sort((a, b) => b - a);
        renderCadencePills();
        if (input) input.value = "";
      }
    });
  }

  const btnAddPost = document.getElementById("btn-add-post");
  if (btnAddPost) {
    btnAddPost.addEventListener("click", () => {
      const input = document.getElementById("input-add-post");
      const val = parseInt(input?.value || "0");
      if (!isNaN(val) && val > 0 && !postReminders.includes(val)) {
        postReminders.push(val);
        postReminders.sort((a, b) => a - b);
        renderCadencePills();
        if (input) input.value = "";
      }
    });
  }

  // Forms
  const cycleForm = document.getElementById("cycle-form");
  if (cycleForm) cycleForm.addEventListener("submit", handleSaveCycle);

  const officeForm = document.getElementById("office-form");
  if (officeForm) officeForm.addEventListener("submit", handleSaveOffice);

  // Initial Load
  loadActiveCycle();
  loadOfficeProfile();
  loadStats();
});

function loadActiveCycle() {
  eel.get_active_cycle()((cycle) => {
    if (!cycle) return;
    activeCycleData = cycle;

    const fyInput = document.getElementById("fy_label");
    const fromM = document.getElementById("collection_from_month");
    const toM = document.getElementById("collection_to_month");
    const dueDateInput = document.getElementById("due_date");
    const rebatePercentInput = document.getElementById("rebate_percent");
    const rebateDeadlineInput = document.getElementById("rebate_deadline");
    const penaltyValueInput = document.getElementById("penalty_value");
    const penaltyStartDaysInput = document.getElementById("penalty_start_days");

    if (fyInput) fyInput.value = cycle.fy_label || "2025-26";
    if (fromM) fromM.value = cycle.collection_from_month || 1;
    if (toM) toM.value = cycle.collection_to_month || 3;
    if (dueDateInput) dueDateInput.value = cycle.due_date || "";

    const rebateChk = document.getElementById("rebate_enabled");
    const rebateBtn = document.getElementById("btn-rebate-toggle");
    const rebateFields = document.getElementById("rebate-fields");

    const isRebate = Boolean(cycle.rebate_enabled);
    if (rebateChk) rebateChk.checked = isRebate;
    if (rebateBtn) {
      rebateBtn.textContent = isRebate ? "ON" : "OFF";
      if (isRebate) rebateBtn.classList.add("active");
      else rebateBtn.classList.remove("active");
    }
    if (rebateFields) rebateFields.style.display = isRebate ? "grid" : "none";
    if (rebatePercentInput) rebatePercentInput.value = cycle.rebate_percent || 0;
    if (rebateDeadlineInput) rebateDeadlineInput.value = cycle.rebate_deadline || "";

    const btnFlat = document.getElementById("btn-pen-flat");
    const btnPct = document.getElementById("btn-pen-pct");
    const penaltyTypeInput = document.getElementById("penalty_type");
    const penaltyUnit = document.getElementById("penalty-unit-label");

    const pType = cycle.penalty_type || "flat";
    if (penaltyTypeInput) penaltyTypeInput.value = pType;
    if (pType === "percent") {
      btnPct?.classList.add("active");
      btnFlat?.classList.remove("active");
      if (penaltyUnit) penaltyUnit.textContent = "%/month";
    } else {
      btnFlat?.classList.add("active");
      btnPct?.classList.remove("active");
      if (penaltyUnit) penaltyUnit.textContent = "₹/month";
    }

    if (penaltyValueInput) penaltyValueInput.value = cycle.penalty_value || 0;
    if (penaltyStartDaysInput) penaltyStartDaysInput.value = cycle.penalty_start_days || 1;

    // Load cadence
    eel.get_cadence(cycle.id)((cadence) => {
      if (cadence && Array.isArray(cadence) && cadence.length) {
        preReminders = cadence.filter(c => c.stage_type === "pre_due").map(c => c.days_offset).sort((a,b) => b-a);
        postReminders = cadence.filter(c => c.stage_type === "post_due").map(c => c.days_offset).sort((a,b) => a-b);
      }
      renderCadencePills();
    });
  });
}

function renderCadencePills() {
  const preCont = document.getElementById("pre-cadence-container");
  if (preCont) {
    preCont.innerHTML = preReminders.map((d, i) => `
      <div class="pill amber">
        <span>${d}d</span>
        <button type="button" class="pill-del" onclick="removePrePill(${i})">✕</button>
      </div>
    `).join("");
  }

  const postCont = document.getElementById("post-cadence-container");
  if (postCont) {
    postCont.innerHTML = postReminders.map((d, i) => `
      <div class="pill red">
        <span>${d}d</span>
        <button type="button" class="pill-del" onclick="removePostPill(${i})">✕</button>
      </div>
    `).join("");
  }
}

function removePrePill(idx) {
  preReminders.splice(idx, 1);
  renderCadencePills();
}

function removePostPill(idx) {
  postReminders.splice(idx, 1);
  renderCadencePills();
}

function handleSaveCycle(e) {
  e.preventDefault();

  const isRebate = document.getElementById("rebate_enabled")?.checked || false;
  const data = {
    fy_label: document.getElementById("fy_label")?.value.trim() || "2025-26",
    collection_from_month: parseInt(document.getElementById("collection_from_month")?.value || "1"),
    collection_to_month: parseInt(document.getElementById("collection_to_month")?.value || "3"),
    due_date: document.getElementById("due_date")?.value || "",
    rebate_enabled: isRebate ? 1 : 0,
    rebate_percent: isRebate ? parseFloat(document.getElementById("rebate_percent")?.value || "0") : 0,
    rebate_deadline: isRebate ? document.getElementById("rebate_deadline")?.value || "" : "",
    penalty_type: document.getElementById("penalty_type")?.value || "flat",
    penalty_value: parseFloat(document.getElementById("penalty_value")?.value || "0"),
    penalty_start_days: parseInt(document.getElementById("penalty_start_days")?.value || "1"),
    pre_reminders: preReminders,
    post_reminders: postReminders,
  };

  if (!data.due_date) {
    showToast("Please specify Due Date.", "error");
    return;
  }

  if (isRebate && data.rebate_deadline && data.rebate_deadline >= data.due_date) {
    showToast("Rebate deadline must be before Due Date.", "error");
    return;
  }

  const btn = document.getElementById("btn-save-cycle");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Saving...";
  }

  eel.save_cycle(data)((res) => {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "✓ Save Tax Cycle";
    }

    if (res && res.success) {
      showToast("Tax cycle configuration saved successfully!");
      loadActiveCycle();
      loadStats();
    } else {
      showToast("Save failed: " + ((res && res.error) || "Error"), "error");
    }
  });
}

function loadOfficeProfile() {
  eel.get_all_app_settings()((settings) => {
    if (!settings) return;
    const nameInput = document.getElementById("gp-name");
    const talukaInput = document.getElementById("gp-taluka");
    const distInput = document.getElementById("gp-district");

    if (nameInput) nameInput.value = settings.gram_panchayat_name || "Gram Panchayat Office";
    if (talukaInput) talukaInput.value = settings.gp_taluka || "";
    if (distInput) distInput.value = settings.gp_district || "";
  });
}

function handleSaveOffice(e) {
  e.preventDefault();
  const settings = {
    gram_panchayat_name: document.getElementById("gp-name")?.value.trim() || "Gram Panchayat Office",
    gp_taluka: document.getElementById("gp-taluka")?.value.trim() || "",
    gp_district: document.getElementById("gp-district")?.value.trim() || "",
  };

  eel.set_all_app_settings(settings)((res) => {
    if (res && res.success) {
      showToast("Office profile updated!");
      renderSidebar("settings");
    } else {
      showToast("Save failed: " + ((res && res.error) || "Error"), "error");
    }
  });
}

function loadStats() {
  eel.get_resident_stats()((stats) => {
    if (!stats) return;
    const totalEl = document.getElementById("stat-row-total");
    const overdueEl = document.getElementById("stat-row-overdue");
    const penaltyEl = document.getElementById("stat-row-penalty");
    const pendingEl = document.getElementById("stat-row-pending");
    const collectedEl = document.getElementById("stat-row-collected");

    if (totalEl) totalEl.textContent = stats.total || 0;
    if (overdueEl) overdueEl.textContent = stats.unpaid || 0;
    if (penaltyEl) penaltyEl.textContent = formatCurrency(stats.total_penalty || 0);
    if (pendingEl) pendingEl.textContent = formatCurrency(stats.total_due || 0);
    if (collectedEl) collectedEl.textContent = formatCurrency(stats.paid_sum || 0);
  });
}
