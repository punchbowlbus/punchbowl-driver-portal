import {
  collection,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";
import { db } from "./firebase.js";
import { listenBlocksByDate, listenDutySpansByDate } from "./db.js";
import { state } from "./state.js";
import { escapeHtml } from "./utils.js";

const STYLE_ID = "operationsDashboardStyles";

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const link = document.createElement("link");
  link.id = STYLE_ID;
  link.rel = "stylesheet";
  link.href = "./styles/operations_dashboard.css?v=1";
  document.head.appendChild(link);
}

function localDate(date = new Date()) {
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

function nowMinute() {
  const date = new Date();
  return date.getHours() * 60 + date.getMinutes();
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function text(value, fallback = "—") {
  const result = String(value ?? "").trim();
  return result || fallback;
}

function time(value) {
  const minute = number(value);
  return `${String(Math.floor(minute / 60) % 24).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}

function status(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "assigned") return "Assigned";
  if (["cancelled", "canceled"].includes(normalized)) return "Cancelled";
  return "Pending";
}

function acknowledgment(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (["yes", "y", "accepted"].includes(normalized)) return "Yes";
  if (["no", "n", "declined"].includes(normalized)) return "No";
  return "Pending";
}

function blockStart(block) {
  return number(block.startMin ?? block.startMinutes);
}

function blockEnd(block) {
  return number(block.endMin ?? block.endMinutes);
}

function blockName(block) {
  return text(block.jobGroupName || block.groupName || block.schoolName || block.title || block.jobName, "Scheduled job");
}

function assignedDriver(block) {
  return text(block.assignedDriverEmployeeNumber || block.driverEmployeeNumber, "");
}

function assignedBus(block) {
  return text(block.busNumber || block.assignedBus, "");
}

function jobPhase(block, selectedDate) {
  if (status(block.dispatchStatus) === "Cancelled") return "cancelled";
  if (!assignedDriver(block)) return "unassigned";
  if (selectedDate < localDate()) return "completed";
  if (selectedDate > localDate()) return "upcoming";
  const minute = nowMinute();
  if (minute > blockEnd(block)) return "completed";
  if (minute >= blockStart(block)) return "active";
  return "upcoming";
}

function reportMatchesDate(report, selectedDate, type) {
  const candidates = type === "incident"
    ? [report.incidentDate, report.reportedAtIso, report.createdAt?.toDate?.()]
    : [report.reportDate, report.reportedDate, report.reportedAtIso, report.createdAt?.toDate?.()];
  return candidates.some((value) => {
    if (!value) return false;
    if (value instanceof Date) return localDate(value) === selectedDate;
    return String(value).slice(0, 10) === selectedDate;
  });
}

function isOpenReport(report) {
  const value = String(report.status || "New").trim().toLowerCase();
  return !["closed", "completed", "resolved", "cancelled", "canceled"].includes(value) && report.deleted !== true;
}

function fleetStatus(bus) {
  return String(bus.status || "Active").trim().toLowerCase();
}

function busNumber(bus) {
  return text(bus.fleetNumber || bus.id, "");
}

function isOperationalBus(bus) {
  return ["active", "in service"].includes(fleetStatus(bus)) && bus.deleted !== true;
}

function isWorkshopBus(bus) {
  return ["workshop", "out of service"].includes(fleetStatus(bus));
}

function isEv(bus) {
  return String(bus.fuelType || bus.fuel || "").trim().toLowerCase() === "ev";
}

function peakBusDemand(duties) {
  const events = [];
  duties.forEach((duty) => {
    if (status(duty.dispatchStatus) === "Cancelled") return;
    const start = number(duty.startMin);
    const end = number(duty.endMin);
    if (end <= start) return;
    events.push({ minute: start, change: 1 });
    events.push({ minute: end, change: -1 });
  });
  events.sort((a, b) => a.minute - b.minute || a.change - b.change);
  let active = 0;
  let peak = 0;
  let peakMinute = 0;
  events.forEach((event) => {
    active += event.change;
    if (active > peak) {
      peak = active;
      peakMinute = event.minute;
    }
  });
  return { peak, peakMinute };
}

function hourlyDemand(duties) {
  const points = [];
  for (let hour = 4; hour <= 23; hour += 1) {
    const minute = hour * 60;
    const count = duties.filter((duty) =>
      status(duty.dispatchStatus) !== "Cancelled" &&
      number(duty.startMin) <= minute &&
      number(duty.endMin) > minute
    ).length;
    points.push({ hour, count });
  }
  return points;
}

function dashboardSummary(model) {
  const phases = model.blocks.map((block) => jobPhase(block, model.selectedDate));
  const demand = peakBusDemand(model.duties);
  const allocated = new Set(model.duties.map((duty) => text(duty.assignedBus || duty.busNumber, "")).filter(Boolean)).size;
  const openDefects = model.defects.filter(isOpenReport);
  const todayIncidents = model.incidents.filter((report) => reportMatchesDate(report, model.selectedDate, "incident"));
  return {
    duties: model.duties.length,
    completed: phases.filter((phase) => phase === "completed").length,
    active: phases.filter((phase) => phase === "active").length,
    upcoming: phases.filter((phase) => phase === "upcoming").length,
    unassigned: phases.filter((phase) => phase === "unassigned").length,
    cancelled: phases.filter((phase) => phase === "cancelled").length,
    peak: demand.peak,
    peakMinute: demand.peakMinute,
    allocated,
    available: model.buses.filter(isOperationalBus).length,
    workshop: model.buses.filter(isWorkshopBus).length,
    ev: model.buses.filter((bus) => isOperationalBus(bus) && isEv(bus)).length,
    defects: openDefects.length,
    incidents: todayIncidents.length
  };
}

function alerts(model) {
  const current = nowMinute();
  const isToday = model.selectedDate === localDate();
  const results = [];
  model.duties.forEach((duty) => {
    const startsSoon = isToday && number(duty.startMin) >= current && number(duty.startMin) - current <= 60;
    const driver = text(duty.driverName, `Driver ${text(duty.driverEmployeeNumber)}`);
    if (acknowledgment(duty.driverAcknowledgment) === "No") results.push({ tone: "critical", title: `${driver} declined duty ${text(duty.dutyNumber)}`, detail: "Driver action required", page: "driverMonitor" });
    else if (status(duty.dispatchStatus) === "Assigned" && acknowledgment(duty.driverAcknowledgment) === "Pending") results.push({ tone: "warning", title: `${driver} has not acknowledged`, detail: `Duty ${text(duty.dutyNumber)} · ${time(duty.startMin)}`, page: "driverMonitor" });
    if (startsSoon && !text(duty.assignedBus || duty.busNumber, "")) results.push({ tone: "critical", title: `${driver} starts soon with no bus`, detail: `Starts ${time(duty.startMin)}`, page: "adminDispatchBoard" });
    const fatigue = String(duty.fatigueStatus || "OK").trim().toUpperCase();
    if (!["OK", "PASS", "COMPLIANT"].includes(fatigue)) results.push({ tone: "warning", title: `${driver} has a fatigue warning`, detail: text(duty.fatigueWarning || duty.fatigueStatus), page: "driverMonitor" });
  });
  model.blocks.forEach((block) => {
    const startsSoon = isToday && blockStart(block) >= current && blockStart(block) - current <= 60;
    if (startsSoon && !assignedDriver(block)) results.push({ tone: "critical", title: `${blockName(block)} starts without a driver`, detail: `Starts ${time(blockStart(block))}`, page: "adminDispatchBoard" });
  });
  const assignedNumbers = new Set(model.duties.map((duty) => text(duty.assignedBus || duty.busNumber, "")).filter(Boolean));
  model.buses.filter(isWorkshopBus).forEach((bus) => {
    if (assignedNumbers.has(busNumber(bus))) results.push({ tone: "critical", title: `Bus ${busNumber(bus)} is allocated but unavailable`, detail: text(bus.status), page: "adminBuses" });
  });
  return results.slice(0, 12);
}

function shell(root, selectedDate) {
  root.innerHTML = `
    <section class="od-page">
      <header class="od-header">
        <div><span class="od-eyebrow">LIVE OPERATIONS</span><h1>Operations Dashboard</h1><p>Daily service performance, fleet demand and operational exceptions.</p></div>
        <div class="od-head-actions"><label>Operating date<input id="odDate" type="date" value="${escapeHtml(selectedDate)}"></label><button id="odRefresh" type="button">Refresh</button></div>
      </header>
      <div id="odKpis" class="od-kpis"></div>
      <div class="od-main-grid">
        <section class="od-panel od-progress-panel"><div class="od-panel-head"><div><h2>Today’s operation</h2><span>Live job progress</span></div><span class="od-live"><i></i> Live</span></div><div id="odProgress"></div></section>
        <section class="od-panel od-alert-panel"><div class="od-panel-head"><div><h2>Immediate attention</h2><span>Dispatcher action required</span></div><strong id="odAlertCount">0</strong></div><div id="odAlerts"></div></section>
      </div>
      <div class="od-lower-grid">
        <section class="od-panel"><div class="od-panel-head"><div><h2>Bus demand</h2><span id="odPeakLabel">Peak requirement</span></div></div><div id="odDemand"></div></section>
        <section class="od-panel"><div class="od-panel-head"><div><h2>Fleet availability</h2><span>Current fleet records</span></div></div><div id="odFleet"></div></section>
        <section class="od-panel"><div class="od-panel-head"><div><h2>Duty types</h2><span>Scheduled duties</span></div></div><div id="odTypes"></div></section>
      </div>
      <section class="od-panel od-quick"><div><h2>Quick actions</h2><span>Open operational tools</span></div><div id="odQuickActions"></div></section>
      <div id="odUpdated" class="od-updated"></div>
    </section>`;
}

function renderKpis(root, summary) {
  const cards = [
    ["Total duties", summary.duties, "navy", "Drivers rostered"],
    ["Jobs completed", summary.completed, "green", "Finished blocks"],
    ["In progress", summary.active, "blue", "Active now"],
    ["Upcoming", summary.upcoming, "purple", "Still to run"],
    ["Unassigned jobs", summary.unassigned, summary.unassigned ? "red" : "green", "No driver"],
    ["Peak buses", summary.peak, "amber", summary.peak ? `Around ${time(summary.peakMinute)}` : "No demand"]
  ];
  root.innerHTML = cards.map(([label, value, tone, note]) => `<article class="od-kpi od-${tone}"><span>${escapeHtml(label)}</span><strong>${value}</strong><small>${escapeHtml(note)}</small></article>`).join("");
}

function renderProgress(root, summary) {
  const total = Math.max(summary.completed + summary.active + summary.upcoming + summary.unassigned + summary.cancelled, 1);
  const segments = [
    ["Completed", summary.completed, "green"], ["In progress", summary.active, "blue"],
    ["Upcoming", summary.upcoming, "navy"], ["Unassigned", summary.unassigned, "red"],
    ["Cancelled", summary.cancelled, "grey"]
  ];
  root.innerHTML = `<div class="od-progress-bar">${segments.map(([label, value, tone]) => value ? `<span class="od-bg-${tone}" style="width:${(value / total) * 100}%" title="${label}: ${value}"></span>` : "").join("")}</div><div class="od-progress-list">${segments.map(([label, value, tone]) => `<div><i class="od-bg-${tone}"></i><span>${label}</span><strong>${value}</strong></div>`).join("")}</div>`;
}

function renderAlerts(root, items, navigate) {
  if (!items.length) {
    root.innerHTML = `<div class="od-clear"><span>✓</span><strong>No urgent operational alerts</strong><small>Everything looks clear for this date.</small></div>`;
    return;
  }
  root.innerHTML = items.map((item) => `<button type="button" class="od-alert od-alert-${item.tone}" data-page="${item.page}"><i>!</i><span><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.detail)}</small></span><b>Open</b></button>`).join("");
  root.querySelectorAll("[data-page]").forEach((button) => button.addEventListener("click", () => navigate?.(button.dataset.page)));
}

function renderDemand(root, duties, summary) {
  const points = hourlyDemand(duties);
  const max = Math.max(...points.map((point) => point.count), 1);
  root.innerHTML = `<div class="od-chart">${points.map((point) => `<div class="od-bar-wrap" title="${String(point.hour).padStart(2, "0")}:00 · ${point.count} buses"><span>${point.count || ""}</span><i style="height:${Math.max(4, (point.count / max) * 110)}px"></i><small>${point.hour % 2 === 0 ? String(point.hour).padStart(2, "0") : ""}</small></div>`).join("")}</div><div class="od-demand-foot"><span>Allocated buses <strong>${summary.allocated}</strong></span><span>Peak required <strong>${summary.peak}</strong></span><span class="${summary.available < summary.peak ? "is-danger" : ""}">Available fleet <strong>${summary.available}</strong></span></div>`;
}

function renderFleet(root, summary) {
  const rows = [["Available", summary.available, "green"], ["Allocated today", summary.allocated, "blue"], ["Workshop / unavailable", summary.workshop, "red"], ["Available EV buses", summary.ev, "purple"], ["Open defects", summary.defects, "amber"], ["Incidents today", summary.incidents, "navy"]];
  root.innerHTML = `<div class="od-metric-list">${rows.map(([label, value, tone]) => `<div><i class="od-bg-${tone}"></i><span>${label}</span><strong>${value}</strong></div>`).join("")}</div>`;
}

function renderTypes(root, duties) {
  const counts = new Map();
  duties.forEach((duty) => {
    const type = text(duty.dutyType, "Other");
    counts.set(type, (counts.get(type) || 0) + 1);
  });
  const rows = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const max = Math.max(...rows.map((row) => row[1]), 1);
  root.innerHTML = rows.length ? `<div class="od-type-list">${rows.map(([type, count]) => `<div><span>${escapeHtml(type)}</span><i><b style="width:${(count / max) * 100}%"></b></i><strong>${count}</strong></div>`).join("")}</div>` : `<div class="od-empty-small">No duties for this date.</div>`;
}

function renderQuick(root, navigate) {
  const actions = [["adminDispatchBoard", "Dispatch Board", "Assign jobs and buses"], ["driverMonitor", "Driver Monitor", "Driver status and replies"], ["adminAllJobs", "All Jobs", "Review duty sheets"], ["adminBuses", "Fleet", "Vehicle availability"], ["notice", "Notice Board", "Publish driver notices"]];
  root.innerHTML = actions.map(([page, label, note]) => `<button type="button" data-page="${page}"><strong>${label}</strong><span>${note}</span><b>→</b></button>`).join("");
  root.querySelectorAll("[data-page]").forEach((button) => button.addEventListener("click", () => navigate?.(button.dataset.page)));
}

export function renderOperationsDashboardPage({ onNavigate } = {}) {
  ensureStyles();
  const root = document.getElementById("contentArea");
  if (!root) return;
  const model = { selectedDate: state.operationsDashboardDate || localDate(), duties: [], blocks: [], buses: [], defects: [], incidents: [], ready: new Set() };
  shell(root, model.selectedDate);
  const get = (id) => root.querySelector(`#${id}`);

  function paint() {
    if (model.ready.size < 5) return;
    const summary = dashboardSummary(model);
    const alertItems = alerts(model);
    renderKpis(get("odKpis"), summary);
    renderProgress(get("odProgress"), summary);
    renderAlerts(get("odAlerts"), alertItems, onNavigate);
    get("odAlertCount").textContent = String(alertItems.length);
    get("odPeakLabel").textContent = summary.peak ? `Peak ${summary.peak} buses around ${time(summary.peakMinute)}` : "No bus demand";
    renderDemand(get("odDemand"), model.duties, summary);
    renderFleet(get("odFleet"), summary);
    renderTypes(get("odTypes"), model.duties);
    renderQuick(get("odQuickActions"), onNavigate);
    get("odUpdated").textContent = `Last updated ${new Date().toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`;
  }

  function subscribe() {
    state.unsubscribeOperationsDashboard?.();
    model.ready.clear();
    const stops = [];
    const ready = (key, target) => (items) => { model[target] = (items || []).filter((item) => item.deleted !== true); model.ready.add(key); paint(); };
    const fail = (key) => (error) => { console.error(`Operations Dashboard ${key}:`, error); model.ready.add(key); paint(); };
    stops.push(listenDutySpansByDate(model.selectedDate, ready("duties", "duties"), fail("duties")));
    stops.push(listenBlocksByDate(model.selectedDate, ready("blocks", "blocks"), fail("blocks")));
    [["buses", "buses"], ["defectReports", "defects"], ["incidentReports", "incidents"]].forEach(([collectionName, target]) => {
      stops.push(onSnapshot(collection(db, collectionName), (snapshot) => ready(target, target)(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }))), fail(target)));
    });
    let stopped = false;
    state.unsubscribeOperationsDashboard = () => { if (stopped) return; stopped = true; stops.forEach((stop) => stop?.()); };
  }

  get("odDate").addEventListener("change", (event) => {
    if (!event.target.value) return;
    model.selectedDate = event.target.value;
    state.operationsDashboardDate = model.selectedDate;
    subscribe();
  });
  get("odRefresh").addEventListener("click", paint);
  subscribe();
}
