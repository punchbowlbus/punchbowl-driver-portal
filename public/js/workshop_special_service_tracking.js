import {
  collection,
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc
} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";
import { auth, db } from "./firebase.js";

const $ = (id) => document.getElementById(id);
const norm = (value) => String(value || "").trim().toLowerCase();
const esc = (value) => String(value ?? "").replace(/[&<>'\"]/g, (char) => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'\"':"&quot;"}[char]));

const PROGRAMS = [
  {
    key:"fire",
    title:"Fire Suppression Check",
    shortTitle:"Fire Suppression",
    months:12,
    lastField:"lastFireSuppressionCheckDate",
    nextField:"nextFireSuppressionCheckDate"
  },
  {
    key:"radiator",
    title:"Intercooler / Radiator Wash",
    shortTitle:"Radiator Wash",
    months:6,
    lastField:"lastRadiatorWashDate",
    nextField:"nextRadiatorWashDate"
  }
];

let buses = [];
let pendingFleetSave = null;
let maintenanceObserver = null;
let fleetObserver = null;
let maintenanceTimer = null;
let fleetTimer = null;

function fleetNo(bus) {
  return String(bus?.fleetNumber || bus?.busNumber || bus?.number || bus?.id || "").trim();
}

function todayString(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
}

function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || "").trim());
}

function addMonths(value, months) {
  if (!validDate(value)) return "";
  const [year, month, day] = value.split("-").map(Number);
  const next = new Date(year, month - 1, 1);
  next.setMonth(next.getMonth() + months);
  const lastDay = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
  next.setDate(Math.min(day, lastDay));
  return todayString(next);
}

function formatDate(value) {
  if (!validDate(value)) return "—";
  return new Intl.DateTimeFormat("en-AU", {day:"2-digit", month:"short", year:"numeric"})
    .format(new Date(`${value}T00:00:00`));
}

function daysUntil(value) {
  if (!validDate(value)) return null;
  return Math.round((new Date(`${value}T00:00:00`) - new Date(`${todayString()}T00:00:00`)) / 86400000);
}

function programState(bus, program) {
  const lastDate = String(bus?.[program.lastField] || "").trim();
  const dueDate = String(bus?.[program.nextField] || addMonths(lastDate, program.months)).trim();
  const days = daysUntil(dueDate);
  if (days == null) return {kind:"unset", days:null, dueDate, detail:"Last service date not set"};
  if (days < 0) return {kind:"overdue", days, dueDate, cardClass:"service-card-overdue", detail:`${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} overdue`};
  if (days === 0) return {kind:"overdue", days, dueDate, cardClass:"service-card-overdue", detail:"Due today"};
  if (days <= 7) return {kind:"urgent", days, dueDate, cardClass:"service-card-red", detail:`Due in ${days} day${days === 1 ? "" : "s"}`};
  if (days <= 14) return {kind:"soon", days, dueDate, cardClass:"service-card-orange", detail:`Due in ${days} days`};
  if (days <= 21) return {kind:"book", days, dueDate, cardClass:"service-card-amber", detail:`Due in ${days} days`};
  if (days <= 30) return {kind:"plan", days, dueDate, cardClass:"service-card-blue", detail:`Due in ${days} days`};
  return {kind:"ok", days, dueDate, detail:`Due in ${days} days`};
}

function badge(state, title) {
  if (state.kind === "overdue") return `<span class="badge bad">${state.days === 0 ? "DUE TODAY" : "OVERDUE"}</span>`;
  if (state.kind === "urgent") return `<span class="badge bad">URGENT</span>`;
  if (state.kind === "soon") return `<span class="badge warn">DUE SOON</span>`;
  if (state.kind === "book") return `<span class="badge warn">BOOK ${esc(title).toUpperCase()}</span>`;
  if (state.kind === "plan") return `<span class="badge info">PLAN ${esc(title).toUpperCase()}</span>`;
  if (state.kind === "ok") return `<span class="badge good">ON TRACK</span>`;
  return `<span class="badge">NOT SET</span>`;
}

function dueItems() {
  return buses.flatMap((bus) => PROGRAMS.map((program) => ({bus, program, state:programState(bus, program)})))
    .filter((item) => ["overdue","urgent","soon","book","plan"].includes(item.state.kind))
    .sort((a,b) => String(a.state.dueDate).localeCompare(String(b.state.dueDate)));
}

function ensureDashboardMetrics() {
  const metrics = $("dashboardView")?.querySelector(".metrics-grid");
  if (!metrics || $("metricSpecialServiceDueSoon")) return;
  metrics.insertAdjacentHTML("beforeend", `
    <article class="metric warning"><span>Special Services Due Soon</span><strong id="metricSpecialServiceDueSoon">0</strong></article>
    <article class="metric danger"><span>Special Services Overdue</span><strong id="metricSpecialServiceOverdue">0</strong></article>`);
}

