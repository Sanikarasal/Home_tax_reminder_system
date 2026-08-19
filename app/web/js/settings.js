/* ============================================================
   settings.js — Tax Cycle & Cadence & Office Configuration
   Desktop-fitted settings controls, cadence pills, and office settings
   ============================================================ */

let activeCycleData = null;
let preReminders = [30, 15, 7, 3, 1];
let postReminders = [3, 7, 15, 30];

document.addEventListener("DOMContentLoaded", () => {
  renderSidebar("settings");

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

    if (fyInput) fyInput.value = cycle.fy_label || "2025-26";
    if (fromM) fromM.value = cycle.collection_from_month || 1;
    if (toM) toM.value = cycle.collection_to_month || 3;
    if (dueDateInput) dueDateInput.value = cycle.due_date || "";

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
        <span>${d}d before</span>
        <button type="button" class="pill-del" onclick="removePrePill(${i})" title="Remove">✕</button>
      </div>
    `).join("");
  }

  const postCont = document.getElementById("post-cadence-container");
  if (postCont) {
    postCont.innerHTML = postReminders.map((d, i) => `
      <div class="pill red">
        <span>${d}d after</span>
        <button type="button" class="pill-del" onclick="removePostPill(${i})" title="Remove">✕</button>
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

  const data = {
    fy_label: document.getElementById("fy_label")?.value.trim() || "2025-26",
    collection_from_month: parseInt(document.getElementById("collection_from_month")?.value || "1"),
    collection_to_month: parseInt(document.getElementById("collection_to_month")?.value || "3"),
    due_date: document.getElementById("due_date")?.value || "",
    rebate_enabled: 0,
    rebate_percent: 0,
    rebate_deadline: "",
    penalty_type: "flat",
    penalty_value: 0,
    penalty_start_days: 1,
    pre_reminders: preReminders,
    post_reminders: postReminders,
  };

  if (!data.due_date) {
    showToast("Please specify Due Date.", "error");
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
      btn.textContent = "✓ Save Tax Cycle & Cadence";
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
    const pendingEl = document.getElementById("stat-row-pending");
    const collectedEl = document.getElementById("stat-row-collected");

    if (totalEl) totalEl.textContent = stats.total || 0;
    if (overdueEl) overdueEl.textContent = stats.unpaid || 0;
    if (pendingEl) pendingEl.textContent = formatCurrency(stats.pending_base !== undefined ? stats.pending_base : stats.total_due);
    if (collectedEl) collectedEl.textContent = formatCurrency(stats.paid_sum || 0);
  });
}

