import {
  deactivateBus,
  getBus,
  listenBuses,
  saveBus
} from "./db.js";
import { els, showError } from "./ui.js";
import { escapeHtml } from "./utils.js";

let busesUnsub = null;

const ACCESS_TYPES = ["STEPS", "WHEEL CHAIR", "LOW FLOOR"];
const FUEL_TYPES = ["Diesel", "EV", "Hybrid"];
const DEPOTS = ["Hannans", "Bounds", "Olympic Park"];
const STATUSES = ["Active", "In Service", "Workshop", "Out of Service", "Inactive"];
const YES_NO = ["YES", "NO"];

function options(items, placeholder) {
  return [
    `<option value="">${escapeHtml(placeholder)}</option>`,
    ...items.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`)
  ].join("");
}

function statusClass(status) {
  const value = String(status || "").toLowerCase();
  if (value === "active" || value === "in service") return "active";
  if (value === "workshop") return "workshop";
  if (value === "out of service") return "out";
  return "inactive";
}

function parseCsvLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const character = line[i];
    if (character === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (character === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += character;
    }
  }

  result.push(current.trim());
  return result;
}

function normalizeYesNo(value) {
  const normalized = String(value || "").trim().toUpperCase();
  if (["YES", "Y"].includes(normalized)) return "YES";
  if (["NO", "N"].includes(normalized)) return "NO";
  return String(value || "").trim();
}

export function renderBusesPage() {
  showError("");

  if (busesUnsub) {
    busesUnsub();
    busesUnsub = null;
  }

  els.contentArea.innerHTML = `
    <div id="fleetPage" class="fleet-page">
      <header class="fleet-hero">
        <div class="fleet-hero-title">
          <span><i data-lucide="bus-front"></i></span>
          <div>
            <div class="fleet-eyebrow">Fleet management</div>
            <h2>Fleet</h2>
            <p>Manage vehicle records, specifications, depot allocation and service status.</p>
          </div>
        </div>
        <div class="fleet-hero-actions">
          <button id="importBusesBtn" type="button" class="fleet-secondary-btn"><i data-lucide="file-up"></i> Import CSV</button>
          <button id="addBusBtn" type="button" class="fleet-primary-btn"><i data-lucide="plus"></i> Add Vehicle</button>
          <input id="importBusesFile" type="file" accept=".csv,text/csv" hidden />
        </div>
      </header>

      <div id="fleetPageMessage" class="fleet-message" hidden></div>

      <section id="busFormWrap" class="card fleet-form-card" hidden>
        <div class="fleet-form-heading">
          <div>
            <div id="busFormKicker" class="fleet-form-kicker">New vehicle</div>
            <h3 id="busFormTitle">Add Vehicle</h3>
            <p id="busFormSubtitle">Create a vehicle record and enter its operating specifications.</p>
          </div>
          <button id="closeBusFormBtn" type="button" class="fleet-icon-btn" aria-label="Close vehicle form"><i data-lucide="x"></i></button>
        </div>

        <div id="fleetFormMessage" class="fleet-form-message" hidden></div>

        <div class="fleet-form-section">
          <div class="fleet-section-heading"><span>1</span><div><h4>Vehicle identity</h4><p>Fleet number, registration and manufacturer information.</p></div></div>
          <div class="fleet-form-grid">
            <label class="fleet-field"><span>Fleet number <b>*</b></span><input id="busFleetNumber" type="text" maxlength="30" autocomplete="off" /></label>
            <label class="fleet-field"><span>Registration</span><input id="busRego" type="text" maxlength="20" autocomplete="off" /></label>
            <label class="fleet-field"><span>Year</span><input id="busYear" type="number" min="1950" max="2100" inputmode="numeric" /></label>
            <label class="fleet-field"><span>Make</span><input id="busMake" type="text" maxlength="80" /></label>
            <label class="fleet-field"><span>Model</span><input id="busModel" type="text" maxlength="100" /></label>
            <label class="fleet-field"><span>VIN / chassis number</span><input id="busVin" type="text" maxlength="80" /></label>
            <label class="fleet-field"><span>Body manufacturer</span><input id="busBodyBy" type="text" maxlength="80" /></label>
            <label class="fleet-field"><span>Body model</span><input id="busBodyModel" type="text" maxlength="80" /></label>
            <label class="fleet-field"><span>Colour</span><input id="busColour" type="text" maxlength="40" /></label>
            <label class="fleet-field"><span>Registration expiry</span><input id="busRegoExpiry" type="text" maxlength="30" placeholder="DD/MM/YYYY" /></label>
          </div>
        </div>

        <div class="fleet-form-section">
          <div class="fleet-section-heading"><span>2</span><div><h4>Operating details</h4><p>Accessibility, capacity, fuel and vehicle configuration.</p></div></div>
          <div class="fleet-form-grid fleet-form-grid-three">
            <label class="fleet-field"><span>Access type</span><select id="busAccessType">${options(ACCESS_TYPES, "Select access type")}</select></label>
            <label class="fleet-field"><span>Fuel type</span><select id="busFuelType">${options(FUEL_TYPES, "Select fuel type")}</select></label>
            <label class="fleet-field"><span>Euro standard</span><input id="busEuro" type="text" maxlength="30" /></label>
            <label class="fleet-field"><span>AdBlue</span><select id="busAdblue">${options(YES_NO, "Select Yes or No")}</select></label>
            <label class="fleet-field"><span>Air conditioned</span><select id="busAirConditioned">${options(YES_NO, "Select Yes or No")}</select></label>
            <label class="fleet-field"><span>Rear door</span><select id="busRearDoor">${options(YES_NO, "Select Yes or No")}</select></label>
            <label class="fleet-field"><span>Seat capacity</span><input id="busSeatCount" type="number" min="0" inputmode="numeric" /></label>
            <label class="fleet-field"><span>Standing capacity</span><input id="busStandCount" type="number" min="0" inputmode="numeric" /></label>
            <label class="fleet-field"><span>CCTV count</span><input id="busCctvCount" type="number" min="0" inputmode="numeric" /></label>
            <label class="fleet-field"><span>Tare</span><input id="busTare" type="text" maxlength="30" /></label>
            <label class="fleet-field"><span>GVM</span><input id="busGvm" type="text" maxlength="30" /></label>
            <label class="fleet-field"><span>Fire suppression</span><select id="busFireSuppression">${options(YES_NO, "Select Yes or No")}</select></label>
            <label class="fleet-field"><span>Luggage bins</span><select id="busLuggageBins">${options(YES_NO, "Select Yes or No")}</select></label>
          </div>
        </div>

        <div class="fleet-form-section">
          <div class="fleet-section-heading"><span>3</span><div><h4>Allocation and status</h4><p>Set the vehicle's current depot and operational availability.</p></div></div>
          <div class="fleet-form-grid">
            <label class="fleet-field"><span>Depot</span><select id="busDepot">${options(DEPOTS, "Select depot")}</select></label>
            <label class="fleet-field"><span>Vehicle status <b>*</b></span><select id="busStatus">${STATUSES.map((status) => `<option value="${status}">${status}</option>`).join("")}</select></label>
            <label class="fleet-field fleet-full"><span>Notes</span><textarea id="busNotes" maxlength="1000" placeholder="Operational notes, restrictions or vehicle information"></textarea></label>
          </div>
        </div>

        <div class="fleet-form-actions">
          <button id="saveBusBtn" type="button" class="fleet-primary-btn">Save Vehicle</button>
          <button id="cancelBusBtn" type="button" class="btn">Cancel</button>
          <button id="deactivateBusBtn" type="button" class="fleet-danger-btn" hidden>Deactivate Vehicle</button>
        </div>
      </section>

      <section class="card fleet-directory">
        <div class="fleet-directory-heading">
          <div><h3>Fleet Directory</h3><p id="fleetResultCount">Loading vehicles…</p></div>
          <button id="editBusBtn" type="button" class="btn" disabled><i data-lucide="pencil"></i> Edit Selected</button>
        </div>

        <div class="fleet-filters">
          <label class="fleet-search"><span>Search</span><div><i data-lucide="search"></i><input id="busSearch" type="search" placeholder="Fleet number, rego, make or model" /></div></label>
          <label><span>Depot</span><select id="busDepotFilter"><option value="">All depots</option>${DEPOTS.map((depot) => `<option value="${depot}">${depot}</option>`).join("")}</select></label>
          <label><span>Status</span><select id="busStatusFilter"><option value="">All statuses</option>${STATUSES.map((status) => `<option value="${status}">${status}</option>`).join("")}</select></label>
          <button id="clearFleetFilters" type="button" class="btn">Clear filters</button>
        </div>

        <div class="fleet-table-wrap">
          <table class="fleet-table">
            <thead><tr><th>Vehicle</th><th>Access</th><th>Make / model</th><th>Capacity</th><th>Depot</th><th>Status</th></tr></thead>
            <tbody id="busesTableBody"><tr><td colspan="6"><div class="fleet-empty">Loading vehicles…</div></td></tr></tbody>
          </table>
        </div>
        <div id="fleetMobileList" class="fleet-mobile-list"></div>
      </section>
    </div>
  `;

  window.lucide?.createIcons?.();

  const field = (id) => document.getElementById(id);
  const tbody = field("busesTableBody");
  const mobileList = field("fleetMobileList");
  const searchInput = field("busSearch");
  const depotFilter = field("busDepotFilter");
  const statusFilter = field("busStatusFilter");
  const countEl = field("fleetResultCount");
  const formWrap = field("busFormWrap");
  const formTitle = field("busFormTitle");
  const formKicker = field("busFormKicker");
  const formSubtitle = field("busFormSubtitle");
  const pageMessage = field("fleetPageMessage");
  const formMessage = field("fleetFormMessage");
  const addBtn = field("addBusBtn");
  const editBtn = field("editBusBtn");
  const saveBtn = field("saveBusBtn");
  const cancelBtn = field("cancelBusBtn");
  const closeBtn = field("closeBusFormBtn");
  const deactivateBtn = field("deactivateBusBtn");
  const importBtn = field("importBusesBtn");
  const importFile = field("importBusesFile");

  const valueFields = [
    "busFleetNumber", "busRego", "busAccessType", "busYear", "busMake", "busModel",
    "busEuro", "busAdblue", "busFuelType", "busVin", "busAirConditioned", "busTare",
    "busGvm", "busRegoExpiry", "busRearDoor", "busSeatCount", "busStandCount", "busBodyBy",
    "busBodyModel", "busColour", "busCctvCount", "busFireSuppression", "busLuggageBins",
    "busDepot", "busNotes"
  ];

  let busesCache = [];
  let selectedFleetNumber = "";
  let editingBus = null;
  let editMode = false;
  let formDirty = false;

  function showPageMessage(message, type = "success") {
    pageMessage.textContent = message;
    pageMessage.className = `fleet-message ${type}`;
    pageMessage.hidden = !message;
  }

  function showFormMessage(message, type = "error") {
    formMessage.textContent = message;
    formMessage.className = `fleet-form-message ${type}`;
    formMessage.hidden = !message;
    if (message) formMessage.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function clearForm() {
    valueFields.forEach((id) => { if (field(id)) field(id).value = ""; });
    field("busStatus").value = "Active";
    formDirty = false;
    showFormMessage("");
  }

  function fillForm(bus) {
    const values = {
      busFleetNumber: bus.fleetNumber, busRego: bus.rego, busAccessType: bus.accessType,
      busYear: bus.year, busMake: bus.make, busModel: bus.model, busEuro: bus.euro,
      busAdblue: bus.adblue, busFuelType: bus.fuelType, busVin: bus.vin,
      busAirConditioned: bus.airConditioned, busTare: bus.tare, busGvm: bus.gvm,
      busRegoExpiry: bus.regoExpiry, busRearDoor: bus.rearDoor, busSeatCount: bus.seatCount,
      busStandCount: bus.standCount, busBodyBy: bus.bodyBy, busBodyModel: bus.bodyModel,
      busColour: bus.colour, busCctvCount: bus.cctvCount, busFireSuppression: bus.fireSuppression,
      busLuggageBins: bus.luggageBins, busDepot: bus.depot, busStatus: bus.status || "Active",
      busNotes: bus.notes
    };
    Object.entries(values).forEach(([id, value]) => { if (field(id)) field(id).value = value || ""; });
    formDirty = false;
    showFormMessage("");
  }

  function openAddForm() {
    editMode = false;
    editingBus = null;
    clearForm();
    field("busFleetNumber").disabled = false;
    formKicker.textContent = "New vehicle";
    formTitle.textContent = "Add Vehicle";
    formSubtitle.textContent = "Create a vehicle record and enter its operating specifications.";
    saveBtn.textContent = "Save Vehicle";
    deactivateBtn.hidden = true;
    formWrap.hidden = false;
    formWrap.scrollIntoView({ behavior: "smooth", block: "start" });
    setTimeout(() => field("busFleetNumber")?.focus(), 250);
  }

  function openEditForm() {
    if (!selectedFleetNumber) return showPageMessage("Select a vehicle before editing.", "error");
    const bus = busesCache.find((item) => String(item.fleetNumber) === selectedFleetNumber);
    if (!bus) return showPageMessage("The selected vehicle could not be found. Refresh and try again.", "error");

    editMode = true;
    editingBus = bus;
    fillForm(bus);
    field("busFleetNumber").disabled = true;
    formKicker.textContent = `Fleet ${bus.fleetNumber}`;
    formTitle.textContent = `Edit ${bus.fleetNumber}`;
    formSubtitle.textContent = "Update vehicle specifications, allocation and service status.";
    saveBtn.textContent = "Save Changes";
    deactivateBtn.hidden = bus.status === "Inactive";
    formWrap.hidden = false;
    formWrap.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function closeForm(force = false) {
    if (!force && formDirty && !confirm("Discard your unsaved vehicle changes?")) return;
    formWrap.hidden = true;
    clearForm();
    editMode = false;
    editingBus = null;
    field("busFleetNumber").disabled = false;
  }

  function filteredBuses() {
    const query = searchInput.value.trim().toLowerCase();
    const depot = depotFilter.value;
    const status = statusFilter.value;
    return busesCache.filter((bus) => {
      if (depot && bus.depot !== depot) return false;
      if (status && bus.status !== status) return false;
      if (!query) return true;
      return [bus.fleetNumber, bus.rego, bus.make, bus.model, bus.accessType, bus.vin]
        .filter(Boolean).join(" ").toLowerCase().includes(query);
    });
  }

  function selectBus(fleetNumber) {
    selectedFleetNumber = String(fleetNumber || "");
    editBtn.disabled = !selectedFleetNumber;
    showPageMessage("");
    renderDirectory();
  }

  function renderDirectory() {
    const list = filteredBuses();
    countEl.textContent = `${list.length} of ${busesCache.length} vehicles`;

    if (!list.some((bus) => String(bus.fleetNumber) === selectedFleetNumber)) {
      selectedFleetNumber = "";
      editBtn.disabled = true;
    }

    if (!list.length) {
      tbody.innerHTML = `<tr><td colspan="6"><div class="fleet-empty">No vehicles match these filters.</div></td></tr>`;
      mobileList.innerHTML = `<div class="fleet-empty">No vehicles match these filters.</div>`;
      return;
    }

    tbody.innerHTML = list.map((bus) => {
      const selected = String(bus.fleetNumber) === selectedFleetNumber;
      const makeModel = [bus.make, bus.model].filter(Boolean).join(" ") || "—";
      const capacity = bus.seatCount ? `${bus.seatCount} seats${bus.standCount ? ` + ${bus.standCount} standing` : ""}` : "—";
      return `
        <tr data-bus-select="${escapeHtml(bus.fleetNumber)}" class="${selected ? "selected" : ""}">
          <td><div class="fleet-name-cell"><strong>${escapeHtml(bus.fleetNumber || "Unnamed vehicle")}</strong><small>${escapeHtml(bus.rego || "No registration")}</small></div></td>
          <td><span class="fleet-type-badge">${escapeHtml(bus.accessType || "Not set")}</span></td>
          <td>${escapeHtml(makeModel)}</td>
          <td>${escapeHtml(capacity)}</td>
          <td>${escapeHtml(bus.depot || "—")}</td>
          <td><span class="fleet-status ${statusClass(bus.status)}">${escapeHtml(bus.status || "Inactive")}</span></td>
        </tr>`;
    }).join("");

    mobileList.innerHTML = list.map((bus) => {
      const selected = String(bus.fleetNumber) === selectedFleetNumber;
      return `
        <article data-bus-select="${escapeHtml(bus.fleetNumber)}" class="fleet-mobile-card ${selected ? "selected" : ""}">
          <div class="fleet-mobile-head"><div><strong>${escapeHtml(bus.fleetNumber || "Unnamed vehicle")}</strong><small>${escapeHtml(bus.rego || "No registration")}</small></div><span class="fleet-status ${statusClass(bus.status)}">${escapeHtml(bus.status || "Inactive")}</span></div>
          <div class="fleet-mobile-meta"><span>${escapeHtml([bus.make, bus.model].filter(Boolean).join(" ") || "Make not set")}</span><span>${escapeHtml(bus.depot || "No depot")}</span><span>${escapeHtml(bus.accessType || "Access not set")}</span></div>
          ${bus.seatCount ? `<div class="fleet-mobile-capacity">${escapeHtml(bus.seatCount)} seats${bus.standCount ? ` · ${escapeHtml(bus.standCount)} standing` : ""}</div>` : ""}
        </article>`;
    }).join("");

    document.querySelectorAll("[data-bus-select]").forEach((element) => {
      element.onclick = () => selectBus(element.getAttribute("data-bus-select"));
      element.ondblclick = () => {
        selectedFleetNumber = element.getAttribute("data-bus-select") || "";
        openEditForm();
      };
    });
  }

  function readBusForm() {
    return {
      fleetNumber: field("busFleetNumber").value.trim().toUpperCase(),
      rego: field("busRego").value.trim().toUpperCase(),
      accessType: field("busAccessType").value, year: field("busYear").value.trim(),
      make: field("busMake").value.trim(), model: field("busModel").value.trim(),
      euro: field("busEuro").value.trim(), adblue: field("busAdblue").value,
      fuelType: field("busFuelType").value, vin: field("busVin").value.trim(),
      airConditioned: field("busAirConditioned").value, tare: field("busTare").value.trim(),
      gvm: field("busGvm").value.trim(), regoExpiry: field("busRegoExpiry").value,
      rearDoor: field("busRearDoor").value, seatCount: field("busSeatCount").value.trim(),
      standCount: field("busStandCount").value.trim(), bodyBy: field("busBodyBy").value.trim(),
      bodyModel: field("busBodyModel").value.trim(), colour: field("busColour").value.trim(),
      cctvCount: field("busCctvCount").value.trim(), fireSuppression: field("busFireSuppression").value,
      luggageBins: field("busLuggageBins").value, depot: field("busDepot").value,
      status: field("busStatus").value, notes: field("busNotes").value.trim()
    };
  }

  function validateBus(bus) {
    if (!bus.fleetNumber) return "Fleet number is required.";
    if (!/^[A-Z0-9-]+$/.test(bus.fleetNumber)) return "Fleet number can contain only letters, numbers and hyphens.";
    if (bus.year && (Number(bus.year) < 1950 || Number(bus.year) > 2100)) return "Enter a valid vehicle year.";
    if (!bus.status) return "Vehicle status is required.";
    return "";
  }

  function busFromCsvRow(row) {
    const bus = {
      fleetNumber: (row["fleetnumber"] || row["fleet number"] || row["bus no."] || row["bus no"] || "").trim().toUpperCase(),
      rego: (row["rego"] || "").trim().toUpperCase(),
      accessType: (row["accesstype"] || row["access type"] || "").trim().toUpperCase(),
      year: (row["year"] || "").trim(), make: (row["make"] || "").trim(),
      model: (row["model"] || row["year & model"] || "").trim(), euro: (row["euro"] || row["euro #"] || "").trim(),
      adblue: normalizeYesNo(row["adblue"]), fuelType: (row["fueltype"] || row["fuel type"] || "").trim(),
      vin: (row["vin"] || row["vin/chassis no."] || row["vin / chassis no."] || "").trim(),
      airConditioned: normalizeYesNo(row["air conditioned"]), tare: (row["tare"] || "").trim(),
      gvm: (row["gvm"] || "").trim(), regoExpiry: (row["date of rego"] || row["date of rego / expiry"] || row["rego expiry"] || "").trim(),
      rearDoor: normalizeYesNo(row["rear door"]), seatCount: (row["seat"] || row["seat count"] || "").trim(),
      standCount: (row["stand"] || row["stand count"] || "").trim(), bodyBy: (row["body by"] || "").trim(),
      bodyModel: (row["body model"] || "").trim(), colour: (row["colour"] || row["color"] || "").trim(),
      cctvCount: (row["cctv"] || row["cctv count"] || "").trim(), fireSuppression: normalizeYesNo(row["fire supp"] || row["fire suppression"]),
      luggageBins: normalizeYesNo(row["luggage bins"] || row["luggage"]), depot: (row["depot"] || "").trim(),
      status: (row["status"] || "Active").trim(), notes: (row["notes"] || "").trim()
    };
    if (!bus.rego) bus.rego = bus.fleetNumber;
    if (!bus.fuelType) bus.fuelType = String(bus.euro).toUpperCase() === "EV" ? "EV" : "Diesel";
    return bus;
  }

  busesUnsub = listenBuses(
    (buses) => {
      if (!document.getElementById("fleetPage")) {
        busesUnsub?.();
        busesUnsub = null;
        return;
      }
      busesCache = buses || [];
      renderDirectory();
    },
    (error) => {
      console.error("Fleet error", error);
      showPageMessage(error?.message || "Failed to load the fleet.", "error");
    }
  );

  document.querySelectorAll("#busFormWrap input, #busFormWrap select, #busFormWrap textarea").forEach((element) => {
    element.addEventListener("input", () => { formDirty = true; });
    element.addEventListener("change", () => { formDirty = true; });
  });

  addBtn.onclick = openAddForm;
  editBtn.onclick = openEditForm;
  cancelBtn.onclick = () => closeForm();
  closeBtn.onclick = () => closeForm();
  [searchInput, depotFilter, statusFilter].forEach((element) => {
    element.addEventListener(element === searchInput ? "input" : "change", renderDirectory);
  });

  field("clearFleetFilters").onclick = () => {
    searchInput.value = "";
    depotFilter.value = "";
    statusFilter.value = "";
    selectedFleetNumber = "";
    editBtn.disabled = true;
    renderDirectory();
  };

  importBtn.onclick = () => {
    importFile.value = "";
    importFile.click();
  };

  importFile.onchange = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    importBtn.disabled = true;
    importBtn.textContent = "Importing…";
    showPageMessage("");

    try {
      const lines = (await file.text()).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      if (lines.length < 2) throw new Error("The CSV file is empty or has no data rows.");
      const headers = parseCsvLine(lines[0]).map((header) => header.trim().toLowerCase());
      let savedCount = 0;
      let skippedCount = 0;

      for (const line of lines.slice(1)) {
        const columns = parseCsvLine(line);
        const row = {};
        headers.forEach((header, index) => { row[header] = columns[index] || ""; });
        const bus = busFromCsvRow(row);
        if (!bus.fleetNumber) {
          skippedCount++;
          continue;
        }
        await saveBus(bus);
        savedCount++;
      }

      showPageMessage(`Imported ${savedCount} vehicle${savedCount === 1 ? "" : "s"}${skippedCount ? `; skipped ${skippedCount} row${skippedCount === 1 ? "" : "s"} without a fleet number` : ""}.`, "success");
    } catch (error) {
      console.error("Fleet CSV import failed", error);
      showPageMessage(error?.message || "Failed to import the CSV file.", "error");
    } finally {
      importBtn.disabled = false;
      importBtn.innerHTML = `<i data-lucide="file-up"></i> Import CSV`;
      window.lucide?.createIcons?.();
    }
  };

  saveBtn.onclick = async () => {
    showFormMessage("");
    const bus = readBusForm();
    const validationError = validateBus(bus);
    if (validationError) return showFormMessage(validationError);

    try {
      if (!editMode) {
        const existing = await getBus(bus.fleetNumber);
        if (existing) {
          showFormMessage(`Fleet number ${bus.fleetNumber} already exists. Select that vehicle and use Edit Selected.`);
          return;
        }
      }

      const wasEditMode = editMode;
      saveBtn.disabled = true;
      cancelBtn.disabled = true;
      saveBtn.textContent = "Saving…";
      await saveBus(bus);
      selectedFleetNumber = bus.fleetNumber;
      closeForm(true);
      showPageMessage(wasEditMode ? `${bus.fleetNumber} was updated successfully.` : `${bus.fleetNumber} was added to the fleet.`, "success");
    } catch (error) {
      console.error("Failed to save vehicle", error);
      showFormMessage(error?.message || "Unable to save the vehicle. Please try again.");
    } finally {
      saveBtn.disabled = false;
      cancelBtn.disabled = false;
      saveBtn.textContent = editMode ? "Save Changes" : "Save Vehicle";
    }
  };

  deactivateBtn.onclick = async () => {
    if (!editingBus) return;
    if (!confirm(`Deactivate vehicle ${editingBus.fleetNumber}? It will no longer appear as active.`)) return;
    const busBeingDeactivated = editingBus;
    deactivateBtn.disabled = true;
    deactivateBtn.textContent = "Deactivating…";

    try {
      await deactivateBus(busBeingDeactivated.fleetNumber);
      closeForm(true);
      showPageMessage(`${busBeingDeactivated.fleetNumber} was deactivated.`, "success");
    } catch (error) {
      console.error("Failed to deactivate vehicle", error);
      showFormMessage(error?.message || "Unable to deactivate the vehicle.");
    } finally {
      deactivateBtn.disabled = false;
      deactivateBtn.textContent = "Deactivate Vehicle";
    }
  };
}
