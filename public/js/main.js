// public/js/main.js
import { onAuthStateChanged, signInWithPopup, signOut } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-auth.js";

import { auth, provider } from "./firebase.js";
import { ADMIN_EMAILS } from "./config.js";
import { state } from "./state.js";
import { normalizeEmail } from "./utils.js";

import { listenShifts, listenLegs, patchShift, patchLeg } from "./db.js";
import { els, showError, renderAuth, renderSidebar, renderMyWork } from "./ui.js";

import { renderShifts } from "./shifts_ui.js";
import { openLegModal } from "./modals.js";

/* =========================================================
   Helpers
========================================================= */
function isAdminEmail(email) {
  return ADMIN_EMAILS.map(normalizeEmail).includes(normalizeEmail(email));
}

function stopAllListeners() {
  if (state.unsubscribeShifts) state.unsubscribeShifts();
  state.unsubscribeShifts = null;

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
  if (state.activePage === "myWork") {
    renderMyWork(
      state.shifts || [],
      { currentUser: state.currentUser, isAdmin: state.isAdmin },
      {
        onConfirm: (shiftId, uiValue) => {
          const dbValue = uiValue === "CONFIRMED" ? "Yes" : "No";
          setShiftConfirmation(shiftId, dbValue);
        }
      }
    );
    return;
  }

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

  if (pageId === "workshopManagement") {
    if (!state.isAdmin) return showError("No admin access");
    stopAllListeners();
    window.location.href = "./workshop.html";
    return;
  }

  if (pageId === "adminDispatchBoard") {
    if (!state.isAdmin) return showError("No admin access");

    stopAllListeners();

    const mod = await import("./dispatch_board.js");
    mod.renderDispatchBoardPage();
    return;
  }

  if (
    pageId === "adminEmployees" ||
    pageId === "adminBuses" ||
    pageId === "adminBookings" ||
    pageId === "adminBlocks" ||
    pageId === "adminBlocksByDate" ||
    pageId === "adminPermanentRuns"
  ) {
    if (!state.isAdmin) return showError("No admin access");

    stopAllListeners();

    const mod = await import("./admin_v2.js");

    if (pageId === "adminEmployees") mod.renderEmployeesPage();
    if (pageId === "adminBuses") mod.renderBusesPage();
    if (pageId === "adminBookings") mod.renderAdminBookings();
    if (pageId === "adminBlocks") mod.renderAdminBlocks();
    if (pageId === "adminBlocksByDate") mod.renderAdminBlocksByDate();
    if (pageId === "adminPermanentRuns") mod.renderAdminPermanentRuns();

    return;
  }

  if (pageId === "allShifts") {
    loadShifts({ mode: "adminAll" });
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

  if (pageId === "myWork") {
    loadShifts({ mode: "driver" });
    return;
  }

  if (pageId === "charters") {
    loadShifts({ mode: "driver" });
    return;
  }

  loadShifts({ mode: "driver" });
}

/* =========================================================
   Auth Boot
========================================================= */
onAuthStateChanged(auth, (u) => {
  state.currentUser = u;
  state.isAdmin = !!u && isAdminEmail(u.email);

  renderAuth(
    { currentUser: state.currentUser, isAdmin: state.isAdmin },
    () => signInWithPopup(auth, provider),
    () => signOut(auth)
  );

  els.contentArea.style.display = u ? "block" : "none";

  stopAllListeners();

  if (!u) return;

  state.activePage = state.isAdmin ? "adminBookings" : "myWork";
  go(state.activePage);
});