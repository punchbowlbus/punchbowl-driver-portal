import { collection, onSnapshot } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";
import { db } from "./firebase.js";

let jobsByNumber = new Map();
let tableObserver = null;
let rendering = false;

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

function setCellText(cell, value) {
  if (!cell) return;
  if (cell.dataset.renderedValue === value) return;
  cell.dataset.renderedValue = value;
  cell.textContent = value;
  cell.classList.add("job-time-value");
}

function renderTimes() {
  if (rendering) return;
  rendering = true;

  try {
    const tbody = document.getElementById("jobsTableBody");
    const table = tbody?.closest("table");
    if (!tbody || !table) return;

    ensureHeaders(table);

    [...tbody.querySelectorAll("tr")].forEach((row) => {
      if (row.querySelector(".empty")) {
        const td = row.querySelector("td");
        if (td && td.colSpan !== 9) td.colSpan = 9;
        return;
      }

      const jobNo = cleanJobNumber(row.cells?.[0]);
      const job = jobsByNumber.get(jobNo) || {};

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

      setCellText(startCell, formatDateTime(jobStart(job)));
      setCellText(endCell, formatDateTime(jobEnd(job)));
    });
  } finally {
    rendering = false;
  }
}

function injectStyles() {
  if (document.getElementById("workshopJobTimeStyles")) return;
  const style = document.createElement("style");
  style.id = "workshopJobTimeStyles";
  style.textContent = `
    #jobsView td.job-time-value{white-space:nowrap;font-size:12px;color:#344054;font-weight:700}
    @media(max-width:900px){
      #jobsView .table-wrap{overflow-x:auto;-webkit-overflow-scrolling:touch}
      #jobsView table{min-width:1180px}
    }
  `;
  document.head.appendChild(style);
}

function scheduleRender() {
  window.requestAnimationFrame(renderTimes);
}

function watchTable() {
  const tbody = document.getElementById("jobsTableBody");
  if (!tbody) {
    setTimeout(watchTable, 250);
    return;
  }

  if (tableObserver) tableObserver.disconnect();
  tableObserver = new MutationObserver((mutations) => {
    const hasExternalRowChange = mutations.some((m) =>
      [...m.addedNodes, ...m.removedNodes].some((node) =>
        node.nodeType === 1 && !node.matches?.('[data-job-time-cell]')
      )
    );
    if (hasExternalRowChange) scheduleRender();
  });
  tableObserver.observe(tbody, { childList:true, subtree:true });
  renderTimes();
}

onSnapshot(collection(db, "workshopJobs"), (snap) => {
  jobsByNumber = new Map(snap.docs.map((d) => {
    const job = { id:d.id, ...d.data() };
    return [String(job.jobNumber || job.id), job];
  }));
  scheduleRender();
});

injectStyles();
watchTable();
