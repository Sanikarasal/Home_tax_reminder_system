/* ============================================================
   add_record.js — Unified Add Tax Record & Excel Import Screen Logic
   Supports:
     1. Manual Single Tax Record (Add / Edit)
     2. Import from Excel (.xlsx, .xls, .csv) & Pasted Data with review/merge
     3. Downloadable Excel Import Sample Template (.xlsx)
   ============================================================ */

let editId = null;
let isPaidState = false;
let parsedData = { new: [], duplicates: [], total_parsed: 0 };
let selectedFile = null;

const SAMPLE_CSV = `Taxpayer Name, Property ID, Ward, Phone, Address, Base Tax Amount, Payment Status
Ramesh Patil, GP/2026/001, Ward 1, 9876543210, Plot 12 Main Road, 2500, unpaid
Sunita Deshmukh, GP/2026/002, Ward 2, 9123456789, House 45 Shivaji Nagar, 1800, unpaid
Vijay Shinde, GP/2026/003, Ward 1, 9988776655, Gat No 7 Near Temple, 3200, paid
सुनील शिंदे, GP/2026/004, Ward 3, 9822114433, घर क्र १२ ग्रामपंचायत जवळ, 2100, unpaid`;

document.addEventListener("DOMContentLoaded", () => {
  renderSidebar("add_record");

  const urlParams = new URLSearchParams(window.location.search);
  editId = urlParams.get("id");
  const initialMode = urlParams.get("mode");

  // Setup Manual Entry Form
  setupManualForm();

  // Setup Import Logic
  setupImportFeatures();

  // Setup Top Mode Switcher (Manual vs Import)
  setupTopModeSwitcher();

  if (editId) {
    // Edit mode
    const titleEl = document.getElementById("page-title");
    if (titleEl) titleEl.textContent = "Edit Tax Record";
    const saveBtn = document.getElementById("btn-save");
    if (saveBtn) saveBtn.textContent = "✓ Save Changes";
    const tabs = document.getElementById("add-mode-tabs");
    if (tabs) tabs.style.display = "none";
    switchAddMode("manual");
    loadResident(editId);
  } else {
    // New Record mode
    if (initialMode === "import") {
      switchAddMode("import");
    } else {
      switchAddMode("manual");
    }
  }
});

// ── Top-level Mode Switcher (Manual Form vs Import) ───────────

function setupTopModeSwitcher() {
  const tabs = document.querySelectorAll("#add-mode-tabs .tab-btn");
  tabs.forEach(btn => {
    btn.addEventListener("click", () => {
      const mode = btn.getAttribute("data-add-mode") || "manual";
      switchAddMode(mode);
    });
  });
}

function switchAddMode(mode) {
  const tabs = document.querySelectorAll("#add-mode-tabs .tab-btn");
  tabs.forEach(btn => {
    if (btn.getAttribute("data-add-mode") === mode) {
      btn.classList.add("active");
    } else {
      btn.classList.remove("active");
    }
  });

  const manualSec = document.getElementById("section-manual-entry");
  const importSec = document.getElementById("section-import");

  if (mode === "import") {
    if (manualSec) manualSec.style.display = "none";
    if (importSec) importSec.style.display = "block";
  } else {
    if (manualSec) manualSec.style.display = "block";
    if (importSec) importSec.style.display = "none";
  }
}

// ── Manual Single Record Features ─────────────────────────────

function setupManualForm() {
  const btnUnpaid = document.getElementById("btn-unpaid");
  const btnPaid = document.getElementById("btn-paid");
  const form = document.getElementById("record-form");

  if (btnUnpaid) btnUnpaid.addEventListener("click", () => setPaid(false));
  if (btnPaid) btnPaid.addEventListener("click", () => setPaid(true));
  if (form) form.addEventListener("submit", handleSubmit);
}

