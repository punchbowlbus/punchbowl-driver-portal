// public/js/main.js
import { onAuthStateChanged, signInWithPopup, signOut } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-auth.js";
import {
  collection,
  addDoc,
  doc,
  setDoc,
  serverTimestamp,
  query,
  where,
  orderBy,
  onSnapshot,
  updateDoc
} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";
import {
  ref,
  uploadBytes,
  getDownloadURL
} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-storage.js";
import { getToken } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-messaging.js";
import { auth, provider, db, messaging, storage } from "./firebase.js";
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

    if (state.unsubscribeJobDetailsBlocks) {
      state.unsubscribeJobDetailsBlocks();
      state.unsubscribeJobDetailsBlocks = null;
    }

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

  function renderEnableNotificationsButton() {
    if (!state.isDriver) return;
    if (!("Notification" in window)) return;
    if (Notification.permission === "granted") return;

    const area = els.contentArea;
    if (!area) return;

    if (document.getElementById("enableNotificationsBtn")) return;

    const wrap = document.createElement("div");
    wrap.style.margin = "0 0 12px 0";

    const btn = document.createElement("button");
    btn.id = "enableNotificationsBtn";
    btn.textContent = "Enable Notifications";
    btn.style.background = "#d21919";
    btn.style.color = "white";
    btn.style.border = "none";
    btn.style.borderRadius = "8px";
    btn.style.padding = "10px 14px";
    btn.style.fontWeight = "700";

    btn.onclick = async () => {
      try {
        btn.disabled = true;
        btn.textContent = "Enabling...";

        await registerPortalNotifications(state.employee);

        alert("Notification permission: " + Notification.permission);

        btn.textContent =
          Notification.permission === "granted"
            ? "Notifications Enabled"
            : "Enable Notifications";

        btn.disabled = false;
      } catch (e) {
        console.error(e);
        alert(e.message || "Notification setup failed");
        btn.disabled = false;
        btn.textContent = "Enable Notifications";
      }
    };

    wrap.appendChild(btn);
    area.prepend(wrap);
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

  renderEnableNotificationsButton();

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

  if (pageId === "newEnquiry") {
    if (!state.isAdmin) return showError("No admin access");
    stopAllListeners();
    window.location.href = "./enquiries.html";
    return;
  }

  if (pageId === "customers") {
    if (!state.isAdmin) return showError("No admin access");
    stopAllListeners();
    window.location.href = "./customers.html";
    return;
  }

  // Dispatch Board
  if (pageId === "adminDispatchBoard") {
    if (!state.isAdmin) return showError("No admin access");

    stopAllListeners();

    const mod = await import("./dispatch_board.js?v=3");
    mod.renderDispatchBoardPage();
    return;
  }

  if (pageId === "settings") {
    if (!state.isAdmin) return showError("No admin access");

    stopAllListeners();
    const mod = await import("./settings.js?v=5");
    await mod.renderSettingsPage();
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

    const mod = await import("./admin_v2.js?v=blocks-by-date-modern-1");

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
      const bulkModule = await import("./bulk_duty_spans.js?v=1");
      await bulkModule.renderBulkDutySpansPage();
      return;
    }
  }

