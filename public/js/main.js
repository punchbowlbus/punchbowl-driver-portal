// public/js/main.js
import { onAuthStateChanged, signInWithPopup, signOut } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-auth.js";
import { collection, addDoc, doc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";
import { getToken } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-messaging.js";
import { auth, provider, db, messaging } from "./firebase.js";
import { ADMIN_EMAILS, FCM_VAPID_KEY } from "./config.js";
import { state } from "./state.js";
import { normalizeEmail, escapeHtml } from "./utils.js";
import {
  listenShifts,
  listenLegs,
  listenDutySpansByDate,
  listenDutySpansByDriverAndDate,
  listenDutySpansByDriverAndDateRange,
  listenBlocksByDate,
  patchShift,
  patchLeg,
  getEmployeeByEmail
} from "./db.js";
import { els, showError, renderAuth, renderSidebar, renderMyWork } from "./ui.js";
import { renderShifts } from "./shifts_ui.js";
import { openLegModal } from "./modals.js";
import { updateDutySpanDriverAcknowledgment } from "./db.js";
let notificationRegisteredForEmpNo = "";

/* =========================================================
   Helpers
========================================================= */
function isAdminEmail(email) {
  return ADMIN_EMAILS.map(normalizeEmail).includes(normalizeEmail(email));
}

function stopAllListeners() {
  if (state.unsubscribeShifts) state.unsubscribeShifts();
  state.unsubscribeShifts = null;

  if (state.unsubscribeDriverDutySpans) state.unsubscribeDriverDutySpans();
  state.unsubscribeDriverDutySpans = null;

  if (state.unsubscribeLegsByShiftId) {
    Object.values(state.unsubscribeLegsByShiftId).forEach((fn) => {
      try {
        fn?.();
      } catch {}
    });
  }

  state.unsubscribeLegsByShiftId = {};
}

/* =========================================================
   Actions
========================================================= */
async function setShiftConfirmation(shiftId, value) {
  showError("");

  const safeValue = String(value || "").trim();
  if (safeValue !== "Yes" && safeValue !== "No") {
    showError("Invalid confirmation value");
    return;
  }

  try {
    await patchShift(shiftId, {
      driverAcknowledgment: safeValue,
      driverAcknowledgmentAt: new Date(),
      updatedAt: new Date(),
      updatedByEmail: normalizeEmail(state.currentUser?.email || "")
    });
  } catch (e) {
    showError(e?.message || "Failed to update confirmation");
  }
}

async function softDeleteShift(shiftId) {
  showError("");
  try {
    await patchShift(shiftId, {
      deleted: true,
      deletedAt: new Date(),
      deletedByEmail: normalizeEmail(state.currentUser?.email || ""),
      updatedAt: new Date(),
      updatedByEmail: normalizeEmail(state.currentUser?.email || "")
    });
  } catch (e) {
    showError(e?.message || "Failed to delete shift");
  }
}

async function softDeleteLeg(legId) {
  showError("");
  try {
    await patchLeg(legId, {
      deleted: true,
      deletedAt: new Date(),
      deletedByEmail: normalizeEmail(state.currentUser?.email || ""),
      updatedAt: new Date(),
      updatedByEmail: normalizeEmail(state.currentUser?.email || "")
    });
  } catch (e) {
    showError(e?.message || "Failed to delete leg");
  }
}

/* =========================================================
   Shifts
========================================================= */
function loadShifts({ mode } = { mode: "driver" }) {
  showError("");
  stopAllListeners();

  if (!state.currentUser) {
    els.contentArea.innerHTML = `Please sign in to view shifts.`;
    return;
  }

  els.contentArea.innerHTML = `<div class="muted">Loading shifts…</div>`;

  const driverEmail = normalizeEmail(state.currentUser.email);
  const isAdminAll = mode === "adminAll";

  state.unsubscribeShifts = listenShifts(
    { isAdmin: isAdminAll, driverEmail },
    (shifts) => {
      state.legsByShiftId = state.legsByShiftId || {};
      state.unsubscribeLegsByShiftId = state.unsubscribeLegsByShiftId || {};

      // Remove leg listeners for shifts that no longer exist
      const currentIds = new Set((shifts || []).map((s) => s.id));
      Object.keys(state.unsubscribeLegsByShiftId).forEach((shiftId) => {
        if (!currentIds.has(shiftId)) {
          try {
            state.unsubscribeLegsByShiftId[shiftId]?.();
          } catch {}
          delete state.unsubscribeLegsByShiftId[shiftId];
          delete state.legsByShiftId[shiftId];
        }
      });

      // Add listeners for new shifts
      shifts.forEach((s) => {
        if (state.unsubscribeLegsByShiftId[s.id]) return;

        const un = listenLegs(
          s.id,
          (legs) => {
            state.legsByShiftId[s.id] = legs;
            render();
          },
          (e) => showError(e?.message || "Failed to load legs")
        );

        state.unsubscribeLegsByShiftId[s.id] = un;
      });

      state.shifts = shifts;
      render();
    },
    (e) => showError(e?.message || "Failed to load shifts")
  );
}

function render() {
  // My Work page uses the new UI renderer
  if (state.activePage === "myWork") {
    renderMyWork(
      state.driverDutySpans || [],
      {
        currentUser: state.currentUser,
        isAdmin: state.isAdmin,
        isDriver: state.isDriver,
        employee: state.employee
      },
      {
        onConfirm: (dutySpanId, uiValue) => {
          updateDutySpanDriverAcknowledgment(dutySpanId, uiValue);
        }
      }
    );
    return;
  }

  if (state.activePage === "jobDetails") {
    go("jobDetails");
    return;
  }

  // Existing shift renderer for charters + admin all-shifts
  const isAdminViewAll = state.isAdmin && state.activePage === "allShifts";

  renderShifts(
    state.shifts || [],
    state.legsByShiftId || {},
    { isAdmin: isAdminViewAll },
    {
      onConfirmShift: setShiftConfirmation,
      onAddLeg: (shiftId) => openLegModal(shiftId),
      onDeleteShift: (shiftId) => {
        if (confirm("Delete this shift?")) softDeleteShift(shiftId);
      },
      onDeleteLeg: (legId) => {
        if (confirm("Delete this leg?")) softDeleteLeg(legId);
      }
    }
  );
}

function renderPlaceholder(title, msg) {
  stopAllListeners();

  els.contentArea.innerHTML = `
    <div class="card">
      <h3 style="margin:0 0 8px">${title}</h3>
      <div class="muted">${msg}</div>
    </div>
  `;
}

/* =========================================================
   Navigation
========================================================= */
export async function go(pageId) {

  state.activePage = pageId;

  renderSidebar(
    {
      currentUser: state.currentUser,
      isAdmin: state.isAdmin,
      activePage: state.activePage
    },
    (id) => go(id)
  );

  showError("");

  // Dispatch Board
  if (pageId === "adminDispatchBoard") {
    if (!state.isAdmin) return showError("No admin access");

    stopAllListeners();

    const mod = await import("./dispatch_board.js?v=3");
    mod.renderDispatchBoardPage();
    return;
  }

  // Admin pages
  if (
    pageId === "adminEmployees" ||
    pageId === "adminBuses" ||
    pageId === "adminBookings" ||
    pageId === "adminBlocks" ||
    pageId === "adminBlocksByDate" ||
    pageId === "adminPermanentRuns" ||
    pageId === "adminBulkDutySpans"
  ) {
    if (!state.isAdmin) return showError("No admin access");

    stopAllListeners();

    const mod = await import("./admin_v2.js");

    if (pageId === "adminEmployees") {
      mod.renderEmployeesPage();
      return;
    }

    if (pageId === "adminBuses") {
      mod.renderBusesPage();
      return;
    }

    if (pageId === "adminBookings") {
      mod.renderAdminBookings();
      return;
    }

    if (pageId === "adminBlocks") {
      mod.renderAdminBlocks();
      return;
    }

    if (pageId === "adminBlocksByDate") {
      mod.renderAdminBlocksByDate();
      return;
    }

    if (pageId === "adminPermanentRuns") {
      mod.renderAdminPermanentRuns();
      return;
    }

if (pageId === "adminBulkDutySpans") {
  els.contentArea.innerHTML = `
    <h2 style="margin-top:0">Bulk Duty Spans</h2>

    <div class="card" style="max-width:900px;">
      <div style="font-weight:700; margin-bottom:12px;">
        Upload Duty Spans CSV
      </div>

      <div style="margin-bottom:12px;">
        <input type="file" id="csvFileInput" accept=".csv" />
      </div>

      <div style="margin-top:10px;">
        <div style="font-weight:600; margin-bottom:6px;">CSV Format:</div>
        <div style="font-family:monospace; font-size:12px; background:#f8f8f8; padding:8px; border-radius:6px;">
          serviceDate,dutyNumber,driverEmployeeNumber,startTime,endTime,startLocation,endLocation,assignedBus<br>
          2026-04-21,101,963,08:00,14:00,Hannans Depot,Hannans Depot,<br>
          2026-04-21,102,959,05:00,13:00,Hannans Depot,Bounds Depot,Bus 12
        </div>
      </div>

      <div id="csvPreview" style="margin-top:16px;"></div>

      <div style="margin-top:12px; display:flex; gap:8px; flex-wrap:wrap;">
        <button id="processCsvBtn">Process CSV</button>
        <button id="importCsvBtn" disabled>Import CSV</button>
      </div>

      <div class="muted" style="margin-top:10px;">
        Import after preview looks correct.
      </div>
    </div>
  `;

  const processBtn = document.getElementById("processCsvBtn");
  const importBtn = document.getElementById("importCsvBtn");
  const fileInput = document.getElementById("csvFileInput");
  const previewDiv = document.getElementById("csvPreview");

  if (!processBtn || !importBtn || !fileInput || !previewDiv) return;

  window._bulkRows = [];

  function timeToMin(t) {
    const parts = String(t || "").trim().split(":");
    if (parts.length !== 2) return NaN;
    return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
  }

  function normalizeDate(d) {
    const v = String(d || "").trim();

    if (!v) return "";

    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;

    if (/^\d{2}\/\d{2}\/\d{4}$/.test(v)) {
      const [day, month, year] = v.split("/");
      return `${year}-${month}-${day}`;
    }

    return v;
  }

  processBtn.onclick = () => {
    importBtn.disabled = true;
    window._bulkRows = [];

    const file = fileInput.files?.[0];
    if (!file) {
      alert("Please select a CSV file");
      return;
    }

    const reader = new FileReader();

    reader.onload = function (e) {
      const text = String(e.target?.result || "");

      const lines = text
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);

      if (lines.length < 2) {
        previewDiv.innerHTML = "<div class='muted'>No data found</div>";
        return;
      }

      const headers = lines[0]
        .split(",")
        .map((h) => h.trim().replace(/^\uFEFF/, ""));

      const rows = lines.slice(1).map((line) => {
        const values = line.split(",").map((v) => v.trim()).slice(0, headers.length);
        const obj = {};

        headers.forEach((h, i) => {
          let val = values[i] || "";

          if (val.startsWith('"') && val.endsWith('"')) {
            val = val.slice(1, -1);
          }

          obj[h] = val;
        });

        return obj;
      });

      const cleanedRows = rows.map((r) => ({
        serviceDate: normalizeDate(r.serviceDate),
        dutyNumber: String(r.dutyNumber || "").trim(),
        driverEmployeeNumber: String(r.driverEmployeeNumber || "").trim(),
        startMin: timeToMin(r.startTime),
        endMin: timeToMin(r.endTime),
        startLocation: String(r.startLocation || "").trim(),
        endLocation: String(r.endLocation || "").trim(),
        assignedBus: String(r.assignedBus || "").trim()
      }));

      window._bulkRows = cleanedRows;
      console.log("Cleaned Rows:", cleanedRows);

      const previewHeaders = [
        "serviceDate",
        "dutyNumber",
        "driverEmployeeNumber",
        "startMin",
        "endMin",
        "startLocation",
        "endLocation",
        "assignedBus"
      ];

      const table = `
        <table style="width:100%; border-collapse:collapse; font-size:12px;">
          <thead>
            <tr>
              ${previewHeaders.map((h) => `<th style="border:1px solid #ddd; padding:6px; background:#f0f0f0;">${h}</th>`).join("")}
            </tr>
          </thead>
          <tbody>
            ${cleanedRows.map((r) => `
              <tr>
                ${previewHeaders.map((h) => `<td style="border:1px solid #ddd; padding:6px;">${r[h] ?? ""}</td>`).join("")}
              </tr>
            `).join("")}
          </tbody>
        </table>
      `;

      previewDiv.innerHTML = table;
      importBtn.disabled = cleanedRows.length === 0;
    };

    reader.readAsText(file);
  };

  importBtn.onclick = async () => {
    if (!window._bulkRows || window._bulkRows.length === 0) {
      alert("No data to import. Please process CSV first.");
      return;
    }

    if (!confirm(`Import ${window._bulkRows.length} duty spans?`)) return;

    try {
      let success = 0;

      for (const r of window._bulkRows) {
        const payload = {
          serviceDate: r.serviceDate,
          dutyNumber: r.dutyNumber,
          driverEmployeeNumber: r.driverEmployeeNumber,
          startMin: r.startMin,
          endMin: r.endMin,
          startLocation: r.startLocation,
          endLocation: r.endLocation,
          assignedBus: r.assignedBus || "",
          dispatchStatus: "Pending",
          driverAcknowledgment: "Pending",
          createdAt: new Date(),
          updatedAt: new Date()
        };

        await addDoc(collection(db, "dutySpans"), payload);
        success++;
      }

      alert(`Imported ${success} duty spans successfully`);
    } catch (err) {
      console.error("IMPORT ERROR:", err);
      alert(err.message || "Import failed");
    }
  };

  return;
    }
  }

// Admin quick menu
if (pageId === "allShifts") {
  if (!state.isAdmin) return showError("No admin access");

  stopAllListeners();

  els.contentArea.innerHTML = `
    <h2 style="margin-top:0">All Jobs</h2>

    <div class="card" style="max-width:100%;">
      <div style="display:flex; flex-wrap:wrap; gap:12px; align-items:end;">
        <div style="flex:1; min-width:220px;">
          <div style="font-weight:700; margin-bottom:8px;">Select Date</div>
          <input id="allJobsDate" type="date" style="width:100%;" />

          <div style="margin-top:12px;">
            <div style="font-weight:700; margin-bottom:8px;">Driver Filter</div>
            <input id="driverFilter" type="text" placeholder="Type driver name or employee number..." style="width:100%;" />
          </div>
        </div>
      </div>

      <div id="allJobsList" style="margin-top:14px;">
        <div class="muted">Select a date to view driver jobs.</div>
      </div>
    </div>
  `;

  const dateEl = document.getElementById("allJobsDate");
  const listEl = document.getElementById("allJobsList");
  const driverFilterEl = document.getElementById("driverFilter");

  let allJobsUnsub = null;

  function renderAllJobsList(jobsToRender, selectedDate) {
    const filterText = (driverFilterEl?.value || "").trim().toLowerCase();

    const filteredJobs = !filterText
      ? jobsToRender
      : jobsToRender.filter((j) => {
          const haystack = [
            j.driverName,
            j.driverEmployeeNumber,
            j.dutyNumber,
            j.assignedBus
          ].filter(Boolean).join(" ").toLowerCase();

          return haystack.includes(filterText);
        });

    if (!filteredJobs.length) {
      listEl.innerHTML = `<div class="muted">No matching driver jobs found.</div>`;
      return;
    }

    listEl.innerHTML = filteredJobs.map((j) => `
      <div class="card adminJobCard" data-job-id="${escapeHtml(j.id)}" style="margin-top:10px; cursor:pointer">
        <div style="font-weight:900">
          ${escapeHtml(j.driverName || j.driverEmployeeNumber || "Unassigned Driver")}
        </div>

        <div style="color:#555; margin-top:4px;">
          ${escapeHtml(
            new Date(j.serviceDate || selectedDate).toLocaleDateString("en-AU", {
              weekday: "long",
              day: "2-digit",
              month: "long",
              year: "numeric"
            })
          )}
        </div>

        <div style="margin-top:6px">
          <b>Duty Number:</b> ${escapeHtml(j.dutyNumber || "-")}
        </div>

        <div style="margin-top:6px">
          <b>Time:</b> ${formatMinutes(j.startMin)} → ${formatMinutes(j.endMin)}
        </div>

        <div style="margin-top:6px">
          <b>Status:</b> ${escapeHtml(j.dispatchStatus || "-")}
        </div>

        <div style="margin-top:6px">
          <b>Driver Acknowledgment:</b>
          ${
            j.driverAcknowledgment === "Yes"
              ? '<span style="color:#2e7d32;font-weight:700">Yes</span>'
              : j.driverAcknowledgment === "No"
              ? '<span style="color:#c62828;font-weight:700">No</span>'
              : '<span style="color:#1565c0;font-weight:700">Pending</span>'
          }
        </div>
      </div>
    `).join("");

    listEl.querySelectorAll(".adminJobCard").forEach((card) => {
      card.onclick = () => {
        const jobId = card.getAttribute("data-job-id");

        state.selectedJobId = jobId;
        state.driverDutySpans = jobsToRender;

        go("jobDetails");
      };
    });
  }

  function loadAllJobsForDate(selectedDate) {
    if (!selectedDate) {
      listEl.innerHTML = `<div class="muted">Select a date to view driver jobs.</div>`;
      return;
    }

    state.allJobsSelectedDate = selectedDate;

    if (allJobsUnsub) allJobsUnsub();

    listEl.innerHTML = `<div class="muted">Loading jobs...</div>`;

    allJobsUnsub = listenDutySpansByDate(
      selectedDate,
      (jobs) => {
        console.log("All Jobs loaded:", jobs);
        state.allJobsLoaded = jobs;

        if (!jobs.length) {
          listEl.innerHTML = `<div class="muted">No driver jobs found for this date.</div>`;
          return;
        }

        renderAllJobsList(jobs, selectedDate);
      },
      (e) => showError(e?.message || "Failed to load all jobs")
    );
  }

  dateEl.onchange = () => {
    loadAllJobsForDate(dateEl.value);
  };

  driverFilterEl.oninput = () => {
    renderAllJobsList(state.allJobsLoaded || [], dateEl.value);
  };

  if (state.allJobsSelectedDate) {
    dateEl.value = state.allJobsSelectedDate;
    loadAllJobsForDate(state.allJobsSelectedDate);
  }

  return;
}

  if (pageId === "driverMonitor") {
    if (!state.isAdmin) return showError("No admin access");
    renderPlaceholder("Driver Monitor", "Coming soon...");
    return;
  }

  if (pageId === "operationsDashboard") {
    if (!state.isAdmin) return showError("No admin access");
    renderPlaceholder("Operations Dashboard", "Coming soon...");
    return;
  }

  
        if (pageId === "jobDetails") {
          const job = (state.driverDutySpans || []).find(j => j.id === state.selectedJobId);
          const dutyDate = String(job?.serviceDate || job?.date || "").trim();
          console.log("jobDetails state.blocks:", state.blocks);

          if (!job) {
            renderPlaceholder("Duty Sheet", "Duty not found");
            return;
          }

          if (String(state.blocksDate || "") !== dutyDate) {
            state.blocks = null;
            state.blocksDate = dutyDate;
          }

          els.contentArea.innerHTML = `
            <div class="card">
              <h3>Duty Sheet</h3>

                <div style="margin-top:10px">
                  <b>Duty Date:</b> ${formatDutyDate(job.serviceDate)}
                </div>

              <div style="margin-top:10px">
                <b>Duty Number:</b> ${escapeHtml(String(job.dutyNumber || "-"))}
              </div>

              <div style="margin-top:10px">
                <b>Duty Type:</b> ${escapeHtml(String(job.dutyType || "Charter"))}
              </div>

              ${
                job.dutyType === "Rail Replacement"
                  ? `
                    <div style="margin-top:10px">
                      <b>Route Number:</b> ${escapeHtml(String(job.routeNumber || "-"))}
                    </div>

                    ${
                      job.routePdfUrl
                        ? `
                          <div style="margin-top:10px">
                            <b>Route Description:</b>
                            <a href="${escapeHtml(String(job.routePdfUrl))}" target="_blank">
                              Route Description
                            </a>
                          </div>
                        `
                        : ""
                    }
                  `
                  : ""
              }

              <div style="margin-top:10px">
                <b>Duty Time:</b> ${formatMinutes(job.startMin)} → ${formatMinutes(job.endMin)}
              </div>

              <div style="margin-top:10px">
                <b>Status:</b> ${job.dispatchStatus === "Cancelled" ? "Cancelled" : "Confirmed"}
              </div>

              <div style="margin-top:16px; font-weight:700;">
                Assigned Jobs
              </div>

              ${(() => {
                const rows = [];

                rows.push({
                  label: "Sign on",
                  time: formatMinutes(job.startMin),
                  sortMin: Number(job.startMin || 0)
                });

                if (String(job.dutyType || "Charter").trim() === "Yard") {
                  rows.push({
                    label: "Yard duties start",
                    time: formatMinutes(job.startMin),
                    sortMin: Number(job.startMin || 0)
                  });
                } else {
                  rows.push({
                    label: "Depart depot",
                    time: formatMinutes(Number(job.startMin || 0) + 5),
                    sortMin: Number(job.startMin || 0) + 5
                  });
                }

                const jobs = (state.blocks || [])
                  .filter((b) => {
                    const blockDutySpanId = String(b.dutySpanId || "").trim();

                    if (blockDutySpanId) {
                      return blockDutySpanId === String(job.id || "").trim();
                    }

                    const sameDate =
                      String(b.serviceDate || b.date || "").trim() ===
                      String(job.serviceDate || job.date || "").trim();

                    const assignedDriver =
                      String(
                        b.assignedDriverEmployeeNumber ||
                        b.assignedDriverId ||
                        b.driverId ||
                        ""
                      ).trim();

                    const sameDriver =
                      assignedDriver === String(job.driverEmployeeNumber || "").trim();

                    const start = Number(b.startMin ?? b.startMinutes ?? 0);
                    const end = Number(b.endMin ?? b.endMinutes ?? 0);

                    const insideDuty =
                      start >= Number(job.startMin || 0) &&
                      end <= Number(job.endMin || 0);

                    return sameDate && sameDriver && insideDuty;
                  });

                jobs.forEach((b) => {
                  const from = b.fromName || b.from || b.startLocation || "Start";
                  const to = b.toName || b.to || b.endLocation || "Destination";

                  const startMin = Number(b.startMin ?? b.startMinutes ?? 0);
                  const endMin = Number(b.endMin ?? b.endMinutes ?? 0);

                  rows.push({
                    label: `Depart ${from}`,
                    time: formatMinutes(startMin),
                    sortMin: startMin
                  });

                  rows.push({
                    label: `Arrive ${to}`,
                    time: formatMinutes(endMin),
                    sortMin: endMin
                  });
                });

                  if (Array.isArray(job.breaks)) {
                    job.breaks.forEach((b) => {
                      const breakStart = Number(b.startMin || 0);
                      const breakEnd = Number(b.endMin || 0);
                      const breakType = String(b.type || "").trim().toLowerCase();

                      rows.push({
                        label: breakType === "crib" ? "Crib break" : "Meal break",
                        time: `${formatMinutes(breakStart)} – ${formatMinutes(breakEnd)}`,
                        sortMin: breakStart
                      });
                    });
                  }

                  rows.push({
                    label: "Estimated duty end<br><span style='font-size:12px;color:#666'>(subject to change)</span>",
                    time: formatMinutes(job.endMin),
                    sortMin: Number(job.endMin || 0)
                  });

                rows.sort((a, b) => a.sortMin - b.sortMin);

                return rows
                  .map(
                    (r) => `
                      <div style="margin-top:8px; display:flex; justify-content:space-between; gap:12px;">
                        <div style="flex:1; min-width:0;">${r.label}</div>
                        <div style="font-weight:600; white-space:nowrap;">${escapeHtml(r.time)}</div>
                      </div>
                    `
                  )
                  .join("");
              })()}
              <div style="margin-top:20px; display:flex; gap:8px;">
                <button 
                  id="yesBtn"
                  style="
                    ${job.driverAcknowledgment === "Yes" ? "background:#2e7d32; color:white; border:1px solid #2e7d32;" : ""}
                  "
                >
                  Yes
                </button>

                <button 
                  id="noBtn"
                  style="
                    ${job.driverAcknowledgment === "No" ? "background:#c62828; color:white; border:1px solid #c62828;" : ""}
                  "
                >
                  No
                </button>
              </div>
              <div style="
                position: fixed;
                bottom: 20px;
                right: 20px;
                z-index: 1000;
              ">
                <button id="backBtn" style="
                  padding: 10px 14px;
                  border-radius: 20px;
                  border: none;
                  background: #d21919;
                  color: white;
                  font-weight: 600;
                  box-shadow: 0 2px 6px rgba(0,0,0,0.2);
                ">
                  ← Back
                </button>
              </div>
            </div>
          `;

            document.getElementById("yesBtn").onclick = () => {
              updateDutySpanDriverAcknowledgment(job.id, "Yes");
            };

            document.getElementById("noBtn").onclick = () => {
              updateDutySpanDriverAcknowledgment(job.id, "No");
            };
            document.getElementById("backBtn").onclick = () => {
              if (state.isAdmin) {
                go("allShifts");
              } else {
                go("myWork");
              }
            };

          if (!state.blocks && dutyDate) {
            listenBlocksByDate(
              dutyDate,
              (blocks) => {
                state.blocks = blocks || [];
                go("jobDetails");
              },
              (e) => showError(e?.message || "Failed to load blocks")
            );
          }

          return;
        }

  // Shared menu
  if (pageId === "notice") {
    renderPlaceholder("Notice Board", "Coming soon...");
    return;
  }

  if (pageId === "defectReport") {
    renderPlaceholder("Defect Report", "Coming soon...");
    return;
  }

  if (pageId === "lostProperty") {
    renderPlaceholder("Lost Property", "Coming soon...");
    return;
  }

  if (pageId === "incidentReport") {
    renderPlaceholder("Incident Report", "Coming soon...");
    return;
  }

  // Driver menu
  if (pageId === "myWork") {
    loadDriverWork();
    return;
  }

  if (pageId === "charters") {
    loadShifts({ mode: "driver" });
    return;
  }

  // Fallback
  loadShifts({ mode: "driver" });
}

