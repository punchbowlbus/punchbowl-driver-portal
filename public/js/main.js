// public/js/main.js
import { onAuthStateChanged, signInWithPopup, signOut } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-auth.js";

import { auth, provider } from "./firebase.js";
import { ADMIN_EMAILS } from "./config.js";
import { state } from "./state.js";
import { normalizeEmail } from "./utils.js";

import { listenShifts, listenLegs, patchShift, patchLeg } from "./db.js";
import { els, showError, renderAuth, renderSidebar } from "./ui.js";

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
      try { fn?.(); } catch {}
    });
  }

  state.unsubscribeLegsByShiftId = {};
}

/* =========================================================
   Actions
========================================================= */
async function setShiftConfirmation(shiftId, value) {
  showError("");
  try {
    await patchShift(shiftId, {
      confirmation: value,
      confirmationAt: new Date(),
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
  const isAdminViewAll =
    state.isAdmin &&
    state.activePage === "allShifts";

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
   Navigation (FIXED)
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

    const mod = await import("./dispatch_board.js");
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

  if (pageId === "charters") {
    loadShifts({ mode: "driver" });
    return;
  }

  if (pageId === "notice") {
    renderPlaceholder("Notice Board", "Coming soon...");
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

  state.activePage = state.isAdmin ? "adminBookings" : "charters";
  go(state.activePage);
});