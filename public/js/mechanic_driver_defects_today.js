import { collection, doc, onSnapshot, runTransaction, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";
import { db } from "./firebase.js";

const esc = (v) => String(v ?? "").replace(/[&<>'\"]/g, (m) => ({
  "&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'\"':"&quot;"
}[m]));

function localDateString(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function yesterdayString() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return localDateString(d);
}

function reportDate(r) {
  if (r.defectDate) return String(r.defectDate).slice(0, 10);
  const d = r.createdAt?.toDate?.() || (r.reportedAtIso ? new Date(r.reportedAtIso) : null);
  return d && !Number.isNaN(d.getTime()) ? localDateString(d) : "";
}

function busLabel(r) {
  return [r.fleetNumber || r.busNumber, r.rego].map((v) => String(v || "").trim()).filter(Boolean).join(" · ") || "—";
}

function isDone(r) {
  return ["completed", "closed"].includes(String(r.status || "").toLowerCase());
}

function ensureJobDialog() {
  if (document.getElementById("mechanicDefectJobDialog")) return;
  const dialog = document.createElement("dialog");
  dialog.id = "mechanicDefectJobDialog";
  dialog.className = "dialog";
  dialog.innerHTML = `<form id="mechanicDefectJobForm" method="dialog">
    <div class="dialog-head"><div><h2>Create Job Card</h2><p id="mechanicDefectJobHelp">Create from driver defect and assign to yourself.</p></div><button id="mechanicDefectJobClose" class="icon-button" type="button">×</button></div>
    <div class="form-grid">
      <label>Bus<input id="mechanicDefectJobBus" readonly></label>
      <label>Job type<select id="mechanicDefectJobType"><option>Defect Repair</option><option>Breakdown Repair</option><option>Electrical</option><option>Tyres</option><option>Body Repair</option><option>Other</option></select></label>
      <label>Priority<select id="mechanicDefectJobPriority"><option>Normal</option><option>High</option><option>Urgent</option><option>Safety Critical</option></select></label>
      <label>Due date<input id="mechanicDefectJobDue" type="date"></label>
      <label class="full">Assigned mechanic<input id="mechanicDefectJobAssignee" readonly></label>
      <label class="full">Reported fault / work requested<textarea id="mechanicDefectJobFault" required></textarea></label>
      <label class="full">Mechanic notes<textarea id="mechanicDefectJobNotes" placeholder="Optional initial notes"></textarea></label>
    </div>
    <div id="mechanicDefectJobMessage" class="status"></div>
    <div class="dialog-actions"><button id="mechanicDefectJobCancel" class="button secondary" type="button">Cancel</button><button id="mechanicDefectJobSubmit" class="button primary" type="submit">Create &amp; Assign to Me</button></div>
  </form>`;
  document.body.appendChild(dialog);
  document.getElementById("mechanicDefectJobClose").onclick = () => dialog.close();
  document.getElementById("mechanicDefectJobCancel").onclick = () => dialog.close();
  dialog.addEventListener("close", () => { selectedDefect = null; });
  document.getElementById("mechanicDefectJobForm").addEventListener("submit", createAndAssignJob);
}

let selectedDefect = null;

function todayString() { return localDateString(); }

function openJobCreation(report) {
  const mechanic = window.currentWorkshopMechanic;
  if (!mechanic) {
    const status = document.getElementById("status");
    if (status) { status.className = "status error"; status.textContent = "Mechanic access is required to create and assign a job."; }
    return;
  }
  ensureJobDialog();
  selectedDefect = report;
  document.getElementById("mechanicDefectJobHelp").textContent = `${report.reportNumber || "Driver defect"} · Confirm details before creating the job.`;
  document.getElementById("mechanicDefectJobBus").value = busLabel(report);
  document.getElementById("mechanicDefectJobType").value = "Defect Repair";
  document.getElementById("mechanicDefectJobPriority").value = report.safeToDrive === "No" ? "Safety Critical" : "Normal";
  document.getElementById("mechanicDefectJobDue").value = String(report.defectDate || "") >= todayString() ? report.defectDate : todayString();
  document.getElementById("mechanicDefectJobAssignee").value = mechanic.name;
  document.getElementById("mechanicDefectJobFault").value = report.description || "";
  document.getElementById("mechanicDefectJobNotes").value = report.adminNotes || "";
  const message = document.getElementById("mechanicDefectJobMessage");
  message.className = "status"; message.textContent = "";
  document.getElementById("mechanicDefectJobDialog").showModal();
}