function loadDriverWork() {
  showError("");
  stopAllListeners();

  if (!state.currentUser) {
    els.contentArea.innerHTML = `Please sign in to view work.`;
    return;
  }

  const driverEmployeeNumber = String(state.employee?.employeeNumber || "").trim();

  if (!driverEmployeeNumber) {
    els.contentArea.innerHTML = `<div class="muted">No driver employee number found.</div>`;
    return;
  }

      const now = new Date();
    const day = now.getDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
    const diffToMonday = day === 0 ? -6 : 1 - day;

    const start = new Date(now);
    start.setDate(now.getDate() + diffToMonday);

    const end = new Date(start);
    end.setDate(start.getDate() + 13);

    const startDate = start.toISOString().slice(0, 10);
    const endDate = end.toISOString().slice(0, 10);

  console.log("loadDriverWork called");
  console.log("driver email:", state.currentUser?.email || null);
  console.log("driver employeeNumber:", driverEmployeeNumber);
  console.log("driver range:", startDate, "→", endDate);

  els.contentArea.innerHTML = `<div class="muted">Loading work…</div>`;

  state.unsubscribeDriverDutySpans = listenDutySpansByDriverAndDateRange(
    driverEmployeeNumber,
    startDate,
    endDate,
    (dutySpans) => {
      state.driverDutySpans = dutySpans || [];
      console.log("driver duty spans loaded:", state.driverDutySpans);
      render();
    },
    (e) => showError(e?.message || "Failed to load duty spans")
  );
}

