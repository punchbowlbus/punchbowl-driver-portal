// public/js/ui.js
import { escapeHtml, fmtDate } from "./utils.js";
import { state } from "./state.js";
import { go } from "./main.js";

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
export function renderAuth(user, employee, onSignIn, onSignOut) {
  const authArea = document.getElementById("authArea");
  if (!authArea) return;

  if (!user) {
    authArea.innerHTML = `
      <div class="authWrap">
        <div class="authTop">
          <button id="signInBtn" class="signOutBtn">Sign in</button>
        </div>
      </div>
    `;

    const signInBtn = document.getElementById("signInBtn");
    if (signInBtn && typeof onSignIn === "function") {
      signInBtn.addEventListener("click", onSignIn);
    }
    return;
  }

  const roleLabel = employee?.role || employee?.accessLevel || "Driver";
  const empLabel = employee?.employeeNumber
    ? `Emp: ${employee.employeeNumber}`
    : "Emp: —";

    authArea.innerHTML = `
      <div class="authWrap">
        <div class="authTop">
          <button id="signOutBtn" class="signOutBtn">Sign out</button>
        </div>

        <div class="authBottom">
          <div class="empText">${empLabel}</div>

          <div class="signedIn" title="${user.email || ""}">
            Signed in as ${user.email || ""}
          </div>
        </div>
      </div>
    `;

  const signOutBtn = document.getElementById("signOutBtn");
  if (signOutBtn && typeof onSignOut === "function") {
    signOutBtn.addEventListener("click", onSignOut);
  }
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
        { id: "adminBuses", label: "Fleet", icon: "bus" },
        { id: "adminBookings", label: "Job Groups", icon: "layers" },
        { id: "adminBlocks", label: "Blocks", icon: "grid" },
        { id: "adminPermanentRuns", label: "Permanent Runs", icon: "repeat" },
        { id: "adminBulkDutySpans", label: "Bulk Duty Spans", icon: "layers" },
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
      btn.onclick = () => {
        onNav(btn.getAttribute("data-nav"));

        if (window.innerWidth <= 650 && window.closeMobileMenu) {
          window.closeMobileMenu();
        }
      };
    });
  };

  hook(els.navArea);
  hook(els.adminNavArea);

  if (window.lucide) window.lucide.createIcons();
}

function getDriverStatusLabel(j) {
  const dispatchStatus = String(j.dispatchStatus || "").trim();
  const ack = String(j.driverAcknowledgment || "Pending").trim();

  if (dispatchStatus === "Cancelled") return "Cancelled";
  if (ack === "Yes") return "Confirmed";
  if (ack === "No") return "Cannot Do";
  return "Awaiting Response";
}

function formatMinutes(mins) {
  if (typeof mins !== "number") return "-";
  const h = Math.floor(mins / 60).toString().padStart(2, "0");
  const m = (mins % 60).toString().padStart(2, "0");
  return `${h}:${m}`;
}