function augmentMaintenanceDue() {
  ensureDashboardMetrics();
  const wrap = $("maintenanceDueList");
  if (!wrap) return;
  const hint = wrap.closest(".panel")?.querySelector(".panel-head .hint");
  if (hint) hint.textContent = "Service, A/C, Fire Suppression, Radiator Wash, 90 Day Safety and Registration due";
  const due = dueItems();
  const signature = due.map(({bus,program,state}) => `${bus.id}:${program.key}:${state.kind}:${state.dueDate}`).join("|");
  const existing = [...wrap.querySelectorAll("[data-special-service-dashboard]")];
  if (wrap.dataset.specialServiceSignature === signature && existing.length === due.length) return;
  existing.forEach((element) => element.remove());
  wrap.dataset.specialServiceSignature = signature;

  if (due.length) {
    [...wrap.querySelectorAll(".empty")].forEach((element) => {
      if (/no .* currently due/i.test(element.textContent || "")) element.remove();
    });
  }

  due.forEach(({bus,program,state}) => {
    const item = document.createElement("div");
    item.className = `list-item ${state.cardClass || ""}`.trim();
    item.dataset.specialServiceDashboard = `${bus.id || fleetNo(bus)}-${program.key}`;
    item.innerHTML = `
      <div class="list-top">
        <div>
          <div class="list-title">${esc(fleetNo(bus))} · ${esc(program.title)}</div>
          <div class="list-meta">${esc(bus.rego || "No registration")} · ${esc(bus.depot || "Depot not set")}</div>
        </div>
        ${badge(state, program.shortTitle)}
      </div>
      <div class="list-meta"><strong>Status:</strong> ${esc(state.detail)} · <strong>Due:</strong> ${esc(formatDate(state.dueDate))}</div>
      <div class="list-meta"><strong>Last completed:</strong> ${esc(formatDate(bus[program.lastField]))}</div>`;
    wrap.appendChild(item);
  });

  const all = buses.flatMap((bus) => PROGRAMS.map((program) => programState(bus, program)));
  if ($("metricSpecialServiceDueSoon")) $("metricSpecialServiceDueSoon").textContent = String(all.filter((state) => ["urgent","soon","book","plan"].includes(state.kind)).length);
  if ($("metricSpecialServiceOverdue")) $("metricSpecialServiceOverdue").textContent = String(all.filter((state) => state.kind === "overdue").length);
}

function findBusForFleetRow(row) {
  const key = row?.cells?.[0]?.querySelector("strong")?.textContent?.trim() || "";
  return buses.find((bus) => norm(fleetNo(bus)) === norm(key));
}

function ensureFleetColumns() {
  const table = $("fleetTableBody")?.closest("table");
  const headRow = table?.querySelector("thead tr");
  if (!headRow) return;
  PROGRAMS.forEach((program) => {
    if (headRow.querySelector(`[data-special-head="${program.key}"]`)) return;
    const th = document.createElement("th");
    th.dataset.specialHead = program.key;
    th.textContent = program.key === "fire" ? "FIRE SUPPRESSION" : "RADIATOR WASH";
    const statusHead = [...headRow.children].find((cell) => /status/i.test(cell.textContent || ""));
    if (statusHead) statusHead.insertAdjacentElement("beforebegin", th);
    else headRow.appendChild(th);
  });
}

function enhanceFleetRows() {
  ensureFleetColumns();
  const body = $("fleetTableBody");
  if (!body) return;
  [...body.querySelectorAll("tr")].forEach((row) => {
    const bus = findBusForFleetRow(row);
    if (!bus) return;
    PROGRAMS.forEach((program) => {
      const state = programState(bus, program);
      let cell = row.querySelector(`[data-special-cell="${program.key}"]`);
      if (!cell) {
        cell = document.createElement("td");
        cell.dataset.specialCell = program.key;
        const statusCell = row.cells[row.cells.length - 2];
        if (statusCell) statusCell.insertAdjacentElement("beforebegin", cell);
        else row.appendChild(cell);
      }
      const signature = `${state.kind}:${state.days}:${state.dueDate}:${bus[program.lastField] || ""}`;
      if (cell.dataset.signature === signature) return;
      cell.dataset.signature = signature;
      cell.innerHTML = `${badge(state, program.shortTitle)}<div class="list-meta" style="margin-top:4px">${esc(state.detail)}</div><div class="list-meta">Due: ${esc(formatDate(state.dueDate))}</div>`;
    });
  });
}

function currentEditedBus() {
  const number = String($("wfFleetNumber")?.value || "").trim();
  return buses.find((bus) => norm(fleetNo(bus)) === norm(number));
}

