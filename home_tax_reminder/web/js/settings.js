/* ============================================================
   settings.js — Tax Cycle & Cadence & Templates Configuration
   ============================================================ */

let activeCycleData = null;
let preReminders = [30, 15, 7, 3, 1];
let postReminders = [3, 7, 15, 30];
let templatesData = {};
let currentTemplateType = "upcoming";

document.addEventListener("DOMContentLoaded", () => {
  renderSidebar("settings");

  // Top Section Switcher
  document.getElementById("tab-btn-cycle").addEventListener("click", () => switchSection("cycle"));
  document.getElementById("tab-btn-templates").addEventListener("click", () => switchSection("templates"));
  document.getElementById("tab-btn-office").addEventListener("click", () => switchSection("office"));

  // Rebate checkbox toggle
  document.getElementById("rebate_enabled").addEventListener("change", (e) => {
    document.getElementById("rebate-fields").style.display = e.target.checked ? "grid" : "none";
  });

  // Cadence offset add buttons
  document.getElementById("btn-add-pre").addEventListener("click", () => {
    const val = parseInt(document.getElementById("input-add-pre").value);
    if (!isNaN(val) && val > 0 && !preReminders.includes(val)) {
      preReminders.push(val);
      preReminders.sort((a, b) => b - a);
      renderCadencePills();
      document.getElementById("input-add-pre").value = "";
    }
  });

  document.getElementById("btn-add-post").addEventListener("click", () => {
    const val = parseInt(document.getElementById("input-add-post").value);
    if (!isNaN(val) && val > 0 && !postReminders.includes(val)) {
      postReminders.push(val);
      postReminders.sort((a, b) => a - b);
      renderCadencePills();
      document.getElementById("input-add-post").value = "";
    }
  });

  // Cycle form save
  document.getElementById("cycle-form").addEventListener("submit", handleSaveCycle);

  // Template Stage Tabs
  const tmplTabs = ["upcoming", "rebate", "overdue", "penalty"];
  tmplTabs.forEach(type => {
    document.getElementById(`tmpl-tab-${type}`).addEventListener("click", () => selectTemplateType(type));
  });

  document.getElementById("btn-save-template").addEventListener("click", handleSaveTemplate);
  document.getElementById("btn-reset-templates").addEventListener("click", handleResetTemplates);

  // Office form save
  document.getElementById("office-form").addEventListener("submit", handleSaveOffice);

  // Initial Data Load
  loadActiveCycle();
  loadTemplates();
  loadOfficeProfile();
});

function switchSection(sec) {
  const sections = ["cycle", "templates", "office"];
  sections.forEach(s => {
    document.getElementById(`tab-btn-${s}`).className = (s === sec) ? "tab-btn active" : "tab-btn";
    document.getElementById(`tab-content-${s}`).style.display = (s === sec) ? "block" : "none";
  });
}

function loadActiveCycle() {
  eel.get_active_cycle()((cycle) => {
    if (!cycle) return;
    activeCycleData = cycle;
    document.getElementById("fy_label").value = cycle.fy_label || "";
    document.getElementById("collection_from_month").value = cycle.collection_from_month || 1;
    document.getElementById("collection_to_month").value = cycle.collection_to_month || 3;
    document.getElementById("due_date").value = cycle.due_date || "";

    const rebateChk = document.getElementById("rebate_enabled");
    rebateChk.checked = Boolean(cycle.rebate_enabled);
    document.getElementById("rebate-fields").style.display = rebateChk.checked ? "grid" : "none";
    document.getElementById("rebate_percent").value = cycle.rebate_percent || 0;
    document.getElementById("rebate_deadline").value = cycle.rebate_deadline || "";

    document.getElementById("penalty_type").value = cycle.penalty_type || "flat";
    document.getElementById("penalty_value").value = cycle.penalty_value || 0;
    document.getElementById("penalty_start_days").value = cycle.penalty_start_days || 1;

    // Load cadence
    eel.get_cadence(cycle.id)((cadence) => {
      if (cadence && cadence.length) {
        preReminders = cadence.filter(c => c.stage_type === "pre_due").map(c => c.days_offset).sort((a,b) => b-a);
        postReminders = cadence.filter(c => c.stage_type === "post_due").map(c => c.days_offset).sort((a,b) => a-b);
      }
      renderCadencePills();
    });
  });
}