function formatDutyDate(dateStr) {
  if (!dateStr) return "-";

  const d = new Date(dateStr);
  if (isNaN(d)) return dateStr;

  const options = { day: "2-digit", month: "short", year: "numeric", weekday: "short" };
  return d.toLocaleDateString("en-AU", options);
}

function formatMinutes(mins) {
  if (typeof mins !== "number") return "-";
  const h = String(Math.floor(mins / 60)).padStart(2, "0");
  const m = String(mins % 60).padStart(2, "0");
  return `${h}:${m}`;
}

window.go = go;
function setupMobileMenu() {
  const menuBtn = document.getElementById("menuToggleBtn");
  const sidebar = document.getElementById("sidebar");
  const overlay = document.getElementById("sidebarOverlay");

  if (!menuBtn || !sidebar || !overlay) return;

  const openMenu = () => {
    sidebar.classList.add("open");
    overlay.classList.add("show");
  };

  const closeMenu = () => {
    sidebar.classList.remove("open");
    overlay.classList.remove("show");
  };

  menuBtn.onclick = () => {
    if (sidebar.classList.contains("open")) {
      closeMenu();
    } else {
      openMenu();
    }
  };

  overlay.onclick = closeMenu;

  // expose globally for next step
  window.closeMobileMenu = closeMenu;
}