// Admin quick menu
if (pageId === "adminAllJobs") {
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

  if (pageId === "allShifts") {
    renderPlaceholder(
      "Old All Shifts",
      "Something is still calling the old allShifts route."
    );
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
          const dutySpan = (state.driverDutySpans || []).find(
            (item) => item.id === state.selectedJobId
          );

          if (!dutySpan) {
            renderPlaceholder("Duty Sheet", "Duty not found");
            return;
          }

          const dutyDate = String(dutySpan.serviceDate || dutySpan.date || "").trim();
          if (String(state.blocksDate || "") !== dutyDate) {
            state.blocks = null;
            state.blocksDate = dutyDate;
          }

          if (!state.blocks && dutyDate) {
            els.contentArea.innerHTML = `
              <div class="driver-duty-loading card">
                <div class="driver-duty-loading-spinner"></div>
                <strong>Preparing your complete shift…</strong>
                <span>Loading assigned jobs and route details.</span>
              </div>
            `;

            if (state.unsubscribeJobDetailsBlocks) {
              state.unsubscribeJobDetailsBlocks();
              state.unsubscribeJobDetailsBlocks = null;
            }

            const currentDutySpanId = String(dutySpan.id || "");
            state.unsubscribeJobDetailsBlocks = listenBlocksByDate(
              dutyDate,
              (blocks) => {
                state.blocks = blocks || [];
                if (
                  state.activePage === "jobDetails" &&
                  String(state.selectedJobId || "") === currentDutySpanId
                ) {
                  go("jobDetails");
                }
              },
              (error) => showError(error?.message || "Failed to load assigned jobs")
            );
            return;
          }

          const dutySheetModule = await import("./driver_duty_sheet.js?v=6");
          await dutySheetModule.renderDriverDutySheet({
            dutySpan,
            blocks: state.blocks || [],
            isAdmin: state.isAdmin,
            onYes: () => updateDutySpanDriverAcknowledgment(dutySpan.id, "Yes"),
            onNo: () => updateDutySpanDriverAcknowledgment(dutySpan.id, "No"),
            onBack: (adminView) => go(adminView ? "adminAllJobs" : "myWork")
          });
          return;
        }

  // Shared menu
if (pageId === "notice") {
    const canManageNotices = state.isAdmin;

  if (!canManageNotices) {
    els.contentArea.innerHTML = `
      <h2 style="margin-top:0">Notice Board</h2>

      <div class="card" style="max-width:900px;">
        <h3 style="margin-top:0">Notices</h3>

        <div id="existingNotices">
          <div class="muted">Loading notices...</div>
        </div>
      </div>
    `;

    const existingNoticesEl = document.getElementById("existingNotices");

    const noticesQuery = query(
      collection(db, "notices"),
      where("active", "==", true),
      orderBy("createdAt", "desc")
    );

    onSnapshot(noticesQuery, (snapshot) => {
      const notices = snapshot.docs.map((d) => ({
        id: d.id,
        ...d.data()
      }));

      if (!notices.length) {
        existingNoticesEl.innerHTML = `<div class="muted">No notices found.</div>`;
        return;
      }

      existingNoticesEl.innerHTML = notices
        .map((n) => `
          <div class="card" style="margin-top:10px; border-left:6px solid ${
            n.priority === "critical"
              ? "#c62828"
              : n.priority === "warning"
              ? "#ef6c00"
              : n.priority === "good"
              ? "#2e7d32"
              : "#1565c0"
          };">
            <div style="font-weight:900; font-size:16px;">
              ${escapeHtml(n.title || "-")}
            </div>

            <div style="margin-top:8px; white-space:pre-wrap;">
              ${escapeHtml(n.message || "")}
            </div>

            ${
              n.imageUrl
                ? `
                  <div style="margin-top:12px;">
                    <img
                      src="${escapeHtml(n.imageUrl)}"
                      alt="Notice image"
                      style="max-width:100%; border-radius:8px;"
                    />
                  </div>
                `
                : ""
            }

            <div class="muted" style="margin-top:8px;">
              Priority: ${escapeHtml(n.priority || "info")}
            </div>
          </div>
        `)
        .join("");
    });

    return;
  }
  els.contentArea.innerHTML = `
    <h2 style="margin-top:0">Notice Board</h2>

    <div class="card" style="max-width:900px;">
      <h3 style="margin-top:0">Create Notice</h3>

      <div style="margin-top:12px;">
        <div style="font-weight:700; margin-bottom:6px;">Title</div>
        <input id="noticeTitle" type="text" placeholder="Notice title" style="width:100%;" />
      </div>

      <div style="margin-top:12px;">
        <div style="font-weight:700; margin-bottom:6px;">Message</div>
        <textarea id="noticeMessage" placeholder="Write notice message..." style="width:100%; min-height:120px;"></textarea>
      </div>

      <div style="margin-top:12px;">
        <div style="font-weight:700; margin-bottom:6px;">Priority</div>
        <select id="noticePriority" style="width:100%;">
          <option value="info">Information</option>
          <option value="warning">Warning</option>
          <option value="critical">Critical</option>
          <option value="good">Good News</option>
        </select>
      </div>

      <div style="margin-top:12px;">
        <div style="font-weight:700; margin-bottom:6px;">Image</div>
        <input id="noticeImage" type="file" accept="image/*" />
      </div>

      <div style="margin-top:16px;">
        <button id="saveNoticeBtn">Save Notice</button>
      </div>
    </div>

    <div class="card" style="max-width:900px; margin-top:14px;">
      <h3 style="margin-top:0">Driver Preview</h3>

      <div id="noticePreviewCard" class="card" style="border-left:6px solid #1565c0;">
        <div id="previewTitle" style="font-size:18px;font-weight:900;">
          Sample Notice Title
        </div>

        <div style="margin-top:8px;color:#555;">
          Posted today
        </div>

          <div id="previewMessage" style="margin-top:12px; white-space: pre-wrap;">
          This is how the notice message will appear to drivers.
        </div>

        <div style="margin-top:12px;">
          <img
            id="noticePreviewImage"
            alt="Notice Preview"
            style="max-width:100%;display:none;border-radius:8px;"
          />
        </div>
      </div>
    </div>

    <div class="card" style="max-width:900px; margin-top:14px;">
          <h3 style="margin-top:0">Existing Notices</h3>

          <div id="existingNotices">
            <div class="muted">Loading notices...</div>
          </div>
        </div>
  `;

  const titleEl = document.getElementById("noticeTitle");
  const messageEl = document.getElementById("noticeMessage");
  const priorityEl = document.getElementById("noticePriority");
  const imageEl = document.getElementById("noticeImage");
  const previewImage = document.getElementById("noticePreviewImage");

  const previewTitle = document.getElementById("previewTitle");
  const previewMessage = document.getElementById("previewMessage");
  const previewCard = document.getElementById("noticePreviewCard");
  const existingNoticesEl = document.getElementById("existingNotices");
  const noticesQuery = query(
  collection(db, "notices"),
  where("active", "==", true),
  orderBy("createdAt", "desc")
);

onSnapshot(
  noticesQuery,
  (snapshot) => {
    const notices = snapshot.docs.map((d) => ({
      id: d.id,
      ...d.data()
    }));

    if (!notices.length) {
      existingNoticesEl.innerHTML = `<div class="muted">No notices found.</div>`;
      return;
    }

    existingNoticesEl.innerHTML = notices
      .map((n) => `
        <div class="card" style="margin-top:10px; border-left:6px solid ${
          n.priority === "critical"
            ? "#c62828"
            : n.priority === "warning"
            ? "#ef6c00"
            : n.priority === "good"
            ? "#2e7d32"
            : "#1565c0"
        };">
          <div style="font-weight:900; font-size:16px;">
            ${escapeHtml(n.title || "-")}
          </div>

          <div style="margin-top:8px; white-space:pre-wrap;">
            ${escapeHtml(n.message || "")}
          </div>
          ${
            n.imageUrl
              ? `
                <div style="margin-top:12px;">
                  <img
                    src="${escapeHtml(n.imageUrl)}"
                    alt="Notice image"
                    style="max-width:100%; border-radius:8px;"
                  />
                </div>
              `
              : ""
          }

          <div style="display:flex; justify-content:space-between; align-items:center; margin-top:8px;">
            <div class="muted">
              Priority: ${escapeHtml(n.priority || "info")}
            </div>

            <button
              class="deleteNoticeBtn"
              data-id="${n.id}"
              style="
                background:#c62828;
                color:white;
                border:none;
                border-radius:6px;
                padding:6px 12px;
                cursor:pointer;
              "
            >
              Delete
            </button>
          </div>
        </div>
      `)
      .join("");

      existingNoticesEl.querySelectorAll(".deleteNoticeBtn").forEach((btn) => {
        btn.onclick = async () => {
          const noticeId = btn.getAttribute("data-id");

          if (!confirm("Delete this notice?")) return;

          try {
            await updateDoc(doc(db, "notices", noticeId), {
              active: false,
              deleted: true,
              deletedAt: serverTimestamp(),
              deletedByEmail: normalizeEmail(state.currentUser?.email || "")
            });

            alert("Notice deleted");
          } catch (e) {
            console.error(e);
            alert("Failed to delete notice");
          }
        };
      });
  },
  (e) => {
    console.error(e);
    existingNoticesEl.innerHTML = `<div class="muted">Failed to load notices.</div>`;
  }
);

  function updatePreview() {
    previewTitle.textContent = titleEl.value.trim() || "Sample Notice Title";

    previewMessage.textContent =
      messageEl.value.trim() ||
      "This is how the notice message will appear to drivers.";

    const priority = priorityEl.value;

    if (priority === "critical") {
      previewCard.style.borderLeft = "6px solid #c62828";
    } else if (priority === "warning") {
      previewCard.style.borderLeft = "6px solid #ef6c00";
    } else if (priority === "good") {
      previewCard.style.borderLeft = "6px solid #2e7d32";
    } else {
      previewCard.style.borderLeft = "6px solid #1565c0";
    }
  }

  titleEl.oninput = updatePreview;
  messageEl.oninput = updatePreview;
  priorityEl.onchange = updatePreview;

  imageEl.onchange = () => {
  const file = imageEl.files?.[0];

  if (!file) {
    previewImage.style.display = "none";
    previewImage.src = "";
    return;
  }

  const reader = new FileReader();

  reader.onload = (e) => {
    previewImage.src = e.target.result;
    previewImage.style.display = "block";
  };

  reader.readAsDataURL(file);
};

  updatePreview();
  const saveBtn = document.getElementById("saveNoticeBtn");

    saveBtn.onclick = async () => {
      try {
        const title = titleEl.value.trim();
        const message = messageEl.value.trim();
        const priority = priorityEl.value;

        if (!title) {
          alert("Please enter a title");
          return;
        }

        if (!message) {
          alert("Please enter a message");
          return;
        }

          let imageUrl = "";

          const imageFile = imageEl.files?.[0];

          if (imageFile) {
            const fileName = `notice-images/${Date.now()}-${imageFile.name}`;

            const storageRef = ref(storage, fileName);

            await uploadBytes(storageRef, imageFile);

            imageUrl = await getDownloadURL(storageRef);
          }

          await addDoc(collection(db, "notices"), {
            title,
            message,
            priority,
            imageUrl,
            active: true,
            createdAt: serverTimestamp(),
            createdByEmail: normalizeEmail(state.currentUser?.email || "")
          });

        alert("Notice saved successfully");

            titleEl.value = "";
            messageEl.value = "";
            priorityEl.value = "info";
            imageEl.value = "";

            previewImage.src = "";
            previewImage.style.display = "none";

            updatePreview();
      } catch (e) {
        console.error(e);
        alert("Failed to save notice");
      }
    };

  return;
}

  if (pageId === "defectReport") {
    stopAllListeners();

    const mod = await import("./defect_reports.js?v=8");
    await mod.renderDefectReportPage();
    return;
  }

  if (pageId === "lostProperty") {
    stopAllListeners();
    const mod = await import("./lost_property.js?v=5");
    await mod.renderLostPropertyPage();
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

async function registerPortalNotifications(employee) {
  try {
    if (!employee) return;

    console.log("PWA notification check started");
    console.log("Notification supported:", "Notification" in window);
    console.log("Current permission:", window.Notification ? Notification.permission : "not-supported");
    console.log("Standalone mode:", window.matchMedia("(display-mode: standalone)").matches);
    console.log("Employee for notification:", employee);

    const empNo = String(employee.employeeNumber || "").trim();
    if (notificationRegisteredForEmpNo === empNo) {
  console.log("FCM already registered for portal user:", empNo);
  return;
}
    const role = String(employee.role || "").trim().toLowerCase();
    const accessLevel = String(employee.accessLevel || "").trim().toLowerCase();
    const department = String(employee.department || "").trim().toLowerCase();
    const status = String(employee.status || "").trim().toLowerCase();

    const canReceivePortalNotifications =
      role === "driver" ||
      role === "dispatcher" ||
      role === "manager" ||
      role === "supervisor" ||
      accessLevel.includes("admin") ||
      department.includes("operation") ||
      department.includes("management");

    if (!empNo || !canReceivePortalNotifications || status !== "active") return;

    if (!("Notification" in window)) {
      console.log("Notifications not supported in this browser");
      return;
    }

    const permission = await Notification.requestPermission();
    console.log("Permission result:", permission);

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

    console.log("FCM token saved for portal user:", empNo);
    notificationRegisteredForEmpNo = empNo;
  } catch (err) {
    console.error("Notification registration failed:", err);
  }
}

window.enablePortalNotifications = () => registerPortalNotifications(state.employee);

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
  await registerPortalNotifications(state.employee);
  state.activePage = "adminBookings";
  go(state.activePage);
  return;
}

// ✅ KEEP THIS
if (state.isDriver) {
  await registerPortalNotifications(state.employee);

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
