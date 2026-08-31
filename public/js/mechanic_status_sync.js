import {
  collection,
  onSnapshot,
  orderBy,
  query
} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";
import { db } from "./firebase.js";

let jobs = [];

function currentJobNumber() {
  const title = document.getElementById("jobCardTitle")?.textContent || "";
  return title.split("·")[0]?.trim() || "";
}

function syncOpenJob() {
  const jobNumber = currentJobNumber();
  if (!jobNumber) return;
  const job = jobs.find((j) => String(j.jobNumber || j.id) === jobNumber);
  if (!job) return;

  const badge = document.getElementById("jobCardStatusBadge");
  if (badge) {
    const nextStatus = String(job.status || "New");
    const currentStatus = badge.textContent?.trim() || "";
    if (currentStatus !== nextStatus) {
      badge.innerHTML = `<span class="badge info">${nextStatus}</span>`;
    }
  }

  const status = String(job.status || "New");
  const locked = ["Completed", "Closed", "Waiting Approval"].includes(status);
  const notStarted = ["New", "Assigned"].includes(status);
  const waitingForParts = status === "Waiting Parts";
  const inProgress = status === "In Progress";

  const start = document.getElementById("startJobBtn");
  const parts = document.getElementById("waitingPartsBtn");
  const save = document.getElementById("saveProgressBtn");
  const complete = document.getElementById("completeJobBtn");

  if (start) {
    start.textContent = waitingForParts ? "Resume Job" : "Start Job";
    start.disabled = locked || inProgress;
  }

  // A job can only be placed on hold for parts after it has actually started.
  if (parts) parts.disabled = locked || !inProgress;

  // Assigned/New jobs must use Start Job first. Waiting Parts jobs must use Resume Job first.
  if (save) save.disabled = locked || notStarted || waitingForParts;

  // Completion is only available while work is actively In Progress.
  if (complete) complete.disabled = locked || !inProgress;
}

onSnapshot(
  query(collection(db, "workshopJobs"), orderBy("createdAt", "desc")),
  (snap) => {
    jobs = snap.docs.map((d) => ({ id:d.id, ...d.data() }));
    syncOpenJob();
  }
);

// Re-check after normal user actions such as opening a job card.
document.addEventListener("click", () => setTimeout(syncOpenJob, 0), true);
