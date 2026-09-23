import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  arrayUnion,
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
import { getEmployeeByEmail } from "./db.js";
import { getRequirementTemplate } from "./workshop_service_requirements.js?v=20260924-special-services";
import { DEFECT_STATUS } from "./workshop_status.js";

const $ = (id) => document.getElementById(id);
const els = {
  authText: $("authText"), loginBtn: $("loginBtn"), logoutBtn: $("logoutBtn"), status: $("status"),
  queueView: $("queueView"), jobCardView: $("jobCardView"), mechanicIdentity: $("mechanicIdentity"), refreshBtn: $("refreshBtn"), statusFilter: $("statusFilter"), jobQueue: $("jobQueue"),
  metricAssigned: $("metricAssigned"), metricProgress: $("metricProgress"), metricUrgent: $("metricUrgent"), metricApproval: $("metricApproval"),
  backToQueueBtn: $("backToQueueBtn"), jobCardStatusBadge: $("jobCardStatusBadge"), jobCardTitle: $("jobCardTitle"), jobCardVehicle: $("jobCardVehicle"), jobCardMeta: $("jobCardMeta"), jobWorkingMechanic: $("jobWorkingMechanic"), updateWorkingMechanicBtn: $("updateWorkingMechanicBtn"), readonlyJobDetails: $("readonlyJobDetails"),
  jobCardForm: $("jobCardForm"), jobPreviousOdometer: $("jobPreviousOdometer"), jobCurrentOdometer: $("jobCurrentOdometer"), diagnosis: $("diagnosis"), workCompleted: $("workCompleted"), furtherWork: $("furtherWork"), furtherWorkRequired: $("furtherWorkRequired"), safeToReturn: $("safeToReturn"), checklistHeading: $("checklistHeading"), jobChecklist: $("jobChecklist"), partsBody: $("partsBody"), addPartBtn: $("addPartBtn"), labourStart: $("labourStart"), labourFinish: $("labourFinish"), mechanicNotes: $("mechanicNotes"), inspectionSignoffSection: $("inspectionSignoffSection"), inspectionCompletedDate: $("inspectionCompletedDate"), mechanicInspectionDeclaration: $("mechanicInspectionDeclaration"), airconSignoffSection: $("airconSignoffSection"), airconServiceCompletedDate: $("airconServiceCompletedDate"), airconMechanicDeclaration: $("airconMechanicDeclaration"), specialServiceSignoffSection: $("specialServiceSignoffSection"), specialServiceSignoffTitle: $("specialServiceSignoffTitle"), specialServiceSignoffHint: $("specialServiceSignoffHint"), specialServiceCompletedDate: $("specialServiceCompletedDate"), specialServiceMechanicDeclaration: $("specialServiceMechanicDeclaration"), startJobBtn: $("startJobBtn"), waitingPartsBtn: $("waitingPartsBtn"), saveProgressBtn: $("saveProgressBtn"), completeJobBtn: $("completeJobBtn")
};

let currentUser = null;
let jobs = [];
let buses = [];
let mechanics = [];
let selectedJob = null;
let jobsUnsub = null;
let busesUnsub = null;
let mechanicsUnsub = null;
window.currentWorkshopMechanic = null;

