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

  const locked = ["Completed", "Closed", "Waiting Approval"].includes(job.status);
  const start = document.getElementById("startJobBtn");
  const parts = document.getElementById("waitingPartsBtn");
  const save = document.getElementById("saveProgressBtn");
  const complete = document.getElementById("completeJobBtn");

  const startDisabled = locked || job.status === "In Progress";
  if (start && start.disabled !== startDisabled) start.disabled = startDisabled;
  if (parts && parts.disabled !== locked) parts.disabled = locked;
  if (save && save.disabled !== locked) save.disabled = locked;
  if (complete && complete.disabled !== locked) complete.disabled = locked;
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
