import { collection, onSnapshot } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";
import { db } from "./firebase.js";

const $ = (id) => document.getElementById(id);
const norm = (value) => String(value || "").trim().toLowerCase();
const fleetNo = (bus) => String(bus?.fleetNumber || bus?.busNumber || bus?.number || bus?.id || "").trim();
const COLUMN_STORAGE = "pbc.workshop.fleet.columns.v1";
const DENSITY_STORAGE = "pbc.workshop.fleet.density.v1";

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
    key:columnKey(cell.textContent)
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
  const text = String(row.cells?.[header.index]?.textContent || "").trim();
  if (header.key === "odometer") return Number(text.replace(/[^0-9.-]/g, "")) || 0;
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
    const checked = header.key === "fleet" || saved[header.key] !== false;
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
    const hidden = header.key === "action" || (header.key !== "fleet" && saved[header.key] === false);
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
