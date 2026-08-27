import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc
} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut
} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-auth.js";

import { auth, db, provider } from "./firebase.js";
import { getRequirementTemplate } from "./workshop_service_requirements.js";

const $ = (id) => document.getElementById(id);
const els = {
  authText: $("authText"), loginBtn: $("loginBtn"), logoutBtn: $("logoutBtn"), status: $("status"),
  queueView: $("queueView"), jobCardView: $("jobCardView"), mechanicIdentity: $("mechanicIdentity"), refreshBtn: $("refreshBtn"), statusFilter: $("statusFilter"), jobQueue: $("jobQueue"),
  metricAssigned: $("metricAssigned"), metricProgress: $("metricProgress"), metricUrgent: $("metricUrgent"), metricApproval: $("metricApproval"),
  backToQueueBtn: $("backToQueueBtn"), jobCardStatusBadge: $("jobCardStatusBadge"), jobCardTitle: $("jobCardTitle"), jobCardVehicle: $("jobCardVehicle"), jobCardMeta: $("jobCardMeta"), readonlyJobDetails: $("readonlyJobDetails"),
  jobCardForm: $("jobCardForm"), jobPreviousOdometer: $("jobPreviousOdometer"), jobCurrentOdometer: $("jobCurrentOdometer"), diagnosis: $("diagnosis"), workCompleted: $("workCompleted"), furtherWork: $("furtherWork"), furtherWorkRequired: $("furtherWorkRequired"), safeToReturn: $("safeToReturn"), checklistHeading: $("checklistHeading"), jobChecklist: $("jobChecklist"), partsBody: $("partsBody"), addPartBtn: $("addPartBtn"), labourStart: $("labourStart"), labourFinish: $("labourFinish"), mechanicNotes: $("mechanicNotes"), startJobBtn: $("startJobBtn"), waitingPartsBtn: $("waitingPartsBtn"), saveProgressBtn: $("saveProgressBtn"), completeJobBtn: $("completeJobBtn")
};

let currentUser = null;
let jobs = [];
let buses = [];
let selectedJob = null;
let jobsUnsub = null;
let busesUnsub = null;