function normalize(v) { return String(v || "").trim().toLowerCase(); }
function isSuperAdmin(email) { return ADMIN_EMAILS.map(normalize).includes(normalize(email)); }
function hasMechanicAccess(employee) {
  if (!employee) return false;
  const status = normalize(employee.status);
  const department = normalize(employee.department);
  const role = normalize(employee.role);
  const accessLevel = normalize(employee.accessLevel);
  if (status !== "active") return false;
  if (accessLevel === "super admin") return true;
  return department === "workshop" && ["mechanic", "manager", "fleet manager"].includes(role);
}
function employeeNumber(employee) { return String(employee.employeeNumber || employee.employeeNo || employee.empNo || employee.number || employee.id || "").trim(); }
function employeeName(employee) {
  return String(employee.displayName || employee.name || employee.fullName || [employee.firstName,employee.lastName].filter(Boolean).join(" ") || employee.email || "Mechanic").trim();
}
function isActiveMechanic(employee) {
  return normalize(employee.status) === "active" && normalize(employee.department) === "workshop" && normalize(employee.role) === "mechanic";
}
function esc(v) { return String(v ?? "").replace(/[&<>'\"]/g, (m) => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'\"':"&quot;"}[m])); }
function num(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }
function fmtDate(v) {
  if (!v) return "—";
  const d = typeof v?.toDate === "function" ? v.toDate() : new Date(`${v}T00:00:00`);
  return Number.isNaN(d.getTime()) ? String(v) : new Intl.DateTimeFormat("en-AU", { day:"2-digit", month:"short", year:"numeric" }).format(d);
}
function showStatus(message, type="success") { els.status.className = `status ${type}`; els.status.textContent = message; }
function clearStatus() { els.status.className = "status"; els.status.textContent = ""; }
function localDateString(date = new Date()) { return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`; }

function busForJob(job) {
  if (!job) return null;
  return buses.find((bus) => bus.id === job.busId)
    || buses.find((bus) => normalize(bus.fleetNumber || bus.busNumber || bus.number || bus.id) === normalize(job.fleetNumber));
}

function workshopBusStatusUpdate(busData, job, status) {
  if (!busData || !["In Progress","Waiting Parts","Waiting Approval"].includes(status)) return null;
  const existingStatus = String(busData.status || "Active").trim();
  const nextStatus = normalize(existingStatus) === "out of service" ? "Out of Service" : "Workshop";
  return {
    status:nextStatus,
    workshopStatusJobId:job.id,
    workshopStatusJobNumber:job.jobNumber || "",
    workshopStatusReason:status,
    workshopStatusUpdatedAt:serverTimestamp(),
    workshopStatusUpdatedBy:normalize(currentUser?.email)
  };
}

const CHECKLISTS = {
  "Defect Repair": ["Reported fault confirmed","Root cause identified","Repair completed","Related components checked","Fault cleared / retested","Road test where required"],
  "Preventive Maintenance": ["Visual inspection","Fluid levels","Belts / hoses","Brakes","Tyres","Electrical","Doors","Leaks","Safety equipment","Road test"],
  "Breakdown Repair": ["Breakdown cause identified","Repair completed","Related systems checked","Warning lights cleared","Road test / functional test"],
  "Tyres": ["Tyre condition","Tread depth","Pressure","Wheel nuts","Matching tyre / size","Post-work inspection"],
  "Electrical": ["Fault confirmed","Wiring / connectors checked","Charging / battery system checked","Repair completed","Functional test"],
  "Body Repair": ["Damage assessed","Structural safety checked","Repair completed","Doors / panels operate correctly","Final visual inspection"],
  "Other": ["Work requirement confirmed","Work completed","Functional test completed"]
};

function openJobs() { return jobs.filter((j) => !["Completed","Closed","Cancelled"].includes(j.status)); }

function categoryLabel(job) {
  return job.serviceType || job.inspectionType || job.jobCategory || "";
}

function renderQueue() {
  const status = els.statusFilter.value;
  let list = jobs.filter((j) => status ? j.status === status : !["Completed","Closed","Cancelled"].includes(j.status));
  list = list.sort((a,b) => String(a.dueDate || "9999").localeCompare(String(b.dueDate || "9999")) || Number(b.createdAt?.seconds || 0) - Number(a.createdAt?.seconds || 0));

  const open = openJobs();
  els.metricAssigned.textContent = jobs.filter((j) => j.status === "Assigned").length;
  els.metricProgress.textContent = jobs.filter((j) => j.status === "In Progress").length;
  els.metricUrgent.textContent = open.filter((j) => /urgent|critical/i.test(j.priority || "")).length;
  els.metricApproval.textContent = jobs.filter((j) => j.status === "Waiting Approval").length;

  if (!list.length) {
    els.jobQueue.innerHTML = `<div class="empty">No workshop jobs for this filter.</div>`;
    return;
  }

  els.jobQueue.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead><tr><th>Job / Mechanic Complaint</th><th>Bus</th><th>Job Type</th><th>Priority</th><th>Assigned Mechanic</th><th>Status</th><th>Due</th><th>Action</th></tr></thead>
        <tbody>${list.map((j) => `
          <tr>
            <td class="mechanic-job-complaint"><strong>${esc(j.jobNumber || j.id)}</strong><div class="mechanic-complaint-label">Reported fault / complaint</div><div class="mechanic-complaint-text">${esc(j.reportedFault || "No complaint recorded")}</div></td>
            <td><strong>${esc(j.fleetNumber || "—")}</strong><div class="list-meta">${esc(j.rego || "")}</div></td>
            <td>${esc(j.jobType || "Workshop Job")}${categoryLabel(j) ? `<div class="list-meta"><strong>${esc(categoryLabel(j))}</strong></div>` : ""}</td>
            <td><span class="badge ${/urgent|critical/i.test(j.priority || "") ? "bad" : /high/i.test(j.priority || "") ? "warn" : "info"}">${esc(j.priority || "Normal")}</span></td>
            <td>${esc(j.assignedMechanic || j.assignedMechanicName || j.assignedMechanicEmployeeNumber || "Unassigned")}</td>
            <td>${esc(j.status || "New")}</td>
            <td>${esc(fmtDate(j.dueDate))}</td>
            <td><button class="button primary" type="button" data-open-job="${esc(j.id)}">${j.status === "Assigned" ? "Open Job Card" : "View / Continue"}</button></td>
          </tr>`).join("")}</tbody>
      </table>
    </div>`;

  els.jobQueue.querySelectorAll("[data-open-job]").forEach((btn) => btn.addEventListener("click", () => openJob(btn.dataset.openJob)));
}

function jobBus(job) {
  return buses.find((b) => b.id === job.busId || normalize(b.fleetNumber || b.busNumber) === normalize(job.fleetNumber));
}
function currentBusOdo(job) {
  const b = jobBus(job);
  return num(b?.currentOdometer ?? b?.odometer ?? b?.odometerKm ?? job.currentOdometer);
}

function mechanicMatchesJob(mechanic, job) {
  if (job.assignedMechanicEmail) return normalize(mechanic.email) === normalize(job.assignedMechanicEmail);
  if (job.assignedMechanicEmployeeNumber) return employeeNumber(mechanic) === String(job.assignedMechanicEmployeeNumber);
  return normalize(employeeName(mechanic)) === normalize(job.assignedMechanic || job.assignedMechanicName);
}

function populateWorkingMechanic(job = selectedJob) {
  if (!els.jobWorkingMechanic) return;
  const current = mechanics.find((mechanic) => mechanicMatchesJob(mechanic, job || {}));
  els.jobWorkingMechanic.innerHTML = `<option value="">Select working mechanic</option>${mechanics.map((mechanic) => `<option value="${esc(mechanic.id)}">${esc(employeeName(mechanic))}${employeeNumber(mechanic) ? ` · ${esc(employeeNumber(mechanic))}` : ""}</option>`).join("")}`;
  els.jobWorkingMechanic.value = current?.id || "";
  const editable = Boolean(job) && ["New","Assigned","In Progress","Waiting Parts"].includes(job.status || "New");
  els.jobWorkingMechanic.disabled = !editable;
  els.updateWorkingMechanicBtn.disabled = !editable;
  els.updateWorkingMechanicBtn.hidden = !editable;
}

async function updateWorkingMechanic() {
  if (!selectedJob) return;
  const mechanic = mechanics.find((item) => item.id === els.jobWorkingMechanic.value);
  if (!mechanic) return showStatus("Select the mechanic who is performing this job.", "error");
  if (mechanicMatchesJob(mechanic, selectedJob)) return showStatus(`${employeeName(mechanic)} is already the working mechanic.`);
  const newName = employeeName(mechanic);
  const newNumber = employeeNumber(mechanic);
  const newEmail = normalize(mechanic.email);
  const button = els.updateWorkingMechanicBtn;
  const previousJob = selectedJob;
  const jobId = selectedJob.id;
  button.disabled = true;
  button.textContent = "Updating...";
  selectedJob = { ...selectedJob, assignedMechanic:newName, assignedMechanicName:newName, assignedMechanicEmployeeNumber:newNumber, assignedMechanicEmail:newEmail, mechanicName:newName, status:selectedJob.status === "New" ? "Assigned" : selectedJob.status };
  const assignedText = $("jobAssignedMechanicText");
  if (assignedText) assignedText.textContent = newName;
  showStatus(`Updating working mechanic to ${newName}...`);
  try {
    const ref = doc(db, "workshopJobs", jobId);
    const snap = await getDoc(ref);
    if (!snap.exists()) throw new Error("This workshop job no longer exists.");
    const current = snap.data();
    if (!["New","Assigned","In Progress","Waiting Parts"].includes(current.status || "New")) {
      throw new Error("The working mechanic is locked because this job has been sent for Fleet Manager approval.");
    }
    await updateDoc(ref, {
        assignedMechanic:newName,
        assignedMechanicName:newName,
        assignedMechanicEmployeeNumber:newNumber,
        assignedMechanicEmail:newEmail,
        mechanicName:newName,
        status:current.status === "New" ? "Assigned" : current.status,
        mechanicAssignmentHistory:arrayUnion({
          fromName:current.assignedMechanic || current.assignedMechanicName || "Unassigned",
          fromEmployeeNumber:current.assignedMechanicEmployeeNumber || "",
          toName:newName,
          toEmployeeNumber:newNumber,
          changedByName:window.currentWorkshopMechanic?.name || currentUser?.displayName || currentUser?.email || "Workshop user",
          changedByEmployeeNumber:window.currentWorkshopMechanic?.employeeNumber || "",
          changedByEmail:normalize(currentUser?.email),
          changeId:`${Date.now()}-${currentUser?.uid || "workshop"}`,
          changedAtIso:new Date().toISOString()
        }),
        updatedAt:serverTimestamp(),
        updatedByEmail:normalize(currentUser?.email)
    });
    showStatus(`Working mechanic updated to ${newName}.`);
  } catch (err) {
    selectedJob = previousJob;
    if (assignedText) assignedText.textContent = previousJob.assignedMechanic || previousJob.assignedMechanicName || "Unassigned";
    showStatus(err?.message || "Unable to update the working mechanic.", "error");
  } finally {
    button.textContent = "Update Mechanic";
    populateWorkingMechanic(selectedJob);
  }
}

function previewWorkingMechanic() {
  if (!selectedJob) return;
  const mechanic = mechanics.find((item) => item.id === els.jobWorkingMechanic.value);
  const assignedText = $("jobAssignedMechanicText");
  if (!mechanic) {
    if (assignedText) assignedText.textContent = selectedJob.assignedMechanic || selectedJob.assignedMechanicName || "Unassigned";
    els.updateWorkingMechanicBtn.textContent = "Update Mechanic";
    return;
  }
  if (assignedText) assignedText.textContent = employeeName(mechanic);
  els.updateWorkingMechanicBtn.textContent = mechanicMatchesJob(mechanic, selectedJob) ? "Mechanic Selected" : "Save Mechanic";
}

function busIsEv(bus) {
  return /\b(ev|electric)\b/i.test(String(bus?.fuelType || bus?.fuel || bus?.powertrain || bus?.serviceProgram || ""));
}

function legacyTemplateKey(job) {
  const existing = String(job.serviceTemplateKey || "").trim().toLowerCase();
  if (existing) return existing;

  const bus = jobBus(job);
  const prefix = busIsEv(bus) ? "ev" : "diesel";
  const type = String(job.jobType || "").trim().toLowerCase();
  const category = String(categoryLabel(job) || "").trim().toLowerCase();

  if (type === "safety inspection") {
    return category.includes("rms") ? `${prefix}-rms` : `${prefix}-90day`;
  }

  if (type === "scheduled service" && ["small", "medium", "large"].includes(category)) {
    if (prefix === "ev" && category === "medium") return "";
    return `${prefix}-${category}`;
  }

  return "";
}

function requirementData(job) {
  const templateKey = legacyTemplateKey(job);
  const template = getRequirementTemplate(templateKey);
  if (Array.isArray(job.assignedChecklist?.items) && job.assignedChecklist.items.length) {
    const currentItems = new Map((template?.items || []).map((item) => [String(item.id), item]));
    return {
      title: job.assignedChecklist.templateTitle || `${categoryLabel(job) || job.jobType} Checklist`,
      source: job.assignedChecklist.templateSource || "Assigned workshop checklist",
      schedule: job.assignedChecklist.schedule || "",
      items: job.assignedChecklist.items.map((item, index) => {
        const positionMatch = template?.items?.[index];
        const samePositionItem = positionMatch
          && normalize(positionMatch.item) === normalize(item.item)
          && normalize(positionMatch.action) === normalize(item.action);
        const current = currentItems.get(String(item.id)) || (samePositionItem ? positionMatch : {});
        return { ...current, ...item, description:item.description || current.description || "", mandatory:item.mandatory ?? current.mandatory ?? true };
      })
    };
  }
  if (!template) return null;
  if (!job.serviceTemplateKey && String(job.jobType || "").trim().toLowerCase() === "safety inspection") {
    return { ...template, source: `${template.source} · legacy Safety Inspection job matched from vehicle type` };
  }
  return template;
}

function is90DayInspection(job) {
  const key = legacyTemplateKey(job);
  const category = normalize(categoryLabel(job));
  return /-(90day|rms)$/.test(key) || (normalize(job.jobType).includes("safety inspection") && (category.includes("90") || category.includes("rms")));
}

function isAirConditioningService(job) {
  return normalize(job?.serviceTemplateKey) === "aircon-annual" || normalize(job?.jobType) === "air conditioning service";
}

function specialServiceKind(job) {
  const key = normalize(job?.serviceTemplateKey);
  const type = normalize(job?.jobType);
  if (key === "fire-suppression-annual" || type === "fire suppression check") return "fire";
  if (key === "radiator-wash-6month" || type === "intercooler / radiator wash") return "radiator";
  return "";
}

function savedChecklistValue(saved, key, item) {
  return saved[key] ?? saved[item] ?? "";
}

function renderRequirementChecklist(job, requirement) {
  const saved = job.jobCard?.checklist || {};
  const grouped = new Map();
  requirement.items.forEach((item, index) => {
    const section = item.section || "General";
    if (!grouped.has(section)) grouped.set(section, []);
    grouped.get(section).push({ ...item, index });
  });

  els.checklistHeading.textContent = `${requirement.title} · ${requirement.items.length} required items`;
  const schedule = requirement.schedule ? `<div class="hint" style="margin-bottom:12px"><strong>Schedule:</strong> ${esc(requirement.schedule)}</div>` : "";
  const source = `<div class="hint" style="margin-bottom:12px">Requirements assigned from ${esc(requirement.source || "Punchbowl Bus service document")}.</div>`;

  els.jobChecklist.innerHTML = schedule + source + [...grouped.entries()].map(([section, items], groupIndex) => `
    <details class="requirement-group" ${groupIndex < 2 ? "open" : ""} style="border:1px solid #e4e7ec;border-radius:10px;margin:0 0 10px;overflow:hidden">
      <summary style="cursor:pointer;padding:12px 14px;font-weight:800;background:#f8fafc">${esc(section)} <span class="hint">(${items.length})</span></summary>
      <div style="padding:4px 12px 10px">
        ${items.map(({id,item,action,description,mandatory,requiresReading,index}) => {
          const key = String(id || `${job.serviceTemplateKey || job.jobType}-${index + 1}`);
          const current = savedChecklistValue(saved, key, item);
          const note = job.jobCard?.checklistNotes?.[key] || "";
          return `<div class="check-row" style="align-items:center">
            <label for="check_${index}"><strong>${esc(item)}</strong>${action ? `<div class="list-meta"><strong>Action:</strong> ${esc(action)}</div>` : ""}${description ? `<div class="check-description"><strong>Description of Work:</strong> ${esc(description)}</div>` : ""}</label>
            <div class="check-response">
            <select id="check_${index}" data-check-key="${esc(key)}" data-check-item="${esc(item)}" data-check-action="${esc(action || "")}" data-check-description="${esc(description || "")}" ${mandatory === false ? "" : 'data-required-work="1"'}>
              <option value="">Select result</option>
              <option value="Pass" ${current === "Pass" ? "selected" : ""}>${requiresReading ? "Reading recorded" : "Completed / Pass"}</option>
              <option value="Attention" ${current === "Attention" ? "selected" : ""}>Attention required</option>
              <option value="N/A" ${current === "N/A" ? "selected" : ""}>N/A</option>
            </select>
            <input class="check-result-note" data-check-note="${esc(key)}" ${requiresReading ? 'data-reading-required="1"' : ""} value="${esc(note)}" placeholder="${requiresReading ? "Enter measured pressure reading and unit" : "Reason/details required for Attention or N/A"}" ${requiresReading || current === "Attention" || current === "N/A" ? "" : "hidden"} />
            </div>
          </div>`;
        }).join("")}
      </div>
    </details>`).join("");
}

function renderChecklist(job) {
  const requirement = requirementData(job);
  if (requirement) {
    renderRequirementChecklist(job, requirement);
    return;
  }

  const items = CHECKLISTS[job.jobType] || CHECKLISTS.Other;
  els.checklistHeading.textContent = `${job.jobType || "Workshop"} Checklist`;
  const saved = job.jobCard?.checklist || {};
  els.jobChecklist.innerHTML = items.map((item, i) => `<div class="check-row"><label for="check_${i}">${esc(item)}</label><select id="check_${i}" data-check-key="${esc(item)}" data-check-item="${esc(item)}"><option value="">Select</option><option value="Pass" ${saved[item] === "Pass" ? "selected" : ""}>Pass</option><option value="Attention" ${saved[item] === "Attention" ? "selected" : ""}>Attention</option><option value="N/A" ${saved[item] === "N/A" ? "selected" : ""}>N/A</option></select></div>`).join("");
}

function partRow(part={}) {
  const tr = document.createElement("tr");
  tr.innerHTML = `<td><input class="part-input part-number" value="${esc(part.partNumber || "")}" placeholder="Part no."></td><td><input class="part-input part-description" value="${esc(part.description || "")}" placeholder="Description"></td><td><input class="part-input part-qty" type="number" min="0" step="1" value="${esc(part.quantity ?? 1)}"></td><td><input class="part-input part-supplier" value="${esc(part.supplierRef || "")}" placeholder="Supplier / ref"></td><td><button class="button secondary remove-part" type="button">Remove</button></td>`;
  tr.querySelector(".remove-part").addEventListener("click", () => tr.remove());
  els.partsBody.appendChild(tr);
}
function renderParts(parts=[]) { els.partsBody.innerHTML = ""; if (parts.length) parts.forEach(partRow); else partRow(); }

function openJob(id) {
  const job = jobs.find((j) => j.id === id);
  if (!job) return showStatus("Workshop job not found.", "error");
  selectedJob = job;
  clearStatus();
  els.queueView.hidden = true;
  els.jobCardView.hidden = false;
  const category = categoryLabel(job);
  els.jobCardTitle.textContent = `${job.jobNumber || job.id} · ${job.jobType || "Workshop Job"}${category ? ` · ${category}` : ""}`;
  els.jobCardVehicle.textContent = `${job.fleetNumber || "Bus"}${job.rego ? ` · ${job.rego}` : ""}`;
  els.jobCardStatusBadge.innerHTML = `<span class="badge info">${esc(job.status || "New")}</span>`;
  els.jobCardMeta.innerHTML = `<div><strong>Priority:</strong> ${esc(job.priority || "Normal")}</div><div><strong>Due:</strong> ${esc(fmtDate(job.dueDate))}</div><div><strong>Assigned:</strong> <span id="jobAssignedMechanicText">${esc(job.assignedMechanic || job.assignedMechanicName || "Unassigned")}</span></div>${category ? `<div><strong>Category:</strong> ${esc(category)}</div>` : ""}`;
  populateWorkingMechanic(job);
  els.readonlyJobDetails.innerHTML = `<div class="readonly-field"><div class="readonly-label">Requested work</div><div class="readonly-value">${esc(job.reportedFault || "—")}</div></div><div class="readonly-field"><div class="readonly-label">Fleet Manager notes</div><div class="readonly-value">${esc(job.managerNotes || "—")}</div></div>`;
  const previous = currentBusOdo(job);
  els.jobPreviousOdometer.value = previous == null ? "" : String(previous);
  els.jobCurrentOdometer.value = job.jobCard?.currentOdometer ?? "";
  els.jobCurrentOdometer.min = previous == null ? "0" : String(previous);
  els.diagnosis.value = job.jobCard?.diagnosis || "";
  els.workCompleted.value = job.jobCard?.workCompleted || "";
  els.furtherWork.value = job.jobCard?.furtherWork || "";
  els.furtherWorkRequired.value = job.jobCard?.furtherWorkRequired || "No";
  els.safeToReturn.value = job.jobCard?.safeToReturn || "";
  els.labourStart.value = job.jobCard?.labourStart || "";
  els.labourFinish.value = job.jobCard?.labourFinish || "";
  els.mechanicNotes.value = job.jobCard?.mechanicNotes || "";
  renderChecklist(job);
  const inspection = is90DayInspection(job);
  els.inspectionSignoffSection.hidden = !inspection;
  els.inspectionCompletedDate.value = job.inspectionCompletedDate || job.jobCard?.inspectionCompletedDate || localDateString();
  els.mechanicInspectionDeclaration.checked = job.jobCard?.mechanicInspectionDeclaration === true;
  const aircon = isAirConditioningService(job);
  els.airconSignoffSection.hidden = !aircon;
  els.airconServiceCompletedDate.value = job.airConditioningServiceDate || job.jobCard?.airConditioningServiceDate || localDateString();
  els.airconServiceCompletedDate.max = localDateString();
  els.airconMechanicDeclaration.checked = job.jobCard?.airconMechanicDeclaration === true;
  const specialKind = specialServiceKind(job);
  els.specialServiceSignoffSection.hidden = !specialKind;
  if (specialKind) {
    els.specialServiceSignoffTitle.textContent = specialKind === "fire" ? "Fire Suppression Check Completion" : "Intercooler / Radiator Wash Completion";
    els.specialServiceSignoffHint.textContent = specialKind === "fire"
      ? "Record the actual completion date. The next check will be due 12 months from this date."
      : "Record the actual completion date. The next wash will be due 6 months from this date.";
  }
  els.specialServiceCompletedDate.value = job.specialServiceCompletedDate || job.jobCard?.specialServiceCompletedDate || localDateString();
  els.specialServiceCompletedDate.max = localDateString();
  els.specialServiceMechanicDeclaration.checked = job.jobCard?.specialServiceMechanicDeclaration === true;
  renderParts(job.jobCard?.partsUsed || []);
  const locked = ["Completed","Closed","Waiting Approval"].includes(job.status);
  els.jobCardForm.classList.toggle("jobcard-locked", locked);
  els.startJobBtn.disabled = locked || job.status === "In Progress";
  els.waitingPartsBtn.disabled = locked;
  els.saveProgressBtn.disabled = locked;
  els.completeJobBtn.disabled = locked;
  els.inspectionCompletedDate.disabled = locked;
  els.mechanicInspectionDeclaration.disabled = locked;
  els.airconServiceCompletedDate.disabled = locked;
  els.airconMechanicDeclaration.disabled = locked;
  els.specialServiceCompletedDate.disabled = locked;
  els.specialServiceMechanicDeclaration.disabled = locked;
  window.scrollTo({top:0,behavior:"smooth"});
}
window.openMechanicJobCard = openJob;

function collectJobCard() {
  const checklist = {};
  const checklistNotes = {};
  const checklistEvidence = {};
  els.jobChecklist.querySelectorAll("[data-check-key]").forEach((el) => {
    const key = el.dataset.checkKey;
    const note = els.jobChecklist.querySelector(`[data-check-note="${CSS.escape(key)}"]`)?.value.trim() || "";
    checklist[key] = el.value;
    if (note) checklistNotes[key] = note;
    checklistEvidence[key] = { item:el.dataset.checkItem || key, action:el.dataset.checkAction || "", description:el.dataset.checkDescription || "", result:el.value, note };
  });
  const partsUsed = [...els.partsBody.querySelectorAll("tr")].map((tr) => ({
    partNumber: tr.querySelector(".part-number")?.value.trim() || "",
    description: tr.querySelector(".part-description")?.value.trim() || "",
    quantity: num(tr.querySelector(".part-qty")?.value) ?? 0,
    supplierRef: tr.querySelector(".part-supplier")?.value.trim() || ""
  })).filter((p) => p.partNumber || p.description || p.supplierRef || p.quantity > 0);
  return {
    previousOdometer: num(els.jobPreviousOdometer.value),
    currentOdometer: num(els.jobCurrentOdometer.value),
    diagnosis: els.diagnosis.value.trim(),
    workCompleted: els.workCompleted.value.trim(),
    furtherWork: els.furtherWork.value.trim(),
    furtherWorkRequired: els.furtherWorkRequired.value,
    safeToReturn: els.safeToReturn.value,
    checklist,
    checklistNotes,
    checklistEvidence,
    partsUsed,
    labourStart: els.labourStart.value,
    labourFinish: els.labourFinish.value,
    mechanicNotes: els.mechanicNotes.value.trim(),
    inspectionCompletedDate:els.inspectionCompletedDate?.value || "",
    mechanicInspectionDeclaration:els.mechanicInspectionDeclaration?.checked === true,
    airConditioningServiceDate:els.airconServiceCompletedDate?.value || "",
    airconMechanicDeclaration:els.airconMechanicDeclaration?.checked === true,
    specialServiceCompletedDate:els.specialServiceCompletedDate?.value || "",
    specialServiceMechanicDeclaration:els.specialServiceMechanicDeclaration?.checked === true
  };
}

async function saveJobCard(status, message) {
  if (!selectedJob) return;
  clearStatus();
  const card = collectJobCard();
  if (card.currentOdometer != null && card.previousOdometer != null && card.currentOdometer < card.previousOdometer) return showStatus(`Current odometer cannot be lower than ${card.previousOdometer.toLocaleString("en-AU")} km.`, "error");
  if (status === "Waiting Approval") {
    if (!card.diagnosis) return showStatus("Enter diagnosis / findings before completing the job.", "error");
    if (!card.workCompleted) return showStatus("Enter work carried out before completing the job.", "error");
    if (!card.safeToReturn) return showStatus("Select whether the vehicle is safe to return to service.", "error");
    const required = [...els.jobChecklist.querySelectorAll("[data-required-work='1']")];
    const incomplete = required.filter((el) => !el.value);
    if (incomplete.length) return showStatus(`Complete all service / inspection requirements before sending for approval. ${incomplete.length} item${incomplete.length === 1 ? " is" : "s are"} still unanswered.`, "error");
    const missingNotes = required.filter((el) => ["Attention","N/A"].includes(el.value) && !card.checklistNotes[el.dataset.checkKey]);
    if (missingNotes.length) return showStatus(`Enter a reason or details for every Attention required or N/A result. ${missingNotes.length} item${missingNotes.length === 1 ? " needs" : "s need"} details.`, "error");
    if (is90DayInspection(selectedJob) && !card.inspectionCompletedDate) return showStatus("Enter the date the 90-day inspection was completed.", "error");
    if (is90DayInspection(selectedJob) && !card.mechanicInspectionDeclaration) return showStatus("Confirm the mechanic inspection declaration before sending for approval.", "error");
    const missingReadings = [...els.jobChecklist.querySelectorAll("[data-reading-required='1']")].filter((el) => !el.value.trim());
    if (isAirConditioningService(selectedJob) && missingReadings.length) return showStatus("Record both low-pressure and high-pressure gas readings before completing the A/C service.", "error");
    if (isAirConditioningService(selectedJob) && !card.airConditioningServiceDate) return showStatus("Enter the actual A/C service completed date.", "error");
    if (isAirConditioningService(selectedJob) && card.airConditioningServiceDate > localDateString()) return showStatus("The A/C service completed date cannot be in the future.", "error");
    if (isAirConditioningService(selectedJob) && !card.airconMechanicDeclaration) return showStatus("Confirm the MVRIA mechanic declaration before sending the A/C service for approval.", "error");
    if (specialServiceKind(selectedJob) && !card.specialServiceCompletedDate) return showStatus("Enter the actual service completed date.", "error");
    if (specialServiceKind(selectedJob) && card.specialServiceCompletedDate > localDateString()) return showStatus("The service completed date cannot be in the future.", "error");
    if (specialServiceKind(selectedJob) && !card.specialServiceMechanicDeclaration) return showStatus("Confirm the mechanic declaration before sending this service for approval.", "error");
  }
  const payload = { jobCard: card, status, updatedAt: serverTimestamp(), updatedByEmail: normalize(currentUser?.email) };
  if (status === "In Progress" && !selectedJob.startedAt) payload.startedAt = serverTimestamp();
  if (status === "Waiting Approval") {
    payload.completedAt = serverTimestamp();
    payload.mechanicCompletedAt = serverTimestamp();
    payload.completedByEmail = normalize(currentUser?.email);
    if (is90DayInspection(selectedJob)) {
      payload.inspectionCompletedDate = card.inspectionCompletedDate;
      payload.mechanicInspectionSignOff = {
        name:window.currentWorkshopMechanic?.name || currentUser?.displayName || currentUser?.email || "Mechanic",
        employeeNumber:window.currentWorkshopMechanic?.employeeNumber || "",
        email:normalize(currentUser?.email),
        signedAt:serverTimestamp()
      };
    }
    if (isAirConditioningService(selectedJob)) {
      payload.airConditioningServiceDate = card.airConditioningServiceDate;
      payload.airConditioningMechanicSignOff = {
        name:window.currentWorkshopMechanic?.name || currentUser?.displayName || currentUser?.email || "Mechanic",
        employeeNumber:window.currentWorkshopMechanic?.employeeNumber || "",
        email:normalize(currentUser?.email),
        signedAt:serverTimestamp()
      };
    }
    if (specialServiceKind(selectedJob)) {
      payload.specialServiceCompletedDate = card.specialServiceCompletedDate;
      payload.specialServiceMechanicSignOff = {
        name:window.currentWorkshopMechanic?.name || currentUser?.displayName || currentUser?.email || "Mechanic",
        employeeNumber:window.currentWorkshopMechanic?.employeeNumber || "",
        email:normalize(currentUser?.email),
        signedAt:serverTimestamp()
      };
    }
  }
  try {
    const jobRef = doc(db, "workshopJobs", selectedJob.id);
    const bus = busForJob(selectedJob);
    const busRef = bus?.id ? doc(db, "buses", bus.id) : null;
    if (status === "Waiting Approval" && selectedJob.sourceDefectId) {
      const defectRef = doc(db, "defectReports", selectedJob.sourceDefectId);
      await runTransaction(db, async (tx) => {
        const [jobSnap, defectSnap, busSnap] = await Promise.all([tx.get(jobRef), tx.get(defectRef), busRef ? tx.get(busRef) : Promise.resolve(null)]);
        if (!jobSnap.exists()) throw new Error("Workshop job no longer exists.");
        tx.update(jobRef, payload);
        if (busRef && busSnap?.exists()) {
          const busUpdate = workshopBusStatusUpdate(busSnap.data(), selectedJob, status);
          if (busUpdate) tx.update(busRef, busUpdate);
        }
        if (defectSnap.exists()) {
          tx.set(defectRef, {
            status:DEFECT_STATUS.COMPLETED,
            workshopJobStatus:"Waiting Approval",
            completedAt:serverTimestamp(),
            completedByUid:currentUser?.uid || "",
            completedByEmail:normalize(currentUser?.email),
            updatedAt:serverTimestamp()
          }, {merge:true});
        }
      });
    } else {
      await runTransaction(db, async (tx) => {
        const [jobSnap, busSnap] = await Promise.all([tx.get(jobRef), busRef ? tx.get(busRef) : Promise.resolve(null)]);
        if (!jobSnap.exists()) throw new Error("Workshop job no longer exists.");
        tx.update(jobRef, payload);
        if (busRef && busSnap?.exists()) {
          const busUpdate = workshopBusStatusUpdate(busSnap.data(), selectedJob, status);
          if (busUpdate) tx.update(busRef, busUpdate);
        }
      });
    }
    showStatus(message);
  }
  catch (err) { showStatus(err?.message || "Unable to update workshop job.", "error"); }
}

function startListeners() {
  if (jobsUnsub) jobsUnsub();
  if (busesUnsub) busesUnsub();
  if (mechanicsUnsub) mechanicsUnsub();
  jobsUnsub = onSnapshot(query(collection(db, "workshopJobs"), orderBy("createdAt", "desc")), (snap) => {
    jobs = snap.docs.map((d) => ({ id:d.id, ...d.data() }));
    renderQueue();
    if (selectedJob) { const refreshed = jobs.find((j) => j.id === selectedJob.id); if (refreshed) selectedJob = refreshed; }
    if (window.pendingMechanicJobToOpen && jobs.some((job) => job.id === window.pendingMechanicJobToOpen)) {
      const jobId = window.pendingMechanicJobToOpen;
      window.pendingMechanicJobToOpen = null;
      openJob(jobId);
    }
  }, (err) => showStatus(err?.message || "Unable to load workshop jobs.", "error"));
  busesUnsub = onSnapshot(collection(db, "buses"), (snap) => { buses = snap.docs.map((d) => ({ id:d.id, ...d.data() })); });
  mechanicsUnsub = onSnapshot(collection(db, "employees"), (snap) => {
    mechanics = snap.docs.map((d) => ({ id:d.id, ...d.data() })).filter(isActiveMechanic).sort((a,b) => employeeName(a).localeCompare(employeeName(b), undefined, {sensitivity:"base"}));
    populateWorkingMechanic();
  }, (err) => showStatus(err?.message || "Unable to load active Workshop mechanics.", "error"));
}

function stopListeners() {
  if (jobsUnsub) { try { jobsUnsub(); } catch {} jobsUnsub = null; }
  if (busesUnsub) { try { busesUnsub(); } catch {} busesUnsub = null; }
  if (mechanicsUnsub) { try { mechanicsUnsub(); } catch {} mechanicsUnsub = null; }
}

els.statusFilter.addEventListener("change", renderQueue);
els.refreshBtn.addEventListener("click", () => renderQueue());
els.backToQueueBtn.addEventListener("click", () => { selectedJob = null; els.jobCardView.hidden = true; els.queueView.hidden = false; clearStatus(); });
els.addPartBtn.addEventListener("click", () => partRow());
els.updateWorkingMechanicBtn.addEventListener("click", updateWorkingMechanic);
els.jobWorkingMechanic.addEventListener("change", previewWorkingMechanic);
els.jobChecklist.addEventListener("change", (event) => {
  const select = event.target.closest?.("select[data-check-key]");
  if (!select) return;
  const note = els.jobChecklist.querySelector(`[data-check-note="${CSS.escape(select.dataset.checkKey)}"]`);
  if (!note) return;
  if (note.dataset.readingRequired === "1") { note.hidden = false; return; }
  note.hidden = !["Attention","N/A"].includes(select.value);
  if (note.hidden) note.value = "";
});
els.startJobBtn.addEventListener("click", () => saveJobCard("In Progress", "Workshop job started."));
els.waitingPartsBtn.addEventListener("click", () => saveJobCard("Waiting Parts", "Workshop job marked as waiting for parts."));
els.saveProgressBtn.addEventListener("click", () => saveJobCard(selectedJob?.status === "Assigned" ? "In Progress" : (selectedJob?.status || "In Progress"), "Job card progress saved."));
els.completeJobBtn.addEventListener("click", () => saveJobCard("Waiting Approval", "Job card completed and sent to Fleet Manager for approval."));
els.loginBtn.addEventListener("click", () => signInWithPopup(auth, provider));
els.logoutBtn.addEventListener("click", () => signOut(auth));

onAuthStateChanged(auth, async (user) => {
  currentUser = user;
  window.currentWorkshopMechanic = null;
  if (!user) {
    stopListeners();
    els.authText.textContent = "Not signed in";
    els.loginBtn.hidden = false;
    els.logoutBtn.hidden = true;
    els.mechanicIdentity.textContent = "Sign in with an authorised Workshop employee account.";
    els.jobQueue.innerHTML = `<div class="empty">Sign in to load workshop jobs.</div>`;
    return;
  }

  els.loginBtn.hidden = true;
  els.logoutBtn.hidden = false;

  let employee = null;
  if (!isSuperAdmin(user.email)) {
    try {
      employee = await getEmployeeByEmail(user.email);
    } catch (err) {
      console.error("Mechanic employee lookup failed", err);
      stopListeners();
      els.authText.textContent = `Signed in: ${user.email}`;
      els.mechanicIdentity.textContent = "Employee access could not be verified.";
      els.jobQueue.innerHTML = `<div class="empty">Unable to verify Workshop access.</div>`;
      return;
    }
  }

  const allowed = isSuperAdmin(user.email) || hasMechanicAccess(employee);
  if (!allowed) {
    stopListeners();
    els.authText.textContent = `Signed in: ${user.email}`;
    els.mechanicIdentity.textContent = "Your employee record does not have Mechanic access.";
    els.jobQueue.innerHTML = `<div class="empty">Mechanic access is controlled from Administration → Employees.</div>`;
    showStatus("Your account does not have access to the Mechanic Work Queue.", "error");
    return;
  }

  const roleLabel = isSuperAdmin(user.email) ? "Super Admin" : (employee?.role || "Workshop");
  window.currentWorkshopMechanic = {
    uid:user.uid || "",
    email:normalize(user.email),
    name:employee?.displayName || user.displayName || user.email,
    employeeNumber:employee?.employeeNumber || employee?.number || ""
  };
  window.dispatchEvent(new CustomEvent("mechanic-portal-access-granted"));
  els.authText.textContent = `${roleLabel}: ${user.email}`;
  els.mechanicIdentity.textContent = `${employee?.displayName || user.email} · Workshop ${employee?.role || "Super Admin"}`;
  clearStatus();
  startListeners();
});
