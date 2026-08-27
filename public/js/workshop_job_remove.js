import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";

import { db } from "./firebase.js";

let jobs = [];
let observer = null;
let rendering = false;
let pendingJob = null;

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function canRemoveJob(job) {
  if (!job || job.startedAt) return false;
  return ["new", "assigned"].includes(normalize(job.status));
}

function showStatus(message, type = "success") {
  const status = document.getElementById("status");
  if (!status) return;
  status.className = `status ${type}`;
  status.textContent = message;
}

function ensureDialog() {
  if (document.getElementById("removeWorkshopJobDialog")) return;

  const dialog = document.createElement("dialog");
  dialog.id = "removeWorkshopJobDialog";
  dialog.className = "dialog";
  dialog.innerHTML = `
    <div class="dialog-head">
      <div>
        <h2>Remove Workshop Job?</h2>
        <p>This action is only available before the mechanic starts the job.</p>
      </div>
      <button id="removeJobCloseBtn" class="icon-button" type="button">×</button>
    </div>
    <div class="remove-job-warning">
      <strong id="removeJobNumber">Workshop job</strong>
      <div id="removeJobDetail"></div>
      <p>Was this job card created by mistake and should it be permanently removed?</p>
    </div>
    <div class="dialog-actions">
      <button id="removeJobNoBtn" class="button secondary" type="button">No, Keep Job</button>
      <button id="removeJobYesBtn" class="button primary remove-job-confirm" type="button">Yes, Remove Job</button>
    </div>
  `;
  document.body.appendChild(dialog);

  const style = document.createElement("style");
  style.textContent = `
    #removeWorkshopJobDialog{width:min(520px,calc(100vw - 28px))}
    .remove-job-warning{border:1px solid #fecdca;background:#fff6f5;border-radius:12px;padding:14px 16px;color:#344054;line-height:1.5}
    .remove-job-warning strong{display:block;color:#b42318;font-size:16px;margin-bottom:4px}
    .remove-job-warning p{margin:12px 0 0;font-weight:700;color:#101828}
    .remove-job-confirm{background:#c62828!important;border-color:#c62828!important;color:#fff!important}
    .job-remove-button{border:1px solid #f04438;background:#fff;color:#b42318;border-radius:8px;padding:7px 11px;font-weight:800;cursor:pointer;white-space:nowrap}
    .job-remove-button:hover{background:#fff1f0}
    @media(max-width:700px){#removeWorkshopJobDialog .dialog-actions{display:flex;gap:8px}#removeWorkshopJobDialog .dialog-actions .button{flex:1;min-height:44px}}
  `;
  document.head.appendChild(style);

  document.getElementById("removeJobCloseBtn").addEventListener("click", () => dialog.close());
  document.getElementById("removeJobNoBtn").addEventListener("click", () => dialog.close());
  document.getElementById("removeJobYesBtn").addEventListener("click", removeConfirmedJob);
}

function openRemoveDialog(job) {
  ensureDialog();
  pendingJob = job;
  document.getElementById("removeJobNumber").textContent = job.jobNumber || job.id || "Workshop job";
  document.getElementById("removeJobDetail").textContent = `${job.fleetNumber || "Bus"} · ${job.jobType || "Workshop Job"} · ${job.assignedMechanic || "Unassigned"}`;
  document.getElementById("removeWorkshopJobDialog").showModal();
}

async function removeConfirmedJob() {
  if (!pendingJob) return;
  const yesBtn = document.getElementById("removeJobYesBtn");
  yesBtn.disabled = true;
  yesBtn.textContent = "Checking...";

  try {
    const ref = doc(db, "workshopJobs", pendingJob.id);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      document.getElementById("removeWorkshopJobDialog").close();
      showStatus("This workshop job has already been removed.", "error");
      return;
    }

    const current = { id: snap.id, ...snap.data() };
    if (!canRemoveJob(current)) {
      document.getElementById("removeWorkshopJobDialog").close();
      showStatus("This job can no longer be removed because the mechanic has already started or progressed it.", "error");
      return;
    }

    yesBtn.textContent = "Removing...";
    await deleteDoc(ref);
    document.getElementById("removeWorkshopJobDialog").close();
    showStatus(`✓ Workshop job ${current.jobNumber || current.id} removed.`);
  } catch (error) {
    showStatus(error?.message || "Unable to remove workshop job.", "error");
  } finally {
    pendingJob = null;
    yesBtn.disabled = false;
    yesBtn.textContent = "Yes, Remove Job";
  }
}

function ensureActionHeader() {
  const headerRow = document.querySelector("#jobsView table thead tr");
  if (!headerRow || headerRow.querySelector("[data-job-remove-header]")) return;
  const th = document.createElement("th");
  th.dataset.jobRemoveHeader = "1";
  th.textContent = "Action";
  headerRow.appendChild(th);
}

function enhanceRows() {
  if (rendering) return;
  rendering = true;
  try {
    ensureActionHeader();
    const tbody = document.getElementById("jobsTableBody");
    if (!tbody) return;

    [...tbody.querySelectorAll("tr")].forEach((row) => {
      if (row.querySelector("[data-job-remove-cell]")) return;
      const firstCell = row.querySelector("td");
      if (!firstCell) return;

      const jobNumber = String(firstCell.querySelector("strong")?.textContent || firstCell.textContent || "").trim();
      const job = jobs.find((item) => String(item.jobNumber || item.id || "").trim() === jobNumber);

      const td = document.createElement("td");
      td.dataset.jobRemoveCell = "1";

      if (canRemoveJob(job)) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "job-remove-button";
        button.textContent = "Remove";
        button.title = "Remove this job before mechanic work starts";
        button.addEventListener("click", () => openRemoveDialog(job));
        td.appendChild(button);
      } else if (job) {
        td.innerHTML = `<span class="list-meta">${job.startedAt || !["New", "Assigned"].includes(job.status) ? "Locked" : ""}</span>`;
      }

      row.appendChild(td);
    });
  } finally {
    rendering = false;
  }
}

function watchTable() {
  const tbody = document.getElementById("jobsTableBody");
  if (!tbody) {
    setTimeout(watchTable, 250);
    return;
  }

  if (observer) observer.disconnect();
  observer = new MutationObserver(() => window.requestAnimationFrame(enhanceRows));
  observer.observe(tbody, { childList: true });
  enhanceRows();
}

ensureDialog();
watchTable();

onSnapshot(collection(db, "workshopJobs"), (snapshot) => {
  jobs = snapshot.docs.map((snap) => ({ id: snap.id, ...snap.data() }));
  window.requestAnimationFrame(enhanceRows);
});
