import {
  collection,
  limit,
  onSnapshot,
  orderBy,
  query
} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";
import { db } from "./firebase.js";
import { getRequirementTemplate } from "./workshop_service_requirements.js";

let jobs = [];
let buses = [];

const norm = (v) => String(v || "").trim().toLowerCase();

function currentJobNumber() {
  const subtitle = document.getElementById("wmReviewSubtitle")?.textContent || "";
  return subtitle.split("·")[0]?.trim() || "";
}

function currentJob() {
  const number = currentJobNumber();
  return jobs.find((j) => String(j.jobNumber || j.id) === number) || null;
}

function jobBus(job) {
  if (!job) return null;
  return buses.find((b) => b.id === job.busId || norm(b.fleetNumber || b.busNumber) === norm(job.fleetNumber));
}

function busIsEv(bus) {
  return /\b(ev|electric)\b/i.test(String(bus?.fuelType || bus?.fuel || bus?.powertrain || bus?.serviceProgram || ""));
}

function categoryLabel(job) {
  return job?.serviceType || job?.inspectionType || job?.jobCategory || "";
}

function legacyTemplateKey(job) {
  const existing = String(job?.serviceTemplateKey || "").trim().toLowerCase();
  if (existing) return existing;

  const prefix = busIsEv(jobBus(job)) ? "ev" : "diesel";
  const type = norm(job?.jobType);
  const category = norm(categoryLabel(job));

  if (type === "safety inspection") return category.includes("rms") ? `${prefix}-rms` : `${prefix}-90day`;
  if (type === "scheduled service" && ["small", "medium", "large"].includes(category)) {
    if (prefix === "ev" && category === "medium") return "";
    return `${prefix}-${category}`;
  }
  return "";
}

function checklistItems(job) {
  if (Array.isArray(job?.assignedChecklist?.items) && job.assignedChecklist.items.length) return job.assignedChecklist.items;
  const template = getRequirementTemplate(legacyTemplateKey(job));
  return Array.isArray(template?.items) ? template.items : [];
}

function labelMap(job) {
  const map = new Map();
  checklistItems(job).forEach((item, index) => {
    const key = String(item.id || `${job?.serviceTemplateKey || job?.jobType}-${index + 1}`);
    const label = String(item.item || item.label || item.name || key);
    map.set(key, label);
  });
  return map;
}

function improveChecklist() {
  const dialog = document.getElementById("fleetManagerReviewDialog");
  if (!dialog) return;
  const job = currentJob();
  if (!job) return;

  const labels = [...dialog.querySelectorAll(".wm-review-label")];
  const checklistLabel = labels.find((el) => el.textContent.trim().toLowerCase() === "checklist");
  const value = checklistLabel?.parentElement?.querySelector(".wm-review-value");
  if (!value) return;

  const names = labelMap(job);
  [...value.children].forEach((row) => {
    const first = row.firstChild;
    if (!first || first.nodeType !== Node.TEXT_NODE) return;
    const text = first.textContent || "";
    const colon = text.indexOf(":");
    if (colon < 0) return;
    const key = text.slice(0, colon).trim();
    const name = names.get(key);
    if (!name) return;
    const next = `${name}: `;
    if (first.textContent !== next) first.textContent = next;
  });
}

onSnapshot(query(collection(db,"workshopJobs"), orderBy("createdAt","desc"), limit(300)), (snap) => {
  jobs = snap.docs.map((d) => ({ id:d.id, ...d.data() }));
  improveChecklist();
});

onSnapshot(collection(db,"buses"), (snap) => {
  buses = snap.docs.map((d) => ({ id:d.id, ...d.data() }));
  improveChecklist();
});

const observer = new MutationObserver(() => improveChecklist());
observer.observe(document.body, { childList:true, subtree:true });
document.addEventListener("click", () => setTimeout(improveChecklist, 0), true);
