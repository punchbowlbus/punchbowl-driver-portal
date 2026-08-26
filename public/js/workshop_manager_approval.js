import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  limit,
  runTransaction,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";

import { auth, db } from "./firebase.js";

let jobs = [];
let buses = [];
let readings = [];
let selectedJob = null;
let selectedBus = null;
let observer = null;

const $ = (id) => document.getElementById(id);
const norm = (v) => String(v || "").trim().toLowerCase();
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const esc = (v) => String(v ?? "").replace(/[&<>'"]/g, (m) => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[m]));
const fleetNo = (b) => b?.fleetNumber || b?.busNumber || b?.number || b?.id || "";
const fmtKm = (v) => { const n = num(v); return n == null ? "—" : `${Math.round(n).toLocaleString("en-AU")} km`; };

function fmtDateTime(v) {
  if (!v) return "—";
  const d = typeof v?.toDate === "function" ? v.toDate() : new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return new Intl.DateTimeFormat("en-AU", {
    day:"2-digit", month:"short", year:"numeric", hour:"numeric", minute:"2-digit"
  }).format(d);
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

function addMonths(dateString, months) {
  if (!dateString || !months) return "";
  const d = new Date(`${dateString}T00:00:00`);
  if (Number.isNaN(d.getTime())) return "";
  d.setMonth(d.getMonth() + months);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

function toast(message, type="success") {
  const status = $("status");
  if (!status) return;
  status.className = `status ${type}`;
  status.textContent = message;
  status.scrollIntoView({behavior:"smooth", block:"nearest"});
}

function injectStyles() {
  if ($("workshopApprovalStyles")) return;
  const style = document.createElement("style");
  style.id = "workshopApprovalStyles";
  style.textContent = `
    .wm-clickable { cursor:pointer; }
    .wm-clickable:hover { background:#f8fafc; }
    .wm-action-row { display:flex; gap:8px; flex-wrap:wrap; margin-top:10px; }
    .wm-review-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:12px; }
    .wm-review-box { border:1px solid #d9e1ea; border-radius:10px; padding:12px; background:#f8fafc; }
    .wm-review-label { font-size:11px; text-transform:uppercase; font-weight:800; color:#5d6a78; margin-bottom:4px; }
    .wm-review-value { white-space:pre-wrap; }
    .wm-full { grid-column:1/-1; }
    .wm-confirm { border:1px solid #f0c36d; background:#fff8e6; border-radius:10px; padding:12px; margin-top:14px; }
    .wm-history-list { max-height:60vh; overflow:auto; display:grid; gap:10px; }
    .wm-history-item { border:1px solid #d9e1ea; border-radius:10px; padding:12px; }
    .wm-history-date { font-size:12px; color:#64748b; }
    .wm-print-only { display:none; }
    @media (max-width:760px) { .wm-review-grid { grid-template-columns:1fr; } }
  `;
  document.head.appendChild(style);
}

function ensureDialogs() {
  injectStyles();
  if (!$("fleetManagerReviewDialog")) {
    const d = document.createElement("dialog");
    d.id = "fleetManagerReviewDialog";
    d.className = "dialog";
    d.innerHTML = `
      <form method="dialog" id="fleetManagerReviewForm">
        <div class="dialog-head">
          <div><h2>Fleet Manager Review</h2><p id="wmReviewSubtitle">Review the completed electronic job card.</p></div>
          <button type="button" class="icon-button" id="wmReviewClose">×</button>
        </div>
        <div id="wmReviewBody"></div>
        <div class="section-title">Fleet Manager Decision</div>
        <div class="form-grid">
          <label>Vehicle status after decision
            <select id="wmVehicleStatus">
              <option value="Active">Available / Active</option>
              <option value="Restricted">Restricted</option>
              <option value="Workshop">Workshop</option>
              <option value="Out of Service">Out of Service</option>
            </select>
          </label>
          <label>Return to service?
            <select id="wmReturnToService"><option value="Yes">Yes</option><option value="No">No</option></select>
          </label>
          <label class="full">Fleet Manager comments
            <textarea id="wmManagerComments" placeholder="Approval comments, restrictions or reason for returning to mechanic"></textarea>
          </label>
        </div>
        <div id="wmReviewMessage" class="status"></div>
        <div class="dialog-actions">
          <button type="button" class="button secondary" id="wmPrintJob">Print Job Card</button>
          <button type="button" class="button secondary" id="wmReturnMechanic">Return to Mechanic</button>
          <button type="button" class="button primary" id="wmApproveClose">Acknowledge & Close</button>
        </div>
      </form>`;
    document.body.appendChild(d);
    $("wmReviewClose").onclick = () => d.close();
    $("wmPrintJob").onclick = () => selectedJob && printJobCard(selectedJob);
    $("wmReturnMechanic").onclick = returnToMechanic;
    $("wmApproveClose").onclick = approveAndClose;
  }

  if (!$("vehicleHistoryDialog")) {
    const d = document.createElement("dialog");
    d.id = "vehicleHistoryDialog";
    d.className = "dialog";
    d.innerHTML = `
      <div class="dialog-head">
        <div><h2 id="wmHistoryTitle">Vehicle History</h2><p id="wmHistorySubtitle"></p></div>
        <button type="button" class="icon-button" id="wmHistoryClose">×</button>
      </div>
      <div id="wmHistoryBody" class="wm-history-list"></div>
      <div class="dialog-actions"><button type="button" class="button secondary" id="wmHistoryDone">Close</button></div>`;
    document.body.appendChild(d);
    $("wmHistoryClose").onclick = () => d.close();
    $("wmHistoryDone").onclick = () => d.close();
  }
}

function busForJob(job) {
  return buses.find((b) => b.id === job.busId || norm(fleetNo(b)) === norm(job.fleetNumber));
}

function approvalDisplay(job) {
  const card = job.jobCard || {};
  const checklist = card.checklist || {};
  const checklistHtml = Object.keys(checklist).length
    ? Object.entries(checklist).map(([k,v]) => `<div>${esc(k)}: <strong>${esc(v || "—")}</strong></div>`).join("")
    : "No checklist recorded.";
  const parts = Array.isArray(card.partsUsed) ? card.partsUsed : [];
  const partsHtml = parts.length
    ? parts.map((p) => `${esc(p.partNumber || "")}${p.partNumber ? " · " : ""}${esc(p.description || "Part")} × ${esc(p.quantity ?? 1)}`).join("<br>")
    : "No parts recorded.";

  return `
    <div class="wm-review-grid">
      <div class="wm-review-box"><div class="wm-review-label">Job</div><div class="wm-review-value"><strong>${esc(job.jobNumber || job.id)}</strong></div></div>
      <div class="wm-review-box"><div class="wm-review-label">Bus</div><div class="wm-review-value"><strong>${esc(job.fleetNumber || "—")}</strong> ${job.rego ? `· ${esc(job.rego)}` : ""}</div></div>
      <div class="wm-review-box"><div class="wm-review-label">Job type</div><div class="wm-review-value">${esc(job.jobType || "Workshop Job")}</div></div>
      <div class="wm-review-box"><div class="wm-review-label">Mechanic</div><div class="wm-review-value">${esc(job.mechanicName || job.assignedMechanic || "—")}</div></div>
      <div class="wm-review-box"><div class="wm-review-label">Mechanic completed</div><div class="wm-review-value">${esc(fmtDateTime(job.mechanicCompletedAt || job.updatedAt))}</div></div>
      <div class="wm-review-box"><div class="wm-review-label">Odometer</div><div class="wm-review-value">${esc(fmtKm(card.currentOdometer ?? job.odometerStart))}</div></div>
      <div class="wm-review-box wm-full"><div class="wm-review-label">Reported fault / work requested</div><div class="wm-review-value">${esc(job.reportedFault || "—")}</div></div>
      <div class="wm-review-box wm-full"><div class="wm-review-label">Diagnosis / findings</div><div class="wm-review-value">${esc(card.diagnosis || job.diagnosis || "—")}</div></div>
      <div class="wm-review-box wm-full"><div class="wm-review-label">Work completed</div><div class="wm-review-value">${esc(card.workCompleted || job.workCompleted || "—")}</div></div>
      <div class="wm-review-box"><div class="wm-review-label">Safe to return</div><div class="wm-review-value"><strong>${esc(card.safeToReturn || "—")}</strong></div></div>
      <div class="wm-review-box"><div class="wm-review-label">Further work required</div><div class="wm-review-value">${esc(card.furtherWorkRequired || "—")}</div></div>
      <div class="wm-review-box wm-full"><div class="wm-review-label">Further work details</div><div class="wm-review-value">${esc(card.furtherWork || "—")}</div></div>
      <div class="wm-review-box wm-full"><div class="wm-review-label">Parts used</div><div class="wm-review-value">${partsHtml}</div></div>
      <div class="wm-review-box wm-full"><div class="wm-review-label">Checklist</div><div class="wm-review-value">${checklistHtml}</div></div>
      <div class="wm-review-box wm-full"><div class="wm-review-label">Mechanic notes</div><div class="wm-review-value">${esc(card.mechanicNotes || "—")}</div></div>
    </div>`;
}

function openReview(jobId) {
  ensureDialogs();
  const job = jobs.find((j) => j.id === jobId);
  if (!job) return toast("Workshop job could not be found.", "error");
  selectedJob = job;
  const bus = busForJob(job);
  $("wmReviewSubtitle").textContent = `${job.jobNumber || job.id} · ${job.fleetNumber || ""} · ${job.status || ""}`;
  $("wmReviewBody").innerHTML = approvalDisplay(job);
  $("wmVehicleStatus").value = bus?.status && ["Active","Restricted","Workshop","Out of Service"].includes(bus.status) ? bus.status : "Active";
  $("wmReturnToService").value = job.jobCard?.safeToReturn === "No" ? "No" : "Yes";
  $("wmManagerComments").value = job.fleetManagerApproval?.comments || "";
  $("wmReviewMessage").className = "status";
  $("wmReviewMessage").textContent = "";
  const waiting = job.status === "Waiting Approval";
  $("wmReturnMechanic").hidden = !waiting;
  $("wmApproveClose").hidden = !waiting;
  $("fleetManagerReviewDialog").showModal();
}

async function returnToMechanic() {
  if (!selectedJob || selectedJob.status !== "Waiting Approval") return;
  const comments = $("wmManagerComments").value.trim();
  if (!comments) {
    $("wmReviewMessage").className = "status error";
    $("wmReviewMessage").textContent = "Enter a reason before returning this Job Card to the mechanic.";
    return;
  }
  const btn = $("wmReturnMechanic");
  btn.disabled = true;
  btn.textContent = "Returning...";
  try {
    await runTransaction(db, async (tx) => {
      const ref = doc(db, "workshopJobs", selectedJob.id);
      const snap = await tx.get(ref);
      if (!snap.exists()) throw new Error("Workshop job no longer exists.");
      if (snap.data().status !== "Waiting Approval") throw new Error("This job is no longer waiting for approval.");
      tx.update(ref, {
        status:"In Progress",
        fleetManagerReviewResult:"Returned to Mechanic",
        fleetManagerReviewComments:comments,
        fleetManagerReviewedByEmail:norm(auth.currentUser?.email),
        fleetManagerReviewedAt:serverTimestamp(),
        updatedAt:serverTimestamp()
      });
    });
    $("fleetManagerReviewDialog").close();
    toast(`${selectedJob.jobNumber || selectedJob.id} returned to the mechanic. Reason saved with date and time.`);
  } catch (e) {
    $("wmReviewMessage").className = "status error";
    $("wmReviewMessage").textContent = e?.message || "Unable to return job to mechanic.";
  } finally {
    btn.disabled = false;
    btn.textContent = "Return to Mechanic";
  }
}

async function approveAndClose() {
  if (!selectedJob || selectedJob.status !== "Waiting Approval") return;
  const returnToService = $("wmReturnToService").value;
  const vehicleStatus = $("wmVehicleStatus").value;
  const comments = $("wmManagerComments").value.trim();
  const card = selectedJob.jobCard || {};

  if (returnToService === "Yes" && card.safeToReturn === "No") {
    $("wmReviewMessage").className = "status error";
    $("wmReviewMessage").textContent = "The mechanic marked this vehicle NOT safe to return. Change Return to service to No, or return the Job Card to the mechanic for correction.";
    return;
  }

  const confirmText = `Acknowledge and permanently close ${selectedJob.jobNumber || selectedJob.id}? Type CLOSE to confirm.`;
  const typed = window.prompt(confirmText, "");
  if (typed !== "CLOSE") return;

  const btn = $("wmApproveClose");
  btn.disabled = true;
  btn.textContent = "Closing...";

  try {
    await runTransaction(db, async (tx) => {
      const jobRef = doc(db, "workshopJobs", selectedJob.id);
      const jobSnap = await tx.get(jobRef);
      if (!jobSnap.exists()) throw new Error("Workshop job no longer exists.");
      const latestJob = jobSnap.data();
      if (latestJob.status !== "Waiting Approval") throw new Error("This job is no longer waiting for approval.");

      const bus = busForJob(selectedJob);
      let busData = null;
      let busRef = null;
      if (bus?.id) {
        busRef = doc(db, "buses", bus.id);
        const busSnap = await tx.get(busRef);
        if (busSnap.exists()) busData = busSnap.data();
      }

      const currentJobOdo = num(latestJob.jobCard?.currentOdometer);
      const oldBusOdo = num(busData?.currentOdometer ?? busData?.odometer ?? busData?.odometerKm);
      const approval = {
        approved:true,
        approvedByName:auth.currentUser?.displayName || auth.currentUser?.email || "Fleet Manager",
        approvedByEmail:norm(auth.currentUser?.email),
        comments,
        returnToService:returnToService === "Yes",
        vehicleStatus,
        approvedAt:serverTimestamp()
      };

      tx.update(jobRef, {
        status:"Closed",
        fleetManagerApproval:approval,
        returnToServiceApproved:returnToService === "Yes",
        closedByEmail:norm(auth.currentUser?.email),
        closedAt:serverTimestamp(),
        updatedAt:serverTimestamp()
      });

      if (busRef && busData) {
        const busUpdate = {
          status:vehicleStatus,
          lastWorkshopJobId:selectedJob.id,
          lastWorkshopJobNumber:selectedJob.jobNumber || "",
          lastWorkshopClosedAt:serverTimestamp(),
          lastWorkshopClosedBy:norm(auth.currentUser?.email)
        };

        if (currentJobOdo != null && (oldBusOdo == null || currentJobOdo >= oldBusOdo)) {
          busUpdate.currentOdometer = currentJobOdo;
          busUpdate.lastOdometerDate = todayStr();
          busUpdate.lastOdometerUpdatedAt = serverTimestamp();
          busUpdate.lastOdometerUpdatedBy = norm(auth.currentUser?.email);

          const readingRef = doc(collection(db, "odometerReadings"));
          tx.set(readingRef, {
            busId:bus.id,
            fleetNumber:fleetNo(bus),
            previousOdometer:oldBusOdo,
            currentOdometer:currentJobOdo,
            readingDate:todayStr(),
            source:"Workshop Job",
            sourceJobId:selectedJob.id,
            sourceJobNumber:selectedJob.jobNumber || "",
            notes:`Recorded on Fleet Manager approval of ${selectedJob.jobNumber || selectedJob.id}`,
            enteredByEmail:norm(auth.currentUser?.email),
            createdAt:serverTimestamp()
          });
        }

        if (selectedJob.jobType === "Scheduled Service" && currentJobOdo != null) {
          const intervalKm = num(busData.serviceIntervalKm);
          const intervalMonths = num(busData.serviceIntervalMonths) || 0;
          busUpdate.lastServiceOdometer = currentJobOdo;
          busUpdate.lastServiceDate = todayStr();
          if (intervalKm != null && intervalKm > 0) busUpdate.nextServiceOdometer = currentJobOdo + intervalKm;
          if (intervalMonths > 0) busUpdate.nextServiceDate = addMonths(todayStr(), intervalMonths);
        }

        tx.update(busRef, busUpdate);
      }
    });

    $("fleetManagerReviewDialog").close();
    toast(`${selectedJob.jobNumber || selectedJob.id} acknowledged and closed. Fleet Manager approval date/time and vehicle history were saved.`);
  } catch (e) {
    $("wmReviewMessage").className = "status error";
    $("wmReviewMessage").textContent = e?.message || "Unable to close workshop job.";
  } finally {
    btn.disabled = false;
    btn.textContent = "Acknowledge & Close";
  }
}

function printJobCard(job) {
  const card = job.jobCard || {};
  const approval = job.fleetManagerApproval || {};
  const parts = Array.isArray(card.partsUsed) ? card.partsUsed : [];
  const checklist = card.checklist || {};
  const html = `<!doctype html><html><head><title>${esc(job.jobNumber || "Job Card")}</title><style>
    body{font-family:Arial,sans-serif;color:#111;margin:28px;font-size:13px} h1,h2{margin:0 0 8px} .head{border-bottom:3px solid #c92026;padding-bottom:12px;margin-bottom:18px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}.box{border:1px solid #bbb;padding:10px}.full{grid-column:1/-1}.label{font-size:10px;font-weight:bold;text-transform:uppercase;color:#555;margin-bottom:4px} table{width:100%;border-collapse:collapse;margin-top:8px}th,td{border:1px solid #bbb;padding:7px;text-align:left}.approval{margin-top:18px;border:2px solid #111;padding:12px}@media print{button{display:none}}</style></head><body>
    <div class="head"><h1>PUNCHBOWL BUS COMPANY</h1><h2>WORKSHOP JOB CARD</h2></div>
    <div class="grid">
      <div class="box"><div class="label">Job No.</div><strong>${esc(job.jobNumber || job.id)}</strong></div>
      <div class="box"><div class="label">Fleet / Rego</div><strong>${esc(job.fleetNumber || "—")}</strong> ${job.rego ? `· ${esc(job.rego)}` : ""}</div>
      <div class="box"><div class="label">Job Type</div>${esc(job.jobType || "—")}</div>
      <div class="box"><div class="label">Mechanic</div>${esc(job.mechanicName || job.assignedMechanic || "—")}</div>
      <div class="box full"><div class="label">Reported Fault / Requested Work</div>${esc(job.reportedFault || "—")}</div>
      <div class="box full"><div class="label">Diagnosis / Findings</div>${esc(card.diagnosis || "—")}</div>
      <div class="box full"><div class="label">Work Completed</div>${esc(card.workCompleted || "—")}</div>
      <div class="box"><div class="label">Odometer</div>${esc(fmtKm(card.currentOdometer ?? job.odometerStart))}</div>
      <div class="box"><div class="label">Safe to Return</div>${esc(card.safeToReturn || "—")}</div>
      <div class="box"><div class="label">Work Started</div>${esc(card.labourStart || "—")}</div>
      <div class="box"><div class="label">Work Finished</div>${esc(card.labourFinish || "—")}</div>
      <div class="box full"><div class="label">Mechanic Notes</div>${esc(card.mechanicNotes || "—")}</div>
    </div>
    <h2 style="margin-top:18px">Parts Used</h2>
    <table><thead><tr><th>Part No.</th><th>Description</th><th>Qty</th><th>Supplier / Ref</th></tr></thead><tbody>${parts.length ? parts.map((p)=>`<tr><td>${esc(p.partNumber||"")}</td><td>${esc(p.description||"")}</td><td>${esc(p.quantity??"")}</td><td>${esc(p.supplierRef||"")}</td></tr>`).join("") : `<tr><td colspan="4">No parts recorded</td></tr>`}</tbody></table>
    <h2 style="margin-top:18px">Checklist</h2>
    <table><tbody>${Object.keys(checklist).length ? Object.entries(checklist).map(([k,v])=>`<tr><td>${esc(k)}</td><td>${esc(v||"—")}</td></tr>`).join("") : `<tr><td>No checklist recorded</td></tr>`}</tbody></table>
    <div class="approval"><h2>Fleet Manager Approval</h2><div><strong>Status:</strong> ${esc(job.status || "—")}</div><div><strong>Approved by:</strong> ${esc(approval.approvedByName || approval.approvedByEmail || "Not yet approved")}</div><div><strong>Approved:</strong> ${esc(fmtDateTime(approval.approvedAt || job.closedAt))}</div><div><strong>Return to service:</strong> ${approval.returnToService === true ? "YES" : approval.returnToService === false ? "NO" : "—"}</div><div><strong>Comments:</strong> ${esc(approval.comments || "—")}</div></div>
    <script>window.onload=()=>window.print();</script></body></html>`;
  const w = window.open("", "_blank", "noopener,noreferrer");
  if (!w) return toast("Pop-up blocked. Allow pop-ups to print the Job Card.", "error");
  w.document.open(); w.document.write(html); w.document.close();
}

function openVehicleHistory(busId) {
  ensureDialogs();
  selectedBus = buses.find((b) => b.id === busId);
  if (!selectedBus) return toast("Vehicle record could not be found.", "error");
  const relatedJobs = jobs.filter((j) => j.busId === busId || norm(j.fleetNumber) === norm(fleetNo(selectedBus)));
  const relatedReadings = readings.filter((r) => r.busId === busId || norm(r.fleetNumber) === norm(fleetNo(selectedBus)));
  const events = [
    ...relatedJobs.map((j) => ({type:"job", when:j.closedAt || j.mechanicCompletedAt || j.updatedAt || j.createdAt, job:j})),
    ...relatedReadings.map((r) => ({type:"odo", when:r.createdAt || r.readingDate, reading:r}))
  ].sort((a,b) => {
    const av = typeof a.when?.toDate === "function" ? a.when.toDate().getTime() : new Date(a.when || 0).getTime();
    const bv = typeof b.when?.toDate === "function" ? b.when.toDate().getTime() : new Date(b.when || 0).getTime();
    return bv-av;
  });

  $("wmHistoryTitle").textContent = `Vehicle History · ${fleetNo(selectedBus)}`;
  $("wmHistorySubtitle").textContent = `${selectedBus.rego || ""} · Current ${fmtKm(selectedBus.currentOdometer ?? selectedBus.odometer ?? selectedBus.odometerKm)} · Status ${selectedBus.status || "Active"}`;
  $("wmHistoryBody").innerHTML = events.length ? events.map((e) => {
    if (e.type === "odo") {
      const r = e.reading;
      return `<div class="wm-history-item"><div class="wm-history-date">${esc(fmtDateTime(e.when))}</div><strong>Odometer Reading</strong><div>${esc(fmtKm(r.currentOdometer))}</div><div class="list-meta">Source: ${esc(r.source || "—")} · Previous: ${esc(fmtKm(r.previousOdometer))}</div></div>`;
    }
    const j = e.job;
    return `<div class="wm-history-item"><div class="wm-history-date">${esc(fmtDateTime(e.when))}</div><strong>${esc(j.jobType || "Workshop Job")} · ${esc(j.jobNumber || j.id)}</strong><div>${esc(j.reportedFault || "")}</div><div class="list-meta">Status: ${esc(j.status || "—")} · Mechanic: ${esc(j.mechanicName || j.assignedMechanic || "—")}</div><div class="wm-action-row"><button type="button" class="button secondary" data-history-review="${esc(j.id)}">View Job Card</button><button type="button" class="button secondary" data-history-print="${esc(j.id)}">Print</button></div></div>`;
  }).join("") : `<div class="empty">No workshop or odometer history recorded for this vehicle yet.</div>`;

  $("wmHistoryBody").querySelectorAll("[data-history-review]").forEach((b) => b.onclick = () => { $("vehicleHistoryDialog").close(); openReview(b.dataset.historyReview); });
  $("wmHistoryBody").querySelectorAll("[data-history-print]").forEach((b) => b.onclick = () => { const j = jobs.find((x)=>x.id===b.dataset.historyPrint); if (j) printJobCard(j); });
  $("vehicleHistoryDialog").showModal();
}

function enhanceDashboardJobs() {
  const root = $("dashboardJobsList");
  if (!root) return;
  [...root.querySelectorAll(".list-item")].forEach((item) => {
    if (item.dataset.wmEnhanced) return;
    const title = item.querySelector(".list-title")?.textContent || "";
    const job = jobs.find((j) => title.includes(j.jobNumber || j.id));
    if (!job) return;
    item.dataset.wmEnhanced = "1";
    item.classList.add("wm-clickable");
    item.addEventListener("click", () => openReview(job.id));
    if (job.status === "Waiting Approval") {
      const row = document.createElement("div"); row.className = "wm-action-row";
      row.innerHTML = `<button type="button" class="button primary">Review & Close</button>`;
      row.querySelector("button").onclick = (e) => { e.stopPropagation(); openReview(job.id); };
      item.appendChild(row);
    }
  });
}

function enhanceJobsTable() {
  const body = $("jobsTableBody");
  if (!body) return;
  [...body.querySelectorAll("tr")].forEach((row) => {
    if (row.dataset.wmEnhanced) return;
    const jobNo = row.cells?.[0]?.textContent?.trim();
    const job = jobs.find((j) => norm(j.jobNumber || j.id) === norm(jobNo));
    if (!job) return;
    row.dataset.wmEnhanced = "1";
    row.classList.add("wm-clickable");
    row.title = "Open Job Card";
    row.addEventListener("click", () => openReview(job.id));
    if (job.status === "Waiting Approval" && row.cells?.[5]) {
      row.cells[5].innerHTML = `<span class="badge warn">Waiting Approval</span><div class="list-meta">Click to review</div>`;
    }
  });
}

function enhanceHistory() {
  const root = $("historyList");
  if (!root) return;
  [...root.querySelectorAll(".list-item")].forEach((item) => {
    if (item.dataset.wmEnhanced) return;
    const title = item.querySelector(".list-title")?.textContent || "";
    const job = jobs.find((j) => title.includes(j.jobNumber || j.id));
    if (!job) return;
    item.dataset.wmEnhanced = "1";
    const row = document.createElement("div"); row.className = "wm-action-row";
    row.innerHTML = `<button type="button" class="button secondary" data-view>View Job Card</button><button type="button" class="button secondary" data-print>Print Job Card</button>`;
    row.querySelector("[data-view]").onclick = () => openReview(job.id);
    row.querySelector("[data-print]").onclick = () => printJobCard(job);
    item.appendChild(row);
  });
}

function enhanceFleet() {
  const body = $("fleetTableBody");
  if (!body) return;
  [...body.querySelectorAll("tr")].forEach((row) => {
    if (row.dataset.wmHistoryEnhanced) return;
    const number = row.cells?.[0]?.textContent?.trim();
    const bus = buses.find((b) => norm(fleetNo(b)) === norm(number));
    if (!bus || !row.cells?.[7]) return;
    row.dataset.wmHistoryEnhanced = "1";
    const btn = document.createElement("button");
    btn.type = "button"; btn.className = "button secondary"; btn.textContent = "View history";
    btn.onclick = () => openVehicleHistory(bus.id);
    row.cells[7].appendChild(btn);
  });
}

function enhanceUi() {
  enhanceDashboardJobs();
  enhanceJobsTable();
  enhanceHistory();
  enhanceFleet();
}

function watchUi() {
  observer?.disconnect();
  observer = new MutationObserver(() => enhanceUi());
  observer.observe(document.body, {childList:true, subtree:true});
  enhanceUi();
}

ensureDialogs();
watchUi();

onSnapshot(query(collection(db,"workshopJobs"), orderBy("createdAt","desc"), limit(300)), (snap) => {
  jobs = snap.docs.map((d) => ({id:d.id,...d.data()}));
  enhanceUi();
});

onSnapshot(collection(db,"buses"), (snap) => {
  buses = snap.docs.map((d) => ({id:d.id,...d.data()}));
  enhanceUi();
});

onSnapshot(query(collection(db,"odometerReadings"), orderBy("createdAt","desc"), limit(500)), (snap) => {
  readings = snap.docs.map((d) => ({id:d.id,...d.data()}));
});
