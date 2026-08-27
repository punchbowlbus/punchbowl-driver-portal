// Prints Workshop Job Cards without relying on browser pop-up permissions.
// This intercepts the existing Workshop print buttons and prints the
// currently rendered Fleet Manager Review through a hidden same-page frame.

function esc(v) {
  return String(v ?? "").replace(/[&<>'\"]/g, (m) => ({
    "&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'\"':"&quot;"
  }[m]));
}

function printCurrentReview() {
  const dialog = document.getElementById("fleetManagerReviewDialog");
  const body = document.getElementById("wmReviewBody");
  const subtitle = document.getElementById("wmReviewSubtitle")?.textContent?.trim() || "Workshop Job Card";

  if (!dialog || !body) return false;

  const statusText = document.getElementById("jobCardStatusBadge")?.textContent?.trim() || "";
  const managerComments = document.getElementById("wmManagerComments")?.value?.trim() || "";
  const returnToService = document.getElementById("wmReturnToService")?.value || "";
  const vehicleStatus = document.getElementById("wmVehicleStatus")?.value || "";

  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.position = "fixed";
  frame.style.right = "0";
  frame.style.bottom = "0";
  frame.style.width = "1px";
  frame.style.height = "1px";
  frame.style.border = "0";
  frame.style.opacity = "0";
  frame.style.pointerEvents = "none";
  document.body.appendChild(frame);

  const doc = frame.contentDocument || frame.contentWindow?.document;
  if (!doc) {
    frame.remove();
    return false;
  }

  const approvalBlock = (managerComments || returnToService || vehicleStatus) ? `
    <section class="approval">
      <h2>Fleet Manager Decision</h2>
      <div class="approval-grid">
        <div><span>Vehicle status</span><strong>${esc(vehicleStatus || "—")}</strong></div>
        <div><span>Return to service</span><strong>${esc(returnToService || "—")}</strong></div>
        <div class="full"><span>Comments</span><strong>${esc(managerComments || "—")}</strong></div>
      </div>
    </section>` : "";

  doc.open();
  doc.write(`<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>${esc(subtitle)}</title>
  <style>
    @page{size:A4;margin:12mm}
    *{box-sizing:border-box}
    body{font-family:Arial,Helvetica,sans-serif;color:#172033;margin:0;font-size:12px;line-height:1.45;background:#fff}
    .print-head{border-bottom:4px solid #c62828;padding:0 0 12px;margin-bottom:16px}
    .company{font-size:19px;font-weight:900;color:#c62828;letter-spacing:.02em}
    .title{font-size:25px;font-weight:900;margin-top:2px;color:#111827}
    .subtitle{margin-top:5px;color:#667085;font-size:11px}
    .wm-review-grid{display:grid;grid-template-columns:1fr 1fr;gap:9px}
    .wm-review-box{border:1px solid #d7dde5;border-radius:8px;padding:9px 10px;background:#fff;break-inside:avoid}
    .wm-review-label{font-size:9px;text-transform:uppercase;font-weight:800;letter-spacing:.05em;color:#667085;margin-bottom:3px}
    .wm-review-value{font-size:12px;white-space:pre-wrap;color:#172033}
    .wm-full{grid-column:1/-1}
    .approval{margin-top:14px;border:2px solid #c62828;border-radius:9px;padding:11px;break-inside:avoid}
    .approval h2{margin:0 0 9px;font-size:15px}
    .approval-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}
    .approval-grid>div{border:1px solid #e5e7eb;border-radius:7px;padding:8px}
    .approval-grid span{display:block;font-size:9px;text-transform:uppercase;color:#667085;font-weight:800;margin-bottom:3px}
    .approval-grid .full{grid-column:1/-1}
    @media print{body{print-color-adjust:exact;-webkit-print-color-adjust:exact}}
  </style>
</head>
<body>
  <header class="print-head">
    <div class="company">PUNCHBOWL BUS COMPANY</div>
    <div class="title">WORKSHOP JOB CARD</div>
    <div class="subtitle">${esc(subtitle)}${statusText ? ` · ${esc(statusText)}` : ""}</div>
  </header>
  ${body.innerHTML}
  ${approvalBlock}
</body>
</html>`);
  doc.close();

  const doPrint = () => {
    try {
      frame.contentWindow?.focus();
      frame.contentWindow?.print();
    } finally {
      setTimeout(() => frame.remove(), 1500);
    }
  };

  if (doc.readyState === "complete") setTimeout(doPrint, 50);
  else frame.onload = () => setTimeout(doPrint, 50);

  return true;
}

function openReviewThenPrint(viewButton) {
  if (!viewButton) return false;
  viewButton.click();
  setTimeout(() => printCurrentReview(), 80);
  return true;
}

document.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) return;

  const isReviewPrint = button.id === "wmPrintJob";
  const isHistoryPrint = button.matches("#historyList [data-print]");
  const isVehicleHistoryPrint = button.matches("#wmHistoryBody [data-history-print]");

  if (!isReviewPrint && !isHistoryPrint && !isVehicleHistoryPrint) return;

  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();

  if (isReviewPrint) {
    printCurrentReview();
    return;
  }

  if (isHistoryPrint) {
    const item = button.closest(".list-item");
    openReviewThenPrint(item?.querySelector("[data-view]"));
    return;
  }

  if (isVehicleHistoryPrint) {
    const item = button.closest(".wm-history-item");
    openReviewThenPrint(item?.querySelector("[data-history-review]"));
  }
}, true);