async function registerDriverNotifications(employee) {
  try {
    if (!employee) return;

    const empNo = String(employee.employeeNumber || "").trim();
    if (notificationRegisteredForEmpNo === empNo) {
  console.log("FCM already registered for driver:", empNo);
  return;
}
    const role = String(employee.role || "").trim().toLowerCase();
    const status = String(employee.status || "").trim().toLowerCase();

    if (!empNo || role !== "driver" || status !== "active") return;

    if (!("Notification" in window)) {
      console.log("Notifications not supported in this browser");
      return;
    }

    const permission = await Notification.requestPermission();

    if (permission !== "granted") {
      console.log("Notification permission not granted");
      return;
    }

    const token = await getToken(messaging, {
      vapidKey: FCM_VAPID_KEY
    });

    if (!token) {
      console.log("No FCM token returned");
      return;
    }

    await setDoc(
      doc(db, "employees", empNo),
      {
        fcmToken: token,
        fcmTokenUpdatedAt: serverTimestamp()
      },
      { merge: true }
    );

    console.log("FCM token saved for driver:", empNo);
    notificationRegisteredForEmpNo = empNo;
  } catch (err) {
    console.error("Notification registration failed:", err);
  }
}

/* =========================================================
   Auth Boot
========================================================= */
setupMobileMenu();

