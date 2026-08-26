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
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function fleetNo(bus) {
  return String(bus?.fleetNumber || bus?.busNumber || bus?.number || bus?.id || "").trim();
}

function formatKm(value) {
  const n = num(value);
  return n == null ? "—" : `${Math.round(n).toLocaleString("en-AU")} km`;
}

function addMonths(dateString, months) {
  if (!dateString || !months) return "";
  const date = new Date(`${dateString}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "";
  date.setMonth(date.getMonth() + months);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
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
          <h2>Service Schedule</h2>
          <p id="serviceScheduleBusLabel">Set the maintenance interval for this bus.</p>
        </div>
        <button id="closeServiceScheduleDialog" class="icon-button" type="button">×</button>
      </div>

      <div class="form-grid">
        <label>Current odometer
          <input id="serviceCurrentOdometer" readonly />
        </label>
        <label>Service interval (km)
          <input id="serviceIntervalKm" type="number" min="1" step="1" placeholder="e.g. 10000 or 15000" required />
        </label>
        <label>Last service odometer
          <input id="lastServiceOdometer" type="number" min="0" step="1" placeholder="km at last completed service" required />
        </label>
        <label>Next service odometer
          <input id="nextServiceOdometerPreview" readonly />
        </label>
        <label>Last service date
          <input id="lastServiceDate" type="date" />
        </label>
        <label>Service interval (months)
          <input id="serviceIntervalMonths" type="number" min="0" step="1" placeholder="Optional, e.g. 6" />
        </label>
        <label class="full">Next service date
          <input id="nextServiceDatePreview" readonly />
        </label>
      </div>

      <div class="hint" style="margin-top:12px">
        The bus becomes due when its kilometre or date limit is reached. Each bus can have a different service interval.
      </div>

      <div class="dialog-actions">
        <button id="cancelServiceScheduleBtn" class="button secondary" type="button">Cancel</button>
        <button id="saveServiceScheduleBtn" class="button primary" type="submit">Save Service Schedule</button>
      </div>
    </form>
  `;
  document.body.appendChild(dialog);

  const form = document.getElementById("serviceScheduleForm");
  const intervalKm = document.getElementById("serviceIntervalKm");
  const lastKm = document.getElementById("lastServiceOdometer");
  const lastDate = document.getElementById("lastServiceDate");
  const intervalMonths = document.getElementById("serviceIntervalMonths");

  function updatePreview() {
    const baseKm = num(lastKm.value);
    const kmInterval = num(intervalKm.value);
    document.getElementById("nextServiceOdometerPreview").value =
      baseKm != null && kmInterval != null ? String(baseKm + kmInterval) : "";

    const months = num(intervalMonths.value);
    document.getElementById("nextServiceDatePreview").value =
      months && lastDate.value ? addMonths(lastDate.value, months) : "";
  }

  [intervalKm, lastKm, lastDate, intervalMonths].forEach((el) => {
    el.addEventListener("input", updatePreview);
    el.addEventListener("change", updatePreview);
  });

  document.getElementById("closeServiceScheduleDialog").addEventListener("click", () => dialog.close());
  document.getElementById("cancelServiceScheduleBtn").addEventListener("click", () => dialog.close());

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!selectedBus) return;

    const current = num(selectedBus.currentOdometer ?? selectedBus.odometer ?? selectedBus.odometerKm);
    const lastServiceKm = num(lastKm.value);
    const kmInterval = num(intervalKm.value);
    const months = num(intervalMonths.value) ?? 0;

    if (lastServiceKm == null || lastServiceKm < 0) {
      alert("Enter a valid last service odometer reading.");
      return;
    }
    if (kmInterval == null || kmInterval <= 0) {
      alert("Enter a valid service interval in kilometres.");
      return;
    }
    if (current != null && lastServiceKm > current) {
      alert(`Last service odometer cannot be higher than the current odometer (${current.toLocaleString("en-AU")} km).`);
      return;
    }

    const nextServiceKm = lastServiceKm + kmInterval;
    const serviceDate = lastDate.value || "";
    const nextDate = serviceDate && months > 0 ? addMonths(serviceDate, months) : "";
    const saveBtn = document.getElementById("saveServiceScheduleBtn");

    saveBtn.disabled = true;
    saveBtn.textContent = "Saving...";

    try {
      await updateDoc(doc(db, "buses", selectedBus.id), {
        serviceIntervalKm: kmInterval,
        serviceIntervalMonths: months,
        lastServiceOdometer: lastServiceKm,
        lastServiceDate: serviceDate,
        nextServiceOdometer: nextServiceKm,
        nextServiceDate: nextDate,
        serviceScheduleUpdatedAt: serverTimestamp(),
        serviceScheduleUpdatedBy: String(auth.currentUser?.email || "").trim().toLowerCase()
      });

      const status = document.getElementById("status");
      if (status) {
        status.className = "status success";
        status.textContent = `Service schedule saved for ${fleetNo(selectedBus)}. Next service: ${formatKm(nextServiceKm)}${nextDate ? ` or ${nextDate}` : ""}.`;
      }
      dialog.close();
    } catch (error) {
      alert(error?.message || "Unable to save service schedule.");
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = "Save Service Schedule";
    }
  });
}

function openSchedule(bus) {
  ensureDialog();
  selectedBus = bus;

  const current = num(bus.currentOdometer ?? bus.odometer ?? bus.odometerKm);
  const interval = num(bus.serviceIntervalKm);
  const lastKm = num(bus.lastServiceOdometer);
  const months = num(bus.serviceIntervalMonths) ?? 0;

  document.getElementById("serviceScheduleBusLabel").textContent =
    `${fleetNo(bus)}${bus.rego ? ` · ${bus.rego}` : ""}`;
  document.getElementById("serviceCurrentOdometer").value = current == null ? "" : String(current);
  document.getElementById("serviceIntervalKm").value = interval == null ? "" : String(interval);
  document.getElementById("lastServiceOdometer").value = lastKm == null ? "" : String(lastKm);
  document.getElementById("lastServiceDate").value = bus.lastServiceDate || "";
  document.getElementById("serviceIntervalMonths").value = months ? String(months) : "";
  document.getElementById("nextServiceOdometerPreview").value =
    lastKm != null && interval != null ? String(lastKm + interval) : "";
  document.getElementById("nextServiceDatePreview").value =
    bus.lastServiceDate && months > 0 ? addMonths(bus.lastServiceDate, months) : "";

  document.getElementById("serviceScheduleDialog").showModal();
}

function enhanceFleetRows() {
  const tbody = document.getElementById("fleetTableBody");
  if (!tbody) return;

  [...tbody.querySelectorAll("tr")].forEach((row) => {
    const cells = row.querySelectorAll("td");
    if (cells.length < 8) return;

    const number = String(cells[0]?.textContent || "").trim();
    const bus = buses.find((item) => normalize(fleetNo(item)) === normalize(number));
    if (!bus) return;

    const serviceCell = cells[5];
    if (serviceCell && !serviceCell.querySelector(".service-interval-meta")) {
      const meta = document.createElement("div");
      meta.className = "list-meta service-interval-meta";
      meta.style.marginTop = "5px";
      meta.textContent = num(bus.serviceIntervalKm) != null
        ? `Every ${Number(bus.serviceIntervalKm).toLocaleString("en-AU")} km`
        : "Interval not configured";
      serviceCell.appendChild(meta);
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
