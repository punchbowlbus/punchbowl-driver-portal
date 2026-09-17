import { collection, doc, getDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";
import { db } from "./firebase.js";

const $ = (id) => document.getElementById(id);
let jobs = [];
let observer = null;
let rendering = false;

function canEditJob(job) {
  return Boolean(job)
    && ["New", "Assigned"].includes(job.status || "New")
    && !job.startedAt
    && !job.jobCard?.labourStart;
}

function setSelectValue(select, value) {
  if (!select) return;
  const wanted = String(value || "");
  if ([...select.options].some((option) => option.value === wanted)) select.value = wanted;
}

function openEditDialog(job) {
  if (!canEditJob(job)) return;
  const dialog = $("jobDialog");
  const form = $("jobForm");
  if (!dialog || !form) return;

  window.workshopEditingJob = job;
  form.reset();
  setSelectValue($("jobBus"), job.busId);
  $("jobBus")?.dispatchEvent(new Event("change", { bubbles:true }));
  setSelectValue($("jobType"), job.jobType);
  $("jobType")?.dispatchEvent(new Event("change", { bubbles:true }));
  setSelectValue($("jobPriority"), job.priority || "Normal");
  setSelectValue($("jobMechanic"), job.assignedMechanic || "");
  $("jobDueDate").value = job.dueDate || "";
  $("jobFault").value = job.reportedFault || "";
  $("jobManagerNotes").value = job.managerNotes || "";
  if ($("jobSafeToDrive")) $("jobSafeToDrive").value = job.defectSafeToDrive || "";
  if (job.sourceDefectId && !job.defectSafeToDrive) {
    getDoc(doc(db, "defectReports", job.sourceDefectId)).then((snapshot) => {
      if (snapshot.exists() && $("jobSafeToDrive")) $("jobSafeToDrive").value = snapshot.data().safeToDrive || "";
    }).catch(() => {});
  }

  const title = dialog.querySelector(".dialog-head h2");
  const help = dialog.querySelector(".dialog-head p");
  const submit = form.querySelector('button[type="submit"]');
  if (title) title.textContent = `Edit ${job.jobNumber || "Workshop Job"}`;
  if (help) help.textContent = "Update this job before mechanic work starts. The existing job number and history will be retained.";
  if (submit) submit.textContent = "Save Changes";

  window.setTimeout(() => {
    setSelectValue($("jobMechanic"), job.assignedMechanic || "");
    setSelectValue($("jobCategory"), job.jobCategory || job.serviceType || job.inspectionType || "");
    $("jobCategory")?.dispatchEvent(new Event("change", { bubbles:true }));
  }, 350);

  dialog.showModal();
}
window.openWorkshopJobEditDialog = openEditDialog;

function enhanceRows() {
  if (rendering) return;
  rendering = true;
  try {
    const tbody = $("jobsTableBody");
    if (!tbody) return;
    [...tbody.querySelectorAll("tr")].forEach((row) => {
      const actionCell = row.querySelector("[data-job-remove-cell]");
      if (!actionCell || actionCell.querySelector("[data-edit-job]")) return;
      const firstCell = row.querySelector("td");
      const jobNumber = String(firstCell?.querySelector("strong")?.textContent || "").trim();
      const job = jobs.find((item) => String(item.jobNumber || item.id || "").trim() === jobNumber);
      if (!canEditJob(job)) return;

      actionCell.classList.add("workshop-job-actions");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "job-edit-button";
      button.dataset.editJob = job.id;
      button.textContent = "Edit";
      button.title = "Edit this job before mechanic work starts";
      button.addEventListener("click", () => openEditDialog(job));
      actionCell.prepend(button);
    });
  } finally {
    rendering = false;
  }
}

function watchRows() {
  const tbody = $("jobsTableBody");
  if (!tbody) return window.setTimeout(watchRows, 250);
  observer?.disconnect();
  observer = new MutationObserver(() => window.requestAnimationFrame(enhanceRows));
  observer.observe(tbody, { childList:true, subtree:true });
  enhanceRows();
}

const style = document.createElement("style");
style.textContent = `
  .workshop-job-actions{display:flex;align-items:center;gap:8px;white-space:nowrap}
  .job-edit-button{border:1px solid #175cd3;background:#eff8ff;color:#1849a9;border-radius:8px;padding:7px 14px;font-weight:800;cursor:pointer}
  .job-edit-button:hover{background:#d1e9ff}
`;
document.head.appendChild(style);

$("jobDialog")?.addEventListener("close", () => {
  window.workshopEditingJob = null;
  window.workshopPendingSourceDefect = null;
  const title = $("jobDialog")?.querySelector(".dialog-head h2");
  const help = $("jobDialog")?.querySelector(".dialog-head p");
  const submit = $("jobForm")?.querySelector('button[type="submit"]');
  if (title) title.textContent = "Create Workshop Job";
  if (help) help.textContent = "Choose the job type. Leave mechanic unassigned to send it to the shared Workshop queue.";
  if (submit) submit.textContent = "Create Job Card";
});

watchRows();
onSnapshot(collection(db, "workshopJobs"), (snapshot) => {
  jobs = snapshot.docs.map((snap) => ({ id:snap.id, ...snap.data() }));
  window.requestAnimationFrame(enhanceRows);
});
