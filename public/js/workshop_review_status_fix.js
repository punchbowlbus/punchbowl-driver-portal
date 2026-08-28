import {
  collection,
  limit,
  onSnapshot,
  orderBy,
  query
} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";
import { db } from "./firebase.js";

let jobsByNumber = new Map();

function fmtDateTime(v) {
  if (!v) return "—";
  const d = typeof v?.toDate === "function" ? v.toDate() : new Date(v);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-AU", {
    day:"2-digit",
    month:"short",
    year:"numeric",
    hour:"numeric",
    minute:"2-digit"
  }).format(d);
}

function reviewParts() {
  const subtitle = document.getElementById("wmReviewSubtitle")?.textContent || "";
  return subtitle.split("·").map((v) => v.trim()).filter(Boolean);
}

function currentJob() {
  const parts = reviewParts();
  const jobNumber = parts[0] || "";
  return jobsByNumber.get(jobNumber) || null;
}

function reviewStatus() {
  const parts = reviewParts();
  return parts.at(-1) || "";
}

function setReviewVisibility() {
  const dialog = document.getElementById("fleetManagerReviewDialog");
  if (!dialog) return;

  const status = reviewStatus();
  const waitingApproval = status === "Waiting Approval";
  const job = currentJob();

  const labels = [...dialog.querySelectorAll(".wm-review-label")];
  const dateLabel = labels.find((el) => {
    const text = el.textContent.trim().toLowerCase();
    return text === "mechanic completed" || text === "job created";
  });
  const dateValue = dateLabel?.parentElement?.querySelector(".wm-review-value");

  if (dateLabel) dateLabel.textContent = "Job created";
  if (dateValue) dateValue.textContent = fmtDateTime(job?.createdAt);

  const decisionTitle = [...dialog.querySelectorAll(".section-title")]
    .find((el) => el.textContent.trim() === "Fleet Manager Decision");
  const decisionForm = decisionTitle?.nextElementSibling;

  if (decisionTitle) decisionTitle.hidden = !waitingApproval;
  if (decisionForm) decisionForm.hidden = !waitingApproval;

  const returnBtn = document.getElementById("wmReturnMechanic");
  const closeBtn = document.getElementById("wmApproveClose");
  if (returnBtn) returnBtn.style.display = waitingApproval ? "" : "none";
  if (closeBtn) closeBtn.style.display = waitingApproval ? "" : "none";
}

onSnapshot(
  query(collection(db,"workshopJobs"), orderBy("createdAt","desc"), limit(300)),
  (snap) => {
    jobsByNumber = new Map(snap.docs.map((d) => {
      const job = { id:d.id, ...d.data() };
      return [String(job.jobNumber || job.id), job];
    }));
    setReviewVisibility();
  },
  () => {}
);

const observer = new MutationObserver(() => setReviewVisibility());
observer.observe(document.documentElement, { childList:true, subtree:true, characterData:true });

document.addEventListener("click", () => setTimeout(setReviewVisibility, 0), true);
setReviewVisibility();
