/* ============================================================
   add_record.js — Add/Edit record screen logic
   ============================================================ */

let editId = null;
let isPaidState = false;

document.addEventListener("DOMContentLoaded", () => {
  renderSidebar("add_record");

  const urlParams = new URLSearchParams(window.location.search);
  editId = urlParams.get("id");

  if (editId) {
    document.getElementById("page-title").textContent = "Edit Tax Record";
    document.getElementById("btn-save").textContent = "✓ Save Changes";
    loadResident(editId);
  }

  document.getElementById("btn-unpaid").addEventListener("click", () => setPaid(false));
  document.getElementById("btn-paid").addEventListener("click", () => setPaid(true));
  document.getElementById("record-form").addEventListener("submit", handleSubmit);
});

function setPaid(paid) {
  isPaidState = paid;
  const btnUnpaid = document.getElementById("btn-unpaid");
  const btnPaid   = document.getElementById("btn-paid");
  const dateGroup = document.getElementById("paid-date-group");

  if (paid) {
    btnPaid.className   = "btn btn-success btn-sm flex-1";
    btnUnpaid.className = "btn btn-secondary btn-sm flex-1";
    dateGroup.style.display = "block";
    if (!document.getElementById("paid_date").value) {
      document.getElementById("paid_date").value = new Date().toISOString().split("T")[0];
    }
  } else {
    btnUnpaid.className = "btn btn-primary btn-sm flex-1";
    btnPaid.className   = "btn btn-secondary btn-sm flex-1";
    dateGroup.style.display = "none";
  }
}

function loadResident(id) {
  eel.get_resident(Number(id))((r) => {
    if (!r) {
      showToast("Resident not found", "error");
      return;
    }
    document.getElementById("name").value        = r.name;
    document.getElementById("property_id").value = r.property_id;
    document.getElementById("ward").value        = r.ward || "";
    document.getElementById("phone").value       = r.phone || "";
    document.getElementById("address").value     = r.address || "";
    document.getElementById("base_amount").value = r.base_amount;

    if (r.payment_status === "paid") {
      setPaid(true);
      document.getElementById("paid_date").value = r.paid_date || "";
    } else {
      setPaid(false);
    }
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
        showToast("Record updated.");
        window.location.href = "tax_records.html";
      } else {
        showToast("Update failed: " + res.error, "error");
      }
    });
  } else {
    eel.create_resident(data)((res) => {
      if (res.success) {
        showToast("Record created.");
        window.location.href = "tax_records.html";
      } else {
        showToast("Create failed: " + res.error, "error");
      }
    });
  }
}
