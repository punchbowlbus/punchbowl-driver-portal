import {
  collection,
  onSnapshot,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";
import { db, auth } from "./firebase.js";
import { listenDutySpansByDate, updateDutySpan } from "./db.js";
import { state } from "./state.js";
import { els } from "./ui.js";

const TURNAROUND_MINUTES = 20;
const ACTIVE_DUTY_STATUSES = new Set(["assigned", "pending"]);
const UNAVAILABLE_BUS_STATUSES = new Set(["workshop", "out of service", "inactive", "restricted"]);
const REQUIRED_DEPOTS = ["Goulburn"];
const EXCLUDED_DEPOT_KEYS = new Set(["olympicpark"]);

let duties = [];
let buses = [];
let selectedDate = localDate();
let depotFilter = "";
let unsubscribeDuties = null;
let unsubscribeBuses = null;
let busy = false;

const clean = (value) => String(value ?? "").trim();
const norm = (value) => clean(value).toLowerCase();
const esc = (value) => clean(value).replace(/[&<>'"]/g, (char) => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[char]));
const fleetNo = (bus) => clean(bus?.fleetNumber || bus?.busNumber || bus?.number || bus?.id);
const busStatus = (bus) => clean(bus?.status || "Active");
const busFuel = (bus) => clean(bus?.fuelType || bus?.fuel || "Diesel");

function depotKey(value) {
  let key = norm(value).replace(/\bdepot\b/g, "").replace(/[^a-z0-9]+/g, "").trim();
  if (["hannan", "hannans"].includes(key)) key = "hannans";
  return key;
}

function explicitDutyDepot(duty) {
  return clean(duty?.depot || duty?.depotName || duty?.homeDepot || duty?.startDepot);
}

function dutyDepot(duty) {
  const explicit = explicitDutyDepot(duty);
  if (explicit) return explicit;
  const start = clean(duty?.startLocation);
  if (!start) return "";
  const known = buses.find((bus) => bus.depot && depotKey(bus.depot) === depotKey(start));
  return known ? clean(known.depot) : "";
}

function localDate(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function minutes(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function formatTime(value) {
  let total = minutes(value);
  while (total < 0) total += 1440;
  const day = Math.floor(total / 1440);
  total %= 1440;
  const label = `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
  return day ? `${label} +${day}` : label;
}

function inputTime(value) {
  let total = minutes(value) % 1440;
  if (total < 0) total += 1440;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function timeToMinutes(value, fallback = 0) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(clean(value));
  if (!match) return fallback;
  return Number(match[1]) * 60 + Number(match[2]);
}

function endMinute(duty) {
  let end = minutes(duty.endMin);
  const start = minutes(duty.startMin);
  if (end < start) end += 1440;
  return end;
}

function movementType(duty) {
  const explicit = clean(duty.yardMovementType);
  if (explicit) return explicit;
  return /relief|changeover/i.test(`${duty.dutyType || ""} ${duty.dutyNumber || ""}`) ? "Relief Changeover" : "Bus Departure";
}

function isRelief(duty) {
  return movementType(duty) === "Relief Changeover";
}

function vehicleRequirement(duty) {
  const value = clean(duty.vehicleRequirement || duty.requiredVehicleType || duty.busType);
  if (/\bev\b|electric/i.test(value)) return "EV";
  if (/coach/i.test(value)) return "Coach";
  if (/accessible|wheelchair/i.test(value)) return "Accessible";
  return value || "Bus";
}

function busMeetsRequirement(bus, requirement) {
  const req = norm(requirement);
  if (req === "ev") return /electric|\bev\b/i.test(busFuel(bus));
  if (req === "coach") return /coach/i.test(`${bus.vehicleType || ""} ${bus.model || ""}`);
  if (req === "accessible") return !/no|false|not fitted/i.test(clean(bus.accessType || bus.wheelchairAccess));
  return true;
}

function availableBus(bus) {
  return !UNAVAILABLE_BUS_STATUSES.has(norm(busStatus(bus)));
}

function dutyIsActive(duty) {
  return duty.deleted !== true && !/cancel/i.test(clean(duty.dispatchStatus)) && ACTIVE_DUTY_STATUSES.has(norm(duty.dispatchStatus || "Pending"));
}

function sameDepot(bus, duty) {
  const requiredDepot = dutyDepot(duty) || depotFilter;
  return !requiredDepot || !bus.depot || depotKey(bus.depot) === depotKey(requiredDepot);
}

function intervalsOverlap(aStart, aEnd, bStart, bEnd, buffer = 0) {
  return aStart < bEnd + buffer && bStart < aEnd + buffer;
}

function relatedBus(duty) {
  const number = clean(duty.actualBus || duty.assignedBus);
  return buses.find((bus) => norm(fleetNo(bus)) === norm(number));
}

function dutyConflicts(duty) {
  if (isRelief(duty)) {
    const car = clean(duty.supportVehicle);
    if (!car) return ["Support car not allocated"];
    const clashes = duties.filter((other) => other.id !== duty.id && isRelief(other) && norm(other.supportVehicle) === norm(car)
      && intervalsOverlap(minutes(duty.startMin), endMinute(duty), minutes(other.startMin), endMinute(other), TURNAROUND_MINUTES));
    return clashes.length ? [`${car} overlaps another relief movement`] : [];
  }
  const number = clean(duty.actualBus || duty.assignedBus);
  if (!number) return ["Bus not allocated"];
  const bus = relatedBus(duty);
  const messages = [];
  if (!bus) messages.push("Bus not found in Fleet");
  else if (!availableBus(bus)) messages.push(`Bus is ${busStatus(bus)}`);
  else if (!sameDepot(bus, duty)) messages.push(`Bus is at ${bus.depot}`);
  else if (!busMeetsRequirement(bus, vehicleRequirement(duty))) messages.push(`Bus does not meet ${vehicleRequirement(duty)} requirement`);
  const clashes = duties.filter((other) => other.id !== duty.id && !isRelief(other)
    && norm(other.actualBus || other.assignedBus) === norm(number)
    && intervalsOverlap(minutes(duty.startMin), endMinute(duty), minutes(other.startMin), endMinute(other), TURNAROUND_MINUTES));
  if (clashes.length) messages.push(`Overlaps ${clashes[0].dutyNumber || clashes[0].driverName || "another duty"}`);
  return messages;
}

function allDepots() {
  const names = new Map();
  [...REQUIRED_DEPOTS, ...duties.map(explicitDutyDepot), ...buses.map((bus) => clean(bus.depot))].filter(Boolean).forEach((name) => {
    const key = depotKey(name);
    if (EXCLUDED_DEPOT_KEYS.has(key)) return;
    const current = names.get(key);
    if (!current || /\bdepot\b/i.test(name)) names.set(key, name);
  });
  return [...names.values()].sort((a, b) => a.localeCompare(b));
}

function visibleDuties() {
  return duties.filter(dutyIsActive).filter((duty) => !depotFilter || depotKey(dutyDepot(duty)) === depotKey(depotFilter));
}

function busMatchesSelectedDepot(bus) {
  return !depotFilter || !bus.depot || depotKey(bus.depot) === depotKey(depotFilter);
}

function busOptions(duty) {
  const selected = clean(duty.assignedBus);
  const list = buses.filter((bus) => availableBus(bus) && sameDepot(bus, duty) && busMeetsRequirement(bus, vehicleRequirement(duty)))
    .sort((a, b) => fleetNo(a).localeCompare(fleetNo(b), undefined, {numeric:true}));
  if (selected && !list.some((bus) => norm(fleetNo(bus)) === norm(selected))) list.unshift({fleetNumber:selected, status:"Unavailable"});
  return `<option value="">Select bus</option>${list.map((bus) => `<option value="${esc(fleetNo(bus))}" ${norm(fleetNo(bus)) === norm(selected) ? "selected" : ""}>${esc(fleetNo(bus))} · ${esc(busFuel(bus))}${availableBus(bus) ? "" : ` · ${esc(busStatus(bus))}`}</option>`).join("")}`;
}

function statusFor(duty) {
  if (clean(duty.yardMovementStatus) === "Departed") return {cls:"departed", label:"DEPARTED"};
  const conflicts = dutyConflicts(duty);
  if (conflicts.length && !/not allocated/i.test(conflicts[0])) return {cls:"conflict", label:"CONFLICT"};
  if (conflicts.length) return {cls:"pending", label:isRelief(duty) ? "NEEDS CAR" : "NEEDS BUS"};
  return {cls:"ready", label:"READY"};
}

function sectionName(duty) {
  if (isRelief(duty)) return "RELIEF CHANGEOVERS";
  const type = norm(duty.dutyType);
  if (type.includes("charter")) return "CHARTER BUSES";
  return minutes(duty.startMin) < 720 ? "MORNING DEPARTURES" : "AFTERNOON / EVENING DEPARTURES";
}

function rowHtml(duty) {
  const relief = isRelief(duty);
  const conflicts = dutyConflicts(duty);
  const status = statusFor(duty);
  const actual = clean(duty.actualBus);
  const depart = clean(duty.yardDepartureMin) ? minutes(duty.yardDepartureMin) : minutes(duty.startMin) + 5;
  return `<tr class="ba-row ba-${status.cls}" data-duty-id="${esc(duty.id)}">
    <td><strong>${esc(duty.dutyNumber || "—")}</strong><small>${esc(duty.dutyType || "")}</small></td>
    <td><strong>${esc(duty.driverName || "Unassigned")}</strong><small>${esc(duty.driverEmployeeNumber || "")}</small></td>
    <td>${formatTime(duty.startMin)}</td><td>${formatTime(depart)}</td>
    <td><select class="ba-small" data-field="yardMovementType"><option ${relief ? "" : "selected"}>Bus Departure</option><option ${relief ? "selected" : ""}>Relief Changeover</option></select></td>
    ${relief ? `
      <td><input class="ba-input" data-field="supportVehicle" value="${esc(duty.supportVehicle || "")}" placeholder="Car / support vehicle"></td>
      <td><input class="ba-input" data-field="reliefBusNumber" value="${esc(duty.reliefBusNumber || duty.assignedBus || "")}" placeholder="Bus on road"></td>
      <td><input class="ba-input" data-field="changeoverLocation" value="${esc(duty.changeoverLocation || "")}" placeholder="Changeover location"></td>` : `
      <td><select class="ba-bus" data-field="assignedBus">${busOptions(duty)}</select></td>
      <td><input class="ba-input" data-field="actualBus" value="${esc(actual)}" placeholder="Confirm actual"></td>
      <td><span class="ba-type ${vehicleRequirement(duty) === "EV" ? "ev" : ""}">${esc(vehicleRequirement(duty))}</span><small>${esc(dutyDepot(duty) || "Depot not set")}${duty.startLocation ? ` · Start: ${esc(duty.startLocation)}` : ""}</small></td>`}
    <td>${formatTime(endMinute(duty))}</td>
    <td><span class="ba-status ${status.cls}">${status.label}</span>${conflicts.length ? `<small class="ba-alert">${esc(conflicts.join(" · "))}</small>` : ""}</td>
    <td class="ba-screen"><button class="ba-check" type="button" data-confirm-duty="${esc(duty.id)}">✓</button></td>
  </tr>`;
}

function renderTable() {
  const body = document.getElementById("baRows");
  if (!body) return;
  const list = visibleDuties().sort((a, b) => minutes(a.startMin) - minutes(b.startMin));
  const grouped = new Map();
  list.forEach((duty) => {
    const section = sectionName(duty);
    if (!grouped.has(section)) grouped.set(section, []);
    grouped.get(section).push(duty);
  });
  const order = ["MORNING DEPARTURES", "RELIEF CHANGEOVERS", "AFTERNOON / EVENING DEPARTURES", "CHARTER BUSES"];
  body.innerHTML = order.filter((section) => grouped.has(section)).map((section) => `<tr class="ba-section"><td colspan="11">${section}</td></tr>${grouped.get(section).map(rowHtml).join("")}`).join("")
    || `<tr><td colspan="11"><div class="ba-empty">No active duties found for this date and depot.</div></td></tr>`;
  wireRows();
  renderMetrics();
  renderAlerts();
}

function renderMetrics() {
  const list = visibleDuties();
  const busDuties = list.filter((duty) => !isRelief(duty));
  const assigned = busDuties.filter((duty) => clean(duty.assignedBus)).length;
  const conflicts = list.filter((duty) => dutyConflicts(duty).some((message) => !/not allocated/i.test(message))).length;
  const used = busDuties.map((duty) => clean(duty.actualBus || duty.assignedBus)).filter(Boolean);
  const reused = used.length - new Set(used.map(norm)).size;
  const values = {baMetricDuties:busDuties.length, baMetricPlanned:assigned, baMetricAwaiting:busDuties.length - assigned, baMetricRelief:list.length - busDuties.length, baMetricReuse:Math.max(0, reused), baMetricConflicts:conflicts, baMetricAvailable:buses.filter((bus) => availableBus(bus) && busMatchesSelectedDepot(bus)).length};
  Object.entries(values).forEach(([id, value]) => { const node = document.getElementById(id); if (node) node.textContent = String(value); });
}

function renderAlerts() {
  const root = document.getElementById("baAlerts");
  if (!root) return;
  const list = visibleDuties();
  const unavailable = buses.filter((bus) => busMatchesSelectedDepot(bus) && UNAVAILABLE_BUS_STATUSES.has(norm(busStatus(bus))));
  const alerts = [];
  list.forEach((duty) => dutyConflicts(duty).forEach((message) => alerts.push({tone:/not allocated/i.test(message) ? "warn" : "bad", title:duty.dutyNumber || duty.driverName || "Duty", text:message})));
  unavailable.forEach((bus) => alerts.push({tone:"bad", title:fleetNo(bus), text:`Excluded automatically: ${busStatus(bus)}`}));
  root.innerHTML = alerts.length ? alerts.slice(0, 12).map((item) => `<div class="ba-notice ${item.tone}"><strong>${esc(item.title)}</strong><span>${esc(item.text)}</span></div>`).join("") : `<div class="ba-notice good"><strong>Plan ready</strong><span>No allocation conflicts found.</span></div>`;
}

async function saveField(dutyId, field, value) {
  const duty = duties.find((item) => item.id === dutyId);
  if (!duty || busy) return;
  const patch = {[field]:clean(value), yardUpdatedAt:serverTimestamp(), yardUpdatedBy:clean(auth.currentUser?.email)};
  if (field === "yardMovementType" && value === "Relief Changeover") {
    patch.actualBus = "";
    patch.yardMovementStatus = "Planned";
  }
  try {
    busy = true;
    await updateDutySpan(dutyId, patch);
    toast(`${field === "yardMovementType" ? "Movement" : "Allocation"} updated`);
  } catch (error) {
    toast(error?.message || "Unable to save allocation", true);
  } finally {
    busy = false;
  }
}

function wireRows() {
  document.querySelectorAll("#baRows [data-field]").forEach((control) => {
    control.addEventListener("change", () => saveField(control.closest("tr").dataset.dutyId, control.dataset.field, control.value));
  });
  document.querySelectorAll("[data-confirm-duty]").forEach((button) => button.addEventListener("click", async () => {
    const duty = duties.find((item) => item.id === button.dataset.confirmDuty);
    if (!duty) return;
    const conflicts = dutyConflicts(duty);
    if (conflicts.length) return toast(`Cannot confirm: ${conflicts.join(" · ")}`, true);
    const patch = {
      yardMovementStatus:"Departed",
      yardConfirmedAt:serverTimestamp(),
      yardConfirmedBy:clean(auth.currentUser?.email)
    };
    if (!isRelief(duty)) patch.actualBus = clean(duty.actualBus || duty.assignedBus);
    await updateDutySpan(duty.id, patch);
    toast(`${duty.dutyNumber || "Duty"} confirmed departed`);
  }));
}

async function autoPlan() {
  const list = visibleDuties().filter((duty) => !isRelief(duty) && !clean(duty.assignedBus)).sort((a, b) => minutes(a.startMin) - minutes(b.startMin));
  if (!list.length) return toast("All bus duties are already planned");
  if (!window.confirm(`Automatically suggest buses for ${list.length} unallocated dut${list.length === 1 ? "y" : "ies"}? Review every allocation before publishing.`)) return;
  const schedules = new Map();
  visibleDuties().filter((duty) => !isRelief(duty) && clean(duty.assignedBus)).forEach((duty) => {
    const key = norm(duty.assignedBus);
    if (!schedules.has(key)) schedules.set(key, []);
    schedules.get(key).push([minutes(duty.startMin), endMinute(duty)]);
  });
  let planned = 0;
  busy = true;
  try {
    for (const duty of list) {
      const candidate = buses.filter((bus) => availableBus(bus) && sameDepot(bus, duty) && busMeetsRequirement(bus, vehicleRequirement(duty))).find((bus) => {
        const periods = schedules.get(norm(fleetNo(bus))) || [];
        return periods.every(([start, end]) => !intervalsOverlap(minutes(duty.startMin), endMinute(duty), start, end, TURNAROUND_MINUTES));
      });
      if (!candidate) continue;
      const number = fleetNo(candidate);
      await updateDutySpan(duty.id, {assignedBus:number, yardMovementType:"Bus Departure", yardMovementStatus:"Planned", yardAutoPlanned:true, yardUpdatedAt:serverTimestamp(), yardUpdatedBy:clean(auth.currentUser?.email)});
      if (!schedules.has(norm(number))) schedules.set(norm(number), []);
      schedules.get(norm(number)).push([minutes(duty.startMin), endMinute(duty)]);
      planned++;
    }
    toast(`${planned} bus allocation${planned === 1 ? "" : "s"} suggested`);
  } catch (error) {
    toast(error?.message || "Unable to create automatic plan", true);
  } finally {
    busy = false;
  }
}

async function publishToYard() {
  const list = visibleDuties();
  const blocking = list.filter((duty) => dutyConflicts(duty).length);
  if (blocking.length) return toast(`Resolve ${blocking.length} incomplete or conflicting movement${blocking.length === 1 ? "" : "s"} before publishing`, true);
  if (!window.confirm(`Publish ${list.length} movements to the yard for ${selectedDate}?`)) return;
  busy = true;
  try {
    for (const duty of list) await updateDutySpan(duty.id, {yardPublished:true, yardPublishedAt:serverTimestamp(), yardPublishedBy:clean(auth.currentUser?.email)});
    toast("Daily plan published to the yard");
  } catch (error) {
    toast(error?.message || "Unable to publish yard plan", true);
  } finally {
    busy = false;
  }
}

function toast(message, error = false) {
  let node = document.getElementById("baToast");
  if (!node) {
    node = document.createElement("div");
    node.id = "baToast";
    document.body.appendChild(node);
  }
  node.className = error ? "ba-toast error show" : "ba-toast show";
  node.textContent = message;
  clearTimeout(window.baToastTimer);
  window.baToastTimer = setTimeout(() => node.classList.remove("show"), 3000);
}

function startListeners() {
  unsubscribeDuties?.();
  unsubscribeDuties = listenDutySpansByDate(selectedDate, (items) => { duties = items || []; renderTable(); }, (error) => toast(error?.message || "Unable to load duties", true));
  if (!unsubscribeBuses) unsubscribeBuses = onSnapshot(collection(db, "buses"), (snapshot) => { buses = snapshot.docs.map((item) => ({id:item.id, ...item.data()})); renderControls(); renderTable(); }, (error) => toast(error?.message || "Unable to load fleet", true));
  state.unsubscribeBusAllocation = () => {
    unsubscribeDuties?.(); unsubscribeDuties = null;
    unsubscribeBuses?.(); unsubscribeBuses = null;
  };
}

function renderControls() {
  const select = document.getElementById("baDepot");
  if (!select) return;
  const current = depotFilter;
  select.innerHTML = `<option value="">All depots</option>${allDepots().map((depot) => `<option ${norm(depot) === norm(current) ? "selected" : ""}>${esc(depot)}</option>`).join("")}`;
}

function injectStyles() {
  if (document.getElementById("baStyles")) return;
  const style = document.createElement("style");
  style.id = "baStyles";
  style.textContent = `
    .ba-page{display:grid;gap:14px}.ba-head{display:flex;align-items:center;gap:16px;padding:20px;border-radius:18px;background:linear-gradient(120deg,#ad191f,#cf252b);color:#fff}.ba-head h1{margin:0;font-size:28px}.ba-head p{margin:3px 0 0;opacity:.9}.ba-head-actions{margin-left:auto;display:flex;gap:8px}.ba-btn{border:1px solid #d0d5dd;border-radius:9px;background:#fff;color:#344054;padding:10px 14px;font-weight:850;cursor:pointer}.ba-btn.primary{border-color:#c82127;background:#c82127;color:#fff}.ba-btn.light{border:0;color:#b42318}.ba-controls{display:grid;grid-template-columns:180px minmax(170px,1fr) auto auto;gap:10px;align-items:end;padding:14px;border:1px solid #dfe5ec;border-radius:14px;background:#fff}.ba-field{display:grid;gap:5px}.ba-field span{font-size:10px;font-weight:900;letter-spacing:.07em;text-transform:uppercase;color:#667085}.ba-field input,.ba-field select{height:40px;border:1px solid #cfd6df;border-radius:8px;background:#fff;padding:0 10px;font-weight:700}.ba-metrics{display:grid;grid-template-columns:repeat(7,minmax(105px,1fr));gap:9px}.ba-metric{border:1px solid #dfe5ec;border-left:4px solid #98a2b3;border-radius:13px;background:#fff;padding:12px;min-height:78px}.ba-metric span{display:block;font-size:9px;font-weight:900;letter-spacing:.05em;color:#667085;text-transform:uppercase}.ba-metric strong{display:block;margin-top:5px;font-size:23px}.ba-metric.green{border-left-color:#12b76a}.ba-metric.amber{border-left-color:#f79009}.ba-metric.red{border-left-color:#f04438}.ba-metric.blue{border-left-color:#2e90fa}.ba-metric.purple{border-left-color:#7f56d9}.ba-layout{display:grid;grid-template-columns:minmax(0,1fr) 290px;gap:13px}.ba-panel{overflow:hidden;border:1px solid #dfe5ec;border-radius:14px;background:#fff}.ba-panel-head{display:flex;align-items:center;gap:10px;padding:14px 15px;border-bottom:1px solid #e4e7ec}.ba-panel-head h2{margin:0;font-size:17px}.ba-panel-head small{color:#667085}.ba-table-wrap{max-height:640px;overflow:auto}.ba-table{width:100%;min-width:1180px;border-collapse:separate;border-spacing:0}.ba-table th{position:sticky;top:0;z-index:3;background:#f7f9fc;color:#475467;padding:9px;font-size:9px;text-align:left;text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid #dfe5ec}.ba-table td{padding:9px;border-bottom:1px solid #edf0f4;vertical-align:middle}.ba-table td>small{display:block;margin-top:3px;color:#667085}.ba-section td{background:#17324d!important;color:#fff!important;padding:7px 10px!important;font-size:10px;font-weight:900;letter-spacing:.08em}.ba-row.ba-conflict{background:#fff7f6}.ba-row.ba-pending{background:#fffcf5}.ba-input,.ba-bus,.ba-small{width:100%;min-width:105px;height:34px;border:1px solid #cfd6df;border-radius:7px;background:#fff;padding:0 7px;font-size:11px;font-weight:700}.ba-small{min-width:135px}.ba-type{font-size:10px;font-weight:900}.ba-type.ev{color:#6941c6}.ba-status{display:inline-flex;border-radius:999px;padding:4px 7px;font-size:9px;font-weight:900}.ba-status.ready{background:#ecfdf3;color:#067647}.ba-status.pending{background:#fff7e8;color:#b54708}.ba-status.conflict{background:#fff1f0;color:#b42318}.ba-status.departed{background:#eff8ff;color:#175cd3}.ba-alert{display:block;max-width:150px;margin-top:4px;color:#b42318;font-size:9px}.ba-check{width:31px;height:31px;border:1px solid #b2ddff;border-radius:7px;background:#eff8ff;color:#175cd3;font-weight:900;cursor:pointer}.ba-alerts{max-height:640px;overflow:auto}.ba-notice{display:grid;gap:2px;padding:12px 13px;border-bottom:1px solid #edf0f4;border-left:4px solid #98a2b3}.ba-notice strong{font-size:12px}.ba-notice span{font-size:11px;color:#667085}.ba-notice.bad{border-left-color:#f04438}.ba-notice.warn{border-left-color:#f79009}.ba-notice.good{border-left-color:#12b76a}.ba-empty{padding:40px;text-align:center;color:#667085}.ba-toast{position:fixed;right:20px;bottom:20px;z-index:9999;max-width:420px;padding:12px 16px;border-radius:10px;background:#102a43;color:#fff;box-shadow:0 12px 30px #10182844;opacity:0;transform:translateY(8px);transition:.2s;pointer-events:none}.ba-toast.error{background:#b42318}.ba-toast.show{opacity:1;transform:none}.ba-print-title{display:none}
    @media(max-width:1200px){.ba-metrics{grid-template-columns:repeat(4,1fr)}.ba-layout{grid-template-columns:1fr}.ba-alerts{max-height:260px}}
    @media(max-width:700px){.ba-head{align-items:flex-start;flex-direction:column}.ba-head-actions{margin:0}.ba-controls{grid-template-columns:1fr 1fr}.ba-metrics{grid-template-columns:repeat(2,1fr)}}
    @media print{body{background:#fff}.sidebar,.topbar,.ba-head,.ba-controls,.ba-metrics,.ba-alerts,.ba-screen{display:none!important}#contentArea{padding:0!important}.ba-layout{display:block}.ba-panel{border:0}.ba-panel-head{display:none}.ba-print-title{display:block;text-align:center;border:2px solid #000;margin-bottom:6px}.ba-print-title h1{margin:0;padding:5px;background:#000;color:#fff;font-size:17px}.ba-print-title h2{margin:4px;font-size:14px}.ba-table-wrap{max-height:none;overflow:visible}.ba-table{min-width:0;border-collapse:collapse;font-size:9px}.ba-table th,.ba-table td{position:static;border:1px solid #000;padding:3px;background:#fff!important;color:#000!important}.ba-section td{background:#000!important;color:#fff!important}.ba-input,.ba-bus,.ba-small{border:0;height:auto;padding:0;appearance:none;font-size:9px}.ba-status{background:none!important;color:#000!important;padding:0}.ba-alert{color:#000}.ba-toast{display:none}}
  `;
  document.head.appendChild(style);
}

export function renderBusAllocationPage() {
  injectStyles();
  els.contentArea.innerHTML = `<div class="ba-page">
    <section class="ba-head"><div><h1>Daily Bus Allocation</h1><p>Plan vehicles, manage roadside relief changeovers and prepare the yard departure sheet.</p></div><div class="ba-head-actions"><button class="ba-btn light" id="baAuto">Auto Plan Buses</button><button class="ba-btn light" id="baPrint">Print / PDF</button></div></section>
    <section class="ba-controls"><label class="ba-field"><span>Operating date</span><input id="baDate" type="date" value="${esc(selectedDate)}"></label><label class="ba-field"><span>Depot</span><select id="baDepot"><option value="">All depots</option></select></label><button class="ba-btn" id="baRefresh">Refresh</button><button class="ba-btn primary" id="baPublish">Publish to Yard</button></section>
    <section class="ba-metrics"><article class="ba-metric blue"><span>Bus duties</span><strong id="baMetricDuties">0</strong></article><article class="ba-metric green"><span>Planned buses</span><strong id="baMetricPlanned">0</strong></article><article class="ba-metric amber"><span>Awaiting bus</span><strong id="baMetricAwaiting">0</strong></article><article class="ba-metric purple"><span>Relief changeovers</span><strong id="baMetricRelief">0</strong></article><article class="ba-metric blue"><span>Buses reused</span><strong id="baMetricReuse">0</strong></article><article class="ba-metric red"><span>Conflicts</span><strong id="baMetricConflicts">0</strong></article><article class="ba-metric"><span>Fleet available</span><strong id="baMetricAvailable">0</strong></article></section>
    <div class="ba-layout"><section class="ba-panel"><div class="ba-print-title"><h1>PUNCHBOWL BUS COMPANY — DAILY DEPARTURE SHEET</h1><h2 id="baPrintDate"></h2></div><div class="ba-panel-head"><div><h2>Departure and Changeover Plan</h2><small>Workshop and Out-of-Service buses are excluded automatically · ${TURNAROUND_MINUTES}-minute reuse buffer</small></div></div><div class="ba-table-wrap"><table class="ba-table"><thead><tr><th>Duty</th><th>Driver</th><th>Start</th><th>Depart</th><th>Movement</th><th>Planned bus / Support car</th><th>Actual bus / Bus on road</th><th>Vehicle / Location</th><th>Return</th><th>Status</th><th class="ba-screen">Confirm</th></tr></thead><tbody id="baRows"></tbody></table></div></section><aside class="ba-panel ba-alerts"><div class="ba-panel-head"><h2>Planning alerts</h2></div><div id="baAlerts"></div></aside></div>
  </div>`;
  document.getElementById("baDate").addEventListener("change", (event) => { selectedDate = event.target.value || localDate(); startListeners(); document.getElementById("baPrintDate").textContent = selectedDate; });
  document.getElementById("baDepot").addEventListener("change", (event) => { depotFilter = event.target.value; renderTable(); });
  document.getElementById("baRefresh").addEventListener("click", renderTable);
  document.getElementById("baAuto").addEventListener("click", autoPlan);
  document.getElementById("baPublish").addEventListener("click", publishToYard);
  document.getElementById("baPrint").addEventListener("click", () => window.print());
  document.getElementById("baPrintDate").textContent = selectedDate;
  startListeners();
}