function setPaid(paid) {
  isPaidState = paid;
  const btnUnpaid = document.getElementById("btn-unpaid");
  const btnPaid   = document.getElementById("btn-paid");
  const dateGroup = document.getElementById("paid-date-group");

  if (paid) {
    if (btnPaid) btnPaid.className   = "btn btn-success btn-sm flex-1";
    if (btnUnpaid) btnUnpaid.className = "btn btn-secondary btn-sm flex-1";
    if (dateGroup) dateGroup.style.display = "block";
    const dateInput = document.getElementById("paid_date");
    if (dateInput && !dateInput.value) {
      dateInput.value = new Date().toISOString().split("T")[0];
    }
  } else {
    if (btnUnpaid) btnUnpaid.className = "btn btn-primary btn-sm flex-1";
    if (btnPaid) btnPaid.className   = "btn btn-secondary btn-sm flex-1";
    if (dateGroup) dateGroup.style.display = "none";
  }
}

function loadResident(id) {
  eel.get_resident(Number(id))((r) => {
    if (!r) {
      showToast("Resident record not found", "error");
      return;
    }
    document.getElementById("name").value        = r.name || "";
    document.getElementById("property_id").value = r.property_id || "";
    document.getElementById("ward").value        = r.ward || "";
    document.getElementById("phone").value       = r.phone || "";
    document.getElementById("address").value     = r.address || "";
    document.getElementById("base_amount").value = r.base_amount || "";

    if (r.payment_status === "paid") {
      setPaid(true);
      document.getElementById("paid_date").value = r.paid_date || "";
    } else {
      setPaid(false);
    }

    // Load payment history for this resident
    loadPaymentHistory(Number(id));
  });
}

function loadPaymentHistory(residentId) {
  eel.get_resident_payment_history(residentId)((history) => {
    const section = document.getElementById("payment-history-section");
    const list    = document.getElementById("payment-history-list");
    const count   = document.getElementById("payment-history-count");
    if (!section || !list) return;

    const rows = Array.isArray(history) ? history : [];
    if (!rows.length) {
      section.style.display = "none";
      return;
    }

    section.style.display = "block";
    count.textContent = rows.length;

    list.innerHTML = rows.map(row => {
      const isPaid    = row.status === "paid";
      const isOverdue = row.status === "overdue";
      const cardClass = isPaid ? "record-card paid" : isOverdue ? "record-card overdue" : "record-card";

      const carryNote = row.carry_forward_from_cycle_id
        ? `<div style="font-size:11px; color:#B45309; margin-top:4px;">⚠ Carry-forward from FY ${row.carry_forward_fy_label || row.carry_forward_from_cycle_id}</div>`
        : "";

      const paidLine = isPaid && row.paid_date
        ? `<span class="text-success" style="font-size:12px;">✓ Paid: ${formatDate(row.paid_date)}</span>` : "";

      const penaltyLine = row.penalty_amount > 0
        ? `<span style="font-size:12px; color:#DC2626;">Penalty: ${formatCurrency(row.penalty_amount)}</span>` : "";

      return `
        <div class="${cardClass}" style="margin-bottom:10px;">
          <div class="record-card-info">
            <div class="flex-center gap-8">
              <span class="record-card-name">FY ${row.fy_label}</span>
              ${statusBadge(row.status)}
            </div>
            <div class="record-card-meta">
              ${paidLine}
              ${penaltyLine}
              ${row.due_date ? `<span>Due: ${formatDate(row.due_date)}</span>` : ""}
            </div>
            ${carryNote}
          </div>
          <div class="record-card-amount">
            <div class="record-card-total">${formatCurrency(row.base_amount)}</div>
          </div>
        </div>
      `;
    }).join("");
  });
}



