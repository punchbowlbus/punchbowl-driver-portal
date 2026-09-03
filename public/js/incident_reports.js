import {
  collection, doc, getDocs, limit, query, serverTimestamp, setDoc, updateDoc, where
} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";
import {
  ref, uploadBytes, getDownloadURL, deleteObject
} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-storage.js";

import { auth, db, storage } from "./firebase.js";
import { state } from "./state.js";
import { els, showError } from "./ui.js";
import { escapeHtml } from "./utils.js";
import { openDriverCollisionClaim, collisionAdminSection, bindCollisionAdmin } from "./collision_claim.js";

const MAX_PHOTOS = 3;
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
const NONE_BUS_ID = "__NOT_VEHICLE_RELATED__";

function employeeName(employee = {}) {
  return String(employee.displayName || employee.name || `${employee.firstName || ""} ${employee.lastName || ""}`.trim() || auth.currentUser?.displayName || auth.currentUser?.email || "Portal user").trim();
}

function localDateString(date = new Date()) {
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

function localTimeString(date = new Date()) {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function safeFileName(name) {
  return String(name || "photo.jpg").replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 100);
}

function busLabel(bus) {
  return [bus?.fleetNumber || bus?.id, bus?.rego, bus?.depot].filter(Boolean).map(String).filter((value, index, list) => list.indexOf(value) === index).join(" · ");
}

async function loadFleet() {
  const snapshot = await getDocs(collection(db, "buses"));
  return snapshot.docs.map((item) => ({id: item.id, ...item.data()}))
    .filter((bus) => bus.deleted !== true && String(bus.status || "Active").toLowerCase() !== "inactive")
    .sort((a, b) => String(a.fleetNumber || a.id).localeCompare(String(b.fleetNumber || b.id), undefined, {numeric: true}));
}

function validatePhotos(files) {
  if (files.length > MAX_PHOTOS) return `Please select no more than ${MAX_PHOTOS} photos.`;
  for (const file of files) {
    if (!String(file.type || "").startsWith("image/")) return `${file.name} is not an image.`;
    if (file.size > MAX_PHOTO_BYTES) return `${file.name} is larger than 8 MB.`;
  }
  return "";
}

function renderPhotoPreview(files) {
  const preview = document.getElementById("incidentPhotoPreview");
  if (!preview) return;
  preview.innerHTML = "";
  files.forEach((file) => {
    const image = document.createElement("img");
    image.src = URL.createObjectURL(file);
    image.alt = file.name;
    image.onload = () => URL.revokeObjectURL(image.src);
    preview.appendChild(image);
  });
}

function urgencyFromAnswers({injury, emergencyServices, policeContacted, safeToContinue}) {
  if (injury === "Yes" || emergencyServices === "Yes" || safeToContinue === "No") return "Critical";
  if (policeContacted === "Yes") return "High";
  return "Standard";
}

function formatDate(date, time) {
  if (!date) return "Date unavailable";
  const parsed = new Date(`${date}T${time || "00:00"}`);
  if (Number.isNaN(parsed.getTime())) return `${date}${time ? ` · ${time}` : ""}`;
  return new Intl.DateTimeFormat("en-AU", {dateStyle: "medium", timeStyle: time ? "short" : undefined}).format(parsed);
}

async function loadMyReports(uid) {
  if (!uid) return [];
  const snapshot = await getDocs(query(collection(db, "incidentReports"), where("reportedByUid", "==", uid), limit(50)));
  return snapshot.docs.map((item) => ({id: item.id, ...item.data()}))
    .filter((item) => item.deleted !== true)
    .sort((a, b) => String(b.reportedAtIso || "").localeCompare(String(a.reportedAtIso || "")))
    .slice(0, 10);
}

function renderRecentReports(reports) {
  const list = document.getElementById("incidentRecentList");
  if (!list) return;
  if (!reports.length) {
    list.innerHTML = `<div class="incident-empty">You have not submitted any incident reports.</div>`;
    return;
  }
  list.innerHTML = reports.map((report) => `
    <article class="incident-recent-item">
      <div class="incident-recent-top"><strong>${escapeHtml(report.reportNumber || report.id)}</strong><span class="${String(report.urgency || "").toLowerCase()}">${escapeHtml(report.status || "Submitted")}</span></div>
      <h4>${escapeHtml(report.category || "Incident")}</h4>
      <p>${escapeHtml(formatDate(report.incidentDate, report.incidentTime))}</p>
      <small>${escapeHtml(report.location || "Location not recorded")} · Urgency: ${escapeHtml(report.urgency || "Standard")}</small>
      ${report.category === "Collision" ? `<button type="button" class="incident-collision-continue" data-collision-report-id="${escapeHtml(report.id)}">${report.collisionClaimStatus === "Submitted for review" || report.collisionClaimStatus === "Ready to print" ? "View Motor Claim" : "Continue Motor Claim"}</button>` : ""}
    </article>`).join("");
}

const INCIDENT_STATUSES = ["Submitted", "Under Review", "Awaiting Information", "Corrective Action", "Closed"];
const INCIDENT_SEVERITIES = ["Standard", "High", "Critical"];

function reportSortValue(report) {
  return String(report.reportedAtIso || report.incidentDate || "");
}

function reportStatusClass(value) {
  return String(value || "submitted").toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

function reportSearchText(report) {
  return [report.reportNumber, report.reportedByName, report.reportedByEmployeeNumber,
    report.fleetNumber, report.rego, report.category, report.location, report.description,
    report.status, report.urgency, report.adminSeverity].filter(Boolean).join(" ").toLowerCase();
}

function optionList(values, selected) {
  return values.map((value) => `<option value="${escapeHtml(value)}" ${value === selected ? "selected" : ""}>${escapeHtml(value)}</option>`).join("");
}

async function loadIncidentAdminData() {
  const [reportSnapshot, employeeSnapshot] = await Promise.all([
    getDocs(collection(db, "incidentReports")),
    getDocs(collection(db, "employees"))
  ]);
  const reports = reportSnapshot.docs.map((item) => ({id: item.id, ...item.data()}))
    .filter((item) => item.deleted !== true)
    .sort((a, b) => reportSortValue(b).localeCompare(reportSortValue(a)));
  const staff = employeeSnapshot.docs.map((item) => ({id: item.id, ...item.data()}))
    .filter((item) => String(item.status || "Active").toLowerCase() === "active")
    .filter((item) => ["admin", "dispatcher", "manager", "supervisor", "operations"].includes(String(item.role || "").toLowerCase()) || String(item.accessLevel || "").toLowerCase().includes("admin"))
    .sort((a, b) => employeeName(a).localeCompare(employeeName(b)));
  return {reports, staff};
}

function adminPhotos(report) {
  if (!Array.isArray(report.photos) || !report.photos.length) return `<div class="incident-admin-no-photos">No photos attached.</div>`;
  return `<div class="incident-admin-photos">${report.photos.map((photo, index) => `<a href="${escapeHtml(photo.url || "#")}" target="_blank" rel="noopener"><img src="${escapeHtml(photo.url || "")}" alt="Incident photo ${index + 1}" /><span>Photo ${index + 1}</span></a>`).join("")}</div>`;
}

function adminReportDetail(report, staff) {
  if (!report) return `<div class="incident-admin-empty-detail"><i data-lucide="mouse-pointer-click"></i><h3>Select an incident report</h3><p>Choose a report to review, assign and update it.</p></div>`;
  const severity = report.adminSeverity || report.urgency || "Standard";
  const selectedStaffKey = report.assignedToEmployeeNumber || "";
  return `
    <div class="incident-admin-detail-head">
      <div><div class="incident-eyebrow">Incident record</div><h3>${escapeHtml(report.reportNumber || report.id)}</h3><p>${escapeHtml(formatDate(report.incidentDate, report.incidentTime))}</p></div>
      <div class="incident-admin-head-badges"><span class="incident-admin-badge ${reportStatusClass(severity)}">${escapeHtml(severity)}</span><span class="incident-admin-badge ${reportStatusClass(report.status)}">${escapeHtml(report.status || "Submitted")}</span></div>
    </div>
    <div id="incidentAdminMessage" class="incident-message" hidden></div>

    <section class="incident-admin-section">
      <h4>Driver and incident</h4>
      <div class="incident-admin-facts">
        <div><span>Reported by</span><strong>${escapeHtml(report.reportedByName || "Unknown")}</strong><small>${escapeHtml(report.reportedByEmployeeNumber || report.reportedByEmail || "")}</small></div>
        <div><span>Vehicle</span><strong>${report.vehicleRelated === false ? "Not vehicle-related" : escapeHtml(report.fleetNumber || report.busId || "Not recorded")}</strong><small>${escapeHtml([report.rego, report.depot].filter(Boolean).join(" · "))}</small></div>
        <div><span>Category</span><strong>${escapeHtml(report.category || "Not recorded")}</strong></div>
        <div><span>Location</span><strong>${escapeHtml(report.location || "Not recorded")}</strong></div>
      </div>
    </section>

    <section class="incident-admin-section">
      <h4>Safety assessment</h4>
      <div class="incident-admin-safety">
        <span class="${report.injury === "Yes" ? "alert" : ""}">Injury <b>${escapeHtml(report.injury || "—")}</b></span>
        <span class="${report.emergencyServices === "Yes" ? "alert" : ""}">Emergency services <b>${escapeHtml(report.emergencyServices || "—")}</b></span>
        <span class="${report.policeContacted === "Yes" ? "warn" : ""}">Police <b>${escapeHtml(report.policeContacted || "—")}</b></span>
        <span class="${report.safeToContinue === "No" ? "alert" : ""}">Safe to continue <b>${escapeHtml(report.safeToContinue || "—")}</b></span>
      </div>
      ${report.policeReference ? `<p class="incident-admin-police-ref"><b>Police reference:</b> ${escapeHtml(report.policeReference)}</p>` : ""}
    </section>

    <section class="incident-admin-section">
      <h4>Report statement</h4>
      ${report.peopleInvolved ? `<div class="incident-admin-statement"><span>People involved</span><p>${escapeHtml(report.peopleInvolved)}</p></div>` : ""}
      ${report.witnessDetails ? `<div class="incident-admin-statement"><span>Witnesses</span><p>${escapeHtml(report.witnessDetails)}</p></div>` : ""}
      <div class="incident-admin-statement"><span>What happened</span><p>${escapeHtml(report.description || "No description supplied.")}</p></div>
      <div class="incident-admin-statement"><span>Immediate actions</span><p>${escapeHtml(report.immediateActions || "No actions supplied.")}</p></div>
      ${adminPhotos(report)}
    </section>

    ${collisionAdminSection(report)}

    <section class="incident-admin-section incident-admin-review">
      <h4>Investigation and actions</h4>
      <div class="incident-grid">
        <label><span>Status <b>*</b></span><select id="incidentAdminStatus" ${report.status === "Closed" ? "disabled" : ""}>${optionList(report.status === "Closed" ? ["Closed"] : INCIDENT_STATUSES.filter((item) => item !== "Closed"), report.status || "Submitted")}</select></label>
        <label><span>Severity <b>*</b></span><select id="incidentAdminSeverity">${optionList(INCIDENT_SEVERITIES, severity)}</select></label>
        <label class="incident-full"><span>Assigned staff member</span><select id="incidentAdminAssignee"><option value="">Unassigned</option>${staff.map((employee) => `<option value="${escapeHtml(employee.employeeNumber || employee.id)}" ${(employee.employeeNumber || employee.id) === selectedStaffKey ? "selected" : ""}>${escapeHtml(employeeName(employee))}${employee.role ? ` · ${escapeHtml(employee.role)}` : ""}</option>`).join("")}</select></label>
        <label class="incident-full"><span>Investigation summary</span><textarea id="incidentAdminInvestigation" maxlength="4000" placeholder="Record verified facts, contributing factors and investigation progress">${escapeHtml(report.investigationSummary || "")}</textarea></label>
        <label class="incident-full"><span>Corrective actions</span><textarea id="incidentAdminCorrective" maxlength="4000" placeholder="Actions required, responsible person and due date">${escapeHtml(report.correctiveActions || "")}</textarea></label>
        <label class="incident-full"><span>Internal notes</span><textarea id="incidentAdminNotes" maxlength="4000" placeholder="Internal Operations notes — not shown to the driver">${escapeHtml(report.adminNotes || "")}</textarea></label>
        <label class="incident-full"><span>Outcome / closure summary</span><textarea id="incidentAdminOutcome" maxlength="3000" placeholder="Required before closing the incident">${escapeHtml(report.outcome || "")}</textarea></label>
      </div>
      <div class="incident-admin-save-row"><small id="incidentAdminSavedMeta">${report.updatedByName ? `Last updated by ${escapeHtml(report.updatedByName)}` : "Changes are recorded against your signed-in account."}</small><button id="incidentAdminSave" type="button" class="btn"><i data-lucide="save"></i> Save progress</button><button id="incidentAdminClose" type="button" class="btn danger" ${report.status === "Closed" ? "disabled" : ""}><i data-lucide="circle-check-big"></i> Close report</button></div>
    </section>`;
}

async function renderIncidentAdminCRM() {
  els.contentArea.innerHTML = `<div class="incident-page"><header class="incident-hero"><div class="incident-hero-icon"><i data-lucide="shield-alert"></i></div><div class="incident-hero-copy"><div class="incident-eyebrow">Safety management</div><h2>Incident Report CRM</h2><p>Review, investigate and close driver incident reports.</p></div><button id="incidentAdminRefresh" class="btn incident-admin-refresh"><i data-lucide="refresh-cw"></i> Refresh</button></header><div class="incident-admin-loading">Loading incident reports…</div></div>`;
  window.lucide?.createIcons?.();
  let reports = [];
  let staff = [];
  let selectedId = "";

  try {
    ({reports, staff} = await loadIncidentAdminData());
  } catch (error) {
    console.error("Unable to load Incident CRM", error);
    els.contentArea.querySelector(".incident-admin-loading").innerHTML = `<div class="incident-message error">${escapeHtml(error?.message || "Unable to load incident reports.")}</div>`;
    return;
  }

  els.contentArea.innerHTML = `
    <div class="incident-page incident-admin-page">
      <header class="incident-hero"><div class="incident-hero-icon"><i data-lucide="shield-alert"></i></div><div class="incident-hero-copy"><div class="incident-eyebrow">Safety management</div><h2>Incident Report CRM</h2><p>Review, investigate and close driver incident reports.</p></div><button id="incidentAdminRefresh" class="btn incident-admin-refresh"><i data-lucide="refresh-cw"></i> Refresh</button></header>
      <div id="incidentAdminSummary" class="incident-admin-summary"></div>
      <section class="incident-admin-filters">
        <label><span>Search</span><input id="incidentAdminSearch" placeholder="Reference, driver, bus, category or location" /></label>
        <label><span>Status</span><select id="incidentAdminStatusFilter"><option value="">All statuses</option>${INCIDENT_STATUSES.map((item) => `<option>${item}</option>`).join("")}</select></label>
        <label><span>Urgency</span><select id="incidentAdminUrgencyFilter"><option value="">All urgency levels</option>${INCIDENT_SEVERITIES.map((item) => `<option>${item}</option>`).join("")}</select></label>
        <label><span>Assignment</span><select id="incidentAdminAssignmentFilter"><option value="">All reports</option><option value="unassigned">Unassigned only</option><option value="mine">Assigned to me</option></select></label>
      </section>
      <div class="incident-admin-workspace"><section class="incident-admin-list"><div class="incident-admin-list-head"><h3>Reports</h3><span id="incidentAdminResultCount"></span></div><div id="incidentAdminListBody"></div></section><section id="incidentAdminDetail" class="incident-admin-detail"></section></div>
    </div>`;
  window.lucide?.createIcons?.();

  const searchEl = document.getElementById("incidentAdminSearch");
  const statusFilter = document.getElementById("incidentAdminStatusFilter");
  const urgencyFilter = document.getElementById("incidentAdminUrgencyFilter");
  const assignmentFilter = document.getElementById("incidentAdminAssignmentFilter");
  const listBody = document.getElementById("incidentAdminListBody");
  const detail = document.getElementById("incidentAdminDetail");
  const resultCount = document.getElementById("incidentAdminResultCount");

  function filteredReports() {
    const text = searchEl.value.trim().toLowerCase();
    return reports.filter((report) => {
      if (text && !reportSearchText(report).includes(text)) return false;
      if (statusFilter.value && (report.status || "Submitted") !== statusFilter.value) return false;
      if (urgencyFilter.value && (report.adminSeverity || report.urgency || "Standard") !== urgencyFilter.value) return false;
      if (assignmentFilter.value === "unassigned" && (report.assignedToEmployeeNumber || report.assignedToEmail)) return false;
      if (assignmentFilter.value === "mine" && report.assignedToEmail !== auth.currentUser?.email && report.assignedToEmployeeNumber !== String(state.employee?.employeeNumber || "")) return false;
      return true;
    });
  }

  function renderSummary() {
    const active = reports.filter((item) => (item.status || "Submitted") !== "Closed");
    const count = (predicate) => reports.filter(predicate).length;
    document.getElementById("incidentAdminSummary").innerHTML = `
      <div><span>Open</span><strong>${active.length}</strong></div><div><span>Critical</span><strong>${count((item) => (item.adminSeverity || item.urgency) === "Critical" && item.status !== "Closed")}</strong></div><div><span>Unassigned</span><strong>${count((item) => item.status !== "Closed" && !item.assignedToEmployeeNumber && !item.assignedToEmail)}</strong></div><div><span>Awaiting information</span><strong>${count((item) => item.status === "Awaiting Information")}</strong></div><div><span>Closed</span><strong>${count((item) => item.status === "Closed")}</strong></div>`;
  }

  function renderList() {
    const visible = filteredReports();
    resultCount.textContent = `${visible.length} result${visible.length === 1 ? "" : "s"}`;
    if (!visible.some((item) => item.id === selectedId)) selectedId = "";
    listBody.innerHTML = visible.length ? visible.map((report) => {
      const severity = report.adminSeverity || report.urgency || "Standard";
      return `<button type="button" class="incident-admin-list-item ${report.id === selectedId ? "selected" : ""}" data-incident-id="${escapeHtml(report.id)}"><div><strong>${escapeHtml(report.reportNumber || report.id)}</strong><span class="incident-admin-badge ${reportStatusClass(severity)}">${escapeHtml(severity)}</span></div><h4>${escapeHtml(report.category || "Incident")}</h4><p>${escapeHtml(report.reportedByName || "Unknown driver")} · ${escapeHtml(report.fleetNumber || (report.vehicleRelated === false ? "Non-vehicle" : "No bus"))}</p><small>${escapeHtml(formatDate(report.incidentDate, report.incidentTime))} · ${escapeHtml(report.status || "Submitted")}</small></button>`;
    }).join("") : `<div class="incident-empty">No reports match these filters.</div>`;
    listBody.querySelectorAll("[data-incident-id]").forEach((button) => button.onclick = () => { selectedId = button.dataset.incidentId; renderList(); renderDetail(); });
  }

  function adminMessage(message, type = "error") {
    const element = document.getElementById("incidentAdminMessage");
    if (!element) return;
    element.textContent = message; element.className = `incident-message ${type}`; element.hidden = !message;
  }

  function renderDetail() {
    const report = reports.find((item) => item.id === selectedId) || null;
    detail.innerHTML = adminReportDetail(report, staff);
    window.lucide?.createIcons?.();
    if (!report) return;
    bindCollisionAdmin(report, {message: adminMessage, changed: () => { renderSummary(); renderList(); }});
    const saveBtn = document.getElementById("incidentAdminSave");
    const closeBtn = document.getElementById("incidentAdminClose");

    async function saveReport(closeReport = false) {
      const status = closeReport ? "Closed" : document.getElementById("incidentAdminStatus").value;
      const severity = document.getElementById("incidentAdminSeverity").value;
      const assigneeKey = document.getElementById("incidentAdminAssignee").value;
      const assignee = staff.find((employee) => String(employee.employeeNumber || employee.id) === assigneeKey) || null;
      const investigationSummary = document.getElementById("incidentAdminInvestigation").value.trim();
      const correctiveActions = document.getElementById("incidentAdminCorrective").value.trim();
      const adminNotes = document.getElementById("incidentAdminNotes").value.trim();
      const outcome = document.getElementById("incidentAdminOutcome").value.trim();
      if (closeReport && !outcome) return adminMessage("Enter an outcome / closure summary before closing this report.");
      if (closeReport && !confirm(`Close ${report.reportNumber || report.id}? This will mark the investigation as completed.`)) return;
      saveBtn.disabled = true; closeBtn.disabled = true;
      const activeButton = closeReport ? closeBtn : saveBtn;
      const oldHtml = activeButton.innerHTML;
      activeButton.textContent = closeReport ? "Closing report…" : "Saving…";
      try {
        const patch = {
          status, adminSeverity: severity,
          assignedToEmployeeNumber: assignee ? String(assignee.employeeNumber || assignee.id) : "",
          assignedToName: assignee ? employeeName(assignee) : "",
          assignedToEmail: assignee?.email || "",
          investigationSummary, correctiveActions, adminNotes, outcome,
          updatedByUid: auth.currentUser?.uid || "", updatedByEmail: auth.currentUser?.email || "",
          updatedByName: employeeName(state.employee || {}), updatedAt: serverTimestamp()
        };
        if (closeReport) Object.assign(patch, {closedAt: serverTimestamp(), closedByUid: auth.currentUser?.uid || "", closedByEmail: auth.currentUser?.email || "", closedByName: employeeName(state.employee || {})});
        await updateDoc(doc(db, "incidentReports", report.id), patch);
        Object.assign(report, patch, {updatedByName: employeeName(state.employee || {})});
        adminMessage(closeReport ? `${report.reportNumber} closed successfully.` : `${report.reportNumber} saved successfully.`, "success");
        renderSummary(); renderList();
        document.getElementById("incidentAdminSavedMeta").textContent = `Updated now by ${employeeName(state.employee || {})}`;
        if (closeReport) { document.getElementById("incidentAdminStatus").value = "Closed"; closeBtn.disabled = true; }
      } catch (error) {
        console.error("Unable to update incident report", error); adminMessage(error?.message || "Unable to save the incident report.");
      } finally {
        saveBtn.disabled = false;
        if (!closeReport) closeBtn.disabled = report.status === "Closed";
        activeButton.innerHTML = oldHtml; window.lucide?.createIcons?.();
      }
    }
    saveBtn.onclick = () => saveReport(false);
    closeBtn.onclick = () => saveReport(true);
  }

  [searchEl, statusFilter, urgencyFilter, assignmentFilter].forEach((element) => element.addEventListener(element === searchEl ? "input" : "change", () => { renderList(); renderDetail(); }));
  document.getElementById("incidentAdminRefresh").onclick = async () => {
    const button = document.getElementById("incidentAdminRefresh"); button.disabled = true; button.textContent = "Refreshing…";
    try { ({reports, staff} = await loadIncidentAdminData()); renderSummary(); renderList(); renderDetail(); }
    catch (error) { console.error("Unable to refresh Incident CRM", error); alert(error?.message || "Unable to refresh incident reports."); }
    finally { button.disabled = false; button.innerHTML = `<i data-lucide="refresh-cw"></i> Refresh`; window.lucide?.createIcons?.(); }
  };
  renderSummary(); renderList(); renderDetail();
}

export async function renderIncidentReportPage() {
  showError("");
  if (state.isAdmin && !state.isDriver) {
    await renderIncidentAdminCRM();
    return;
  }

  const employee = state.employee || {};
  const reporterName = employeeName(employee);
  const employeeNumber = String(employee.employeeNumber || "").trim();

  els.contentArea.innerHTML = `
    <div class="incident-page">
      <header class="incident-hero">
        <div class="incident-hero-icon"><i data-lucide="shield-alert"></i></div>
        <div class="incident-hero-copy"><div class="incident-eyebrow">Safety and operations</div><h2>Report an incident</h2><p>Record what happened as soon as it is safe to do so.</p></div>
        <div class="incident-reporter"><span>Reporting as</span><strong>${escapeHtml(reporterName)}</strong>${employeeNumber ? `<small>Employee ${escapeHtml(employeeNumber)}</small>` : ""}</div>
      </header>

      <div class="incident-layout">
        <section class="card incident-form-card">
          <div id="incidentMessage" class="incident-message" hidden></div>

          <section class="incident-section">
            <div class="incident-section-heading"><span>1</span><div><h3>Incident details</h3><p>Tell Operations when and where the incident occurred.</p></div></div>
            <div class="incident-grid">
              <label><span>Incident date <b>*</b></span><input id="incidentDate" type="date" required /></label>
              <label><span>Incident time <b>*</b></span><input id="incidentTime" type="time" required /></label>
              <label><span>Bus number <b>*</b></span><select id="incidentBus"><option value="">Loading fleet…</option></select></label>
              <label><span>Incident category <b>*</b></span><select id="incidentCategory"><option value="">Select category</option><option>Collision</option><option>Customer / Passenger Incident</option><option>Employee Injury</option><option>Near Miss</option><option>Property Damage</option><option>Security / Antisocial Behaviour</option><option>Slip, Trip or Fall</option><option>Traffic Incident</option><option>Vehicle Incident</option><option>Other</option></select></label>
              <label class="incident-full"><span>Location <b>*</b></span><input id="incidentLocation" maxlength="250" placeholder="Street, suburb, station, depot or nearest known location" /></label>
            </div>
          </section>

          <section class="incident-section">
            <div class="incident-section-heading"><span>2</span><div><h3>Immediate safety assessment</h3><p>Your answers help Operations determine how urgently to respond.</p></div></div>
            <div class="incident-grid">
              <label><span>Was anyone injured? <b>*</b></span><select id="incidentInjury"><option value="">Select Yes or No</option><option>Yes</option><option>No</option></select></label>
              <label><span>Were emergency services contacted? <b>*</b></span><select id="incidentEmergency"><option value="">Select Yes or No</option><option>Yes</option><option>No</option></select></label>
              <label><span>Were Police contacted? <b>*</b></span><select id="incidentPolice"><option value="">Select Yes or No</option><option>Yes</option><option>No</option></select></label>
              <label><span>Can you safely continue your duty? <b>*</b></span><select id="incidentSafeToContinue"><option value="">Select Yes or No</option><option>Yes</option><option>No</option></select></label>
              <label id="policeReferenceField" class="incident-full" hidden><span>Police event/reference number</span><input id="incidentPoliceReference" maxlength="100" placeholder="Enter the Police event number if supplied" /></label>
            </div>
            <div id="incidentUrgentWarning" class="incident-urgent-warning" hidden><i data-lucide="triangle-alert"></i><div><strong>Urgent incident</strong><span>Move to a safe location and contact OCC immediately. Do not wait for this form to be reviewed.</span></div></div>
          </section>

          <section class="incident-section">
            <div class="incident-section-heading"><span>3</span><div><h3>People and description</h3><p>Record facts clearly. Do not include unnecessary identity or payment details.</p></div></div>
            <div class="incident-grid">
              <label class="incident-full"><span>People involved</span><textarea id="incidentPeople" maxlength="1200" placeholder="Names or descriptions of passengers, employees or members of the public involved"></textarea></label>
              <label class="incident-full"><span>Witness details</span><textarea id="incidentWitnesses" maxlength="1200" placeholder="Witness name and safe contact details, if available"></textarea></label>
              <label class="incident-full"><span>Describe what happened <b>*</b></span><textarea id="incidentDescription" maxlength="3000" placeholder="Describe the sequence of events, direction of travel, conditions and what you observed"></textarea></label>
              <label class="incident-full"><span>Immediate actions taken <b>*</b></span><textarea id="incidentActions" maxlength="2000" placeholder="Describe first aid, calls to OCC, vehicle movement, passenger assistance or other action taken"></textarea></label>
            </div>

            <label class="incident-upload" for="incidentPhotos"><input id="incidentPhotos" type="file" accept="image/*" multiple /><span class="incident-upload-icon"><i data-lucide="camera"></i></span><span><strong>Add incident photos</strong><small id="incidentPhotoHelp">Choose up to 3 images · maximum 8 MB each</small></span><b>Choose photos</b></label>
            <div id="incidentPhotoPreview" class="incident-photo-preview"></div>
          </section>

          <section class="incident-declaration"><label><input id="incidentDeclaration" type="checkbox" /><span>I confirm this report is true and accurate to the best of my knowledge. <b>*</b></span></label></section>
          <div class="incident-actions"><button id="submitIncident" type="button"><i data-lucide="send"></i><span>Submit Incident Report</span></button><small>Your report will be sent to Operations for review.</small></div>
        </section>

        <aside class="card incident-recent-card"><div class="incident-recent-heading"><i data-lucide="history"></i><div><h3>My Recent Reports</h3><p>Track reports you have submitted.</p></div></div><div id="incidentRecentList"><div class="incident-empty">Loading reports…</div></div></aside>
      </div>
    </div>`;

  window.lucide?.createIcons?.();
  const field = (id) => document.getElementById(id);
  const dateEl = field("incidentDate");
  const timeEl = field("incidentTime");
  const busEl = field("incidentBus");
  const categoryEl = field("incidentCategory");
  const locationEl = field("incidentLocation");
  const injuryEl = field("incidentInjury");
  const emergencyEl = field("incidentEmergency");
  const policeEl = field("incidentPolice");
  const policeReferenceEl = field("incidentPoliceReference");
  const safeToContinueEl = field("incidentSafeToContinue");
  const peopleEl = field("incidentPeople");
  const witnessesEl = field("incidentWitnesses");
  const descriptionEl = field("incidentDescription");
  const actionsEl = field("incidentActions");
  const photosEl = field("incidentPhotos");
  const declarationEl = field("incidentDeclaration");
  const submitBtn = field("submitIncident");
  const messageEl = field("incidentMessage");
  const warningEl = field("incidentUrgentWarning");
  const policeReferenceField = field("policeReferenceField");
  const photoHelpEl = field("incidentPhotoHelp");
  const now = new Date();
  dateEl.value = localDateString(now); dateEl.max = localDateString(now); timeEl.value = localTimeString(now);
  let fleet = [];

  function showMessage(message, type = "error") {
    messageEl.textContent = message; messageEl.className = `incident-message ${type}`; messageEl.hidden = !message;
  }

  function safetyAnswers() {
    return {injury: injuryEl.value, emergencyServices: emergencyEl.value, policeContacted: policeEl.value, safeToContinue: safeToContinueEl.value};
  }

  function updateSafetyPanel() {
    policeReferenceField.hidden = policeEl.value !== "Yes";
    warningEl.hidden = urgencyFromAnswers(safetyAnswers()) !== "Critical";
  }

  [injuryEl, emergencyEl, policeEl, safeToContinueEl].forEach((input) => input.addEventListener("change", updateSafetyPanel));
  photosEl.addEventListener("change", () => {
    const files = Array.from(photosEl.files || []); const error = validatePhotos(files);
    if (error) { showMessage(error); photosEl.value = ""; photoHelpEl.textContent = "Choose up to 3 images · maximum 8 MB each"; renderPhotoPreview([]); return; }
    showMessage(""); photoHelpEl.textContent = files.length ? `${files.length} photo${files.length === 1 ? "" : "s"} selected` : "Choose up to 3 images · maximum 8 MB each"; renderPhotoPreview(files);
  });

  try {
    fleet = await loadFleet();
    busEl.innerHTML = [`<option value="">Select bus or incident type</option>`, `<option value="${NONE_BUS_ID}">Not vehicle-related</option>`, ...fleet.map((bus) => `<option value="${escapeHtml(bus.id)}">${escapeHtml(busLabel(bus))}</option>`)].join("");
  } catch (error) {
    console.error("Failed to load fleet for incident report", error); busEl.innerHTML = `<option value="">Fleet failed to load</option><option value="${NONE_BUS_ID}">Not vehicle-related</option>`; showMessage("Unable to load the Fleet list. You may select Not vehicle-related.");
  }

  async function refreshRecent() {
    try {
      const recent = await loadMyReports(auth.currentUser?.uid || "");
      renderRecentReports(recent);
      document.querySelectorAll("[data-collision-report-id]").forEach((button) => {
        button.onclick = () => {
          const report = recent.find((item) => item.id === button.dataset.collisionReportId);
          if (report) openDriverCollisionClaim(report, {onSaved: refreshRecent});
        };
      });
    }
    catch (error) { console.error("Unable to load recent incident reports", error); field("incidentRecentList").innerHTML = `<div class="incident-empty">Unable to load recent reports.</div>`; }
  }
  await refreshRecent();

  submitBtn.onclick = async () => {
    showError(""); showMessage("");
    const incidentDate = dateEl.value;
    const incidentTime = timeEl.value;
    const busValue = busEl.value;
    const selectedBus = fleet.find((bus) => String(bus.id) === busValue) || null;
    const category = categoryEl.value;
    const location = locationEl.value.trim();
    const injury = injuryEl.value;
    const emergencyServices = emergencyEl.value;
    const policeContacted = policeEl.value;
    const safeToContinue = safeToContinueEl.value;
    const peopleInvolved = peopleEl.value.trim();
    const witnessDetails = witnessesEl.value.trim();
    const description = descriptionEl.value.trim();
    const immediateActions = actionsEl.value.trim();
    const photos = Array.from(photosEl.files || []);

    if (!incidentDate) return showMessage("Please select the incident date.");
    if (incidentDate > localDateString()) return showMessage("Incident date cannot be in the future.");
    if (!incidentTime) return showMessage("Please enter the incident time.");
    if (!busValue) return showMessage("Please select a bus or Not vehicle-related.");
    if (!category) return showMessage("Please select the incident category.");
    if (!location) return showMessage("Please enter the incident location.");
    if (!injury) return showMessage("Please confirm whether anyone was injured.");
    if (!emergencyServices) return showMessage("Please confirm whether emergency services were contacted.");
    if (!policeContacted) return showMessage("Please confirm whether Police were contacted.");
    if (!safeToContinue) return showMessage("Please confirm whether you can safely continue your duty.");
    if (!description) return showMessage("Please describe what happened.");
    if (!immediateActions) return showMessage("Please describe the immediate actions taken.");
    if (!declarationEl.checked) return showMessage("Please confirm the driver declaration before submitting.");
    const photoError = validatePhotos(photos); if (photoError) return showMessage(photoError);

    const reportRef = doc(collection(db, "incidentReports"));
    const reportNumber = `IR-${incidentDate.replaceAll("-", "")}-${reportRef.id.slice(0, 6).toUpperCase()}`;
    const urgency = urgencyFromAnswers({injury, emergencyServices, policeContacted, safeToContinue});
    const uploadedRefs = [];
    submitBtn.disabled = true; submitBtn.textContent = photos.length ? "Uploading photos…" : "Submitting…";
    try {
      const uploadedPhotos = [];
      for (let index = 0; index < photos.length; index += 1) {
        const file = photos[index]; submitBtn.textContent = `Uploading photo ${index + 1} of ${photos.length}…`;
        const storagePath = `incident-reports/${reportRef.id}/${Date.now()}-${index + 1}-${safeFileName(file.name)}`;
        const photoRef = ref(storage, storagePath); uploadedRefs.push(photoRef);
        await uploadBytes(photoRef, file, {contentType: file.type, customMetadata: {reportId: reportRef.id, reportedByUid: auth.currentUser?.uid || ""}});
        uploadedPhotos.push({url: await getDownloadURL(photoRef), storagePath, fileName: file.name, contentType: file.type, size: file.size});
      }
      submitBtn.textContent = "Saving report…";
      const reportRecord = {
        schemaVersion: 1, reportNumber, status: "Submitted", urgency,
        incidentDate, incidentTime, category, location, injury, emergencyServices, policeContacted,
        policeReference: policeContacted === "Yes" ? policeReferenceEl.value.trim() : "", safeToContinue,
        peopleInvolved, witnessDetails, description, immediateActions,
        vehicleRelated: busValue !== NONE_BUS_ID, busId: selectedBus?.id || "",
        fleetNumber: String(selectedBus?.fleetNumber || ""), rego: String(selectedBus?.rego || ""), depot: String(selectedBus?.depot || ""),
        photos: uploadedPhotos, photoCount: uploadedPhotos.length,
        driverDeclarationAccepted: true, driverDeclarationAcceptedAt: serverTimestamp(),
        reportedByUid: auth.currentUser?.uid || "", reportedByEmail: auth.currentUser?.email || "",
        reportedByName: reporterName, reportedByEmployeeNumber: employeeNumber, reportedAtIso: new Date().toISOString(),
        assignedToEmail: "", adminSeverity: "", adminNotes: "", deleted: false,
        collisionClaimStatus: category === "Collision" ? "Not started" : "",
        createdAt: serverTimestamp(), updatedAt: serverTimestamp()
      };
      await setDoc(reportRef, reportRecord);
      showMessage(`${reportNumber} submitted successfully.`, "success");
      [categoryEl, locationEl, injuryEl, emergencyEl, policeEl, policeReferenceEl, safeToContinueEl, peopleEl, witnessesEl, descriptionEl, actionsEl].forEach((input) => { input.value = ""; });
      busEl.value = ""; photosEl.value = ""; declarationEl.checked = false; photoHelpEl.textContent = "Choose up to 3 images · maximum 8 MB each"; warningEl.hidden = true; policeReferenceField.hidden = true; renderPhotoPreview([]);
      dateEl.value = localDateString(); timeEl.value = localTimeString(); await refreshRecent(); messageEl.scrollIntoView({behavior: "smooth", block: "center"});
      if (category === "Collision") openDriverCollisionClaim({id: reportRef.id, ...reportRecord}, {onSaved: refreshRecent});
    } catch (error) {
      console.error("Failed to submit incident report", error); await Promise.allSettled(uploadedRefs.map((photoRef) => deleteObject(photoRef))); showMessage(error?.message || "Failed to submit the incident report. Please try again.");
    } finally {
      submitBtn.disabled = false; submitBtn.innerHTML = `<i data-lucide="send"></i><span>Submit Incident Report</span>`; window.lucide?.createIcons?.();
    }
  };
}
