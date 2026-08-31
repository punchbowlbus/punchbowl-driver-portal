// Digital version of the workshop's manual Pre RMS job card.
// The main mechanic module handles saving; this helper renders the
// Pre RMS checklist and restores saved checklist values when reopened.

import { collection, onSnapshot } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";
import { db } from "./firebase.js";

const PRE_RMS_ITEMS = [
  "Brake Test",
  "Tyres",
  "Inspect",
  "Lights",
  "Seat",
  "Wash"
];

let workshopJobs = [];

function esc(v) {
  return String(v ?? "").replace(/[&<>'\"]/g, (m) => ({
    "&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'\"':"&quot;"
  }[m]));
}

function currentJobNumber() {
  const title = document.getElementById("jobCardTitle")?.textContent || "";
  return title.split("·")[0]?.trim() || "";
}

function currentJob() {
  const jobNumber = currentJobNumber();
  if (!jobNumber) return null;
  return workshopJobs.find((job) => String(job.jobNumber || job.id) === jobNumber) || null;
}

function isPreRmsOpen() {
  const title = document.getElementById("jobCardTitle")?.textContent || "";
  const jobCardView = document.getElementById("jobCardView");
  return !jobCardView?.hidden && /\bpre\s*rms\s*check\b/i.test(title);
}

function hasRenderedPreRmsChecklist(wrap) {
  return wrap.querySelectorAll('select[id^="pre_rms_"]').length === PRE_RMS_ITEMS.length;
}

function renderPreRmsChecklist() {
  const wrap = document.getElementById("jobChecklist");
  if (!wrap) return;

  if (!isPreRmsOpen()) {
    delete wrap.dataset.preRmsReady;
    return;
  }

  const heading = document.getElementById("checklistHeading");
  if (!heading) return;

  // Only skip rendering when the actual six-item Pre RMS checklist is still present.
  // The main mechanic renderer can replace the checklist when a job is reopened.
  if (wrap.dataset.preRmsReady === "1" && hasRenderedPreRmsChecklist(wrap)) return;

  const existingValues = {};
  wrap.querySelectorAll("[data-check-key]").forEach((el) => {
    existingValues[el.dataset.checkKey] = el.value;
  });

  // Restore persisted progress from Firestore. This is important when the main
  // mechanic renderer rebuilds the card before this Pre RMS helper runs again.
  const savedValues = currentJob()?.jobCard?.checklist || {};

  heading.textContent = "Pre RMS Check · 6 required items";
  wrap.innerHTML = `
    <div class="hint" style="margin-bottom:12px">
      Complete the Pre RMS checks from the workshop manual job card before sending the job for Fleet Manager approval.
    </div>
    <div class="requirement-group" style="border:1px solid #e4e7ec;border-radius:10px;overflow:hidden">
      <div style="padding:12px 14px;font-weight:800;background:#f8fafc">Pre RMS Inspection</div>
      <div style="padding:4px 12px 10px">
        ${PRE_RMS_ITEMS.map((item, index) => {
          const current = existingValues[item] || savedValues[item] || "";
          return `<div class="check-row" style="align-items:center">
            <label for="pre_rms_${index}"><strong>${esc(item)}</strong></label>
            <select id="pre_rms_${index}" data-check-key="${esc(item)}" data-check-item="${esc(item)}" data-required-work="1">
              <option value="">Select result</option>
              <option value="Pass" ${current === "Pass" ? "selected" : ""}>Completed / Pass</option>
              <option value="Attention" ${current === "Attention" ? "selected" : ""}>Attention required</option>
              <option value="N/A" ${current === "N/A" ? "selected" : ""}>N/A</option>
            </select>
          </div>`;
        }).join("")}
      </div>
    </div>`;
  wrap.dataset.preRmsReady = "1";
}

onSnapshot(collection(db, "workshopJobs"), (snap) => {
  workshopJobs = snap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
  if (isPreRmsOpen() && !hasRenderedPreRmsChecklist(document.getElementById("jobChecklist"))) {
    renderPreRmsChecklist();
  }
});

// The mechanic page changes views without a full page reload, so re-check
// after normal clicks. No MutationObserver is used to avoid render loops.
document.addEventListener("click", () => {
  setTimeout(renderPreRmsChecklist, 30);
}, true);

setTimeout(renderPreRmsChecklist, 100);
