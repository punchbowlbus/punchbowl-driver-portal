import {
  collection,
  doc,
  getDocs,
  query,
  serverTimestamp,
  where,
  writeBatch
} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";

import { auth, db } from "./firebase.js";
import { calculateFatigue } from "./dispatch_fatigue.js";
import { els, showError } from "./ui.js";
import { escapeHtml } from "./utils.js";

const DUTY_TYPES = ["Charter", "Rail Replacement", "Yard", "Mechanic", "Office"];
const REQUIRED_HEADERS = [
  "serviceDate",
  "dutyNumber",
  "dutyType",
  "driverEmployeeNumber",
  "startTime",
  "endTime",
  "startLocation",
  "endLocation"
];
const TEMPLATE_HEADERS = [
  ...REQUIRED_HEADERS,
  "assignedBus",
  "routeNumber",
  "routePdfUrl",
  "break1Type",
  "break1Start",
  "break1End",
  "break1Location",
  "break2Type",
  "break2Start",
  "break2End",
  "break2Location"
];

function employeeName(employee) {
  return String(
    employee.displayName ||
    employee.name ||
    `${employee.firstName || ""} ${employee.lastName || ""}`.trim() ||
    employee.employeeNumber ||
    employee.id ||
    ""
  ).trim();
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const character = text[i];

    if (character === '"') {
      if (quoted && text[i + 1] === '"') {
        value += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      row.push(value.trim());
      value = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && text[i + 1] === "\n") i += 1;
      row.push(value.trim());
      if (row.some((cell) => cell !== "")) rows.push(row);
      row = [];
      value = "";
    } else {
      value += character;
    }
  }

  row.push(value.trim());
  if (row.some((cell) => cell !== "")) rows.push(row);
  return rows;
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function normalizeDate(value) {
  const input = String(value || "").trim();
  let year;
  let month;
  let day;

  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) {
    [year, month, day] = input.split("-").map(Number);
  } else if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(input)) {
    [day, month, year] = input.split("/").map(Number);
  } else {
    return "";
  }

  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) return "";

  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function timeToMin(value) {
  const input = String(value || "").trim();
  if (!/^\d{1,2}:\d{2}$/.test(input)) return NaN;
  const [hours, minutes] = input.split(":").map(Number);
  if (hours < 0 || hours > 48 || minutes < 0 || minutes > 59) return NaN;
  return hours * 60 + minutes;
}

function minToTime(value) {
  if (!Number.isFinite(value)) return "—";
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}

function canonicalDutyType(value) {
  const input = String(value || "").trim().toLowerCase();
  return DUTY_TYPES.find((type) => type.toLowerCase() === input) || "";
}

function isHttpsUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    return url.protocol === "https:";
  } catch {
    return false;
  }
}

function rowKey(row) {
  return [
    row.serviceDate,
    row.driverEmployeeNumber,
    String(row.dutyNumber || "").trim().toLowerCase(),
    row.startMin,
    row.endMin
  ].join("|");
}

function spansOverlap(a, b) {
  return a.serviceDate === b.serviceDate &&
    a.driverEmployeeNumber === b.driverEmployeeNumber &&
    a.startMin < b.endMin && b.startMin < a.endMin;
}

