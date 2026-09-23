import { collection, onSnapshot } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";
import { db } from "./firebase.js";

const $ = (id) => document.getElementById(id);
const norm = (value) => String(value || "").trim().toLowerCase();
const esc = (value) => String(value ?? "").replace(/[&<>'\"]/g, (char) => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'\"':"&quot;"}[char]));
const fleetNo = (bus) => String(bus?.fleetNumber || bus?.busNumber || bus?.number || bus?.id || "").trim();
const COLUMN_STORAGE = "pbc.workshop.fleet.columns.v1";
const DENSITY_STORAGE = "pbc.workshop.fleet.density.v1";
const OPTIONAL_COLUMNS = [
  {key:"registration-expiry", label:"Registration Expiry", defaultVisible:false, render:registrationExpiryHtml, sortValue:registrationExpirySortValue},
  {key:"year", label:"Year", value:(bus) => bus.year},
  {key:"make", label:"Make", value:(bus) => bus.make},
  {key:"model", label:"Model", value:(bus) => bus.model},
  {key:"fuel-type", label:"Fuel Type", value:(bus) => bus.fuelType || bus.fuel},
  {key:"access-type", label:"Access Type", value:(bus) => bus.accessType},
  {key:"seat-capacity", label:"Seat Capacity", value:(bus) => bus.seatCount},
  {key:"standing-capacity", label:"Standing Capacity", value:(bus) => bus.standCount},
  {key:"vin-chassis", label:"VIN / Chassis", value:(bus) => bus.vin || bus.chassisNumber},
  {key:"body-manufacturer", label:"Body Manufacturer", value:(bus) => bus.bodyBy || bus.bodyManufacturer},
  {key:"body-model", label:"Body Model", value:(bus) => bus.bodyModel},
  {key:"colour", label:"Colour", value:(bus) => bus.colour || bus.color},
  {key:"euro-standard", label:"Euro Standard", value:(bus) => bus.euro || bus.euroStandard},
  {key:"adblue", label:"AdBlue", value:(bus) => bus.adblue},
  {key:"air-conditioned", label:"Air Conditioned", value:(bus) => bus.airConditioned},
  {key:"rear-door", label:"Rear Door", value:(bus) => bus.rearDoor},
  {key:"cctv", label:"CCTV", value:(bus) => bus.cctvCount},
  {key:"fire-suppression-fitted", label:"Fire Suppression Fitted", value:(bus) => bus.fireSuppression},
  {key:"luggage-bins", label:"Luggage Bins", value:(bus) => bus.luggageBins},
  {key:"tare", label:"Tare", value:(bus) => bus.tare},
  {key:"gvm", label:"GVM", value:(bus) => bus.gvm}
];
const OPTIONAL_COLUMN_KEYS = new Set(OPTIONAL_COLUMNS.map((column) => column.key));
const OPTIONAL_COLUMN_MAP = new Map(OPTIONAL_COLUMNS.map((column) => [column.key, column]));
const NUMERIC_COLUMN_KEYS = new Set(["odometer","year","seat-capacity","standing-capacity","cctv","tare","gvm"]);

let buses = [];
let sortState = {key:"fleet", direction:"asc"};
let refreshTimer = null;
let tableObserver = null;

function columnKey(label) {
  return norm(label).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function currentHeaders() {
  const row = $("fleetView")?.querySelector("table thead tr");
  if (!row) return [];
  return [...row.cells].map((cell, index) => ({
    cell,
    index,
    label:String(cell.textContent || "").trim(),
    key:cell.dataset.columnKey || columnKey(cell.textContent)
  }));
}

function savedColumns() {
  try {
    const parsed = JSON.parse(localStorage.getItem(COLUMN_STORAGE) || "null");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function setSavedColumns(value) {
  localStorage.setItem(COLUMN_STORAGE, JSON.stringify(value));
}

function injectStyles() {
  if ($("fleetRegistryControlStyles")) return;
  const style = document.createElement("style");
  style.id = "fleetRegistryControlStyles";
  style.textContent = `
    .fleet-register-controls{display:grid;grid-template-columns:minmax(170px,1fr) minmax(150px,.8fr) minmax(150px,.8fr) minmax(180px,1fr) auto auto;gap:10px;align-items:end;margin:0 0 14px;padding:14px;border:1px solid #dfe5ec;border-radius:14px;background:#fff;box-shadow:0 5px 18px rgba(16,24,40,.04)}
    .fleet-register-filter{display:grid;gap:5px}.fleet-register-filter>span{font-size:10px;font-weight:900;letter-spacing:.06em;text-transform:uppercase;color:#667085}
    .fleet-register-filter select{min-height:40px;border:1px solid #cfd6dd;border-radius:9px;background:#fff;padding:8px 34px 8px 10px;color:#101828;font-weight:700}
    .fleet-register-actions{display:flex;gap:8px;align-items:center;position:relative}
    .fleet-register-button{min-height:40px;border:1px solid #cfd6dd;border-radius:9px;background:#fff;color:#344054;padding:8px 12px;font-weight:800;cursor:pointer;white-space:nowrap}
    .fleet-register-button:hover{border-color:#98a2b3;background:#f8fafc}.fleet-register-button[aria-expanded="true"]{border-color:#c62828;box-shadow:0 0 0 3px rgba(198,40,40,.1)}
    .fleet-column-menu{position:absolute;z-index:30;right:0;top:46px;width:270px;padding:12px;border:1px solid #d0d5dd;border-radius:12px;background:#fff;box-shadow:0 16px 40px rgba(16,24,40,.18)}
    .fleet-column-menu-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px}.fleet-column-menu-head strong{font-size:13px}.fleet-column-menu-head button{border:0;background:none;color:#175cd3;font-size:12px;font-weight:800;cursor:pointer}
    .fleet-column-options{display:grid;gap:2px;max-height:340px;overflow:auto}.fleet-column-option{display:flex;align-items:center;gap:9px;padding:8px;border-radius:8px;font-size:13px;font-weight:700;color:#344054}.fleet-column-option:hover{background:#f8fafc}.fleet-column-option input{width:16px;height:16px;accent-color:#c62828}
    .fleet-register-summary{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:-2px 0 10px;color:#667085;font-size:12px}.fleet-register-summary strong{color:#101828}
    #fleetView table thead th[data-fleet-sort]{cursor:pointer;user-select:none;white-space:nowrap}#fleetView table thead th[data-fleet-sort]:hover{background:#eef2f6;color:#101828}
    #fleetView table thead th[data-sort-direction="asc"]::after{content:"  ▲";font-size:8px;color:#c62828}#fleetView table thead th[data-sort-direction="desc"]::after{content:"  ▼";font-size:8px;color:#c62828}
    #fleetView .table-wrap{max-height:calc(100vh - 310px);min-height:340px;overflow:auto}#fleetView table thead{position:sticky;top:0;z-index:5}#fleetView table thead th{box-shadow:0 1px 0 #dfe5ec}
    #fleetView[data-density="compact"] .wf-clean-row td{padding-top:9px;padding-bottom:9px}#fleetView[data-density="comfortable"] .wf-clean-row td{padding-top:20px;padding-bottom:20px}
    #fleetView tr[data-fleet-filtered="true"]{display:none!important}
    @media(max-width:1180px){.fleet-register-controls{grid-template-columns:repeat(3,minmax(150px,1fr))}.fleet-register-actions{justify-content:flex-start}}
    @media(max-width:720px){.fleet-register-controls{grid-template-columns:1fr 1fr}.fleet-register-actions{grid-column:1/-1}.fleet-register-summary{align-items:flex-start;flex-direction:column}}
    @media(max-width:480px){.fleet-register-controls{grid-template-columns:1fr}}
  `;
  document.head.appendChild(style);
}

function optionValues(field) {
  return [...new Set(buses.map((bus) => String(bus?.[field] || "").trim()).filter(Boolean))]
    .sort((a,b) => a.localeCompare(b, undefined, {numeric:true}));
}

function fillSelect(select, values, placeholder) {
  if (!select) return;
  const selected = select.value;
  select.innerHTML = `<option value="">${placeholder}</option>${values.map((value) => `<option value="${value.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/\"/g,"&quot;")}">${value.replace(/&/g,"&amp;").replace(/</g,"&lt;")}</option>`).join("")}`;
  if ([...select.options].some((option) => option.value === selected)) select.value = selected;
}

function ensureControls() {
  const view = $("fleetView");
  const panel = view?.querySelector(".table-panel");
  if (!view || !panel) return;
  injectStyles();
  if (!$("fleetRegisterControls")) {
    const controls = document.createElement("div");
    controls.id = "fleetRegisterControls";
    controls.className = "fleet-register-controls";
    controls.innerHTML = `
      <label class="fleet-register-filter"><span>Depot</span><select id="fleetRegisterDepot"><option value="">All depots</option></select></label>
      <label class="fleet-register-filter"><span>Vehicle status</span><select id="fleetRegisterStatus"><option value="">All statuses</option></select></label>
      <label class="fleet-register-filter"><span>Fuel type</span><select id="fleetRegisterFuel"><option value="">All fuel types</option></select></label>
      <label class="fleet-register-filter"><span>Maintenance</span><select id="fleetRegisterMaintenance"><option value="">All maintenance states</option><option value="critical">Critical / overdue</option><option value="attention">Planning / attention</option><option value="on-track">On track</option><option value="not-set">Not set</option></select></label>
      <label class="fleet-register-filter"><span>Row density</span><select id="fleetRegisterDensity"><option value="compact">Compact</option><option value="standard">Standard</option><option value="comfortable">Comfortable</option></select></label>
      <div class="fleet-register-actions">
        <button id="fleetClearFilters" class="fleet-register-button" type="button">Clear filters</button>
        <button id="fleetColumnsButton" class="fleet-register-button" type="button" aria-expanded="false">Columns ▾</button>
        <div id="fleetColumnMenu" class="fleet-column-menu" hidden>
          <div class="fleet-column-menu-head"><strong>Visible columns</strong><button id="fleetResetColumns" type="button">Reset</button></div>
          <div id="fleetColumnOptions" class="fleet-column-options"></div>
        </div>
      </div>`;
    panel.insertAdjacentElement("beforebegin", controls);

    const summary = document.createElement("div");
    summary.className = "fleet-register-summary";
    summary.innerHTML = `<span id="fleetRegisterResultCount"><strong>0</strong> vehicles</span><span>Click a heading to sort · Double-click a row to open the full record</span>`;
    panel.insertAdjacentElement("beforebegin", summary);

    ["fleetRegisterDepot","fleetRegisterStatus","fleetRegisterFuel","fleetRegisterMaintenance"].forEach((id) => $(id)?.addEventListener("change", scheduleRefresh));
    $("fleetRegisterDensity").value = localStorage.getItem(DENSITY_STORAGE) || "standard";
    $("fleetRegisterDensity").addEventListener("change", () => {
      localStorage.setItem(DENSITY_STORAGE, $("fleetRegisterDensity").value);
      applyDensity();
    });
    $("fleetClearFilters").onclick = clearFilters;
    $("fleetColumnsButton").onclick = (event) => {
      event.stopPropagation();
      const menu = $("fleetColumnMenu");
      menu.hidden = !menu.hidden;
      $("fleetColumnsButton").setAttribute("aria-expanded", String(!menu.hidden));
      if (!menu.hidden) syncColumnMenu();
    };
    $("fleetColumnMenu").addEventListener("click", (event) => event.stopPropagation());
    $("fleetResetColumns").onclick = () => { localStorage.removeItem(COLUMN_STORAGE); syncColumnMenu(); applyColumns(); };
    document.addEventListener("click", () => {
      const menu = $("fleetColumnMenu");
      if (menu && !menu.hidden) {
        menu.hidden = true;
        $("fleetColumnsButton")?.setAttribute("aria-expanded", "false");
      }
    });
    $("fleetSearch")?.addEventListener("input", scheduleRefresh);
  }
  fillSelect($("fleetRegisterDepot"), optionValues("depot"), "All depots");
  fillSelect($("fleetRegisterStatus"), optionValues("status"), "All statuses");
  fillSelect($("fleetRegisterFuel"), [...new Set(buses.map((bus) => String(bus.fuelType || bus.fuel || "").trim()).filter(Boolean))].sort(), "All fuel types");
  applyDensity();
}

function applyDensity() {
  const view = $("fleetView");
  if (view) view.dataset.density = $("fleetRegisterDensity")?.value || "standard";
}

function busForRow(row) {
  const number = row.cells?.[0]?.querySelector("strong")?.textContent?.trim() || row.cells?.[0]?.textContent?.trim() || "";
  return buses.find((bus) => norm(fleetNo(bus)) === norm(number));
}

function optionalValue(column, bus) {
  const value = column.value(bus);
  return value === "" || value == null ? "—" : String(value);
}

function isoDate(value) {
  const text = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const date = new Date(`${text}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function registrationExpiryValue(bus) {
  const saved = String(bus?.regoExpiryDate || "").trim();
  if (isoDate(saved)) return saved;
  const legacy = String(bus?.regoExpiry || "").trim();
  return isoDate(legacy) ? legacy : "";
}

function registrationExpirySortValue(bus) {
  return registrationExpiryValue(bus) || "9999-12-31";
}

function formatDate(value) {
  const date = isoDate(value);
  return date ? new Intl.DateTimeFormat("en-AU", {day:"2-digit", month:"short", year:"numeric"}).format(date) : "—";
}

function registrationExpiryHtml(bus) {
  const dueValue = registrationExpiryValue(bus);
  const legacy = String(bus?.regoExpiry || "").trim();
  if (!dueValue) {
    return legacy
      ? `<span class="badge warn">DATE NEEDS YEAR</span><div class="list-meta">${esc(legacy)}</div>`
      : `<span class="badge">NOT SET</span><div class="list-meta">Add registration expiry</div>`;
  }
  const today = isoDate(new Date().toLocaleDateString("en-CA"));
  const due = isoDate(dueValue);
  const days = Math.ceil((due - today) / 86400000);
  if (days < 0) return `<span class="badge bad">EXPIRED</span><div class="list-meta">${esc(formatDate(dueValue))} · ${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} overdue</div>`;
  if (days === 0) return `<span class="badge bad">DUE TODAY</span><div class="list-meta">${esc(formatDate(dueValue))}</div>`;
  if (days <= 30) return `<span class="badge warn">DUE SOON</span><div class="list-meta">${esc(formatDate(dueValue))} · ${days} day${days === 1 ? "" : "s"}</div>`;
  if (days <= 90) return `<span class="badge warn">DUE WITHIN 3 MONTHS</span><div class="list-meta">${esc(formatDate(dueValue))} · ${days} days</div>`;
  return `<span class="badge good">ON TRACK</span><div class="list-meta">${esc(formatDate(dueValue))} · Due in ${days} days</div>`;
}

function ensureOptionalColumns() {
  const table = $("fleetView")?.querySelector("table");
  const headRow = table?.querySelector("thead tr");
  const body = $("fleetTableBody");
  if (!headRow || !body) return;

  OPTIONAL_COLUMNS.forEach((column) => {
    let header = currentHeaders().find((item) => item.key === column.key);
    if (!header) {
      const statusHeader = currentHeaders().find((item) => item.key === "status");
      const th = document.createElement("th");
      th.dataset.columnKey = column.key;
      th.dataset.optionalColumn = "true";
      th.textContent = column.label;
      if (statusHeader?.cell) statusHeader.cell.insertAdjacentElement("beforebegin", th);
      else headRow.appendChild(th);
      header = currentHeaders().find((item) => item.key === column.key);
    }
    if (!header) return;

    [...body.rows].forEach((row) => {
      const bus = busForRow(row);
      if (!bus) return;
      let cell = row.querySelector(`[data-optional-cell="${column.key}"]`);
      if (!cell) {
        cell = document.createElement("td");
        cell.dataset.optionalCell = column.key;
        const insertionPoint = row.cells[header.index];
        if (insertionPoint) insertionPoint.insertAdjacentElement("beforebegin", cell);
        else row.appendChild(cell);
      }
      if (column.render) cell.innerHTML = column.render(bus);
      else cell.textContent = optionalValue(column, bus);
      cell.dataset.sortValue = column.sortValue ? String(column.sortValue(bus) || "") : "";
    });
  });
}

function maintenanceClass(row) {
  const text = norm(row.textContent);
  if (/overdue|urgent|expired/.test(text)) return "critical";
  if (/due soon|book |plan |workshop|restricted/.test(text)) return "attention";
  if (/not set/.test(text)) return "not-set";
  return "on-track";
}

function applyFilters() {
  const rows = [...($("fleetTableBody")?.rows || [])];
  const depot = $("fleetRegisterDepot")?.value || "";
  const status = $("fleetRegisterStatus")?.value || "";
  const fuel = $("fleetRegisterFuel")?.value || "";
  const maintenance = $("fleetRegisterMaintenance")?.value || "";
  let visible = 0;
  rows.forEach((row) => {
    const bus = busForRow(row);
    if (!bus) return;
    const matches = (!depot || String(bus.depot || "") === depot)
      && (!status || String(bus.status || "") === status)
      && (!fuel || String(bus.fuelType || bus.fuel || "") === fuel)
      && (!maintenance || maintenanceClass(row) === maintenance);
    row.dataset.fleetFiltered = matches ? "false" : "true";
    if (matches) visible++;
  });
  const total = rows.filter(busForRow).length;
  if ($("fleetRegisterResultCount")) $("fleetRegisterResultCount").innerHTML = `<strong>${visible}</strong> of ${total} vehicles shown`;
}

function cellSortValue(row, header) {
  const cell = row.cells?.[header.index];
  const explicit = String(cell?.dataset.sortValue || "").trim();
  if (explicit) return explicit;
  const text = String(cell?.textContent || "").trim();
  if (NUMERIC_COLUMN_KEYS.has(header.key)) return Number(text.replace(/[^0-9.-]/g, "")) || 0;
  if (header.key === "fleet" || header.key === "rego") return text;
  return text.toLowerCase();
}

function applySort() {
  const body = $("fleetTableBody");
  const header = currentHeaders().find((item) => item.key === sortState.key);
  if (!body || !header) return;
  const rows = [...body.rows].filter(busForRow);
  rows.sort((a,b) => {
    const av = cellSortValue(a, header);
    const bv = cellSortValue(b, header);
    const comparison = typeof av === "number" ? av - bv : String(av).localeCompare(String(bv), undefined, {numeric:true});
    return sortState.direction === "asc" ? comparison : -comparison;
  });
  const current = [...body.rows].filter(busForRow);
  if (rows.some((row, index) => row !== current[index])) rows.forEach((row) => body.appendChild(row));
  currentHeaders().forEach(({cell,key}) => {
    cell.removeAttribute("data-sort-direction");
    if (key === sortState.key) cell.dataset.sortDirection = sortState.direction;
  });
}

function wireSorting() {
  currentHeaders().forEach((header) => {
    if (!header.key || header.key === "action") return;
    header.cell.dataset.fleetSort = header.key;
    header.cell.title = `Sort by ${header.label}`;
    if (header.cell.dataset.sortWired === "1") return;
    header.cell.dataset.sortWired = "1";
    header.cell.addEventListener("click", () => {
      sortState = sortState.key === header.key
        ? {key:header.key, direction:sortState.direction === "asc" ? "desc" : "asc"}
        : {key:header.key, direction:"asc"};
      applySort();
    });
  });
}

function syncColumnMenu() {
  const wrap = $("fleetColumnOptions");
  if (!wrap) return;
  const saved = savedColumns();
  const headers = currentHeaders().filter((header) => header.key !== "action");
  wrap.innerHTML = headers.map((header) => {
    const optional = OPTIONAL_COLUMN_MAP.get(header.key);
    const checked = header.key === "fleet" || (optional ? (saved[header.key] ?? optional.defaultVisible === true) : saved[header.key] !== false);
    return `<label class="fleet-column-option"><input type="checkbox" data-column-key="${header.key}" ${checked ? "checked" : ""} ${header.key === "fleet" ? "disabled" : ""}> ${header.label}</label>`;
  }).join("");
  wrap.querySelectorAll("[data-column-key]").forEach((input) => input.addEventListener("change", () => {
    const next = savedColumns();
    next[input.dataset.columnKey] = input.checked;
    setSavedColumns(next);
    applyColumns();
  }));
}

function applyColumns() {
  const saved = savedColumns();
  const headers = currentHeaders();
  const rows = [...($("fleetTableBody")?.rows || [])];
  headers.forEach((header) => {
    const optional = OPTIONAL_COLUMN_MAP.get(header.key);
    const optionalVisible = optional ? (saved[header.key] ?? optional.defaultVisible === true) : true;
    const optionalHidden = Boolean(optional) && !optionalVisible;
    const standardHidden = !OPTIONAL_COLUMN_KEYS.has(header.key) && header.key !== "fleet" && saved[header.key] === false;
    const hidden = header.key === "action" || optionalHidden || standardHidden;
    header.cell.style.display = hidden ? "none" : "";
    rows.forEach((row) => { if (row.cells[header.index]) row.cells[header.index].style.display = hidden ? "none" : ""; });
  });
}

function clearFilters() {
  ["fleetRegisterDepot","fleetRegisterStatus","fleetRegisterFuel","fleetRegisterMaintenance"].forEach((id) => { if ($(id)) $(id).value = ""; });
  if ($("fleetSearch")) {
    $("fleetSearch").value = "";
    $("fleetSearch").dispatchEvent(new Event("input", {bubbles:true}));
  } else scheduleRefresh();
}

function refresh() {
  ensureControls();
  ensureOptionalColumns();
  wireSorting();
  applyColumns();
  applyFilters();
  applySort();
}

function scheduleRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(refresh, 25);
}

function observeTable() {
  const table = $("fleetView")?.querySelector("table");
  if (!table || tableObserver) return;
  tableObserver = new MutationObserver(scheduleRefresh);
  tableObserver.observe(table, {childList:true, subtree:true});
}

onSnapshot(collection(db, "buses"), (snapshot) => {
  buses = snapshot.docs.map((item) => ({id:item.id, ...item.data()}));
  scheduleRefresh();
});

ensureControls();
observeTable();
scheduleRefresh();