function handleSubmit(e) {
  e.preventDefault();

  const data = {
    name:        document.getElementById("name").value.trim(),
    property_id: document.getElementById("property_id").value.trim(),
    ward:        document.getElementById("ward").value.trim(),
    phone:       document.getElementById("phone").value.trim(),
    address:     document.getElementById("address").value.trim(),
    base_amount: parseFloat(document.getElementById("base_amount").value) || 0,
    payment_status: isPaidState ? "paid" : "unpaid",
    paid:        isPaidState,
    paid_date:   isPaidState ? document.getElementById("paid_date").value : null,
  };

  if (!data.name || !data.property_id || !data.phone || data.base_amount <= 0) {
    showToast("Please fill all required fields correctly.", "error");
    return;
  }

  if (editId) {
    eel.update_resident(Number(editId), data)((res) => {
      if (res.success) {
        showToast("Record updated successfully.");
        setTimeout(() => {
          window.location.href = "tax_records.html";
        }, 800);
      } else {
        showToast("Update failed: " + (res.error || "Error"), "error");
      }
    });
  } else {
    eel.create_resident(data)((res) => {
      if (res.success) {
        showToast("Tax record created successfully.");
        setTimeout(() => {
          window.location.href = "tax_records.html";
        }, 800);
      } else {
        showToast("Create failed: " + (res.error || "Error"), "error");
      }
    });
  }
}

// ── Import from Excel / CSV Features ──────────────────────────

function setupImportFeatures() {
  // Mode Switcher (File vs Paste)
  const modeTabs = document.querySelectorAll("#import-mode-tabs .tab-btn");
  modeTabs.forEach(btn => {
    btn.addEventListener("click", () => {
      modeTabs.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      const mode = btn.getAttribute("data-mode");
      document.getElementById("mode-content-file").style.display = (mode === "file") ? "block" : "none";
      document.getElementById("mode-content-paste").style.display = (mode === "paste") ? "block" : "none";
    });
  });

  // Download Sample Excel Template
  const btnDownloadTpl = document.getElementById("btn-download-template");
  if (btnDownloadTpl) {
    btnDownloadTpl.addEventListener("click", handleDownloadTemplate);
  }

  // File Picker & Drop Zone
  const dropZone = document.getElementById("drop-zone");
  const fileInput = document.getElementById("excel-file-input");
  const btnParseFile = document.getElementById("btn-parse-file");
  const btnRemoveFile = document.getElementById("btn-remove-file");

  if (dropZone && fileInput) {
    dropZone.addEventListener("click", () => fileInput.click());
    dropZone.addEventListener("dragover", (e) => {
      e.preventDefault();
      dropZone.style.borderColor = "var(--saffron)";
      dropZone.style.background = "#FEF3C7";
    });
    dropZone.addEventListener("dragleave", () => {
      dropZone.style.borderColor = "var(--border)";
      dropZone.style.background = "#FFFBF5";
    });
    dropZone.addEventListener("drop", (e) => {
      e.preventDefault();
      dropZone.style.borderColor = "var(--border)";
      dropZone.style.background = "#FFFBF5";
      if (e.dataTransfer.files && e.dataTransfer.files.length) {
        handleFileSelected(e.dataTransfer.files[0]);
      }
    });

    fileInput.addEventListener("change", (e) => {
      if (e.target.files && e.target.files.length) {
        handleFileSelected(e.target.files[0]);
      }
    });
  }

  if (btnRemoveFile) {
    btnRemoveFile.addEventListener("click", () => {
      selectedFile = null;
      if (fileInput) fileInput.value = "";
      document.getElementById("selected-file-info").style.display = "none";
      if (btnParseFile) btnParseFile.disabled = true;
    });
  }

  if (btnParseFile) {
    btnParseFile.addEventListener("click", parseExcelFile);
  }

  // Paste Mode Handlers
  const btnParseText = document.getElementById("btn-parse-text");
  if (btnParseText) btnParseText.addEventListener("click", parsePastedText);

  const btnLoadSample = document.getElementById("btn-load-sample");
  if (btnLoadSample) {
    btnLoadSample.addEventListener("click", () => {
      const textarea = document.getElementById("import-text");
      if (textarea) textarea.value = SAMPLE_CSV;
    });
  }

  const btnClear = document.getElementById("btn-clear");
  if (btnClear) {
    btnClear.addEventListener("click", () => {
      const textarea = document.getElementById("import-text");
      if (textarea) textarea.value = "";
    });
  }

  // Review Sub-Tabs
  const tabNew = document.getElementById("tab-btn-new");
  const tabDup = document.getElementById("tab-btn-dup");
  if (tabNew && tabDup) {
    tabNew.addEventListener("click", () => {
      tabNew.classList.add("active");
      tabDup.classList.remove("active");
      document.getElementById("tab-content-new").style.display = "block";
      document.getElementById("tab-content-dup").style.display = "none";
    });
    tabDup.addEventListener("click", () => {
      tabDup.classList.add("active");
      tabNew.classList.remove("active");
      document.getElementById("tab-content-dup").style.display = "block";
      document.getElementById("tab-content-new").style.display = "none";
    });
  }

  // Confirm Import Button
  const btnConfirm = document.getElementById("btn-confirm-import");
  if (btnConfirm) btnConfirm.addEventListener("click", handleConfirmImport);
}

