import {
  collection,
  doc,
  onSnapshot,
  serverTimestamp,
  updateDoc
} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";

import { auth, db } from "./firebase.js";

let buses = [];
let selectedBus = null;
let observer = null;

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function num(value) {
  if (value === "" || value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function fleetNo(bus) {
  return String(bus?.fleetNumber || bus?.busNumber || bus?.number || bus?.id || "").trim();
}

function isEv(bus) {
  return /\b(ev|electric)\b/i.test(String(bus?.fuelType || bus?.fuel || ""));
}

function formatKm(value) {
  const n = num(value);
  return n == null ? "—" : `${Math.round(n).toLocaleString("en-AU")} km`;
}

function nextServiceTypeFor(vehicleIsEv, lastType) {
  const type = String(lastType || "").trim();
  if (vehicleIsEv) return type === "Small" ? "Large" : "Small";
  if (type === "Small") return "Medium";
  if (type === "Medium") return "Large";
  return "Small";
}

function intervalForType(bus, type) {
  if (type === "Small") return num(bus.serviceSmallIntervalKm ?? bus.serviceIntervalKm);
  if (type === "Medium") return num(bus.serviceMediumIntervalKm);
  if (type === "Large") return num(bus.serviceLargeIntervalKm);
  return null;
}

function showDialogMessage(message, type = "error") {
  const box = document.getElementById("serviceScheduleMessage");
  if (!box) return;
  box.hidden = !message;
  box.className = `status ${type}`;
  box.textContent = message || "";
}

function showPageStatus(message, type = "success") {
  const status = document.getElementById("status");
  if (!status) return;
  status.className = `status ${type}`;
  status.textContent = message;
}

function ensureDialog() {
  if (document.getElementById("serviceScheduleDialog")) return;

  const dialog = document.createElement("dialog");
  dialog.id = "serviceScheduleDialog";
  dialog.className = "dialog";
  dialog.innerHTML = `
    <form id="serviceScheduleForm" method="dialog">
      <div class="dialog-head">
        <div>
          <h2>Service Setup</h2>
          <p id="serviceScheduleBusLabel">Configure service intervals for this vehicle.</p>
        </div>
        <button id="closeServiceScheduleDialog" class="icon-button" type="button">×</button>
      </div>

      <div id="serviceScheduleMessage" class="status" hidden></div>

      <div class="service-setup-summary">
        <div><span>Vehicle type</span><strong id="serviceVehicleType">—</strong></div>
        <div><span>Current odometer</span><strong id="serviceCurrentOdometerLabel">—</strong></div>
        <div><span>Service sequence</span><strong id="serviceSequenceLabel">—</strong></div>
      </div>

      <div class="service-setup-section">
        <h3>Service intervals</h3>
        <p class="hint">Set the odometer interval for each service level. These values are saved separately for this vehicle.</p>
        <div class="form-grid" id="serviceIntervalGrid">
          <label>Small service interval (km)
            <input id="serviceSmallIntervalKm" type="number" min="1" step="1" placeholder="e.g. 10000" required />
          </label>
          <label id="serviceMediumWrap">Medium service interval (km)
            <input id="serviceMediumIntervalKm" type="number" min="1" step="1" placeholder="e.g. 20000" />
          </label>
          <label>Large service interval (km)
            <input id="serviceLargeIntervalKm" type="number" min="1" step="1" placeholder="e.g. 40000" required />
          </label>
        </div>
      </div>

      <div class="service-setup-section">
        <h3>Current service position</h3>
        <div class="form-grid">
          <label>Last completed service
            <select id="lastServiceType">
              <option value="">Not recorded</option>
              <option value="Small">Small</option>
              <option value="Medium">Medium</option>
              <option value="Large">Large</option>
            </select>
          </label>
          <label>Last service odometer
            <input id="lastServiceOdometer" type="number" min="0" step="1" placeholder="km at last completed service" />
          </label>
          <label>Last service date
            <input id="lastServiceDate" type="date" />
          </label>
          <label>Next service
            <select id="nextServiceType">
              <option value="Small">Small</option>
              <option value="Medium">Medium</option>
              <option value="Large">Large</option>
            </select>
          </label>
          <label>Next service odometer
            <input id="nextServiceOdometerPreview" readonly />
          </label>
        </div>
      </div>

      <div class="service-sequence-note" id="serviceSequenceNote"></div>

      <div class="dialog-actions">
        <button id="cancelServiceScheduleBtn" class="button secondary" type="button">Cancel</button>
        <button id="saveServiceScheduleBtn" class="button primary" type="submit">Save Service Setup</button>
      </div>
    </form>
  `;
  document.body.appendChild(dialog);

  const style = document.createElement("style");
  style.textContent = `
    #serviceScheduleDialog{width:min(820px,calc(100vw - 24px));max-height:94vh}
    #serviceScheduleDialog form{max-height:94vh;overflow:auto}
    .service-setup-summary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin:12px 0 16px}
    .service-setup-summary>div{border:1px solid #e4e7ec;border-radius:10px;background:#f8fafc;padding:10px 12px}
    .service-setup-summary span{display:block;color:#667085;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.04em;margin-bottom:4px}
    .service-setup-summary strong{font-size:14px;color:#101828}
    .service-setup-section{border-top:1px solid #e5e7eb;padding-top:14px;margin-top:14px}
    .service-setup-section h3{margin:0 0 4px;font-size:16px}
    .service-sequence-note{margin-top:14px;padding:11px 12px;border:1px solid #d1e9ff;background:#f5fbff;border-radius:10px;color:#344054;font-size:13px;line-height:1.45}
    @media(max-width:700px){
      .service-setup-summary{grid-template-columns:1fr}
      #serviceScheduleDialog .form-grid{grid-template-columns:1fr}
      #serviceScheduleDialog .dialog-actions{position:sticky;bottom:0;background:#fff;padding-top:12px}
      #serviceScheduleDialog .dialog-actions .button{min-height:46px;flex:1}
    }
  `;
  document.head.appendChild(style);

  const form = document.getElementById("serviceScheduleForm");
  const small = document.getElementById("serviceSmallIntervalKm");
  const medium = document.getElementById("serviceMediumIntervalKm");
  const large = document.getElementById("serviceLargeIntervalKm");
  const lastType = document.getElementById("lastServiceType");
  const lastKm = document.getElementById("lastServiceOdometer");
  const nextType = document.getElementById("nextServiceType");

  function updatePreview() {
    if (!selectedBus) return;
    const vehicleIsEv = isEv(selectedBus);
    const type = nextType.value || nextServiceTypeFor(vehicleIsEv, lastType.value);
    const baseKm = num(lastKm.value);
    const interval = type === "Small" ? num(small.value) : type === "Medium" ? num(medium.value) : num(large.value);
    document.getElementById("nextServiceOdometerPreview").value = baseKm != null && interval != null ? String(baseKm + interval) : "";
  }

  [small, medium, large, lastKm, nextType].forEach((el) => {
    el.addEventListener("input", updatePreview);
    el.addEventListener("change", updatePreview);
  });

  lastType.addEventListener("change", () => {
    if (!selectedBus) return;
    nextType.value = nextServiceTypeFor(isEv(selectedBus), lastType.value);
    updatePreview();
  });

  document.getElementById("closeServiceScheduleDialog").addEventListener("click", () => dialog.close());
  document.getElementById("cancelServiceScheduleBtn").addEventListener("click", () => dialog.close());

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!selectedBus) return;
    showDialogMessage("");

    const vehicleIsEv = isEv(selectedBus);
    const current = num(selectedBus.currentOdometer ?? selectedBus.odometer ?? selectedBus.odometerKm);
    const smallKm = num(small.value);
    const mediumKm = num(medium.value);
    const largeKm = num(large.value);
    const lastServiceKm = num(lastKm.value);
    const currentLastType = lastType.value || "";
    const currentNextType = nextType.value || nextServiceTypeFor(vehicleIsEv, currentLastType);

    if (smallKm == null || smallKm <= 0) return showDialogMessage("Enter a valid Small service interval in kilometres.");
    if (!vehicleIsEv && (mediumKm == null || mediumKm <= 0)) return showDialogMessage("Enter a valid Medium service interval in kilometres.");
    if (largeKm == null || largeKm <= 0) return showDialogMessage("Enter a valid Large service interval in kilometres.");
    if (lastServiceKm != null && lastServiceKm < 0) return showDialogMessage("Enter a valid last service odometer reading.");
    if (current != null && lastServiceKm != null && lastServiceKm > current) return showDialogMessage(`Last service odometer cannot be higher than the current odometer (${current.toLocaleString("en-AU")} km).`);
    if (vehicleIsEv && currentNextType === "Medium") return showDialogMessage("EV service sequence uses Small and Large only.");

    const nextInterval = currentNextType === "Small" ? smallKm : currentNextType === "Medium" ? mediumKm : largeKm;
    const nextServiceKm = lastServiceKm != null && nextInterval != null ? lastServiceKm + nextInterval : null;
    const saveBtn = document.getElementById("saveServiceScheduleBtn");

    saveBtn.disabled = true;
    saveBtn.textContent = "Saving...";

    try {
      await updateDoc(doc(db, "buses", selectedBus.id), {
        serviceProgram: vehicleIsEv ? "EV" : "Diesel",
        serviceSequence: vehicleIsEv ? ["Small", "Large"] : ["Small", "Medium", "Large"],
        serviceSmallIntervalKm: smallKm,
        serviceMediumIntervalKm: vehicleIsEv ? null : mediumKm,
        serviceLargeIntervalKm: largeKm,
        // Keep the old field populated for backwards compatibility with the current dashboard.
        serviceIntervalKm: nextInterval,
        lastServiceType: currentLastType,
        lastServiceOdometer: lastServiceKm,
        lastServiceDate: document.getElementById("lastServiceDate").value || "",
        nextServiceType: currentNextType,
        nextServiceOdometer: nextServiceKm,
        serviceScheduleUpdatedAt: serverTimestamp(),
        serviceScheduleUpdatedBy: String(auth.currentUser?.email || "").trim().toLowerCase()
      });

      showPageStatus(`✓ Service setup saved for ${fleetNo(selectedBus)}. Next service: ${currentNextType}${nextServiceKm != null ? ` at ${formatKm(nextServiceKm)}` : ""}.`);
      dialog.close();
    } catch (error) {
      showDialogMessage(error?.message || "Unable to save service setup.");
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = "Save Service Setup";
    }
  });
}