/** ✅ Driver My Work page */
export function renderMyWork(jobs, { currentUser, isAdmin }, actions = {}) {
  if (!els.contentArea) return;

  const email = (currentUser?.email || "").toLowerCase().trim();

    const mine = (jobs || [])
      .filter((j) => !j.deleted)
      .filter((j) => j.dispatchStatus !== "Pending")
    .filter((j) => {
      if (isAdmin) return true;

      // dutySpans are already filtered in main.js by driverEmployeeNumber + date
      if (j.driverEmployeeNumber) return true;

      const driverEmail = (j.driverEmail || "").toLowerCase().trim();
      return !!email && driverEmail === email;
    })
    .sort((a, b) =>
      String(a.serviceDate || a.date || "").localeCompare(String(b.serviceDate || b.date || ""))
    );

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

              let statusLabel = "Confirmed";

        if (j.dispatchStatus === "Cancelled") {
          statusLabel = "Cancelled";
        }

      return `
                    <div
              class="card jobCard"
              data-job-id="${escapeHtml(j.id)}"
              style="
                margin-top:10px;
                cursor:pointer;
                ${j.dispatchStatus === "Cancelled" ? "background:#fff1f1; border:1px solid #e57373;" : ""}
              "
            >
          <div class="row">
            <div style="min-width:280px;flex:1">
              <div class="muted mobileHide">${escapeHtml(j.jobId || j.id || "-")}</div>
              <div style="font-size:18px;font-weight:900">${escapeHtml(fmtDate(j.serviceDate || j.date))}</div>

                ${
                  j.jobDescription
                    ? `
                      <div style="margin-top:8px">
                        <b>Job:</b> ${escapeHtml(j.jobDescription)}
                      </div>
                    `
                    : ``
                }

              <div style="margin-top:8px;font-size:13px">
                <b>Depot:</b> ${escapeHtml(formatMinutes(j.startMin))} → ${escapeHtml(formatMinutes(j.endMin))}
              </div>


              ${
                links.length
                  ? `
                    <div style="margin-top:10px">
                      ${links
                        .map(
                          (u, i) =>
                            `<a href="${escapeHtml(u)}" target="_blank" rel="noreferrer" onclick="event.stopPropagation()">PDF ${i + 1}</a>`
                        )
                        .join(" | ")}
                    </div>
                  `
                  : ``
              }
            </div>

              <div style="min-width:230px">
                <div style="font-size:13px;margin-bottom:8px">
                  <b>Status:</b> 
                  <span style="color: ${j.dispatchStatus === "Cancelled" ? "red" : "green"}; font-weight: 600;">
                    ${escapeHtml(statusLabel)}
                  </span>
                  ${j.dispatchStatus === "Cancelled" 
                    ? `<div style="margin-top:8px; color:#c62828; font-weight:500;">
                        This job has been cancelled
                      </div>` 
                    : ``}
                </div>

                <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:10px">
                  <button 
                    data-c="${escapeHtml(j.id)}" 
                    data-v="Yes"
                    style="
                      ${j.driverAcknowledgment === "Yes" ? "background:#2e7d32; color:white; border:1px solid #2e7d32;" : ""}
                      ${j.dispatchStatus === "Cancelled" ? "opacity:0.5; cursor:not-allowed;" : ""}
                    "
                    ${j.dispatchStatus === "Cancelled" ? "disabled" : ""}
                  >
                    Yes
                  </button>

                  <button 
                    data-c="${escapeHtml(j.id)}" 
                    data-v="No"
                    style="
                      ${j.driverAcknowledgment === "No" ? "background:#c62828; color:white; border:1px solid #c62828;" : ""}
                      ${j.dispatchStatus === "Cancelled" ? "opacity:0.5; cursor:not-allowed;" : ""}
                    "
                    ${j.dispatchStatus === "Cancelled" ? "disabled" : ""}
                  >
                    No
                  </button>
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

  [...els.contentArea.querySelectorAll(".jobCard")].forEach((el) => {
    el.onclick = () => {
      const jobId = el.getAttribute("data-job-id");

      const job = (state.driverDutySpans || []).find(j => j.id === jobId);

      if (job?.dispatchStatus === "Cancelled") {
        return; // ❌ do nothing if cancelled
      }

      state.selectedJobId = jobId;
      go("jobDetails");
    };
  });

  [...els.contentArea.querySelectorAll("button[data-c]")].forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation();
      actions.onConfirm?.(btn.getAttribute("data-c"), btn.getAttribute("data-v"));
    };
  });
}

/** ✅ Legacy Jobs renderer (single clean version) */
export function renderJobs(jobs, { isAdmin }, actions = {}) {
  if (!els.contentArea) return;

  const visible = (jobs || []).filter((j) => !j.deleted);

  if (!visible.length) {
    els.contentArea.innerHTML = `<div>No jobs found.</div>`;
    return;
  }

  const rows = visible
    .map((j) => {
      const links = Array.isArray(j.pdfLinks)
        ? j.pdfLinks
        : j.pdfLink
          ? [j.pdfLink]
          : [];

      return `
        <div class="card" style="margin-top:10px">
          <div class="row">
            <div style="min-width:260px">
              <div class="muted">${escapeHtml(j.jobId || j.id)}</div>
              <div style="font-size:18px;font-weight:900">${escapeHtml(fmtDate(j.serviceDate || j.date))}</div>

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
                <div><b>Acknowledgment:</b> ${escapeHtml(j.driverAcknowledgment || "Pending")}</div>
                <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">
                  <button data-edit="${j.id}">Edit</button>
                  <button data-del="${j.id}">Delete</button>
                </div>
              </div>
            `
                : `
              <div style="min-width:230px">
                <div style="font-size:13px;margin-bottom:8px"><b>Status:</b> ${escapeHtml(getDriverStatusLabel(j))}</div>
                <div style="display:flex;gap:8px;flex-wrap:wrap">
                  <button data-c="${j.id}" data-v="Yes">Yes</button>
                  <button data-c="${j.id}" data-v="No">No</button>
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

  els.contentArea.innerHTML = `
    <h3 style="margin:0 0 10px">${isAdmin ? "All Jobs (Admin view)" : "Your Jobs"}</h3>
    ${rows}
  `;

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