function handleDownloadTemplate() {
  eel.get_excel_import_template()((res) => {
    if (!res || !res.success || !res.data) {
      showToast("Failed to generate Excel template.", "error");
      return;
    }
    const a = document.createElement("a");
    a.href = res.data;
    a.download = res.filename || "Taxpayer_Import_Template.xlsx";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    showToast("Downloaded sample Excel template.");
  });
}

function handleFileSelected(file) {
  const name = file.name.toLowerCase();
  if (!name.endsWith(".xlsx") && !name.endsWith(".xls") && !name.endsWith(".csv")) {
    showToast("Please select an Excel (.xlsx, .xls) or CSV (.csv) file.", "error");
    return;
  }
  selectedFile = file;
  document.getElementById("file-name-display").textContent = file.name;
  document.getElementById("file-size-display").textContent = `(${(file.size / 1024).toFixed(1)} KB)`;
  document.getElementById("selected-file-info").style.display = "flex";
  document.getElementById("btn-parse-file").disabled = false;
}

function parseExcelFile() {
  if (!selectedFile) {
    showToast("No file selected.", "error");
    return;
  }

  const btn = document.getElementById("btn-parse-file");
  btn.disabled = true;
  btn.textContent = "Parsing Excel File...";

  const reader = new FileReader();
  reader.onload = function(e) {
    const base64Data = e.target.result;
    eel.parse_import_excel(base64Data)((res) => {
      btn.disabled = false;
      btn.textContent = "📊 Import & Parse Excel File";

      if (!res || !res.success) {
        showToast("Excel parse failed: " + ((res && res.error) || "Unknown error"), "error");
        return;
      }

      parsedData = {
        total_parsed: res.total_parsed || 0,
        new: Array.isArray(res.new) ? res.new : [],
        duplicates: Array.isArray(res.duplicates) ? res.duplicates : []
      };
      renderReview();
      showToast(`Parsed ${parsedData.total_parsed} records from ${selectedFile.name}`);
    });
  };
  reader.onerror = function() {
    btn.disabled = false;
    btn.textContent = "📊 Import & Parse Excel File";
    showToast("Failed to read file.", "error");
  };
  reader.readAsDataURL(selectedFile);
}

function parsePastedText() {
  const text = document.getElementById("import-text")?.value.trim();
  if (!text) {
    showToast("Please paste some data first.", "error");
    return;
  }

  const btn = document.getElementById("btn-parse-text");
  btn.disabled = true;
  btn.textContent = "Parsing Data...";

  eel.parse_import_text(text)((res) => {
    btn.disabled = false;
    btn.textContent = "⊕ Parse Pasted Data";

    if (!res || !res.success) {
      showToast("Parse failed: " + ((res && res.error) || "Unknown error"), "error");
      return;
    }

    parsedData = {
      total_parsed: res.total_parsed || 0,
      new: Array.isArray(res.new) ? res.new : [],
      duplicates: Array.isArray(res.duplicates) ? res.duplicates : []
    };
    renderReview();
  });
}

