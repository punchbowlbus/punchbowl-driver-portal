import {
  collection,
  addDoc,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  limit,
  runTransaction,
  serverTimestamp,
  updateDoc
} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut
} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-auth.js";

import { auth, db, provider } from "./firebase.js";
import { ADMIN_EMAILS } from "./config.js";

const $ = (id) => document.getElementById(id);
const els = {
  authText: $("authText"), loginBtn: $("loginBtn"), logoutBtn: $("logoutBtn"), status: $("status"),
  fleetTableBody: $("fleetTableBody"), fleetSearch: $("fleetSearch"),
  odometerForm: $("odometerForm"), odometerBus: $("odometerBus"), previousOdometer: $("previousOdometer"), currentOdometer: $("currentOdometer"), odometerDate: $("odometerDate"), odometerSource: $("odometerSource"), odometerNotes: $("odometerNotes"), odometerHistory: $("odometerHistory"),
  jobsTableBody: $("jobsTableBody"), jobSearch: $("jobSearch"), jobStatusFilter: $("jobStatusFilter"),
  jobDialog: $("jobDialog"), jobForm: $("jobForm"), jobBus: $("jobBus"), jobType: $("jobType"), jobPriority: $("jobPriority"), jobDueDate: $("jobDueDate"), jobMechanic: $("jobMechanic"), jobFault: $("jobFault"), jobManagerNotes: $("jobManagerNotes"),
  maintenanceDueList: $("maintenanceDueList"), dashboardJobsList: $("dashboardJobsList"), historyList: $("historyList"),
  metricFleet: $("metricFleet"), metricWorkshop: $("metricWorkshop"), metricOut: $("metricOut"), metricOpenJobs: $("metricOpenJobs"), metricDueSoon: $("metricDueSoon"), metricOverdue: $("metricOverdue")
};

let currentUser = null;
let buses = [];
let workshopJobs = [];
let odometerReadings = [];
let unsubscribers = [];