onAuthStateChanged(auth, async (u) => {
  state.currentUser = u;

  // ✅ NEW (add this block)
  state.employee = null;

if (u?.email) {
  try {
    console.log("Signed in email:", u.email);
    const emp = await getEmployeeByEmail(u.email);
    state.employee = emp || null;
    console.log("Employee match:", emp);
  } catch (e) {
    console.error("Employee lookup failed", e);
  }
}

  // ❗ KEEP EXISTING (do NOT change yet)
  state.isAdmin =
  !!u &&
  (
    isAdminEmail(u.email) ||
    String(state.employee?.role || "").trim().toLowerCase() === "admin" ||
    String(state.employee?.accessLevel || "").trim().toLowerCase().includes("admin")
  );

  state.isDriver =
  !!u &&
  !!state.employee &&
  String(state.employee?.status || "").trim().toLowerCase() === "active" &&
  (
    String(state.employee?.role || "").trim().toLowerCase() === "driver" ||
    String(state.employee?.accessLevel || "").trim().toLowerCase() === "driver"
  );

renderAuth(
  state.currentUser,
  state.employee,
  () => signInWithPopup(auth, provider),
  () => signOut(auth)
)

  els.contentArea.style.display = u ? "block" : "none";

  stopAllListeners();

if (!u) return;

// ✅ ADD THIS (you are missing it)
state.isDriver =
  !!u &&
  !!state.employee &&
  String(state.employee?.status || "").trim().toLowerCase() === "active" &&
  (
    String(state.employee?.role || "").trim().toLowerCase() === "driver" ||
    String(state.employee?.accessLevel || "").trim().toLowerCase() === "driver"
  );

// ✅ KEEP THIS
if (state.isAdmin) {
  state.activePage = "adminBookings";
  go(state.activePage);
  return;
}

// ✅ KEEP THIS
if (state.isDriver) {
  await registerDriverNotifications(state.employee);

  state.activePage = "myWork";
  go(state.activePage);
  return;
}

// ✅ KEEP THIS
showError("Your account is signed in, but no active employee access was found.");
els.contentArea.innerHTML = `
  <div class="card">
    <h3>Access not configured</h3>
    <div class="muted">Please contact admin to link your email to an active employee record.</div>
</div>
`;
});