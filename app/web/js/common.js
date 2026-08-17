/* ============================================================
   common.js — Shared helper utilities & navigation loader
   Matches Figma Make prototype aesthetics
   ============================================================ */

// ── Formatting ───────────────────────────────────────────────────────────────

function formatCurrency(amount) {
  if (amount === null || amount === undefined || isNaN(amount)) return "₹0";
  try {
    const num = Math.round(Number(amount));
    return "₹" + num.toLocaleString("en-IN");
  } catch (e) {
    return "₹" + amount;
  }
}

function formatDate(isoStr) {
  if (!isoStr) return "";
  try {
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return isoStr;
    return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  } catch (e) {
    return isoStr;
  }
}

function formatDateTime(isoStr) {
  if (!isoStr) return "";
  try {
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return isoStr;
    return d.toLocaleString("en-IN", {
      day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit"
    });
  } catch (e) {
    return isoStr;
  }
}

function statusBadge(status) {
  const map = {
    paid:    '<span class="badge badge-paid">Paid</span>',
    unpaid:  '<span class="badge badge-unpaid">Unpaid</span>',
    overdue: '<span class="badge badge-overdue">Overdue</span>',
  };
  return map[status] || `<span class="badge">${status}</span>`;
}

// ── Toast notifications ──────────────────────────────────────────────────────

function showToast(message, type = "success") {
  let el = document.getElementById("toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "toast";
    document.body.appendChild(el);
  }
  el.className = `toast ${type}`;
  el.textContent = message;
  el.style.display = "block";

  setTimeout(() => {
    el.style.display = "none";
  }, 3500);
}

// ── Sidebar & Header Injection ────────────────────────────────────────────────

const NAV_ITEMS = [
  { id: "dashboard",   label: "Dashboard",        icon: "⊞", href: "dashboard.html" },
  { id: "tax_records", label: "Tax Records",      icon: "☰", href: "tax_records.html" },
  { id: "add_record",  label: "Add Record",       icon: "+", href: "add_record.html" },
  { id: "import_word", label: "Import from Word", icon: "⊕", href: "import_word.html" },
  { id: "reminders",   label: "Reminders",        icon: "🔔", href: "reminders.html" },
  { id: "report",      label: "Tax Report",       icon: "📊", href: "report.html" },
  { id: "settings",    label: "Settings",         icon: "⚙", href: "settings.html" },
];

function renderSidebar(activeId) {
  const container = document.getElementById("sidebar-container");
  if (!container) return;

  const linksHtml = NAV_ITEMS.map(item => `
    <a href="${item.href}" class="nav-link ${item.id === activeId ? 'active' : ''}">
      <span class="nav-icon">${item.icon}</span>
      <span style="flex: 1;">${item.label}</span>
      ${item.id === 'reminders' ? '<span id="nav-reminder-badge" class="nav-badge" style="display:none">0</span>' : ''}
    </a>
  `).join("");

  container.innerHTML = `
    <aside class="sidebar">
      <div class="sidebar-header">
        <div class="sidebar-title" id="sidebar-gp-name">Gram Panchayat Office</div>
        <div class="sidebar-sub">Property Tax Reminders</div>
      </div>
      <nav class="sidebar-nav">
        ${linksHtml}
      </nav>
      <div class="sidebar-footer">
        <div class="sidebar-version">v3.0 • Home Tax System</div>
      </div>
    </aside>
  `;

  // Update header right meta on every page
  const headerMeta = document.getElementById("header-date");
  if (headerMeta) {
    headerMeta.textContent = new Date().toLocaleDateString("en-IN", {
      weekday: "short", day: "2-digit", month: "short", year: "numeric"
    });
  }

  // Load GP Office Name into sidebar & overdue badge in header if applicable
  if (window.eel) {
    eel.get_all_app_settings()((settings) => {
      const el = document.getElementById("sidebar-gp-name");
      if (el && settings && settings.gram_panchayat_name) {
        el.textContent = settings.gram_panchayat_name;
      }
    });

    eel.get_resident_stats()((stats) => {
      if (stats && stats.unpaid > 0) {
        const badge = document.getElementById("nav-reminder-badge");
        if (badge) {
          badge.textContent = stats.unpaid;
          badge.style.display = "inline-block";
        }
      }
    });
  }
}
