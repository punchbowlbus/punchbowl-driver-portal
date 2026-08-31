// Digital version of the workshop's manual Pre RMS job card.
// The main mechanic module handles saving; this helper only renders the
// Pre RMS checklist when that job type is opened.

const PRE_RMS_ITEMS = [
  "Brake Test",
  "Tyres",
  "Inspect",
  "Lights",
  "Seat",
  "Wash"
];

function esc(v) {
  return String(v ?? "").replace(/[&<>'\"]/g, (m) => ({
    "&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'\"':"&quot;"
  }[m]));
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

  heading.textContent = "Pre RMS Check · 6 required items";
  wrap.innerHTML = `
    <div class="hint" style="margin-bottom:12px">
      Complete the Pre RMS checks from the workshop manual job card before sending the job for Fleet Manager approval.
    </div>
    <div class="requirement-group" style="border:1px solid #e4e7ec;border-radius:10px;overflow:hidden">
      <div style="padding:12px 14px;font-weight:800;background:#f8fafc">Pre RMS Inspection</div>
      <div style="padding:4px 12px 10px">
        ${PRE_RMS_ITEMS.map((item, index) => {
          const current = existingValues[item] || "";
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

// The mechanic page changes views without a full page reload, so re-check
// after normal clicks. No MutationObserver is used to avoid render loops.
document.addEventListener("click", () => {
  setTimeout(renderPreRmsChecklist, 30);
}, true);

setTimeout(renderPreRmsChecklist, 100);