function renderReview() {
  document.getElementById("review-section").style.display = "block";
  const newCount = (parsedData.new && parsedData.new.length) || 0;
  const dupCount = (parsedData.duplicates && parsedData.duplicates.length) || 0;

  document.getElementById("stat-total-parsed").textContent = parsedData.total_parsed || 0;
  document.getElementById("stat-new-count").textContent = newCount;
  document.getElementById("stat-dup-count").textContent = dupCount;

  document.getElementById("tab-new-badge").textContent = newCount;
  document.getElementById("tab-dup-badge").textContent = dupCount;

  // Render New Records List
  const newList = document.getElementById("new-records-list");
  if (!newCount) {
    newList.innerHTML = `<div class="empty-state"><div class="empty-title">No new unique records</div></div>`;
  } else {
    newList.innerHTML = parsedData.new.map((r) => `
      <div class="record-card paid">
        <div class="record-card-info">
          <div class="flex-center gap-8">
            <span class="record-card-name">${r.name}</span>
            <span class="badge badge-paid">New</span>
            ${r.payment_status === 'paid' ? '<span class="badge badge-paid">Paid</span>' : ''}
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
        </div>
      </div>
    `).join("");
  }

  // Render Duplicate Records List
  const dupList = document.getElementById("dup-records-list");
  if (!dupCount) {
    dupList.innerHTML = `<div class="empty-state"><div class="empty-title">No duplicate records found</div></div>`;
  } else {
    dupList.innerHTML = parsedData.duplicates.map((r, i) => `
      <div class="record-card" style="border-left-color: var(--warn);">
        <div class="record-card-info">
          <div class="flex-center gap-8">
            <span class="record-card-name">${r.name}</span>
            <span class="badge badge-unpaid">Duplicate Property ID</span>
          </div>
          <div class="record-card-meta">
            <span>📋 <strong>${r.property_id}</strong></span>
            ${r.ward ? `<span>🏘 ${r.ward}</span>` : ''}
            ${r.phone ? `<span>📞 ${r.phone}</span>` : ''}
            ${r.address ? `<span>📍 ${r.address}</span>` : ''}
          </div>
        </div>
        <div class="record-card-amount">
          <div class="record-card-total">${formatCurrency(r.base_amount)}</div>
          <div class="record-card-actions">
            <button type="button" class="btn btn-secondary btn-sm" onclick="handleMergeDuplicate(${i})">Overwrite / Merge</button>
          </div>
        </div>
      </div>
    `).join("");
  }

  // Scroll smoothly down to review section
  document.getElementById("review-section").scrollIntoView({ behavior: "smooth" });
}

function handleConfirmImport() {
  if (!parsedData.new || !parsedData.new.length) {
    showToast("No new records to import.", "error");
    return;
  }

  const btn = document.getElementById("btn-confirm-import");
  btn.disabled = true;
  btn.textContent = "Importing...";

  eel.confirm_import(parsedData.new)((res) => {
    btn.disabled = false;
    btn.textContent = "✓ Confirm Import All New Records";

    if (res && res.success) {
      showToast(`Successfully imported ${res.inserted || 0} resident(s)!`);
      parsedData.new = [];
      renderReview();
      setTimeout(() => {
        window.location.href = "tax_records.html";
      }, 1200);
    } else {
      showToast("Import failed: " + ((res && res.error) || "Error"), "error");
    }
  });
}

function handleMergeDuplicate(idx) {
  const rec = parsedData.duplicates[idx];
  if (!rec) return;

  if (!confirm(`Overwrite/merge existing resident with Property ID "${rec.property_id}"?`)) return;

  eel.get_resident_by_property_id(rec.property_id)((existing) => {
    if (!existing || !existing.id) {
      showToast("Could not find matching resident in database.", "error");
      return;
    }

    eel.merge_resident_import(existing.id, rec)((res) => {
      if (res && (res.success || res.merged)) {
        showToast(`Merged Property ID ${rec.property_id} successfully.`);
        parsedData.duplicates.splice(idx, 1);
        renderReview();
      } else {
        showToast("Merge failed: " + ((res && res.error) || "Unknown error"), "error");
      }
    });
  });
}