function renderCadencePills() {
  const preCont = document.getElementById("pre-cadence-container");
  preCont.innerHTML = preReminders.map((d, i) => `
    <div class="pill amber">
      <span>${d} days before</span>
      <button type="button" class="pill-del" onclick="removePrePill(${i})">✕</button>
    </div>
  `).join("");

  const postCont = document.getElementById("post-cadence-container");
  postCont.innerHTML = postReminders.map((d, i) => `
    <div class="pill red">
      <span>${d} days after</span>
      <button type="button" class="pill-del" onclick="removePostPill(${i})">✕</button>
    </div>
  `).join("");
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

  const isRebate = document.getElementById("rebate_enabled").checked;
  const data = {
    fy_label: document.getElementById("fy_label").value.trim(),
    collection_from_month: parseInt(document.getElementById("collection_from_month").value),
    collection_to_month: parseInt(document.getElementById("collection_to_month").value),
    due_date: document.getElementById("due_date").value,
    rebate_enabled: isRebate ? 1 : 0,
    rebate_percent: isRebate ? parseFloat(document.getElementById("rebate_percent").value || 0) : 0,
    rebate_deadline: isRebate ? document.getElementById("rebate_deadline").value : "",
    penalty_type: document.getElementById("penalty_type").value,
    penalty_value: parseFloat(document.getElementById("penalty_value").value || 0),
    penalty_start_days: parseInt(document.getElementById("penalty_start_days").value || 1),
    pre_reminders: preReminders,
    post_reminders: postReminders,
  };

  if (!data.fy_label || !data.due_date) {
    showToast("Please specify FY label and Due Date.", "error");
    return;
  }

  const btn = document.getElementById("btn-save-cycle");
  btn.disabled = true;
  btn.textContent = "Saving...";

  eel.save_cycle(data)((res) => {
    btn.disabled = false;
    btn.textContent = "💾 Save Tax Cycle Configuration";

    if (res.success) {
      showToast("Tax cycle configuration saved successfully!");
      loadActiveCycle();
    } else {
      showToast("Save failed: " + res.error, "error");
    }
  });
}

function loadTemplates() {
  eel.get_all_templates()((tmpls) => {
    templatesData = tmpls || {};
    populateTemplateEditors();
  });
}

function selectTemplateType(type) {
  currentTemplateType = type;
  const tmplTabs = ["upcoming", "rebate", "overdue", "penalty"];
  tmplTabs.forEach(t => {
    document.getElementById(`tmpl-tab-${t}`).className = (t === type) ? "tab-btn active" : "tab-btn";
  });
  populateTemplateEditors();
}

function populateTemplateEditors() {
  const mr = (templatesData[currentTemplateType] && templatesData[currentTemplateType].mr) || "";
  const en = (templatesData[currentTemplateType] && templatesData[currentTemplateType].en) || "";
  document.getElementById("tmpl-body-mr").value = mr;
  document.getElementById("tmpl-body-en").value = en;
}

function handleSaveTemplate() {
  const mr = document.getElementById("tmpl-body-mr").value;
  const en = document.getElementById("tmpl-body-en").value;

  eel.update_template(currentTemplateType, "mr", mr)(() => {
    eel.update_template(currentTemplateType, "en", en)(() => {
      showToast("Templates saved successfully!");
      loadTemplates();
    });
  });
}

function handleResetTemplates() {
  if (!confirm("Reset all message templates to system defaults?")) return;
  eel.reset_templates()((res) => {
    if (res.success) {
      showToast("Templates reset to defaults.");
      loadTemplates();
    } else {
      showToast("Reset failed: " + res.error, "error");
    }
  });
}

function loadOfficeProfile() {
  eel.get_all_app_settings()((settings) => {
    if (!settings) return;
    document.getElementById("gp-name").value = settings.gram_panchayat_name || "";
    document.getElementById("gp-taluka").value = settings.gp_taluka || "";
    document.getElementById("gp-district").value = settings.gp_district || "";
  });
}

function handleSaveOffice(e) {
  e.preventDefault();
  const settings = {
    gram_panchayat_name: document.getElementById("gp-name").value.trim(),
    gp_taluka: document.getElementById("gp-taluka").value.trim(),
    gp_district: document.getElementById("gp-district").value.trim(),
  };

  eel.set_all_app_settings(settings)((res) => {
    if (res.success) {
      showToast("Office profile updated!");
      renderSidebar("settings");
    } else {
      showToast("Save failed: " + res.error, "error");
    }
  });
}