function normalize(v) { return String(v || "").trim().toLowerCase(); }
function esc(v) { return String(v ?? "").replace(/[&<>'\"]/g, (m) => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'\"':"&quot;"}[m])); }
function num(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }
function fmtDate(v) {
  if (!v) return "—";
  const d = typeof v?.toDate === "function" ? v.toDate() : new Date(`${v}T00:00:00`);
  return Number.isNaN(d.getTime()) ? String(v) : new Intl.DateTimeFormat("en-AU", { day:"2-digit", month:"short", year:"numeric" }).format(d);
}
function showStatus(message, type="success") { els.status.className = `status ${type}`; els.status.textContent = message; }
function clearStatus() { els.status.className = "status"; els.status.textContent = ""; }

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
        <thead><tr><th>Job</th><th>Bus</th><th>Type</th><th>Priority</th><th>Assigned Mechanic</th><th>Status</th><th>Due</th><th></th></tr></thead>
        <tbody>${list.map((j) => `
          <tr>
            <td><strong>${esc(j.jobNumber || j.id)}</strong><div class="list-meta">${esc(j.reportedFault || "")}</div></td>
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
  if (Array.isArray(job.assignedChecklist?.items) && job.assignedChecklist.items.length) {
    return {
      title: job.assignedChecklist.templateTitle || `${categoryLabel(job) || job.jobType} Checklist`,
      source: job.assignedChecklist.templateSource || "Assigned workshop checklist",
      schedule: job.assignedChecklist.schedule || "",
      items: job.assignedChecklist.items
    };
  }
  const templateKey = legacyTemplateKey(job);
  const template = getRequirementTemplate(templateKey);
  if (!template) return null;
  if (!job.serviceTemplateKey && String(job.jobType || "").trim().toLowerCase() === "safety inspection") {
    return { ...template, source: `${template.source} · legacy Safety Inspection job matched from vehicle type` };
  }
  return template;
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
        ${items.map(({id,item,action,index}) => {
          const key = String(id || `${job.serviceTemplateKey || job.jobType}-${index + 1}`);
          const current = savedChecklistValue(saved, key, item);
          return `<div class="check-row" style="align-items:center">
            <label for="check_${index}"><strong>${esc(item)}</strong>${action ? `<div class="list-meta">Action: ${esc(action)}</div>` : ""}</label>
            <select id="check_${index}" data-check-key="${esc(key)}" data-check-item="${esc(item)}" data-required-work="1">
              <option value="">Select result</option>
              <option value="Pass" ${current === "Pass" ? "selected" : ""}>Completed / Pass</option>
              <option value="Attention" ${current === "Attention" ? "selected" : ""}>Attention required</option>
              <option value="N/A" ${current === "N/A" ? "selected" : ""}>N/A</option>
            </select>
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
  els.jobCardMeta.innerHTML = `<div><strong>Priority:</strong> ${esc(job.priority || "Normal")}</div><div><strong>Due:</strong> ${esc(fmtDate(job.dueDate))}</div><div><strong>Assigned:</strong> ${esc(job.assignedMechanic || job.assignedMechanicName || "Unassigned")}</div>${category ? `<div><strong>Category:</strong> ${esc(category)}</div>` : ""}`;
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
  renderParts(job.jobCard?.partsUsed || []);
  const locked = ["Completed","Closed","Waiting Approval"].includes(job.status);
  els.jobCardForm.classList.toggle("jobcard-locked", locked);
  els.startJobBtn.disabled = locked || job.status === "In Progress";
  els.waitingPartsBtn.disabled = locked;
  els.saveProgressBtn.disabled = locked;
  els.completeJobBtn.disabled = locked;
  window.scrollTo({top:0,behavior:"smooth"});
}

function collectJobCard() {
  const checklist = {};
  els.jobChecklist.querySelectorAll("[data-check-key]").forEach((el) => { checklist[el.dataset.checkKey] = el.value; });
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
    partsUsed,
    labourStart: els.labourStart.value,
    labourFinish: els.labourFinish.value,
    mechanicNotes: els.mechanicNotes.value.trim()
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
  }
  const payload = { jobCard: card, status, updatedAt: serverTimestamp(), updatedByEmail: normalize(currentUser?.email) };
  if (status === "In Progress" && !selectedJob.startedAt) payload.startedAt = serverTimestamp();
  if (status === "Waiting Approval") { payload.completedAt = serverTimestamp(); payload.completedByEmail = normalize(currentUser?.email); }
  try { await updateDoc(doc(db, "workshopJobs", selectedJob.id), payload); showStatus(message); }
  catch (err) { showStatus(err?.message || "Unable to update workshop job.", "error"); }
}

function startListeners() {
  if (jobsUnsub) jobsUnsub();
  if (busesUnsub) busesUnsub();
  jobsUnsub = onSnapshot(query(collection(db, "workshopJobs"), orderBy("createdAt", "desc")), (snap) => {
    jobs = snap.docs.map((d) => ({ id:d.id, ...d.data() }));
    renderQueue();
    if (selectedJob) { const refreshed = jobs.find((j) => j.id === selectedJob.id); if (refreshed) selectedJob = refreshed; }
  }, (err) => showStatus(err?.message || "Unable to load workshop jobs.", "error"));
  busesUnsub = onSnapshot(collection(db, "buses"), (snap) => { buses = snap.docs.map((d) => ({ id:d.id, ...d.data() })); });
}

els.statusFilter.addEventListener("change", renderQueue);
els.refreshBtn.addEventListener("click", () => renderQueue());
els.backToQueueBtn.addEventListener("click", () => { selectedJob = null; els.jobCardView.hidden = true; els.queueView.hidden = false; clearStatus(); });
els.addPartBtn.addEventListener("click", () => partRow());
els.startJobBtn.addEventListener("click", () => saveJobCard("In Progress", "Workshop job started."));
els.waitingPartsBtn.addEventListener("click", () => saveJobCard("Waiting Parts", "Workshop job marked as waiting for parts."));
els.saveProgressBtn.addEventListener("click", () => saveJobCard(selectedJob?.status === "Assigned" ? "In Progress" : (selectedJob?.status || "In Progress"), "Job card progress saved."));
els.completeJobBtn.addEventListener("click", () => saveJobCard("Waiting Approval", "Job card completed and sent to Fleet Manager for approval."));
els.loginBtn.addEventListener("click", () => signInWithPopup(auth, provider));
els.logoutBtn.addEventListener("click", () => signOut(auth));

onAuthStateChanged(auth, (user) => {
  currentUser = user;
  if (!user) {
    els.authText.textContent = "Not signed in";
    els.loginBtn.hidden = false;
    els.logoutBtn.hidden = true;
    els.mechanicIdentity.textContent = "Sign in to view the shared workshop queue.";
    els.jobQueue.innerHTML = `<div class="empty">Sign in to load workshop jobs.</div>`;
    if (jobsUnsub) jobsUnsub();
    if (busesUnsub) busesUnsub();
    return;
  }
  els.authText.textContent = `Signed in: ${user.email}`;
  els.loginBtn.hidden = true;
  els.logoutBtn.hidden = false;
  els.mechanicIdentity.textContent = "Shared workshop table · all assigned jobs visible to workshop staff";
  startListeners();
});