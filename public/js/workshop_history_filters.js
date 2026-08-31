import {
  collection,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";
import { db } from "./firebase.js";

const $ = (id) => document.getElementById(id);
const norm = (v) => String(v || "").trim().toLowerCase();
const esc = (v) => String(v ?? "").replace(/[&<>'\"]/g, (m) => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'\"':"&quot;"}[m]));

let jobs = [];
let observer = null;
let applyTimer = null;

function toDateString(value) {
  if (!value) return "";
  const d = typeof value?.toDate === "function" ? value.toDate() : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

function jobHistoryDate(job) {
  return toDateString(job.closedAt || job.completedAt || job.mechanicCompletedAt || job.updatedAt || job.createdAt) || String(job.dueDate || "");
}

function mechanicName(job) {
  return String(job.mechanicName || job.assignedMechanic || job.assignedMechanicName || job.completedByName || "").trim();
}

function completedJobs() {
  return jobs.filter((job) => ["completed", "closed"].includes(norm(job.status)));
}

function uniqueSorted(values) {
  return [...new Set(values.map((v) => String(v || "").trim()).filter(Boolean))].sort((a,b) => a.localeCompare(b, undefined, {numeric:true, sensitivity:"base"}));
}

function ensureFilterUi() {
  const historyList = $("historyList");
  if (!historyList || $("historyFilterBar")) return;

  const panel = historyList.closest(".panel");
  if (!panel) return;

  const wrap = document.createElement("div");
  wrap.id = "historyFilterBar";
  wrap.innerHTML = `
    <style>
      #historyFilterBar{padding:14px 14px 4px;border-bottom:1px solid #e5e7eb;margin-bottom:12px}
      .history-filter-grid{display:grid;grid-template-columns:repeat(6,minmax(140px,1fr));gap:10px;align-items:end}
      .history-filter-grid label{display:grid;gap:5px;font-size:12px;font-weight:800;color:#475467}
      .history-filter-grid input,.history-filter-grid select{width:100%;border:1px solid #cfd6dd;border-radius:9px;padding:9px 10px;background:#fff;color:#1f2937}
      .history-filter-actions{display:flex;gap:8px;align-items:end}
      #historyFilterResult{font-size:12px;color:#667085;margin:9px 0 2px}
      @media(max-width:1100px){.history-filter-grid{grid-template-columns:repeat(3,minmax(160px,1fr))}}
      @media(max-width:700px){.history-filter-grid{grid-template-columns:1fr}}
    </style>
    <div class="history-filter-grid">
      <label>From date<input id="historyDateFrom" type="date"></label>
      <label>To date<input id="historyDateTo" type="date"></label>
      <label>Bus number<input id="historyBusSearch" type="search" placeholder="e.g. MO007"></label>
      <label>Job type<select id="historyJobType"><option value="">All job types</option></select></label>
      <label>Mechanic<select id="historyMechanic"><option value="">All mechanics</option></select></label>
      <label>Job ID<input id="historyJobId" type="search" placeholder="e.g. WJ-2026-990771"></label>
    </div>
    <div class="history-filter-actions" style="margin-top:10px">
      <button type="button" class="button secondary" id="historyClearFilters">Clear filters</button>
    </div>
    <div id="historyFilterResult">Showing all completed and closed Job Cards.</div>`;
  panel.insertBefore(wrap, historyList);

  ["historyDateFrom","historyDateTo","historyBusSearch","historyJobType","historyMechanic","historyJobId"].forEach((id) => {
    $(id)?.addEventListener(id.includes("Date") || id.includes("JobType") || id.includes("Mechanic") ? "change" : "input", applyFilters);
  });

  $("historyClearFilters")?.addEventListener("click", () => {
    ["historyDateFrom","historyDateTo","historyBusSearch","historyJobType","historyMechanic","historyJobId"].forEach((id) => {
      if ($(id)) $(id).value = "";
    });
    applyFilters();
  });
}

function refreshOptions() {
  ensureFilterUi();
  const history = completedJobs();
  const typeSelect = $("historyJobType");
  const mechanicSelect = $("historyMechanic");
  if (!typeSelect || !mechanicSelect) return;

  const currentType = typeSelect.value;
  const currentMechanic = mechanicSelect.value;
  const types = uniqueSorted(history.map((j) => j.jobType));
  const mechanics = uniqueSorted(history.map(mechanicName));

  typeSelect.innerHTML = `<option value="">All job types</option>${types.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join("")}`;
  mechanicSelect.innerHTML = `<option value="">All mechanics</option>${mechanics.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join("")}`;
  if (types.includes(currentType)) typeSelect.value = currentType;
  if (mechanics.includes(currentMechanic)) mechanicSelect.value = currentMechanic;
}

function jobForHistoryItem(item) {
  const title = item.querySelector(".list-title")?.textContent || item.textContent || "";
  const jobIdMatch = title.match(/WJ-[A-Za-z0-9-]+/i)?.[0] || "";
  if (jobIdMatch) {
    const found = jobs.find((job) => norm(job.jobNumber) === norm(jobIdMatch) || norm(job.id) === norm(jobIdMatch));
    if (found) return found;
  }
  return jobs.find((job) => title.includes(job.jobNumber || "") || title.includes(job.id || "")) || null;
}

function matches(job) {
  const from = $("historyDateFrom")?.value || "";
  const to = $("historyDateTo")?.value || "";
  const bus = norm($("historyBusSearch")?.value);
  const type = norm($("historyJobType")?.value);
  const mechanic = norm($("historyMechanic")?.value);
  const jobId = norm($("historyJobId")?.value);
  const date = jobHistoryDate(job);

  if (from && (!date || date < from)) return false;
  if (to && (!date || date > to)) return false;
  if (bus && !norm(job.fleetNumber || job.busNumber || job.rego).includes(bus)) return false;
  if (type && norm(job.jobType) !== type) return false;
  if (mechanic && norm(mechanicName(job)) !== mechanic) return false;
  if (jobId && !norm(`${job.jobNumber || ""} ${job.id || ""}`).includes(jobId)) return false;
  return true;
}

function applyFilters() {
  ensureFilterUi();
  const historyList = $("historyList");
  if (!historyList) return;

  const items = [...historyList.querySelectorAll(":scope > .list-item")];
  let shown = 0;
  items.forEach((item) => {
    const job = jobForHistoryItem(item);
    const visible = job ? matches(job) : true;
    item.hidden = !visible;
    if (visible) shown += 1;
  });

  let empty = $("historyFilterEmpty");
  if (!empty) {
    empty = document.createElement("div");
    empty.id = "historyFilterEmpty";
    empty.className = "empty";
    empty.textContent = "No Job Cards match these filters.";
    historyList.appendChild(empty);
  }
  empty.hidden = shown !== 0 || items.length === 0;

  const result = $("historyFilterResult");
  if (result) result.textContent = `${shown} Job Card${shown === 1 ? "" : "s"} shown.`;
}

function watchHistoryList() {
  const historyList = $("historyList");
  if (!historyList || observer) return;
  observer = new MutationObserver(() => {
    clearTimeout(applyTimer);
    applyTimer = setTimeout(() => {
      refreshOptions();
      applyFilters();
    }, 0);
  });
  observer.observe(historyList, {childList:true, subtree:true});
}

onSnapshot(collection(db, "workshopJobs"), (snap) => {
  jobs = snap.docs.map((d) => ({id:d.id, ...d.data()}));
  refreshOptions();
  applyFilters();
  watchHistoryList();
});

setTimeout(() => {
  ensureFilterUi();
  refreshOptions();
  applyFilters();
  watchHistoryList();
}, 100);
