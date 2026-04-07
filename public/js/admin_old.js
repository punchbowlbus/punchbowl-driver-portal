import { addShift, addLeg, listenShifts, listenLegs, serverTimestamp } from "./db.js";
import { JOB_TYPES } from "./config.js";
import { els, showError } from "./ui.js";
import { normalizeEmail, getActor } from "./utils.js";
import { auth } from "./firebase.js";

let unsubShifts = null;
let legUnsubs = {};
let shiftsCache = [];
let legsByShift = {};

export function renderAdminPanel() {
  showError("");

  els.contentArea.innerHTML = `
    <h3 style="margin-top:0">Admin – Shift Planner</h3>

    <div class="card" style="background:#fafafa">
      <h4>Create Shift (Depot → Depot)</h4>

      <div class="grid">
        <div>
          <div class="muted">Date *</div>
          <input id="shiftDate" placeholder="2026-03-05" />
        </div>

        <div>
          <div class="muted">Driver Email *</div>
          <input id="shiftDriverEmail" placeholder="driver@gmail.com" />
        </div>

        <div>
          <div class="muted">Driver Name</div>
          <input id="shiftDriverName" placeholder="Tony" />
        </div>

        <div>
          <div class="muted">Depot Start *</div>
          <input id="shiftDepotStart" placeholder="07:00" />
        </div>

        <div>
          <div class="muted">Depot Finish *</div>
          <input id="shiftDepotFinish" placeholder="16:10" />
        </div>
      </div>

      <div style="margin-top:10px">
        <button id="createShiftBtn">Create Shift</button>
      </div>
    </div>

    <div style="height:16px"></div>

    <div id="shiftList"></div>

    <div id="modalHost"></div>
  `;

  document.getElementById("createShiftBtn").onclick = createShift;

  startListeners();
}

function startListeners() {
  if (unsubShifts) unsubShifts();
  Object.values(legUnsubs).forEach(fn => fn && fn());
  legUnsubs = {};
  legsByShift = {};
  shiftsCache = [];

  unsubShifts = listenShifts(
    { isAdmin: true, driverEmail: "" },
    (shifts) => {
      shiftsCache = shifts.filter(s => !s.deleted);

      for (const s of shiftsCache) {
        if (!legUnsubs[s.id]) {
          legUnsubs[s.id] = listenLegs(
            s.id,
            (legs) => {
              legsByShift[s.id] = legs;
              renderShiftList();
            },
            (e) => showError(e?.message || "Leg load failed")
          );
        }
      }

      renderShiftList();
    },
    (e) => showError(e?.message || "Shift load failed")
  );
}

function renderShiftList() {
  const host = document.getElementById("shiftList");

  if (!shiftsCache.length) {
    host.innerHTML = `<div class="muted">No shifts yet.</div>`;
    return;
  }

  host.innerHTML = shiftsCache.map(s => {
    const legs = (legsByShift[s.id] || []).filter(l => !l.deleted);

    return `
      <div class="card" style="margin-top:12px">
        <div class="row">
          <div>
            <div style="font-weight:900">${s.date} • ${s.depotStartTime} → ${s.depotFinishTime}</div>
            <div class="muted">${s.driverEmail} ${s.driverName ? `(${s.driverName})` : ""}</div>
            <div class="muted" style="margin-top:6px">Legs: ${legs.length}</div>
          </div>

          <div>
            <button data-add-leg="${s.id}">Add Leg</button>
          </div>
        </div>
      </div>
    `;
  }).join("");

  [...host.querySelectorAll("button[data-add-leg]")].forEach(btn => {
    btn.onclick = () => openLegModal(btn.getAttribute("data-add-leg"));
  });
}

async function createShift() {
  showError("");

  const a = getActor(auth);

  const payload = {
    date: document.getElementById("shiftDate").value.trim(),
    driverEmail: normalizeEmail(document.getElementById("shiftDriverEmail").value),
    driverName: document.getElementById("shiftDriverName").value.trim(),
    depotStartTime: document.getElementById("shiftDepotStart").value.trim(),
    depotFinishTime: document.getElementById("shiftDepotFinish").value.trim(),
    confirmation: "PENDING",

    createdAt: serverTimestamp(),
    createdByUid: a.uid,
    createdByEmail: a.email,
    updatedAt: serverTimestamp(),
    updatedByUid: a.uid,
    updatedByEmail: a.email,

    deleted: false
  };

  if (!payload.date) return showError("Date required.");
  if (!payload.driverEmail) return showError("Driver Email required.");
  if (!payload.depotStartTime) return showError("Depot Start required.");
  if (!payload.depotFinishTime) return showError("Depot Finish required.");

  try {
    await addShift(payload);
    alert("Shift created ✅");
  } catch (e) {
    showError(e?.message || "Create failed");
  }
}

function openLegModal(shiftId) {
  const shift = shiftsCache.find(s => s.id === shiftId);
  if (!shift) return;

  const existing = (legsByShift[shiftId] || []).filter(l => !l.deleted);
  const nextSeq = existing.length + 1;

  document.getElementById("modalHost").innerHTML = `
    <div style="
      position:fixed; inset:0;
      background:rgba(0,0,0,0.5);
      display:flex; align-items:center; justify-content:center;
      z-index:9999;
    ">
      <div style="background:#fff;padding:18px;border-radius:12px;max-width:700px;width:100%">
        <h3>Add Leg</h3>

        <div class="grid">
          <div>
            <div class="muted">Seq</div>
            <input id="legSeq" value="${nextSeq}" />
          </div>

          <div>
            <div class="muted">Type</div>
            <select id="legType">
              ${JOB_TYPES.map(t => `<option value="${t}">${t}</option>`).join("")}
            </select>
          </div>

          <div>
            <div class="muted">Start *</div>
            <input id="legStart" placeholder="07:29" />
          </div>

          <div>
            <div class="muted">End *</div>
            <input id="legEnd" placeholder="08:10" />
          </div>

          <div style="grid-column:1/-1">
            <div class="muted">Description *</div>
            <input id="legDesc" placeholder="School run / Charter..." />
          </div>
        </div>

        <div style="margin-top:12px;display:flex;gap:10px;justify-content:flex-end">
          <button id="cancelLeg">Cancel</button>
          <button id="saveLeg">Save</button>
        </div>
      </div>
    </div>
  `;

  document.getElementById("cancelLeg").onclick = () => {
    document.getElementById("modalHost").innerHTML = "";
  };

  document.getElementById("saveLeg").onclick = async () => {
    const a = getActor(auth);

    const payload = {
      shiftId,
      seq: Number(document.getElementById("legSeq").value),
      jobType: document.getElementById("legType").value,
      startTime: document.getElementById("legStart").value.trim(),
      endTime: document.getElementById("legEnd").value.trim(),
      jobDescription: document.getElementById("legDesc").value.trim(),

      createdAt: serverTimestamp(),
      createdByUid: a.uid,
      createdByEmail: a.email,
      updatedAt: serverTimestamp(),
      updatedByUid: a.uid,
      updatedByEmail: a.email,

      deleted: false
    };

    if (!payload.startTime) return showError("Start required.");
    if (!payload.endTime) return showError("End required.");
    if (!payload.jobDescription) return showError("Description required.");

    try {
      await addLeg(payload);
      document.getElementById("modalHost").innerHTML = "";
      alert("Leg added ✅");
    } catch (e) {
      showError(e?.message || "Leg save failed");
    }
  };
}