function openSchedule(bus) {
  ensureDialog();
  selectedBus = bus;
  showDialogMessage("");

  const vehicleIsEv = isEv(bus);
  const current = num(bus.currentOdometer ?? bus.odometer ?? bus.odometerKm);
  const smallKm = num(bus.serviceSmallIntervalKm ?? bus.serviceIntervalKm);
  const mediumKm = num(bus.serviceMediumIntervalKm);
  const largeKm = num(bus.serviceLargeIntervalKm);
  const lastKm = num(bus.lastServiceOdometer);
  const lastType = bus.lastServiceType || "";
  const suggestedNext = bus.nextServiceType || nextServiceTypeFor(vehicleIsEv, lastType);

  document.getElementById("serviceScheduleBusLabel").textContent = `${fleetNo(bus)}${bus.rego ? ` · ${bus.rego}` : ""}`;
  document.getElementById("serviceVehicleType").textContent = vehicleIsEv ? "Electric (EV)" : "Diesel";
  document.getElementById("serviceCurrentOdometerLabel").textContent = formatKm(current);
  document.getElementById("serviceSequenceLabel").textContent = vehicleIsEv ? "Small → Large" : "Small → Medium → Large";
  document.getElementById("serviceSequenceNote").textContent = vehicleIsEv
    ? "EV progression: Small → Large → Small. When a service is Fleet Manager approved, the system will move to the next service level."
    : "Diesel progression: Small → Medium → Large → Small. When a service is Fleet Manager approved, the system will move to the next service level.";

  document.getElementById("serviceSmallIntervalKm").value = smallKm == null ? "" : String(smallKm);
  document.getElementById("serviceMediumIntervalKm").value = mediumKm == null ? "" : String(mediumKm);
  document.getElementById("serviceLargeIntervalKm").value = largeKm == null ? "" : String(largeKm);
  document.getElementById("serviceMediumWrap").hidden = vehicleIsEv;
  document.getElementById("serviceMediumIntervalKm").required = !vehicleIsEv;

  const lastTypeSelect = document.getElementById("lastServiceType");
  const nextTypeSelect = document.getElementById("nextServiceType");
  [...lastTypeSelect.options].forEach((opt) => { if (opt.value === "Medium") opt.hidden = vehicleIsEv; });
  [...nextTypeSelect.options].forEach((opt) => { if (opt.value === "Medium") opt.hidden = vehicleIsEv; });

  lastTypeSelect.value = vehicleIsEv && lastType === "Medium" ? "" : lastType;
  document.getElementById("lastServiceOdometer").value = lastKm == null ? "" : String(lastKm);
  document.getElementById("lastServiceDate").value = bus.lastServiceDate || "";
  nextTypeSelect.value = vehicleIsEv && suggestedNext === "Medium" ? "Small" : suggestedNext;

  const nextInterval = nextTypeSelect.value === "Small" ? smallKm : nextTypeSelect.value === "Medium" ? mediumKm : largeKm;
  document.getElementById("nextServiceOdometerPreview").value = lastKm != null && nextInterval != null ? String(lastKm + nextInterval) : "";

  document.getElementById("serviceScheduleDialog").showModal();
}