function chunk(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

function breakFromRaw(raw, number, errors) {
  const typeValue = String(raw[`break${number}Type`] || "").trim();
  const startValue = String(raw[`break${number}Start`] || "").trim();
  const endValue = String(raw[`break${number}End`] || "").trim();
  const location = String(raw[`break${number}Location`] || "").trim();
  const hasAnyValue = Boolean(typeValue || startValue || endValue || location);
  if (!hasAnyValue) return null;

  const type = typeValue.toLowerCase();
  const startMin = timeToMin(startValue);
  const endMin = timeToMin(endValue);

  if (!['meal', 'crib'].includes(type)) {
    errors.push(`Break ${number} type must be Meal or Crib.`);
  }
  if (!Number.isFinite(startMin) || !Number.isFinite(endMin) || startMin >= endMin) {
    errors.push(`Break ${number} start/end time is invalid.`);
  }

  return {
    type,
    paid: type === "crib",
    startMin,
    endMin,
    location
  };
}

function statusLabel(row) {
  if (row.errors.length) return {label: "Invalid", className: "invalid"};
  if (row.duplicate) return {label: "Duplicate", className: "duplicate"};
  if (row.warnings.length) return {label: "Warning", className: "warning"};
  return {label: "Ready", className: "ready"};
}

export async function renderBulkDutySpansPage() {
  showError("");

  els.contentArea.innerHTML = `
    <div class="bulk-duty-page">
      <header class="bulk-duty-hero">
        <div class="bulk-duty-hero-title">
          <span><i data-lucide="layers"></i></span>
          <div>
            <div class="bulk-duty-eyebrow">Roster administration</div>
            <h2>Bulk Duty Spans</h2>
            <p>Validate and import complete driver shifts from a CSV file.</p>
          </div>
        </div>
        <button id="downloadDutyTemplate" type="button" class="bulk-duty-secondary-btn">
          <i data-lucide="download"></i> Download CSV template
        </button>
      </header>

      <div id="bulkDutyMessage" class="bulk-duty-message" hidden role="status" aria-live="polite"></div>

      <section class="card bulk-duty-upload-card">
        <div class="bulk-duty-section-heading">
          <span>1</span>
          <div><h3>Select CSV file</h3><p>Use the template to keep column names and time formats correct.</p></div>
        </div>

        <label class="bulk-duty-dropzone" for="bulkDutyFile">
          <i data-lucide="file-up"></i>
          <strong id="bulkDutyFileName">Choose a duty spans CSV file</strong>
          <small>CSV only · dates may use YYYY-MM-DD or DD/MM/YYYY · overnight times may use 24+ hours</small>
          <span>Browse file</span>
          <input id="bulkDutyFile" type="file" accept=".csv,text/csv" hidden />
        </label>

        <div class="bulk-duty-help-grid">
          <div><strong>Supported duty types</strong><span>${DUTY_TYPES.join(" · ")}</span></div>
          <div><strong>Rail Replacement</strong><span>Route number and HTTPS Route Description PDF link are required.</span></div>
          <div><strong>Optional breaks</strong><span>Meal is unpaid; Crib is paid. Breaks are used for fatigue calculations.</span></div>
        </div>

        <div class="bulk-duty-actions">
          <button id="validateDutyCsv" type="button" class="bulk-duty-primary-btn" disabled>
            <i data-lucide="scan-line"></i> Validate CSV
          </button>
          <button id="clearDutyCsv" type="button" class="btn" disabled>Clear</button>
        </div>
      </section>

      <section id="bulkDutyPreviewSection" class="card bulk-duty-preview-card" hidden>
        <div class="bulk-duty-section-heading">
          <span>2</span>
          <div><h3>Review import</h3><p>Only valid, non-duplicate rows can be imported.</p></div>
        </div>

        <div class="bulk-duty-summary">
          <div><strong id="bulkTotalCount">0</strong><span>Total</span></div>
          <div class="ready"><strong id="bulkReadyCount">0</strong><span>Ready</span></div>
          <div class="warning"><strong id="bulkWarningCount">0</strong><span>Warnings</span></div>
          <div class="invalid"><strong id="bulkInvalidCount">0</strong><span>Invalid</span></div>
          <div class="duplicate"><strong id="bulkDuplicateCount">0</strong><span>Duplicates</span></div>
        </div>

        <div class="bulk-duty-table-wrap">
          <table class="bulk-duty-table">
            <thead><tr><th>Row</th><th>Status</th><th>Date / duty</th><th>Driver</th><th>Type</th><th>Time</th><th>Route / locations</th><th>Issues</th></tr></thead>
            <tbody id="bulkDutyPreviewBody"></tbody>
          </table>
        </div>
        <div id="bulkDutyMobilePreview" class="bulk-duty-mobile-preview"></div>

        <div class="bulk-duty-import-row">
          <label><input id="confirmDutyImport" type="checkbox" /> I have reviewed the ready rows.</label>
          <button id="importDutyRows" type="button" class="bulk-duty-primary-btn" disabled>
            Import ready duty spans
          </button>
        </div>
      </section>
    </div>
  `;

  window.lucide?.createIcons?.();

  const field = (id) => document.getElementById(id);
  const fileInput = field("bulkDutyFile");
  const fileNameEl = field("bulkDutyFileName");
  const validateBtn = field("validateDutyCsv");
  const clearBtn = field("clearDutyCsv");
  const importBtn = field("importDutyRows");
  const confirmEl = field("confirmDutyImport");
  const previewSection = field("bulkDutyPreviewSection");
  const previewBody = field("bulkDutyPreviewBody");
  const mobilePreview = field("bulkDutyMobilePreview");
  const messageEl = field("bulkDutyMessage");
  let processedRows = [];
  let processing = false;
  let importing = false;

  function showMessage(message, type = "success") {
    messageEl.textContent = message;
    messageEl.className = `bulk-duty-message ${type}`;
    messageEl.hidden = !message;
    if (message) messageEl.scrollIntoView({behavior: "smooth", block: "nearest"});
  }

  function resetPage() {
    fileInput.value = "";
    fileNameEl.textContent = "Choose a duty spans CSV file";
    validateBtn.disabled = true;
    clearBtn.disabled = true;
    previewSection.hidden = true;
    previewBody.innerHTML = "";
    mobilePreview.innerHTML = "";
    confirmEl.checked = false;
    importBtn.disabled = true;
    processedRows = [];
    showMessage("");
  }

  field("downloadDutyTemplate").addEventListener("click", () => {
    const examples = [
      TEMPLATE_HEADERS,
      ["2026-08-10", "101", "Charter", "963", "08:00", "14:00", "Hannans Depot", "Hannans Depot", "MO007", "", "", "meal", "11:00", "11:30", "Hannans Depot", "", "", "", ""],
      ["2026-08-10", "RR102", "Rail Replacement", "959", "05:00", "15:00", "Hannans Depot", "Bounds Depot", "MO025", "T4", "https://example.com/route-description.pdf", "crib", "09:30", "09:45", "", "meal", "12:30", "13:00", ""]
    ];
    const csv = examples.map((row) => row.map(csvCell).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], {type: "text/csv;charset=utf-8"}));
    const link = document.createElement("a");
    link.href = url;
    link.download = "bulk-duty-spans-template.csv";
    link.click();
    URL.revokeObjectURL(url);
  });

  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    processedRows = [];
    previewSection.hidden = true;
    confirmEl.checked = false;
    importBtn.disabled = true;
    fileNameEl.textContent = file ? file.name : "Choose a duty spans CSV file";
    validateBtn.disabled = !file;
    clearBtn.disabled = !file;
    showMessage("");
  });

  clearBtn.addEventListener("click", resetPage);
  confirmEl.addEventListener("change", () => {
    const importable = processedRows.filter((row) => !row.errors.length && !row.duplicate);
    importBtn.disabled = !confirmEl.checked || !importable.length || importing;
  });

  function renderPreview() {
    const counts = {
      ready: processedRows.filter((row) => !row.errors.length && !row.duplicate && !row.warnings.length).length,
      warning: processedRows.filter((row) => !row.errors.length && !row.duplicate && row.warnings.length).length,
      invalid: processedRows.filter((row) => row.errors.length).length,
      duplicate: processedRows.filter((row) => !row.errors.length && row.duplicate).length
    };
    field("bulkTotalCount").textContent = String(processedRows.length);
    field("bulkReadyCount").textContent = String(counts.ready);
    field("bulkWarningCount").textContent = String(counts.warning);
    field("bulkInvalidCount").textContent = String(counts.invalid);
    field("bulkDuplicateCount").textContent = String(counts.duplicate);

    const rowHtml = (row, mobile = false) => {
      const status = statusLabel(row);
      const issues = [...row.errors, ...row.warnings, ...(row.duplicate ? [row.duplicateReason] : [])];
      const route = row.dutyType === "Rail Replacement"
        ? `${row.routeNumber || "—"} · ${row.startLocation} → ${row.endLocation}`
        : `${row.startLocation} → ${row.endLocation}`;

      if (mobile) {
        return `<article class="bulk-duty-mobile-card ${status.className}">
          <div><strong>CSV row ${row.csvRow}</strong><span class="bulk-duty-status ${status.className}">${status.label}</span></div>
          <h4>${escapeHtml(row.dutyNumber || "No duty number")} · ${escapeHtml(row.dutyType || "Unknown type")}</h4>
          <p>${escapeHtml(row.serviceDate || "Invalid date")} · ${escapeHtml(row.driverName || row.driverEmployeeNumber)}</p>
          <p>${escapeHtml(minToTime(row.startMin))}–${escapeHtml(minToTime(row.endMin))} · ${escapeHtml(route)}</p>
          ${issues.length ? `<ul>${issues.map((issue) => `<li>${escapeHtml(issue)}</li>`).join("")}</ul>` : ""}
        </article>`;
      }

      return `<tr>
        <td>${row.csvRow}</td>
        <td><span class="bulk-duty-status ${status.className}">${status.label}</span></td>
        <td><strong>${escapeHtml(row.serviceDate || "—")}</strong><small>${escapeHtml(row.dutyNumber || "—")}</small></td>
        <td><strong>${escapeHtml(row.driverName || "—")}</strong><small>${escapeHtml(row.driverEmployeeNumber || "—")}</small></td>
        <td>${escapeHtml(row.dutyType || "—")}</td>
        <td>${escapeHtml(minToTime(row.startMin))}–${escapeHtml(minToTime(row.endMin))}</td>
        <td>${escapeHtml(route)}</td>
        <td>${issues.length ? `<ul>${issues.map((issue) => `<li>${escapeHtml(issue)}</li>`).join("")}</ul>` : "—"}</td>
      </tr>`;
    };

    previewBody.innerHTML = processedRows.map((row) => rowHtml(row)).join("");
    mobilePreview.innerHTML = processedRows.map((row) => rowHtml(row, true)).join("");
    previewSection.hidden = false;
    confirmEl.checked = false;
    importBtn.disabled = true;
    previewSection.scrollIntoView({behavior: "smooth", block: "start"});
  }

  validateBtn.addEventListener("click", async () => {
    if (processing) return;
    const file = fileInput.files?.[0];
    if (!file) return;

    processing = true;
    validateBtn.disabled = true;
    validateBtn.textContent = "Validating…";
    showMessage("Reading and validating the CSV file…", "info");

    try {
      const csvRows = parseCsv(await file.text());
      if (csvRows.length < 2) throw new Error("The CSV does not contain any duty-span rows.");

      const headers = csvRows[0].map((header) => String(header || "").replace(/^\uFEFF/, "").trim());
      const missingHeaders = REQUIRED_HEADERS.filter((header) => !headers.includes(header));
      if (missingHeaders.length) {
        throw new Error(`Missing required CSV columns: ${missingHeaders.join(", ")}.`);
      }

      const rawRows = csvRows.slice(1).map((values, index) => {
        const raw = {};
        headers.forEach((header, columnIndex) => { raw[header] = values[columnIndex] || ""; });
        return {raw, csvRow: index + 2};
      });

      const [employeeSnapshot, busSnapshot] = await Promise.all([
        getDocs(collection(db, "employees")),
        getDocs(collection(db, "buses"))
      ]);
      const employees = employeeSnapshot.docs.map((item) => ({id: item.id, ...item.data()}));
      const buses = busSnapshot.docs.map((item) => ({id: item.id, ...item.data()}));
      const employeeMap = new Map();
      employees.forEach((employee) => {
        employeeMap.set(String(employee.id).trim().toLowerCase(), employee);
        employeeMap.set(String(employee.employeeNumber || "").trim().toLowerCase(), employee);
      });
      const busSet = new Set();
      buses.forEach((bus) => {
        busSet.add(String(bus.id).trim().toUpperCase());
        busSet.add(String(bus.fleetNumber || "").trim().toUpperCase());
      });

      processedRows = rawRows.map(({raw, csvRow}) => {
        const errors = [];
        const warnings = [];
        const serviceDate = normalizeDate(raw.serviceDate);
        const dutyType = canonicalDutyType(raw.dutyType);
        const dutyNumber = String(raw.dutyNumber || "").trim();
        const driverEmployeeNumber = String(raw.driverEmployeeNumber || "").trim();
        const employee = employeeMap.get(driverEmployeeNumber.toLowerCase());
        const startMin = timeToMin(raw.startTime);
        const endMin = timeToMin(raw.endTime);
        const startLocation = String(raw.startLocation || "").trim();
        const endLocation = String(raw.endLocation || "").trim();
        const assignedBus = String(raw.assignedBus || "").trim().toUpperCase();
        const routeNumber = String(raw.routeNumber || "").trim();
        const routePdfUrl = String(raw.routePdfUrl || "").trim();

        if (!serviceDate) errors.push("Service date is invalid.");
        if (!dutyNumber) errors.push("Duty number is required.");
        if (!dutyType) errors.push(`Duty type must be ${DUTY_TYPES.join(", ")}.`);
        if (!driverEmployeeNumber) errors.push("Driver employee number is required.");
        if (!employee) {
          errors.push("Employee number was not found.");
        } else {
          if (String(employee.status || "").trim().toLowerCase() !== "active") errors.push("Employee is not active.");
          const role = String(employee.role || "").trim().toLowerCase();
          const access = String(employee.accessLevel || "").trim().toLowerCase();
          if (role !== "driver" && access !== "driver") errors.push("Employee is not configured as a driver.");
        }
        if (!Number.isFinite(startMin) || !Number.isFinite(endMin)) {
          errors.push("Start or end time is invalid. Use HH:MM and 24+ time for overnight duties.");
        } else if (startMin >= endMin) {
          errors.push("Duty end must be later than duty start.");
        }
        if (!startLocation || !endLocation) errors.push("Start and end locations are required.");
        if (assignedBus && !busSet.has(assignedBus)) warnings.push("Assigned bus was not found in Fleet.");

        if (dutyType === "Rail Replacement") {
          if (!routeNumber) errors.push("Rail Replacement requires a route number.");
          if (!routePdfUrl) errors.push("Rail Replacement requires a Route Description PDF link.");
          else if (!isHttpsUrl(routePdfUrl)) errors.push("Route Description must be a valid HTTPS link.");
        } else if (routeNumber || routePdfUrl) {
          warnings.push("Route details will be saved although this is not a Rail Replacement duty.");
        }

        const breaks = [breakFromRaw(raw, 1, errors), breakFromRaw(raw, 2, errors)]
          .filter(Boolean)
          .sort((a, b) => a.startMin - b.startMin);
        breaks.forEach((breakItem, index) => {
          if (Number.isFinite(startMin) && Number.isFinite(endMin) &&
              (breakItem.startMin < startMin || breakItem.endMin > endMin)) {
            errors.push(`Break ${index + 1} must remain inside the duty span.`);
          }
          if (index > 0 && breakItem.startMin < breaks[index - 1].endMin) {
            errors.push("Breaks cannot overlap each other.");
          }
        });

        const fatigue = calculateFatigue({startMin, endMin, breaks});
        if (fatigue.fatigueStatus !== "OK") {
          warnings.push(`Fatigue ${fatigue.fatigueStatus}: ${fatigue.fatigueWarning}`);
        }

        return {
          csvRow,
          serviceDate,
          dutyNumber,
          dutyType,
          driverEmployeeNumber,
          driverName: employee ? employeeName(employee) : "",
          startMin,
          endMin,
          startLocation,
          endLocation,
          assignedBus,
          routeNumber,
          routePdfUrl,
          breaks,
          ...fatigue,
          errors,
          warnings,
          duplicate: false,
          duplicateReason: ""
        };
      });

      const validDates = [...new Set(processedRows.map((row) => row.serviceDate).filter(Boolean))];
      const existingSpans = [];
      for (const dateChunk of chunk(validDates, 10)) {
        const snapshot = await getDocs(query(collection(db, "dutySpans"), where("serviceDate", "in", dateChunk)));
        snapshot.docs.forEach((item) => existingSpans.push({id: item.id, ...item.data()}));
      }

      const fileKeys = new Set();
      const existingKeys = new Set(existingSpans.filter((span) => !span.deleted).map(rowKey));
      processedRows.forEach((row, index) => {
        if (row.errors.length) return;
        const key = rowKey(row);
        if (existingKeys.has(key)) {
          row.duplicate = true;
          row.duplicateReason = "This duty span already exists in Firestore.";
        } else if (fileKeys.has(key)) {
          row.duplicate = true;
          row.duplicateReason = "This duty span is repeated in the CSV file.";
        } else {
          fileKeys.add(key);
        }

        if (!row.duplicate) {
          const overlappingExisting = existingSpans.some((span) =>
            !span.deleted && spansOverlap(row, {
              serviceDate: String(span.serviceDate || ""),
              driverEmployeeNumber: String(span.driverEmployeeNumber || ""),
              startMin: Number(span.startMin),
              endMin: Number(span.endMin)
            })
          );
          const overlappingFile = processedRows.slice(0, index).some((other) =>
            !other.errors.length && !other.duplicate && spansOverlap(row, other)
          );
          if (overlappingExisting || overlappingFile) {
            row.errors.push("Duty span overlaps another shift for this driver on this date.");
          }
        }
      });

      renderPreview();
      const importableCount = processedRows.filter((row) => !row.errors.length && !row.duplicate).length;
      showMessage(
        importableCount
          ? `${importableCount} duty span${importableCount === 1 ? " is" : "s are"} ready to import. Review warnings before continuing.`
          : "No duty spans are ready to import. Correct the CSV errors and validate it again.",
        importableCount ? "success" : "error"
      );
    } catch (error) {
      console.error("Bulk duty CSV validation failed", error);
      showMessage(error?.message || "Unable to validate the CSV file.", "error");
    } finally {
      processing = false;
      validateBtn.disabled = !fileInput.files?.length;
      validateBtn.innerHTML = '<i data-lucide="scan-line"></i> Validate CSV';
      window.lucide?.createIcons?.();
    }
  });

  importBtn.addEventListener("click", async () => {
    if (importing) return;
    const importableRows = processedRows.filter((row) => !row.errors.length && !row.duplicate);
    if (!importableRows.length || !confirmEl.checked) return;

    if (!window.confirm(`Import ${importableRows.length} complete duty span${importableRows.length === 1 ? "" : "s"}?`)) return;

    importing = true;
    importBtn.disabled = true;
    importBtn.textContent = "Importing…";
    validateBtn.disabled = true;
    clearBtn.disabled = true;
    showMessage("Importing duty spans. Do not close this page…", "info");

    try {
      let importedCount = 0;
      for (const rowChunk of chunk(importableRows, 450)) {
        const batch = writeBatch(db);
        rowChunk.forEach((row) => {
          const ref = doc(collection(db, "dutySpans"));
          batch.set(ref, {
            deleted: false,
            serviceDate: row.serviceDate,
            driverEmployeeNumber: row.driverEmployeeNumber,
            driverName: row.driverName,
            dutyType: row.dutyType,
            dutyNumber: row.dutyNumber,
            routeNumber: row.routeNumber,
            routePdfUrl: row.routePdfUrl,
            startMin: row.startMin,
            endMin: row.endMin,
            startLocation: row.startLocation,
            endLocation: row.endLocation,
            assignedBus: row.assignedBus,
            dispatchStatus: "Pending",
            driverAcknowledgment: "Pending",
            breaks: row.breaks,
            totalSpanMinutes: row.totalSpanMinutes,
            unpaidMinutes: row.unpaidMinutes,
            paidMinutes: row.paidMinutes,
            fatigueStatus: row.fatigueStatus,
            fatigueWarning: row.fatigueWarning,
            importSource: "Bulk Duty Spans CSV",
            createdByEmail: auth.currentUser?.email || "",
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
          });
        });
        await batch.commit();
        importedCount += rowChunk.length;
        showMessage(`Imported ${importedCount} of ${importableRows.length} duty spans…`, "info");
      }

      showMessage(`${importedCount} duty span${importedCount === 1 ? " was" : "s were"} imported successfully.`, "success");
      processedRows.forEach((row) => {
        if (!row.errors.length && !row.duplicate) {
          row.duplicate = true;
          row.duplicateReason = "Imported successfully in this session.";
        }
      });
      renderPreview();
      confirmEl.checked = false;
    } catch (error) {
      console.error("Bulk duty import failed", error);
      showMessage(error?.message || "The duty-span import failed.", "error");
    } finally {
      importing = false;
      importBtn.disabled = true;
      importBtn.textContent = "Import ready duty spans";
      validateBtn.disabled = !fileInput.files?.length;
      clearBtn.disabled = !fileInput.files?.length;
    }
  });
}
