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
  if (badge) badge.innerHTML = `<span class="badge info">${String(job.status || "New")}</span>`;

  const locked = ["Completed", "Closed", "Waiting Approval"].includes(job.status);
  const start = document.getElementById("startJobBtn");
  const parts = document.getElementById("waitingPartsBtn");
  const save = document.getElementById("saveProgressBtn");
  const complete = document.getElementById("completeJobBtn");

  if (start) start.disabled = locked || job.status === "In Progress";
  if (parts) parts.disabled = locked;
  if (save) save.disabled = locked;
  if (complete) complete.disabled = locked;
}

onSnapshot(
  query(collection(db, "workshopJobs"), orderBy("createdAt", "desc")),
  (snap) => {
    jobs = snap.docs.map((d) => ({ id:d.id, ...d.data() }));
    syncOpenJob();
  }
);

const observer = new MutationObserver(() => syncOpenJob());
observer.observe(document.body, { childList:true, subtree:true });
