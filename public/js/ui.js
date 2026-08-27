// public/js/ui.js
import { escapeHtml, fmtDate } from "./utils.js";

/** ✅ Central DOM references (exported) */
export const els = {
  authArea: document.getElementById("authArea"),
  tabsArea: document.getElementById("tabsArea"),
  contentArea: document.getElementById("contentArea"),
  errorArea: document.getElementById("errorArea"),

  // ✅ Sidebar containers
  navArea: document.getElementById("navArea"),
  adminNavArea: document.getElementById("adminNavArea"),
};

/** ✅ Error banner (exported) */
export function showError(msg) {
  if (!els.errorArea) return;

  if (!msg) {
    els.errorArea.style.display = "none";
    els.errorArea.innerHTML = "";
    return;
  }

  els.errorArea.style.display = "block";
  els.errorArea.innerHTML = `<b>Error:</b> ${escapeHtml(msg)}`;
}

/** ✅ Top auth area (exported) */
export function renderAuth({ currentUser, isAdmin }, onLogin, onLogout) {
  if (!els.authArea) return;

  if (!currentUser) {
    els.authArea.innerHTML = `<button id="loginBtn">Sign in with Google</button>`;
    const btn = document.getElementById("loginBtn");
    if (btn) btn.onclick = onLogin;
    return;
  }

  els.authArea.innerHTML = `
    <div class="muted">
      Signed in as <b>${escapeHtml(currentUser.email)}</b>
      ${isAdmin ? `<span class="pill">Admin</span>` : ``}
    </div>
    <button id="logoutBtn">Sign out</button>
  `;

  const out = document.getElementById("logoutBtn");
  if (out) out.onclick = onLogout;
}

/** ✅ Tabs (exported) - kept for compatibility */
export function renderTabs({ currentUser, isAdmin, currentTab }, onDriverTab, onAdminTab) {
  if (!els.tabsArea) return;

  if (!currentUser || !isAdmin) {
    els.tabsArea.style.display = "none";
    els.tabsArea.innerHTML = "";
    return;
  }

  els.tabsArea.style.display = "block";
  els.tabsArea.innerHTML = `
    <div class="row">
      <div>
        <button id="driverTab" ${currentTab === "driver" ? "style='font-weight:900'" : ""}>Driver View</button>
        <button id="adminTab" ${currentTab === "admin" ? "style='font-weight:900'" : ""}>Admin Panel</button>
      </div>
      <div class="muted">Admin can add jobs & bulk import CSV</div>
    </div>
  `;

  const d = document.getElementById("driverTab");
  const a = document.getElementById("adminTab");
  if (d) d.onclick = onDriverTab;
  if (a) a.onclick = onAdminTab;
}

/** ✅ Sidebar renderer */
export function renderSidebar({ currentUser, isAdmin, activePage }, onNav) {
  if (!els.navArea || !els.adminNavArea) return;

  if (!currentUser) {
    els.navArea.innerHTML = `<div class="muted">Please sign in…</div>`;
    els.adminNavArea.innerHTML = ``;
    return;
  }

  const driverItems = [
    { id: "myWork", label: "My Work", icon: "briefcase" },
    { id: "notice", label: "Notice Board", icon: "megaphone" },
    { id: "defectReport", label: "Defect Report", icon: "wrench" },
    { id: "lostProperty", label: "Lost Property", icon: "package" },
    { id: "incidentReport", label: "Incident Report", icon: "alert-triangle" },
  ];

  const adminQuickItems = isAdmin
    ? [
        { id: "allShifts", label: "All Jobs", icon: "list" },
        { id: "driverMonitor", label: "Driver Monitor", icon: "users" },
        { id: "operationsDashboard", label: "Operations Dashboard", icon: "bar-chart-3" },
        { id: "notice", label: "Notice Board", icon: "megaphone" },
        { id: "defectReport", label: "Defect Report", icon: "wrench" },
        { id: "lostProperty", label: "Lost Property", icon: "package" },
        { id: "incidentReport", label: "Incident Report", icon: "alert-triangle" },
      ]
    : [];

  const adminItems = isAdmin
    ? [
        { id: "adminDispatchBoard", label: "Dispatch Board", icon: "map" },
        { id: "adminEmployees", label: "Employees", icon: "user" },
        { id: "workshopManagement", label: "Workshop Management", icon: "wrench" },
        { id: "adminBookings", label: "Job Groups", icon: "layers" },
        { id: "adminBlocks", label: "Blocks", icon: "grid" },
        { id: "adminPermanentRuns", label: "Permanent Runs", icon: "repeat" },
        { id: "adminBlocksByDate", label: "Blocks By Date", icon: "calendar" },
        { id: "settings", label: "Settings", icon: "settings" },
      ]
    : [];

  const renderButtons = (items) =>
    items
      .map(
        (i) => `
          <button class="navBtn ${activePage === i.id ? "active" : ""}" data-nav="${i.id}">
            ${i.icon ? `<i data-lucide="${escapeHtml(i.icon)}"></i>` : ``}
            ${escapeHtml(i.label)}
          </button>
        `
      )
      .join("");

  if (!isAdmin) {
    els.navArea.innerHTML = `
      <div class="menuGroupTitle">MENU</div>
      ${renderButtons(driverItems)}
    `;
    els.adminNavArea.innerHTML = "";
  } else {
    els.navArea.innerHTML = `
      <div class="menuGroupTitle">OPERATIONS</div>
      ${renderButtons(adminQuickItems)}
    `;

    els.adminNavArea.innerHTML = `
      <div class="menuGroupTitle">MANAGEMENT</div>
      ${renderButtons(adminItems)}
    `;
  }

  const hook = (container) => {
    if (!container) return;
    [...container.querySelectorAll("button[data-nav]")].forEach((btn) => {
      btn.onclick = () => onNav(btn.getAttribute("data-nav"));
    });
  };

  hook(els.navArea);
  hook(els.adminNavArea);

  if (window.lucide) window.lucide.createIcons();
}