async function createAndAssignJob(event) {
  event.preventDefault();
  const report = selectedDefect;
  const mechanic = window.currentWorkshopMechanic;
  const message = document.getElementById("mechanicDefectJobMessage");
  const submit = document.getElementById("mechanicDefectJobSubmit");
  if (!report || !mechanic) { message.className = "status error"; message.textContent = "Mechanic access or defect details are unavailable."; return; }
  const fault = document.getElementById("mechanicDefectJobFault").value.trim();
  if (!fault) { message.className = "status error"; message.textContent = "Describe the work required."; return; }
  submit.disabled = true; submit.textContent = "Creating…";
  const jobRef = doc(collection(db,"workshopJobs"));
  const defectRef = doc(db,"defectReports",report.id);
  const jobNumber = `WJ-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`;
  window.pendingMechanicJobToOpen = jobRef.id;
  try {
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(defectRef);
      if (!snap.exists()) throw new Error("This defect report no longer exists.");
      const current = snap.data();
      if (current.workshopJobId || current.workshopJobNumber) throw new Error(`A job card already exists: ${current.workshopJobNumber || current.workshopJobId}`);
      if (isDone(current)) throw new Error("This defect report has already been completed.");
      tx.set(jobRef, {
        jobNumber, busId:current.busId || report.busId || "", fleetNumber:current.fleetNumber || current.busNumber || report.fleetNumber || report.busNumber || "", rego:current.rego || report.rego || "",
        jobType:document.getElementById("mechanicDefectJobType").value || "Defect Repair", priority:document.getElementById("mechanicDefectJobPriority").value || "Normal",
        status:"Assigned", assignedMechanic:mechanic.name, assignedMechanicName:mechanic.name, assignedMechanicEmployeeNumber:mechanic.employeeNumber, assignedMechanicEmail:mechanic.email,
        dueDate:document.getElementById("mechanicDefectJobDue").value || "", source:"Driver Defect", sourceDefectId:report.id, sourceDefectNumber:current.reportNumber || report.reportNumber || "",
        defectCategory:current.category || report.category || "", defectPhotos:Array.isArray(current.photos) ? current.photos : [], reportedFault:fault,
        managerNotes:document.getElementById("mechanicDefectJobNotes").value.trim(), diagnosis:"", workCompleted:"", partsUsed:[], labourEntries:[], returnToServiceApproved:false,
        createdByUid:mechanic.uid, createdByEmail:mechanic.email, createdAt:serverTimestamp(), updatedAt:serverTimestamp(), schemaVersion:1
      });
      tx.set(defectRef, {status:"Workshop Assigned", workshopJobId:jobRef.id, workshopJobNumber:jobNumber, convertedToJobAt:serverTimestamp(), convertedToJobByUid:mechanic.uid, convertedToJobByEmail:mechanic.email, updatedAt:serverTimestamp()}, {merge:true});
    });
    document.getElementById("mechanicDefectJobDialog").close();
  } catch (error) {
    window.pendingMechanicJobToOpen = null;
    message.className = "status error"; message.textContent = error?.message || "Unable to create the workshop job.";
  } finally {
    submit.disabled = false; submit.textContent = "Create & Assign to Me";
  }
}

function dayLabel(dateValue, today, yesterday) {
  if (dateValue === today) return "Today";
  if (dateValue === yesterday) return "Yesterday";
  return dateValue || "Earlier";
}

function render(reports) {
  const wrap = document.getElementById("mechanicTodayDefects");
  const count = document.getElementById("mechanicTodayDefectCount");
  if (!wrap) return;

  const today = localDateString();
  const yesterday = yesterdayString();
  const list = reports
    .map((r) => ({ ...r, _reportDate: reportDate(r) }))
    .filter((r) => r.deleted !== true && !isDone(r))
    .sort((a,b) => {
      if (a._reportDate !== b._reportDate) return String(b._reportDate || "").localeCompare(String(a._reportDate || ""));
      return (b.createdAt?.toMillis?.() || Date.parse(b.reportedAtIso || "") || 0) - (a.createdAt?.toMillis?.() || Date.parse(a.reportedAtIso || "") || 0);
    });

  if (count) count.textContent = String(list.length);

  if (!list.length) {
    wrap.innerHTML = `<div class="empty">No open driver defect reports.</div>`;
    return;
  }

  wrap.innerHTML = list.map((r) => {
    const unsafe = r.safeToDrive === "No";
    const linkedJob = r.workshopJobId || r.workshopJobNumber;
    const action = linkedJob
      ? `<button class="button secondary mechanic-open-linked-job" type="button" data-linked-job="${esc(r.workshopJobId || "")}" ${r.workshopJobId ? "" : "disabled"}>${r.workshopJobId ? "Open Job Card" : `Job ${esc(r.workshopJobNumber)}`}</button>`
      : `<button class="button primary mechanic-create-defect-job" type="button" data-create-defect-job="${esc(r.id)}">Create &amp; Assign to Me</button>`;
    return `<article class="mechanic-defect-card ${unsafe ? "unsafe" : ""}">
      <div class="mechanic-defect-head">
        <div>
          <strong>${esc(r.reportNumber || r.id)}</strong>
          <span>${esc(busLabel(r))} · ${esc(dayLabel(r._reportDate, today, yesterday))}</span>
        </div>
        <div class="mechanic-defect-badges">
          <span class="badge ${unsafe ? "bad" : "good"}">${unsafe ? "Unsafe to drive" : "Safe to drive"}</span>
          <span class="badge info">${esc(r.status || "New")}</span>
        </div>
      </div>
      <div class="mechanic-defect-meta">
        <div><span>Category</span><strong>${esc(r.category || "Other")}</strong></div>
        <div><span>Driver</span><strong>${esc(r.reportedByName || "Unknown")}</strong></div>
      </div>
      <div class="mechanic-defect-description">${esc(r.description || "No description provided")}</div>
      <div class="mechanic-defect-actions">${action}</div>
    </article>`;
  }).join("");

  wrap.querySelectorAll("[data-create-defect-job]").forEach((button) => button.addEventListener("click", () => {
    const report = list.find((item) => item.id === button.dataset.createDefectJob);
    if (report) openJobCreation(report);
  }));
  wrap.querySelectorAll("[data-linked-job]").forEach((button) => button.addEventListener("click", () => {
    if (button.dataset.linkedJob && typeof window.openMechanicJobCard === "function") window.openMechanicJobCard(button.dataset.linkedJob);
  }));
}

onSnapshot(collection(db, "defectReports"), (snap) => {
  render(snap.docs.map((d) => ({ id:d.id, ...d.data() })));
}, (error) => {
  console.error("Unable to load recent driver defects", error);
  const wrap = document.getElementById("mechanicTodayDefects");
  if (wrap) wrap.innerHTML = `<div class="empty">Unable to load recent driver defect reports.</div>`;
});
