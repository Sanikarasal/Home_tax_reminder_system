/* ============================================================
   import_word.js — Word import parser & review workflow
   ============================================================ */

let parsedData = { new: [], duplicates: [] };

document.addEventListener("DOMContentLoaded", () => {
  renderSidebar("import_word");

  document.getElementById("btn-load-sample").addEventListener("click", loadSample);
  document.getElementById("btn-clear").addEventListener("click", clearAll);
  document.getElementById("btn-parse").addEventListener("click", handleParse);
  document.getElementById("btn-confirm-import").addEventListener("click", handleConfirmImport);

  document.getElementById("tab-btn-new").addEventListener("click", () => switchTab("new"));
  document.getElementById("tab-btn-dup").addEventListener("click", () => switchTab("dup"));
});

function loadSample() {
  document.getElementById("import-text").value = `Name: Ramesh Patil
Property ID: GP/2026/101
Ward: Ward 1
Phone: 9876543210
Amount: 2500
Address: Plot 12, Main Road

Name: Sunita Deshmukh
Property ID: GP/2026/102
Ward: Ward 2
Mobile: 9123456789
Address: House 45, Shivaji Nagar
Tax Amount: ₹1,800

नाव - मीना जाधव
Property ID - GP/2026/103
Ward - Ward 3
Phone - 9765432100
रक्कम - ₹3,200.00`;
}

function clearAll() {
  document.getElementById("import-text").value = "";
  document.getElementById("review-section").style.display = "none";
  parsedData = { new: [], duplicates: [] };
}

function switchTab(tab) {
  const tabBtnNew = document.getElementById("tab-btn-new");
  const tabBtnDup = document.getElementById("tab-btn-dup");
  const contentNew = document.getElementById("tab-content-new");
  const contentDup = document.getElementById("tab-content-dup");

  if (tab === "new") {
    tabBtnNew.className = "tab-btn active";
    tabBtnDup.className = "tab-btn";
    contentNew.style.display = "block";
    contentDup.style.display = "none";
  } else {
    tabBtnDup.className = "tab-btn active";
    tabBtnNew.className = "tab-btn";
    contentDup.style.display = "block";
    contentNew.style.display = "none";
  }
}

function handleParse() {
  const text = document.getElementById("import-text").value.trim();
  if (!text) {
    showToast("Please paste text before parsing.", "error");
    return;
  }

  const btn = document.getElementById("btn-parse");
  btn.disabled = true;
  btn.textContent = "Parsing...";

  eel.parse_import_text(text)((res) => {
    btn.disabled = false;
    btn.textContent = "🔍 Parse & Review";

    if (!res.success) {
      showToast("Parse failed: " + res.error, "error");
      return;
    }

    parsedData = res;
    renderReview();
  });
}

function renderReview() {
  document.getElementById("review-section").style.display = "block";
  document.getElementById("stat-total-parsed").textContent = parsedData.total_parsed || 0;
  document.getElementById("stat-new-count").textContent = parsedData.new.length;
  document.getElementById("stat-dup-count").textContent = parsedData.duplicates.length;

  document.getElementById("tab-new-badge").textContent = parsedData.new.length;
  document.getElementById("tab-dup-badge").textContent = parsedData.duplicates.length;

  // Render New Records List
  const newList = document.getElementById("new-records-list");
  if (!parsedData.new.length) {
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
  if (!parsedData.duplicates.length) {
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
          <div class="record-card-actions mt-8">
            <button class="btn btn-warn btn-sm" onclick="handleMerge(${i})">Overwrite / Merge</button>
          </div>
        </div>
      </div>
    `).join("");
  }

  switchTab(parsedData.new.length > 0 ? "new" : "dup");
}

function handleConfirmImport() {
  if (!parsedData.new || !parsedData.new.length) {
    showToast("No new records to import.", "info");
    return;
  }

  const btn = document.getElementById("btn-confirm-import");
  btn.disabled = true;
  btn.textContent = "Importing...";

  eel.confirm_import(parsedData.new)((res) => {
    btn.disabled = false;
    btn.textContent = "✓ Confirm Import All New Records";

    if (res.success) {
      showToast(`Successfully imported ${res.inserted} record(s)!`);
      setTimeout(() => {
        window.location.href = "tax_records.html";
      }, 1200);
    } else {
      showToast("Import failed: " + res.error, "error");
    }
  });
}

function handleMerge(idx) {
  const rec = parsedData.duplicates[idx];
  if (!rec) return;

  if (!confirm(`Overwrite existing resident with Property ID "${rec.property_id}" using the new parsed data?`)) {
    return;
  }

  // Look up existing resident ID by property_id
  eel.get_all_residents(rec.property_id)((residents) => {
    const existing = residents.find(r => r.property_id.toLowerCase() === rec.property_id.toLowerCase());
    if (!existing) {
      showToast("Existing record could not be located.", "error");
      return;
    }

    eel.merge_resident_import(existing.id, rec)((res) => {
      if (res.success) {
        showToast(`Merged Property ID ${rec.property_id} successfully.`);
        // Remove from duplicates list
        parsedData.duplicates.splice(idx, 1);
        renderReview();
      } else {
        showToast("Merge failed: " + res.error, "error");
      }
    });
  });
}