/** ✅ Driver My Work page */
export function renderMyWork(jobs, { currentUser, isAdmin }, actions = {}) {
  if (!els.contentArea) return;

  const email = (currentUser?.email || "").toLowerCase().trim();

  const mine = (jobs || [])
    .filter((j) => !j.deleted)
    .filter((j) => {
      if (isAdmin) return true;

      const driverEmail = (j.driverEmail || "").toLowerCase().trim();
      return !!email && driverEmail === email;
    })
    .sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")));

  if (!mine.length) {
    els.contentArea.innerHTML = `
      <div class="card">
        <h3 style="margin-top:0">My Work</h3>
        <div class="muted">No jobs assigned yet.</div>
      </div>
    `;
    return;
  }

  const rows = mine
    .map((j) => {
      const links = Array.isArray(j.pdfLinks)
        ? j.pdfLinks
        : j.pdfLink
          ? [j.pdfLink]
          : [];

      return `
        <div class="card" style="margin-top:10px">
          <div class="row">
            <div style="min-width:280px;flex:1">
              <div class="muted">${escapeHtml(j.jobId || j.id || "-")}</div>
              <div style="font-size:18px;font-weight:900">${escapeHtml(fmtDate(j.date))}</div>

              <div style="margin-top:8px">
                <b>Job:</b> ${escapeHtml(j.jobDescription || "-")}
              </div>

              <div style="margin-top:8px;font-size:13px">
                <b>Depot:</b> ${escapeHtml(j.depotStartTime || "-")} → ${escapeHtml(j.depotFinishTime || "-")}
              </div>

              ${
                j.driverName || j.driverEmail
                  ? `
                    <div class="muted" style="margin-top:8px">
                      <b>Driver:</b> ${escapeHtml(j.driverName || j.driverEmail || "-")}
                    </div>
                  `
                  : ``
              }

              ${
                links.length
                  ? `
                    <div style="margin-top:10px">
                      ${links
                        .map(
                          (u, i) =>
                            `<a href="${escapeHtml(u)}" target="_blank" rel="noreferrer">PDF ${i + 1}</a>`
                        )
                        .join(" | ")}
                    </div>
                  `
                  : ``
              }
            </div>

            <div style="min-width:230px">
              <div style="font-size:13px;margin-bottom:8px">
                <b>Status:</b> ${escapeHtml(j.confirmation || "PENDING")}
              </div>
              <div style="display:flex;gap:8px;flex-wrap:wrap">
                <button data-c="${j.id}" data-v="CONFIRMED">Confirm</button>
                <button data-c="${j.id}" data-v="CANT_DO">Can’t do</button>
              </div>
              <div class="muted" style="margin-top:10px">
                Your confirmation updates automatically.
              </div>
            </div>
          </div>
        </div>
      `;
    })
    .join("");

  els.contentArea.innerHTML = `
    <h3 style="margin:0 0 10px">My Work</h3>
    ${rows}
  `;

  [...els.contentArea.querySelectorAll("button[data-c]")].forEach((btn) => {
    btn.onclick = () => actions.onConfirm?.(btn.dataset.c, btn.dataset.v);
  });
}
