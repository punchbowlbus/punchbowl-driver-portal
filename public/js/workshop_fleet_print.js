// Build a read-only print snapshot; only plain text from the filtered table is used.
const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));

export function fleetPrintCellText(cell) {
  if (!cell) return "—";
  const copy = cell.cloneNode(true);
  copy.querySelectorAll("button, .wf-row-open-hint, svg, [data-lucide]").forEach(node => node.remove());
  copy.querySelectorAll("br").forEach(node => node.replaceWith("\n"));
  copy.querySelectorAll("div, p, li").forEach(node => { node.before("\n"); node.after("\n"); });
  return copy.textContent.split("\n").map(line => line.replace(/\s+/g, " ").trim()).filter(Boolean).join("\n") || "—";
}

export function fleetPrintColumnGroups(columns, maximum = 10) {
  const indexes = columns.map((_, index) => index);
  if (columns.length <= maximum) return [indexes];
  const identity = indexes.filter(index => ["fleet", "rego"].includes(columns[index].key));
  const remaining = indexes.filter(index => !identity.includes(index));
  const width = Math.max(1, maximum - identity.length);
  const groups = [];
  for (let offset = 0; offset < remaining.length; offset += width) groups.push([...identity, ...remaining.slice(offset, offset + width)]);
  return groups;
}

export function fleetPrintDocument({columns, rows, filters = [], sort = "Fleet — ascending", generatedAt = new Date()}) {
  const groups = fleetPrintColumnGroups(columns);
  const stamp = generatedAt.toLocaleString("en-AU", {timeZone:"Australia/Sydney", dateStyle:"medium", timeStyle:"short"});
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Fleet Register — Filtered Results</title><style>
    @page{size:A4 landscape;margin:10mm}
    *{box-sizing:border-box}body{font-family:Arial,Helvetica,sans-serif;color:#172033;margin:0;font-size:9pt;line-height:1.35}
    .print-section+.print-section{break-before:page}.print-head{border-bottom:2px solid #b42318;padding-bottom:10px;margin-bottom:12px}
    .company{font-weight:700;color:#b42318;font-size:11pt}h1{font-size:19pt;margin:3px 0 6px}.meta{color:#475467;margin:3px 0;overflow-wrap:anywhere}
    table{border-collapse:collapse;width:100%;table-layout:fixed;font-size:8pt}thead{display:table-header-group}th{background:#f2f4f7;text-align:left;font-size:7.5pt}
    th,td{border:1px solid #d0d5dd;padding:6px;vertical-align:top;overflow-wrap:anywhere;white-space:pre-line}tr{break-inside:avoid}td:first-child{font-weight:700}
    @media print{th{print-color-adjust:exact;-webkit-print-color-adjust:exact}}
  </style></head><body>${groups.map((indexes, part) => `<section class="print-section">
    <header class="print-head"><div class="company">Punchbowl Bus Company</div><h1>Fleet Register${groups.length > 1 ? ` — Part ${part + 1} of ${groups.length}` : ""}</h1>
    <p class="meta"><strong>${rows.length} vehicle${rows.length === 1 ? "" : "s"}</strong> · Generated ${esc(stamp)} (Sydney)</p>
    <p class="meta"><strong>Filters:</strong> ${esc(filters.length ? filters.join(" · ") : "All vehicles")}</p><p class="meta"><strong>Sort:</strong> ${esc(sort)}</p></header>
    <table><thead><tr>${indexes.map(index => `<th scope="col">${esc(columns[index].label)}</th>`).join("")}</tr></thead>
    <tbody>${rows.map(row => `<tr>${indexes.map(index => `<td>${esc(row[index] || "—")}</td>`).join("")}</tr>`).join("")}</tbody></table>
  </section>`).join("")}</body></html>`;
}

export function printFleetSnapshot(snapshot) {
  document.getElementById("fleetRegisterPrintFrame")?.remove();
  const frame = document.createElement("iframe");
  frame.id = "fleetRegisterPrintFrame";
  frame.title = "Fleet Register printout";
  frame.setAttribute("aria-hidden", "true");
  Object.assign(frame.style, {position:"fixed", right:"0", bottom:"0", width:"1px", height:"1px", border:"0", opacity:"0", pointerEvents:"none"});
  return new Promise((resolve, reject) => {
    frame.addEventListener("load", async () => {
      try {
        const printWindow = frame.contentWindow;
        if (!printWindow) throw new Error("Print preview is unavailable.");
        await printWindow.document.fonts?.ready;
        printWindow.addEventListener("afterprint", () => frame.remove(), {once:true});
        printWindow.focus();
        printWindow.print();
        resolve();
      } catch (error) { frame.remove(); reject(error); }
    }, {once:true});
    frame.addEventListener("error", () => { frame.remove(); reject(new Error("Unable to prepare the fleet printout.")); }, {once:true});
    frame.srcdoc = fleetPrintDocument(snapshot);
    document.body.appendChild(frame);
  });
}