function serviceIntervalSummary(bus) {
  const small = intervalForType(bus, "Small");
  const medium = intervalForType(bus, "Medium");
  const large = intervalForType(bus, "Large");
  if (small == null && medium == null && large == null) return "Intervals not configured";
  if (isEv(bus)) return `S ${small == null ? "—" : Number(small).toLocaleString("en-AU")} · L ${large == null ? "—" : Number(large).toLocaleString("en-AU")} km`;
  return `S ${small == null ? "—" : Number(small).toLocaleString("en-AU")} · M ${medium == null ? "—" : Number(medium).toLocaleString("en-AU")} · L ${large == null ? "—" : Number(large).toLocaleString("en-AU")} km`;
}

function enhanceFleetRows() {
  const tbody = document.getElementById("fleetTableBody");
  if (!tbody) return;

  [...tbody.querySelectorAll("tr")].forEach((row) => {
    const cells = row.querySelectorAll("td");
    if (cells.length < 8) return;

    const number = String(cells[0]?.querySelector("strong")?.textContent || cells[0]?.textContent || "").trim();
    const bus = buses.find((item) => normalize(fleetNo(item)) === normalize(number));
    if (!bus) return;

    const serviceCell = cells[5];
    if (serviceCell) {
      let meta = serviceCell.querySelector(".service-interval-meta");
      if (!meta) {
        meta = document.createElement("div");
        meta.className = "list-meta service-interval-meta";
        meta.style.marginTop = "5px";
        serviceCell.appendChild(meta);
      }
      meta.textContent = serviceIntervalSummary(bus);
    }

    const actions = cells[7];
    if (!actions || actions.querySelector("[data-service-setup]")) return;

    actions.style.display = "flex";
    actions.style.gap = "8px";
    actions.style.flexWrap = "wrap";

    const button = document.createElement("button");
    button.type = "button";
    button.className = "button secondary";
    button.dataset.serviceSetup = bus.id;
    button.textContent = "Service setup";
    button.addEventListener("click", () => openSchedule(bus));
    actions.appendChild(button);
  });
}

function watchFleetTable() {
  const tbody = document.getElementById("fleetTableBody");
  if (!tbody) {
    setTimeout(watchFleetTable, 300);
    return;
  }

  if (observer) observer.disconnect();
  observer = new MutationObserver(() => enhanceFleetRows());
  observer.observe(tbody, { childList: true, subtree: true });
  enhanceFleetRows();
}

ensureDialog();
watchFleetTable();

onSnapshot(collection(db, "buses"), (snapshot) => {
  buses = snapshot.docs.map((snap) => ({ id: snap.id, ...snap.data() }));
  enhanceFleetRows();
});