function normalizeEmail(v) { return String(v || "").trim().toLowerCase(); }
function isAdmin(email) { return ADMIN_EMAILS.map(normalizeEmail).includes(normalizeEmail(email)); }
function esc(v) { return String(v ?? "").replace(/[&<>'"]/g, (m) => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[m])); }
function num(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }
function fmtKm(v) { const n = num(v); return n == null ? "—" : `${Math.round(n).toLocaleString("en-AU")} km`; }
function fmtDate(v) {
  if (!v) return "—";
  const d = typeof v?.toDate === "function" ? v.toDate() : new Date(`${v}T00:00:00`);
  return Number.isNaN(d.getTime()) ? String(v) : new Intl.DateTimeFormat("en-AU", { day:"2-digit", month:"short", year:"numeric" }).format(d);
}
function todayStr() { return new Date().toLocaleDateString("en-CA"); }
function showStatus(message, type="success") { els.status.className = `status ${type}`; els.status.textContent = message; }
function clearStatus() { els.status.className = "status"; els.status.textContent = ""; }

function busId(bus) { return bus.id; }
function fleetNo(bus) { return bus.fleetNumber || bus.busNumber || bus.number || bus.id || ""; }
function currentOdo(bus) { return num(bus.currentOdometer ?? bus.odometer ?? bus.odometerKm); }
function nextServiceOdo(bus) { return num(bus.nextServiceOdometer ?? bus.nextServiceKm); }
function nextServiceDate(bus) { return bus.nextServiceDate || ""; }

function maintenanceState(bus) {
  const current = currentOdo(bus);
  const dueKm = nextServiceOdo(bus);
  const dueDate = nextServiceDate(bus);
  let overdue = false;
  let dueSoon = false;
  let detail = "No service schedule";

  if (current != null && dueKm != null) {
    const remaining = dueKm - current;
    if (remaining < 0) { overdue = true; detail = `Overdue by ${fmtKm(Math.abs(remaining))}`; }
    else if (remaining === 0) { overdue = true; detail = "Service due now"; }
    else if (remaining <= 1000) { dueSoon = true; detail = `Due in ${fmtKm(remaining)}`; }
    else detail = `Due in ${fmtKm(remaining)}`;
  }

  if (dueDate) {
    const today = new Date(`${todayStr()}T00:00:00`);
    const due = new Date(`${dueDate}T00:00:00`);
    if (!Number.isNaN(due.getTime())) {
      const days = Math.ceil((due - today) / 86400000);
      if (days < 0) { overdue = true; detail = `${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} overdue`; }
      else if (days === 0) { overdue = true; detail = "Service due today"; }
      else if (days <= 14 && !overdue) { dueSoon = true; detail = `Due in ${days} day${days === 1 ? "" : "s"}`; }
    }
  }

  return { overdue, dueSoon, detail };
}

function serviceBadge(bus) {
  const s = maintenanceState(bus);
  if (s.overdue) return `<span class="badge bad">OVERDUE</span><div class="list-meta">${esc(s.detail)}</div>`;
  if (s.dueSoon) return `<span class="badge warn">DUE SOON</span><div class="list-meta">${esc(s.detail)}</div>`;
  if (nextServiceOdo(bus) != null || nextServiceDate(bus)) return `<span class="badge good">ON TRACK</span><div class="list-meta">${esc(s.detail)}</div>`;
  return `<span class="badge">NOT SET</span>`;
}

function populateBusSelects() {
  const options = [...buses].sort((a,b) => fleetNo(a).localeCompare(fleetNo(b), undefined, {numeric:true})).map((b) => `<option value="${esc(busId(b))}">${esc(fleetNo(b))}${b.rego ? ` · ${esc(b.rego)}` : ""}</option>`).join("");
  els.odometerBus.innerHTML = `<option value="">Select bus</option>${options}`;
  els.jobBus.innerHTML = `<option value="">Select bus</option>${options}`;
}

function renderFleet() {
  const term = String(els.fleetSearch.value || "").trim().toLowerCase();
  const list = buses.filter((b) => [fleetNo(b), b.rego, b.make, b.model, b.depot, b.status].some((v) => String(v || "").toLowerCase().includes(term)));
  if (!list.length) { els.fleetTableBody.innerHTML = `<tr><td colspan="8"><div class="empty">No matching vehicles.</div></td></tr>`; return; }
  els.fleetTableBody.innerHTML = list.map((b) => `
    <tr>
      <td><strong>${esc(fleetNo(b))}</strong></td>
      <td>${esc(b.rego || "—")}</td>
      <td>${esc([b.make,b.model].filter(Boolean).join(" ") || "—")}</td>
      <td>${esc(b.depot || "—")}</td>
      <td>${esc(fmtKm(currentOdo(b)))}</td>
      <td>${serviceBadge(b)}</td>
      <td><span class="badge ${/out of service/i.test(b.status || "") ? "bad" : /workshop/i.test(b.status || "") ? "warn" : "good"}">${esc(b.status || "Active")}</span></td>
      <td><button class="button secondary" data-odo-bus="${esc(busId(b))}">Update km</button></td>
    </tr>`).join("");
  els.fleetTableBody.querySelectorAll("[data-odo-bus]").forEach((btn) => btn.addEventListener("click", () => {
    switchView("odometer"); els.odometerBus.value = btn.dataset.odoBus; syncPreviousOdometer();
  }));
}

function renderDashboard() {
  const maint = buses.map((bus) => ({bus, state:maintenanceState(bus)}));
  const overdue = maint.filter((x) => x.state.overdue);
  const dueSoon = maint.filter((x) => !x.state.overdue && x.state.dueSoon);
  const openJobs = workshopJobs.filter((j) => !["Completed","Closed","Cancelled"].includes(j.status));
  els.metricFleet.textContent = buses.length;
  els.metricWorkshop.textContent = buses.filter((b) => /workshop/i.test(b.status || "")).length;
  els.metricOut.textContent = buses.filter((b) => /out of service/i.test(b.status || "")).length;
  els.metricOpenJobs.textContent = openJobs.length;
  els.metricDueSoon.textContent = dueSoon.length;
  els.metricOverdue.textContent = overdue.length;

  const dueList = [...overdue, ...dueSoon].slice(0,12);
  els.maintenanceDueList.innerHTML = dueList.length ? dueList.map(({bus,state}) => `
    <div class="list-item"><div class="list-top"><div><div class="list-title">${esc(fleetNo(bus))}</div><div class="list-meta">Current: ${esc(fmtKm(currentOdo(bus)))} · Next service: ${esc(fmtKm(nextServiceOdo(bus)))}</div></div><span class="badge ${state.overdue ? "bad" : "warn"}">${state.overdue ? "OVERDUE" : "DUE SOON"}</span></div><div class="list-meta">${esc(state.detail)}</div></div>`).join("") : `<div class="empty">No buses currently due based on recorded schedules.</div>`;

  els.dashboardJobsList.innerHTML = openJobs.length ? openJobs.slice(0,10).map(jobCardSummary).join("") : `<div class="empty">No open workshop jobs.</div>`;
}

function jobCardSummary(j) {
  return `<div class="list-item"><div class="list-top"><div><div class="list-title">${esc(j.jobNumber || j.id)} · ${esc(j.fleetNumber || "")}</div><div class="list-meta">${esc(j.jobType || "Workshop Job")} · ${esc(j.reportedFault || "")}</div></div><span class="badge info">${esc(j.status || "New")}</span></div><div class="list-meta">Assigned: ${esc(j.assignedMechanic || "Unassigned")} · Due: ${esc(fmtDate(j.dueDate))}</div></div>`;
}

function renderJobs() {
  const term = String(els.jobSearch.value || "").trim().toLowerCase();
  const status = els.jobStatusFilter.value;
  const list = workshopJobs.filter((j) => (!status || j.status === status) && [j.jobNumber,j.fleetNumber,j.jobType,j.assignedMechanic,j.reportedFault].some((v) => String(v || "").toLowerCase().includes(term)));
  els.jobsTableBody.innerHTML = list.length ? list.map((j) => `<tr><td><strong>${esc(j.jobNumber || j.id)}</strong></td><td>${esc(j.fleetNumber || "—")}</td><td>${esc(j.jobType || "—")}</td><td><span class="badge ${/urgent|critical/i.test(j.priority || "") ? "bad" : /high/i.test(j.priority || "") ? "warn" : ""}">${esc(j.priority || "Normal")}</span></td><td>${esc(j.assignedMechanic || "Unassigned")}</td><td>${esc(j.status || "New")}</td><td>${esc(fmtDate(j.dueDate))}</td></tr>`).join("") : `<tr><td colspan="7"><div class="empty">No workshop jobs found.</div></td></tr>`;

  const history = workshopJobs.filter((j) => ["Completed","Closed"].includes(j.status));
  els.historyList.innerHTML = history.length ? history.map(jobCardSummary).join("") : `<div class="empty">No completed job cards yet.</div>`;
}

function renderOdometerHistory() {
  els.odometerHistory.innerHTML = odometerReadings.length ? odometerReadings.slice(0,30).map((r) => `<div class="list-item"><div class="list-top"><div><div class="list-title">${esc(r.fleetNumber || "Vehicle")}</div><div class="list-meta">${esc(fmtDate(r.readingDate))} · ${esc(r.source || "")}</div></div><strong>${esc(fmtKm(r.currentOdometer))}</strong></div><div class="list-meta">Previous: ${esc(fmtKm(r.previousOdometer))} · Entered by ${esc(r.enteredByEmail || "")}</div></div>`).join("") : `<div class="empty">No odometer history yet.</div>`;
}

function syncPreviousOdometer() {
  const bus = buses.find((b) => b.id === els.odometerBus.value);
  els.previousOdometer.value = bus && currentOdo(bus) != null ? String(currentOdo(bus)) : "";
  els.currentOdometer.min = bus && currentOdo(bus) != null ? String(currentOdo(bus)) : "0";
}

async function saveOdometer(e) {
  e.preventDefault(); clearStatus();
  const bus = buses.find((b) => b.id === els.odometerBus.value);
  if (!bus) return showStatus("Select a bus.", "error");
  const newReading = num(els.currentOdometer.value);
  if (newReading == null || newReading < 0) return showStatus("Enter a valid current odometer reading.", "error");
  const readingDate = els.odometerDate.value || todayStr();
  const busRef = doc(db, "buses", bus.id);
  const readingRef = doc(collection(db, "odometerReadings"));
  try {
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(busRef);
      if (!snap.exists()) throw new Error("Bus record no longer exists.");
      const data = snap.data();
      const previous = num(data.currentOdometer ?? data.odometer ?? data.odometerKm);
      if (previous != null && newReading < previous) throw new Error(`Current reading cannot be lower than the previous reading (${previous.toLocaleString("en-AU")} km).`);
      tx.set(readingRef, {
        busId: bus.id, fleetNumber: fleetNo({id:bus.id,...data}), previousOdometer: previous, currentOdometer: newReading,
        readingDate, source: els.odometerSource.value || "Fleet Manager", notes: els.odometerNotes.value.trim(), enteredByEmail: normalizeEmail(currentUser.email), createdAt: serverTimestamp()
      });
      tx.update(busRef, { currentOdometer:newReading, lastOdometerDate:readingDate, lastOdometerUpdatedAt:serverTimestamp(), lastOdometerUpdatedBy:normalizeEmail(currentUser.email) });
    });
    els.currentOdometer.value = ""; els.odometerNotes.value = ""; showStatus(`Odometer saved for ${fleetNo(bus)}.`);
  } catch (err) { showStatus(err?.message || "Unable to save odometer reading.", "error"); }
}

async function createWorkshopJob(e) {
  e.preventDefault(); clearStatus();
  const bus = buses.find((b) => b.id === els.jobBus.value);
  if (!bus) return showStatus("Select a bus for this job.", "error");
  const fault = els.jobFault.value.trim();
  if (!fault) return showStatus("Describe the work required.", "error");
  const now = Date.now();
  const jobNumber = `WJ-${new Date().getFullYear()}-${String(now).slice(-6)}`;
  try {
    await addDoc(collection(db, "workshopJobs"), {
      jobNumber, busId:bus.id, fleetNumber:fleetNo(bus), rego:bus.rego || "", jobType:els.jobType.value, priority:els.jobPriority.value || "Normal",
      status:els.jobMechanic.value.trim() ? "Assigned" : "New", assignedMechanic:els.jobMechanic.value.trim(), dueDate:els.jobDueDate.value || "",
      source:"Fleet Manager", sourceDefectId:"", reportedFault:fault, managerNotes:els.jobManagerNotes.value.trim(), odometerStart:currentOdo(bus),
      diagnosis:"", workCompleted:"", partsUsed:[], labourEntries:[], returnToServiceApproved:false,
      createdByEmail:normalizeEmail(currentUser.email), createdAt:serverTimestamp(), updatedAt:serverTimestamp(), schemaVersion:1
    });
    els.jobForm.reset(); els.jobDialog.close(); showStatus(`Workshop job ${jobNumber} created successfully.`);
  } catch (err) { showStatus(err?.message || "Unable to create workshop job.", "error"); }
}

function openJobDialog(busId="") { els.jobForm.reset(); if (busId) els.jobBus.value = busId; els.jobDialog.showModal(); }
function switchView(name) {
  document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
  document.querySelectorAll(".nav-item").forEach((b) => b.classList.toggle("active", b.dataset.view === name));
  $(`${name}View`)?.classList.add("active");
}

function startListeners() {
  stopListeners();
  unsubscribers.push(onSnapshot(collection(db,"buses"), (snap) => {
    buses = snap.docs.map((d) => ({id:d.id,...d.data()})); populateBusSelects(); renderFleet(); renderDashboard(); syncPreviousOdometer();
  }, (err) => showStatus(err?.message || "Unable to load fleet.", "error")));

  unsubscribers.push(onSnapshot(query(collection(db,"workshopJobs"), orderBy("createdAt","desc"), limit(200)), (snap) => {
    workshopJobs = snap.docs.map((d) => ({id:d.id,...d.data()})); renderJobs(); renderDashboard();
  }, (err) => {
    console.error(err); workshopJobs = []; renderJobs(); renderDashboard(); showStatus("Workshop jobs could not be loaded. Check Firestore permissions for workshopJobs.", "error");
  }));

  unsubscribers.push(onSnapshot(query(collection(db,"odometerReadings"), orderBy("createdAt","desc"), limit(100)), (snap) => {
    odometerReadings = snap.docs.map((d) => ({id:d.id,...d.data()})); renderOdometerHistory();
  }, (err) => {
    console.error(err); odometerReadings = []; renderOdometerHistory(); showStatus("Odometer history could not be loaded. Check Firestore permissions for odometerReadings.", "error");
  }));
}
function stopListeners() { unsubscribers.forEach((u) => { try { u(); } catch {} }); unsubscribers = []; }

els.odometerDate.value = todayStr();
document.querySelectorAll(".nav-item").forEach((b) => b.addEventListener("click", () => switchView(b.dataset.view)));
els.fleetSearch.addEventListener("input", renderFleet); els.jobSearch.addEventListener("input", renderJobs); els.jobStatusFilter.addEventListener("change", renderJobs);
els.odometerBus.addEventListener("change", syncPreviousOdometer); els.odometerForm.addEventListener("submit", saveOdometer); els.jobForm.addEventListener("submit", createWorkshopJob);
$("createJobBtn").addEventListener("click", () => openJobDialog()); $("dashboardCreateJobBtn").addEventListener("click", () => openJobDialog());
$("closeJobDialog").addEventListener("click", () => els.jobDialog.close()); $("cancelJobBtn").addEventListener("click", () => els.jobDialog.close());
els.loginBtn.addEventListener("click", () => signInWithPopup(auth,provider)); els.logoutBtn.addEventListener("click", () => signOut(auth));

onAuthStateChanged(auth, (user) => {
  currentUser = user;
  if (!user) {
    stopListeners(); els.authText.textContent = "Not signed in"; els.loginBtn.hidden = false; els.logoutBtn.hidden = true;
    showStatus("Sign in with an authorised admin account to use Workshop Management.", "error"); return;
  }
  const allowed = isAdmin(user.email);
  els.authText.textContent = allowed ? `Admin: ${user.email}` : `Signed in: ${user.email}`;
  els.loginBtn.hidden = true; els.logoutBtn.hidden = false;
  if (!allowed) { stopListeners(); showStatus("Your account does not have Workshop Management access.", "error"); return; }
  clearStatus(); startListeners();
});
