import { collection, onSnapshot } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";
import { db } from "./firebase.js";

let jobsByNumber = new Map();

function asDate(value) {
  if (!value) return null;
  if (typeof value?.toDate === "function") return value.toDate();
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatDateTime(value) {
  const d = asDate(value);
  if (!d) return "—";
  return new Intl.DateTimeFormat("en-AU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(d);
}

function labourDateTime(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function jobStart(job) {
  return job.startedAt || labourDateTime(job.jobCard?.labourStart) || null;
}

function jobEnd(job) {
  return job.completedAt || job.closedAt || labourDateTime(job.jobCard?.labourFinish) || null;
}

function ensureHeaders(table) {
  const row = table?.querySelector("thead tr");
  if (!row) return;
  if (!row.querySelector('[data-job-time-head="start"]')) {
    const th = document.createElement("th");
    th.dataset.jobTimeHead = "start";
    th.textContent = "Job Start";
    row.appendChild(th);
  }
  if (!row.querySelector('[data-job-time-head="end"]')) {
    const th = document.createElement("th");
    th.dataset.jobTimeHead = "end";
    th.textContent = "Job End";
    row.appendChild(th);
  }
}

function cleanJobNumber(cell) {
  return cell?.querySelector("strong")?.textContent?.trim() || cell?.textContent?.trim() || "";
}

function renderTimes() {
  const tbody = document.getElementById("jobsTableBody");
  const table = tbody?.closest("table");
  if (!tbody || !table) return;

  ensureHeaders(table);

  [...tbody.querySelectorAll("tr")].forEach((row) => {
    if (row.querySelector(".empty")) {
      const td = row.querySelector("td");
      if (td) td.colSpan = 9;
      return;
    }

    const jobNo = cleanJobNumber(row.cells?.[0]);
    const job = jobsByNumber.get(jobNo);

    let startCell = row.querySelector('[data-job-time-cell="start"]');
    if (!startCell) {
      startCell = document.createElement("td");
      startCell.dataset.jobTimeCell = "start";
      row.appendChild(startCell);
    }

    let endCell = row.querySelector('[data-job-time-cell="end"]');
    if (!endCell) {
      endCell = document.createElement("td");
      endCell.dataset.jobTimeCell = "end";
      row.appendChild(endCell);
    }

    startCell.innerHTML = `<span class="job-time-value">${formatDateTime(jobStart(job || {}))}</span>`;
    endCell.innerHTML = `<span class="job-time-value">${formatDateTime(jobEnd(job || {}))}</span>`;
  });
}

function injectStyles() {
  if (document.getElementById("workshopJobTimeStyles")) return;
  const style = document.createElement("style");
  style.id = "workshopJobTimeStyles";
  style.textContent = `
    .job-time-value{white-space:nowrap;font-size:12px;color:#344054;font-weight:700}
    @media(max-width:900px){
      #jobsView .table-wrap{overflow-x:auto;-webkit-overflow-scrolling:touch}
      #jobsView table{min-width:1180px}
    }
  `;
  document.head.appendChild(style);
}

const tableObserver = new MutationObserver(renderTimes);
function watchTable() {
  const tbody = document.getElementById("jobsTableBody");
  if (!tbody) return setTimeout(watchTable, 250);
  tableObserver.observe(tbody, { childList:true, subtree:true });
  renderTimes();
}

onSnapshot(collection(db, "workshopJobs"), (snap) => {
  jobsByNumber = new Map(snap.docs.map((d) => {
    const job = { id:d.id, ...d.data() };
    return [String(job.jobNumber || job.id), job];
  }));
  renderTimes();
});

injectStyles();
watchTable();