function ensureFleetEditorFields() {
  const body = $("wfEditBody");
  const notesLabel = $("wfNotes")?.closest("label");
  if (!body || !notesLabel || $("wfLastFireSuppressionCheck")) return;
  const bus = currentEditedBus();
  const section = document.createElement("div");
  section.className = "wf-section-title";
  section.textContent = "Tracked Special Services";
  notesLabel.insertAdjacentElement("beforebegin", section);

  let anchor = section;
  PROGRAMS.forEach((program) => {
    const idPart = program.key === "fire" ? "FireSuppressionCheck" : "RadiatorWash";
    const lastId = `wfLast${idPart}`;
    const nextId = `wfNext${idPart}`;
    const lastLabel = document.createElement("label");
    lastLabel.innerHTML = `Last ${esc(program.title)}<input id="${lastId}" type="date" value="${esc(bus?.[program.lastField] || "")}">`;
    anchor.insertAdjacentElement("afterend", lastLabel);
    const nextLabel = document.createElement("label");
    nextLabel.innerHTML = `Next ${esc(program.title)} Due<input id="${nextId}" type="date" value="${esc(bus?.[program.nextField] || addMonths(bus?.[program.lastField] || "", program.months))}" readonly>`;
    lastLabel.insertAdjacentElement("afterend", nextLabel);
    $(lastId)?.addEventListener("change", () => { if ($(nextId)) $(nextId).value = addMonths($(lastId).value, program.months); });
    anchor = nextLabel;
  });
}

function enhanceFleetDetails() {
  const body = $("wfBusBody");
  if (!body || body.querySelector("[data-special-service-summary]")) return;
  const title = body.querySelector(".wf-title")?.textContent?.trim() || "";
  const bus = buses.find((item) => norm(fleetNo(item)) === norm(title));
  const grid = body.querySelector(".wf-grid");
  if (!bus || !grid) return;
  const card = document.createElement("section");
  card.className = "wf-card";
  card.dataset.specialServiceSummary = "1";
  card.innerHTML = `<h3>Tracked Special Services</h3>${PROGRAMS.map((program) => {
    const state = programState(bus, program);
    return `<div class="wf-kv" style="margin-bottom:12px"><span>${esc(program.title)}</span><span>${badge(state, program.shortTitle)}</span><span>Last completed</span><span>${esc(formatDate(bus[program.lastField]))}</span><span>Next due</span><span>${esc(formatDate(state.dueDate))}</span></div>`;
  }).join("")}`;
  grid.appendChild(card);
}

async function savePendingTracking() {
  const pending = pendingFleetSave;
  pendingFleetSave = null;
  if (!pending || !/vehicle .* (updated|created) successfully/i.test($("status")?.textContent || "")) return;
  const bus = buses.find((item) => norm(fleetNo(item)) === norm(pending.fleetNumber));
  const refId = bus?.id || pending.fleetNumber;
  if (!refId) return;
  try {
    await setDoc(doc(db, "buses", refId), {
      lastFireSuppressionCheckDate:pending.fireLast,
      nextFireSuppressionCheckDate:addMonths(pending.fireLast, 12),
      lastRadiatorWashDate:pending.radiatorLast,
      nextRadiatorWashDate:addMonths(pending.radiatorLast, 6),
      specialServiceTrackingUpdatedAt:serverTimestamp(),
      specialServiceTrackingUpdatedBy:norm(auth.currentUser?.email)
    }, {merge:true});
  } catch (error) {
    console.error("Unable to save tracked special-service dates", error);
  }
}

function observeAreas() {
  const maintenance = $("maintenanceDueList");
  if (maintenance && !maintenanceObserver) {
    maintenanceObserver = new MutationObserver(() => {
      clearTimeout(maintenanceTimer);
      maintenanceTimer = setTimeout(augmentMaintenanceDue, 0);
    });
    maintenanceObserver.observe(maintenance, {childList:true, subtree:true});
  }
  const fleetBody = $("fleetTableBody");
  if (fleetBody && !fleetObserver) {
    fleetObserver = new MutationObserver(() => {
      clearTimeout(fleetTimer);
      fleetTimer = setTimeout(enhanceFleetRows, 0);
    });
    fleetObserver.observe(fleetBody, {childList:true, subtree:true});
  }
}

document.addEventListener("click", () => setTimeout(() => {
  ensureFleetEditorFields();
  enhanceFleetDetails();
  enhanceFleetRows();
  augmentMaintenanceDue();
}, 30), true);

document.addEventListener("submit", (event) => {
  if (event.target?.id !== "wfEditForm") return;
  pendingFleetSave = {
    fleetNumber:String($("wfFleetNumber")?.value || "").trim(),
    fireLast:String($("wfLastFireSuppressionCheck")?.value || "").trim(),
    radiatorLast:String($("wfLastRadiatorWash")?.value || "").trim()
  };
}, true);

document.addEventListener("close", (event) => {
  if (event.target?.id === "wfEditDialog") setTimeout(savePendingTracking, 0);
}, true);

onSnapshot(collection(db, "buses"), (snapshot) => {
  buses = snapshot.docs.map((item) => ({id:item.id, ...item.data()}));
  augmentMaintenanceDue();
  setTimeout(() => {
    ensureFleetEditorFields();
    enhanceFleetDetails();
    enhanceFleetRows();
    observeAreas();
  }, 30);
});

setTimeout(() => {
  augmentMaintenanceDue();
  enhanceFleetRows();
  observeAreas();
}, 100);
