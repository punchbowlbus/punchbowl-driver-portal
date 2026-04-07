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

/** ✅ Sidebar renderer (UPDATED) */
export function renderSidebar({ currentUser, isAdmin, activePage }, onNav) {
  if (!els.navArea || !els.adminNavArea) return;

  if (!currentUser) {
    els.navArea.innerHTML = `<div class="muted">Please sign in…</div>`;
    els.adminNavArea.innerHTML = ``;
    return;
  }

  // ✅ Driver-visible pages
  // - Removed "Daily Job List" from here
  // - Renamed "PBC Charters" -> "Drivers (Roster)"
  const items = [
    { id: "charters", label: "Drivers (Roster)" },
    { id: "notice", label: "Notice Board" },
  ];

  // ✅ Admin-only pages
  // - Daily Job List moved here
const adminItems = isAdmin
  ? [
      { id: "adminDispatchBoard", label: "Dispatch Board" },
      { id: "adminEmployees", label: "Employees" },
      { id: "adminBuses", label: "Fleet" },
      { id: "adminBookings", label: "Job Groups" },
      { id: "adminBlocks", label: "Blocks" },
      { id: "adminPermanentRuns", label: "Permanent Runs" },
      { id: "adminBlocksByDate", label: "Blocks By Date" },
      { id: "settings", label: "Settings" },
    ]
  : [];

  els.navArea.innerHTML = items
    .map(
      (i) => `
        <button class="navBtn ${activePage === i.id ? "active" : ""}" data-nav="${i.id}">
          ${escapeHtml(i.label)}
        </button>
      `
    )
    .join("");

  // ✅ If not admin, keep admin section empty (clean)
  els.adminNavArea.innerHTML = adminItems.length
    ? adminItems
        .map(
          (i) => `
            <button class="navBtn ${activePage === i.id ? "active" : ""}" data-nav="${i.id}">
              ${escapeHtml(i.label)}
            </button>
          `
        )
        .join("")
    : "";

  // ✅ Hook clicks ONLY inside sidebar areas (important)
  const hook = (container) => {
    if (!container) return;
    [...container.querySelectorAll("button[data-nav]")].forEach((btn) => {
      btn.onclick = () => onNav(btn.getAttribute("data-nav"));
    });
  };

  hook(els.navArea);
  hook(els.adminNavArea);
}

/** ✅ Legacy Jobs renderer (exported) */
export function renderJobs(jobs, { isAdmin }, actions = {}) {
  if (!els.contentArea) return;

  const visible = (jobs || []).filter((j) => !j.deleted);

  if (!visible.length) {
    els.contentArea.innerHTML = `<div>No jobs found.</div>`;
    return;
  }

  const rows = visible
    .map((j) => {
      const links = Array.isArray(j.pdfLinks) ? j.pdfLinks : j.pdfLink ? [j.pdfLink] : [];

      return `
        <div class="card" style="margin-top:10px">
          <div class="row">
            <div style="min-width:260px">
              <div class="muted">${escapeHtml(j.jobId || j.id)}</div>
              <div style="font-size:18px;font-weight:900">${escapeHtml(fmtDate(j.date))}</div>

              <div style="margin-top:8px">${escapeHtml(j.jobDescription || "-")}</div>

              <div style="margin-top:8px;font-size:13px">
                <b>Depot:</b> ${escapeHtml(j.depotStartTime || "-")} → ${escapeHtml(j.depotFinishTime || "-")}
              </div>

              ${
                isAdmin
                  ? `
                <div class="muted" style="margin-top:8px">
                  <b>Driver:</b> ${escapeHtml(j.driverEmail || "-")}
                  ${j.driverName ? `(${escapeHtml(j.driverName)})` : ""}
                </div>
              `
                  : ""
              }

              ${
                links.length
                  ? `
                <div style="margin-top:10px">
                  ${links
                    .map((u, i) => `<a href="${escapeHtml(u)}" target="_blank" rel="noreferrer">PDF ${i + 1}</a>`)
                    .join(" | ")}
                </div>
              `
                  : ""
              }
            </div>

            ${
              isAdmin
                ? `
              <div style="min-width:260px;font-size:13px;color:#444">
                <div><b>Confirmation:</b> ${escapeHtml(j.confirmation || "PENDING")}</div>
                <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">
                  <button data-edit="${j.id}">Edit</button>
                  <button data-del="${j.id}">Delete</button>
                </div>
              </div>
            `
                : `
              <div style="min-width:230px">
                <div style="font-size:13px;margin-bottom:8px"><b>Status:</b> ${escapeHtml(j.confirmation || "PENDING")}</div>
                <div style="display:flex;gap:8px;flex-wrap:wrap">
                  <button data-c="${j.id}" data-v="CONFIRMED">Confirm</button>
                  <button data-c="${j.id}" data-v="CANT_DO">Can’t do</button>
                </div>
                <div class="muted" style="margin-top:10px">Your confirmation updates automatically.</div>
              </div>
            `
            }
          </div>
        </div>
      `;
    })
    .join("");

  els.contentArea.innerHTML = `<h3 style="margin:0 0 10px">${isAdmin ? "All Jobs (Admin view)" : "Your Jobs"}</h3>${rows}`;

  if (!isAdmin) {
    [...els.contentArea.querySelectorAll("button[data-c]")].forEach((btn) => {
      btn.onclick = () => actions.onConfirm?.(btn.getAttribute("data-c"), btn.getAttribute("data-v"));
    });
  } else {
    [...els.contentArea.querySelectorAll("button[data-edit]")].forEach((btn) => {
      btn.onclick = () => actions.onEdit?.(btn.getAttribute("data-edit"));
    });
    [...els.contentArea.querySelectorAll("button[data-del]")].forEach((btn) => {
      btn.onclick = () => actions.onDelete?.(btn.getAttribute("data-del"));
    });
  }
}