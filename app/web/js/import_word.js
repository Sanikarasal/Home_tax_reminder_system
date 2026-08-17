/* ============================================================
   import_word.js — Word (.docx) & text paste import screen logic
   Matches Figma prototype workflow with full .docx file support
   ============================================================ */

let parsedData = { new: [], duplicates: [], total_parsed: 0 };
let selectedFile = null;

const SAMPLE_TEXT = `Name: Ramesh Patil
Property ID: GP/2024/001
Ward: Ward 1
Phone: 9876543210
Amount: 2500
Address: Plot 12, Main Road

Name: Sunita Deshmukh
Property ID: GP/2024/002
Ward: Ward 2
Phone: 9123456789
Amount: 1800
Address: House 45, Shivaji Nagar

Name: Vijay Shinde
Property ID: GP/2024/003
Ward: Ward 1
Phone: 9988776655
Amount: 3200
Address: Gat No 7, Near Temple`;

document.addEventListener("DOMContentLoaded", () => {
  renderSidebar("import_word");

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

  // File Picker & Drop Zone
  const dropZone = document.getElementById("drop-zone");
  const fileInput = document.getElementById("docx-file-input");
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
    btnParseFile.addEventListener("click", parseDocxFile);
  }

  // Paste Mode Handlers
  const btnParseText = document.getElementById("btn-parse-text");
  if (btnParseText) btnParseText.addEventListener("click", parsePastedText);

  const btnLoadSample = document.getElementById("btn-load-sample");
  if (btnLoadSample) {
    btnLoadSample.addEventListener("click", () => {
      const textarea = document.getElementById("import-text");
      if (textarea) textarea.value = SAMPLE_TEXT;
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
});

function handleFileSelected(file) {
  if (!file.name.toLowerCase().endsWith(".docx")) {
    showToast("Please select a Microsoft Word (.docx) file.", "error");
    return;
  }
  selectedFile = file;
  document.getElementById("file-name-display").textContent = file.name;
  document.getElementById("file-size-display").textContent = `(${(file.size / 1024).toFixed(1)} KB)`;
  document.getElementById("selected-file-info").style.display = "flex";
  document.getElementById("btn-parse-file").disabled = false;
}

function parseDocxFile() {
  if (!selectedFile) {
    showToast("No file selected.", "error");
    return;
  }

  const btn = document.getElementById("btn-parse-file");
  btn.disabled = true;
  btn.textContent = "Parsing Word Document...";

  const reader = new FileReader();
  reader.onload = function(e) {
    const base64Data = e.target.result;
    eel.parse_import_docx(base64Data)((res) => {
      btn.disabled = false;
      btn.textContent = "⊕ Import & Parse Word File";

      if (!res || !res.success) {
        showToast("Word parse failed: " + ((res && res.error) || "Unknown error"), "error");
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
    btn.textContent = "⊕ Import & Parse Word File";
    showToast("Failed to read file.", "error");
  };
  reader.readAsDataURL(selectedFile);
}

function parsePastedText() {
  const text = document.getElementById("import-text")?.value.trim();
  if (!text) {
    showToast("Please paste some text first.", "error");
    return;
  }

  const btn = document.getElementById("btn-parse-text");
  btn.disabled = true;
  btn.textContent = "Parsing Text...";

  eel.parse_import_text(text)((res) => {
    btn.disabled = false;
    btn.textContent = "⊕ Parse Pasted Text";

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
    newList.innerHTML = parsedData.new.map((r, i) => `
      <div class="record-card paid">
        <div class="record-card-info">
          <div class="flex-center gap-8">
            <span class="record-card-name">${r.name}</span>
            <span class="badge badge-paid">New</span>
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
      showToast(`Successfully imported ${res.inserted || 0} new resident(s)!`);
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
