import {
  collection,
  doc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  where
} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";
import {
  deleteObject,
  getDownloadURL,
  ref,
  uploadBytes
} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-storage.js";

import { auth, db, storage } from "./firebase.js";
import { state } from "./state.js";
import { els, showError } from "./ui.js";
import { escapeHtml } from "./utils.js";

const MAX_PHOTOS = 3;
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

function localDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function uniqueBusLabel(bus) {
  const values = [bus?.fleetNumber || bus?.id, bus?.rego, bus?.depot]
    .map((value) => String(value || "").trim())
    .filter(Boolean);

  return values.filter(
    (value, index) =>
      values.findIndex((item) => item.toLowerCase() === value.toLowerCase()) === index
  ).join(" · ");
}

function employeeDisplayName(employee) {
  const fullName = `${employee?.firstName || ""} ${employee?.lastName || ""}`.trim();

  return String(
    employee?.displayName ||
    employee?.name ||
    fullName ||
    auth.currentUser?.displayName ||
    auth.currentUser?.email ||
    "Driver"
  ).trim();
}

function formatReportDate(value) {
  const date = value?.toDate?.() || (value ? new Date(value) : null);
  if (!date || Number.isNaN(date.getTime())) return "Saving date…";

  return new Intl.DateTimeFormat("en-AU", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function safeFileName(name) {
  return String(name || "photo.jpg")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .slice(0, 100);
}

async function loadFleet() {
  const snapshot = await getDocs(collection(db, "buses"));

  return snapshot.docs
    .map((item) => ({ id: item.id, ...item.data() }))
    .filter((bus) => String(bus.status || "").toLowerCase() !== "inactive")
    .sort((a, b) =>
      String(a.fleetNumber || a.id).localeCompare(
        String(b.fleetNumber || b.id),
        undefined,
        { numeric: true }
      )
    );
}

async function loadMyReports(uid) {
  if (!uid) return [];

  const snapshot = await getDocs(
    query(
      collection(db, "defectReports"),
      where("reportedByUid", "==", uid)
    )
  );

  return snapshot.docs
    .map((item) => ({ id: item.id, ...item.data() }))
    .filter((report) => report.deleted !== true)
    .sort((a, b) => {
      const aTime = a.createdAt?.toMillis?.() || Date.parse(a.reportedAtIso || "") || 0;
      const bTime = b.createdAt?.toMillis?.() || Date.parse(b.reportedAtIso || "") || 0;
      return bTime - aTime;
    })
    .slice(0, 20);
}

function renderRecentReports(reports) {
  const listEl = document.getElementById("defectRecentList");
  if (!listEl) return;

  if (!reports.length) {
    listEl.innerHTML = `
      <div class="defect-empty-state">
        You have not submitted any defect reports yet.
      </div>
    `;
    return;
  }

  listEl.innerHTML = reports
    .map((report) => {
      const photos = Array.isArray(report.photos) ? report.photos : [];

      return `
        <article class="defect-report-card">
          <div class="defect-report-card-head">
            <div>
              <div class="defect-report-number">
                ${escapeHtml(report.reportNumber || report.id)}
              </div>
              <div class="muted">
                ${escapeHtml(formatReportDate(report.createdAt || report.reportedAtIso))}
              </div>
            </div>

            <div class="defect-report-badges">
              <span class="defect-badge defect-status-badge">
                ${escapeHtml(report.status || "New")}
              </span>
            </div>
          </div>

          <div class="defect-report-bus">
            Bus ${escapeHtml(uniqueBusLabel(report) || "-")}
          </div>

          <div class="defect-report-category">
            ${escapeHtml(report.category || "Other")}
          </div>

          <div class="defect-report-description">
            ${escapeHtml(report.description || "")}
          </div>

          <div class="defect-report-meta">
            Safe to drive: <b>${escapeHtml(report.safeToDrive || "Not stated")}</b>
            ${report.defectDate ? ` · Defect date: ${escapeHtml(report.defectDate)}` : ""}
          </div>

          ${
            photos.length
              ? `
                <div class="defect-report-photos">
                  ${photos
                    .map(
                      (photo) => `
                        <a href="${escapeHtml(photo.url || "")}" target="_blank" rel="noopener noreferrer">
                          <img src="${escapeHtml(photo.url || "")}" alt="Defect photo" />
                        </a>
                      `
                    )
                    .join("")}
                </div>
              `
              : ""
          }
        </article>
      `;
    })
    .join("");
}

const ADMIN_DEFECT_STATUSES = [
  "New",
  "Acknowledged",
  "Workshop Assigned",
  "Completed"
];

function isCompletedDefect(report) {
  return ["completed", "closed"].includes(
    String(report?.status || "").toLowerCase()
  );
}

async function loadAllDefectReports() {
  const snapshot = await getDocs(collection(db, "defectReports"));

  return snapshot.docs
    .map((item) => ({ id: item.id, ...item.data() }))
    .filter((report) => report.deleted !== true)
    .sort((a, b) => {
      const aTime = a.createdAt?.toMillis?.() || Date.parse(a.reportedAtIso || "") || 0;
      const bTime = b.createdAt?.toMillis?.() || Date.parse(b.reportedAtIso || "") || 0;
      return bTime - aTime;
    });
}

async function renderAdminDefectDashboard() {
  els.contentArea.innerHTML = `
    <div class="defect-admin-page">
      <header class="defect-admin-hero">
        <div>
          <div class="defect-eyebrow">Fleet safety</div>
          <h2>Defect Management</h2>
          <p>Review driver reports, assign action and track completion.</p>
        </div>
        <div class="defect-admin-hero-actions">
          <button id="enableAdminDefectAlerts" type="button" class="btn">
            <i data-lucide="bell" aria-hidden="true"></i>
            Enable alerts
          </button>
          <button id="refreshAdminDefects" type="button" class="btn">
            <i data-lucide="refresh-cw" aria-hidden="true"></i>
            Refresh
          </button>
        </div>
      </header>

      <nav class="defect-admin-tabs" aria-label="Defect report sections">
        <button type="button" class="active" data-defect-tab="overview">Overview</button>
        <button type="button" data-defect-tab="open">Open Reports</button>
        <button type="button" data-defect-tab="completed">Completed</button>
      </nav>

      <section id="defectAdminSummary" class="defect-admin-summary"></section>

      <section class="card defect-admin-workspace">
        <div class="defect-admin-filters">
          <label>
            <span>Search</span>
            <input id="adminDefectSearch" type="search" placeholder="Report, bus, driver or description" />
          </label>
          <label>
            <span>Date</span>
            <input id="adminDefectDate" type="date" />
          </label>
          <label>
            <span>Category</span>
            <select id="adminDefectCategory"><option value="">All categories</option></select>
          </label>
          <label>
            <span>Safety</span>
            <select id="adminDefectSafety">
              <option value="">All reports</option>
              <option value="No">Unsafe to drive</option>
              <option value="Yes">Safe to drive</option>
            </select>
          </label>
        </div>

        <div id="adminDefectList" class="defect-admin-list">
          <div class="defect-empty-state">Loading defect reports…</div>
        </div>
      </section>
    </div>
  `;

  window.lucide?.createIcons?.();

  const listEl = document.getElementById("adminDefectList");
  const summaryEl = document.getElementById("defectAdminSummary");
  const searchEl = document.getElementById("adminDefectSearch");
  const dateEl = document.getElementById("adminDefectDate");
  const categoryEl = document.getElementById("adminDefectCategory");
  const safetyEl = document.getElementById("adminDefectSafety");
  const refreshBtn = document.getElementById("refreshAdminDefects");
  const enableAlertsBtn = document.getElementById("enableAdminDefectAlerts");

  let reports = [];
  let activeTab = "overview";

  function renderSummary() {
    if (!summaryEl) return;

    const open = reports.filter((report) => !isCompletedDefect(report)).length;
    const unsafe = reports.filter(
      (report) => !isCompletedDefect(report) && report.safeToDrive === "No"
    ).length;
    const completed = reports.filter(isCompletedDefect).length;

    summaryEl.innerHTML = `
      <article><span>Total reports</span><strong>${reports.length}</strong></article>
      <article><span>Open</span><strong>${open}</strong></article>
      <article class="danger"><span>Unsafe vehicles</span><strong>${unsafe}</strong></article>
      <article class="success"><span>Completed</span><strong>${completed}</strong></article>
    `;
  }

  function rebuildCategories() {
    if (!categoryEl) return;
    const oldValue = categoryEl.value;
    const categories = [...new Set(reports.map((report) => report.category).filter(Boolean))]
      .sort((a, b) => String(a).localeCompare(String(b)));

    categoryEl.innerHTML = [
      `<option value="">All categories</option>`,
      ...categories.map(
        (category) => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`
      )
    ].join("");
    categoryEl.value = categories.includes(oldValue) ? oldValue : "";
  }

  function filteredReports() {
    const search = String(searchEl?.value || "").trim().toLowerCase();
    const date = String(dateEl?.value || "").trim();
    const category = String(categoryEl?.value || "").trim();
    const safety = String(safetyEl?.value || "").trim();

    return reports.filter((report) => {
      if (activeTab === "open" && isCompletedDefect(report)) return false;
      if (activeTab === "completed" && !isCompletedDefect(report)) return false;
      if (date && String(report.defectDate || "") !== date) return false;
      if (category && report.category !== category) return false;
      if (safety && report.safeToDrive !== safety) return false;

      if (search) {
        const haystack = [
          report.reportNumber,
          report.fleetNumber,
          report.rego,
          report.reportedByName,
          report.reportedByEmployeeNumber,
          report.category,
          report.description,
          report.status
        ].filter(Boolean).join(" ").toLowerCase();
        if (!haystack.includes(search)) return false;
      }

      return true;
    });
  }

  function renderList() {
    if (!listEl) return;
    const filtered = filteredReports();

    if (!filtered.length) {
      listEl.innerHTML = `<div class="defect-empty-state">No defect reports match these filters.</div>`;
      return;
    }

    listEl.innerHTML = filtered.map((report) => {
      const unsafe = report.safeToDrive === "No";
      const photos = Array.isArray(report.photos) ? report.photos : [];
      const currentStatus = report.status || "New";

      return `
        <article class="defect-admin-report ${unsafe ? "unsafe" : ""}">
          <div class="defect-admin-report-head">
            <div>
              <div class="defect-report-number">${escapeHtml(report.reportNumber || report.id)}</div>
              <div class="defect-admin-subline">
                ${escapeHtml(report.defectDate || "Date not recorded")} ·
                ${escapeHtml(formatReportDate(report.createdAt || report.reportedAtIso))}
              </div>
            </div>
            <div class="defect-report-badges">
              ${unsafe ? `<span class="defect-badge defect-priority-critical">Unsafe to drive</span>` : `<span class="defect-badge defect-priority-low">Safe to drive</span>`}
              <span class="defect-badge defect-status-badge">${escapeHtml(currentStatus)}</span>
            </div>
          </div>

          <div class="defect-admin-report-grid">
            <div><span>Bus</span><strong>${escapeHtml(uniqueBusLabel(report) || "-")}</strong></div>
            <div><span>Category</span><strong>${escapeHtml(report.category || "Other")}</strong></div>
            <div><span>Driver</span><strong>${escapeHtml(report.reportedByName || "Unknown")}</strong><small>${escapeHtml(report.reportedByEmployeeNumber || "")}</small></div>
          </div>

          <div class="defect-admin-description">${escapeHtml(report.description || "")}</div>

          ${photos.length ? `
            <div class="defect-report-photos">
              ${photos.map((photo) => `
                <a href="${escapeHtml(photo.url || "")}" target="_blank" rel="noopener noreferrer">
                  <img src="${escapeHtml(photo.url || "")}" alt="Defect photo" />
                </a>
              `).join("")}
            </div>
          ` : ""}

          <div class="defect-admin-action-row">
            <label>
              <span>Status</span>
              <select data-admin-defect-status="${escapeHtml(report.id)}">
                ${ADMIN_DEFECT_STATUSES.map((status) => `<option value="${status}" ${status === currentStatus ? "selected" : ""}>${status}</option>`).join("")}
              </select>
            </label>
            <label class="notes">
              <span>Operations / workshop notes</span>
              <input data-admin-defect-notes="${escapeHtml(report.id)}" value="${escapeHtml(report.adminNotes || "")}" placeholder="Add an internal note" />
            </label>
            <button type="button" data-save-admin-defect="${escapeHtml(report.id)}">Save update</button>
          </div>
          <div class="defect-admin-save-message" data-admin-defect-message="${escapeHtml(report.id)}"></div>
        </article>
      `;
    }).join("");

    [...listEl.querySelectorAll("[data-save-admin-defect]")].forEach((button) => {
      button.onclick = async () => {
        const id = button.getAttribute("data-save-admin-defect");
        const statusEl = listEl.querySelector(`[data-admin-defect-status="${CSS.escape(id)}"]`);
        const notesEl = listEl.querySelector(`[data-admin-defect-notes="${CSS.escape(id)}"]`);
        const messageEl = listEl.querySelector(`[data-admin-defect-message="${CSS.escape(id)}"]`);
        const status = String(statusEl?.value || "New");
        const adminNotes = String(notesEl?.value || "").trim();

        button.disabled = true;
        button.textContent = "Saving…";
        if (messageEl) messageEl.textContent = "";

        try {
          await setDoc(doc(db, "defectReports", id), {
            status,
            adminNotes,
            updatedAt: serverTimestamp(),
            updatedByUid: auth.currentUser?.uid || "",
            updatedByEmail: auth.currentUser?.email || ""
          }, { merge: true });

          const report = reports.find((item) => item.id === id);
          if (report) {
            report.status = status;
            report.adminNotes = adminNotes;
          }
          renderSummary();
          if (messageEl) messageEl.textContent = "Update saved.";
        } catch (error) {
          console.error("Failed to update defect report", error);
          if (messageEl) messageEl.textContent = error?.message || "Update failed.";
        } finally {
          button.disabled = false;
          button.textContent = "Save update";
        }
      };
    });
  }

  async function refresh() {
    if (listEl) listEl.innerHTML = `<div class="defect-empty-state">Loading defect reports…</div>`;
    if (refreshBtn) refreshBtn.disabled = true;
    try {
      reports = await loadAllDefectReports();
      rebuildCategories();
      renderSummary();
      renderList();
    } catch (error) {
      console.error("Failed to load admin defect reports", error);
      if (listEl) listEl.innerHTML = `<div class="defect-empty-state defect-load-error">Unable to load defect reports.</div>`;
    } finally {
      if (refreshBtn) refreshBtn.disabled = false;
    }
  }

  [...document.querySelectorAll("[data-defect-tab]")].forEach((button) => {
    button.onclick = () => {
      activeTab = button.getAttribute("data-defect-tab") || "overview";
      document.querySelectorAll("[data-defect-tab]").forEach((item) => {
        item.classList.toggle("active", item === button);
      });
      renderList();
    };
  });

  [searchEl, dateEl, categoryEl, safetyEl].forEach((element) => {
    element?.addEventListener(element === searchEl ? "input" : "change", renderList);
  });
  refreshBtn?.addEventListener("click", refresh);
  enableAlertsBtn?.addEventListener("click", async () => {
    enableAlertsBtn.disabled = true;
    try {
      await window.enablePortalNotifications?.();
      enableAlertsBtn.textContent = window.Notification?.permission === "granted" ?
        "Alerts enabled" : "Alerts not enabled";
    } finally {
      enableAlertsBtn.disabled = false;
    }
  });

  await refresh();
}

function renderPhotoPreview(files) {
  const previewEl = document.getElementById("defectPhotoPreview");
  if (!previewEl) return;

  previewEl.innerHTML = "";

  files.forEach((file) => {
    const image = document.createElement("img");
    image.src = URL.createObjectURL(file);
    image.alt = file.name;
    image.onload = () => URL.revokeObjectURL(image.src);
    previewEl.appendChild(image);
  });
}

function validatePhotos(files) {
  if (files.length > MAX_PHOTOS) {
    return `Please select no more than ${MAX_PHOTOS} photos.`;
  }

  for (const file of files) {
    if (!String(file.type || "").startsWith("image/")) {
      return `${file.name} is not an image.`;
    }

    if (file.size > MAX_PHOTO_BYTES) {
      return `${file.name} is larger than 8 MB.`;
    }
  }

  return "";
}

export async function renderDefectReportPage() {
  showError("");

  if (state.isAdmin && !state.isDriver) {
    await renderAdminDefectDashboard();
    return;
  }

  const employee = state.employee || {};
  const reporterName = employeeDisplayName(employee);
  const employeeNumber = String(employee.employeeNumber || "").trim();

  els.contentArea.innerHTML = `
    <div class="defect-page">
      <header class="defect-hero">
        <div class="defect-hero-icon" aria-hidden="true">
          <i data-lucide="wrench"></i>
        </div>

        <div class="defect-hero-copy">
          <div class="defect-eyebrow">Vehicle safety</div>
          <h2>Report a vehicle defect</h2>
          <p>Provide clear details so OCC and the workshop can respond quickly.</p>
        </div>

        <div class="defect-reporter-card">
          <span>Reporting as</span>
          <strong>${escapeHtml(reporterName)}</strong>
          ${employeeNumber ? `<small>Employee ${escapeHtml(employeeNumber)}</small>` : ""}
        </div>
      </header>

      <div class="defect-layout">
        <section class="card defect-form-card">
          <div id="defectFormMessage" class="defect-form-message" hidden></div>

          <div class="defect-form-section">
            <div class="defect-section-heading">
              <span class="defect-step">1</span>
              <div>
                <h3>Vehicle details</h3>
                <p>Select the bus and the type of fault.</p>
              </div>
            </div>

            <div class="defect-form-grid">
              <label class="defect-field">
                <span>Defect date <b>*</b></span>
                <input id="defectDate" type="date" required />
              </label>

              <label class="defect-field">
                <span>Bus number <b>*</b></span>
                <select id="defectBus" required>
                  <option value="">Loading fleet…</option>
                </select>
              </label>

              <label class="defect-field">
                <span>Defect category <b>*</b></span>
                <select id="defectCategory" required>
                  <option value="">Select category</option>
                  <option value="Accessibility Equipment">Accessibility Equipment</option>
                  <option value="Air Conditioning">Air Conditioning</option>
                  <option value="Body / Glass / Mirrors">Body / Glass / Mirrors</option>
                  <option value="Brakes">Brakes</option>
                  <option value="CCTV / Communications">CCTV / Communications</option>
                  <option value="Doors">Doors</option>
                  <option value="Electrical">Electrical</option>
                  <option value="Engine / Transmission">Engine / Transmission</option>
                  <option value="Interior / Seats">Interior / Seats</option>
                  <option value="Lights / Indicators">Lights / Indicators</option>
                  <option value="Other">Other</option>
                  <option value="Steering">Steering</option>
                  <option value="Tyres / Wheels">Tyres / Wheels</option>
                </select>
              </label>
            </div>
          </div>

          <div class="defect-form-section">
            <div class="defect-section-heading">
              <span class="defect-step">2</span>
              <div>
                <h3>Safety assessment</h3>
                <p>Confirm whether the vehicle can continue operating safely.</p>
              </div>
            </div>

            <div class="defect-safety-panel">
              <label class="defect-field">
                <span>Is the bus safe to drive? <b>*</b></span>
                <select id="defectSafeToDrive" required>
                  <option value="">Select Yes or No</option>
                  <option value="Yes">Yes</option>
                  <option value="No">No — stop using the vehicle</option>
                </select>
              </label>
            </div>

            <div id="defectCriticalWarning" class="defect-critical-warning" hidden>
              <i data-lucide="triangle-alert" aria-hidden="true"></i>
              <div>
                <strong>Vehicle marked unsafe to drive</strong>
                <span>Stop in a safe location and contact OCC immediately.</span>
              </div>
            </div>
          </div>

          <div class="defect-form-section">
            <div class="defect-section-heading">
              <span class="defect-step">3</span>
              <div>
                <h3>Report details</h3>
                <p>Describe the problem and include supporting photos.</p>
              </div>
            </div>

            <label class="defect-field">
              <span>Describe the defect <b>*</b></span>
              <textarea
                id="defectDescription"
                maxlength="2000"
                placeholder="Describe what happened, warning lights, noises, damage and any immediate action taken."
                required
              ></textarea>
              <small>Include enough detail for OCC and the workshop to understand the problem.</small>
            </label>

            <label class="defect-upload-zone" for="defectPhotos">
              <input id="defectPhotos" type="file" accept="image/*" multiple />
              <span class="defect-upload-icon"><i data-lucide="camera"></i></span>
              <span class="defect-upload-copy">
                <strong>Add defect photos</strong>
                <small id="defectPhotoHelp">Choose up to 3 images · maximum 8 MB each</small>
              </span>
              <span class="defect-upload-action">Choose photos</span>
            </label>

            <div id="defectPhotoPreview" class="defect-photo-preview"></div>
          </div>

          <div class="defect-form-actions">
            <button id="submitDefectReport" type="button">
              <i data-lucide="send" aria-hidden="true"></i>
              <span>Submit Defect Report</span>
            </button>
            <div class="defect-submit-note">
              Your report will be sent to Operations for review.
            </div>
          </div>
        </section>

        <section class="card defect-recent-card">
          <div class="defect-recent-heading">
            <span class="defect-recent-icon"><i data-lucide="history"></i></span>
            <div>
              <h3>My Recent Reports</h3>
              <p>Track the latest status from Operations.</p>
            </div>
          </div>
          <div id="defectRecentList">
            <div class="defect-empty-state">Loading reports…</div>
          </div>
        </section>
      </div>
    </div>
  `;

  const busEl = document.getElementById("defectBus");
  const dateEl = document.getElementById("defectDate");
  const categoryEl = document.getElementById("defectCategory");
  const safeToDriveEl = document.getElementById("defectSafeToDrive");
  const descriptionEl = document.getElementById("defectDescription");
  const photosEl = document.getElementById("defectPhotos");
  const submitBtn = document.getElementById("submitDefectReport");
  const messageEl = document.getElementById("defectFormMessage");
  const criticalWarningEl = document.getElementById("defectCriticalWarning");
  const photoHelpEl = document.getElementById("defectPhotoHelp");

  window.lucide?.createIcons?.();

  const today = localDateString();
  if (dateEl) {
    dateEl.value = today;
    dateEl.max = today;
  }

  let fleet = [];

  function showFormMessage(message, type = "error") {
    if (!messageEl) return;
    messageEl.textContent = message;
    messageEl.className = `defect-form-message ${type}`;
    messageEl.hidden = !message;
  }

  function updateSafetyWarning() {
    const unsafe = safeToDriveEl?.value === "No";
    if (criticalWarningEl) criticalWarningEl.hidden = !unsafe;
  }

  safeToDriveEl?.addEventListener("change", updateSafetyWarning);

  photosEl?.addEventListener("change", () => {
    const files = Array.from(photosEl.files || []);
    const error = validatePhotos(files);

    if (error) {
      showFormMessage(error);
      photosEl.value = "";
      if (photoHelpEl) photoHelpEl.textContent = "Choose up to 3 images · maximum 8 MB each";
      renderPhotoPreview([]);
      return;
    }

    showFormMessage("");
    if (photoHelpEl) {
      photoHelpEl.textContent = files.length
        ? `${files.length} photo${files.length === 1 ? "" : "s"} selected`
        : "Choose up to 3 images · maximum 8 MB each";
    }
    renderPhotoPreview(files);
  });

  try {
    fleet = await loadFleet();

    if (busEl) {
      busEl.innerHTML = [
        `<option value="">Select bus</option>`,
        ...fleet.map((bus) => {
          const label = uniqueBusLabel(bus);
          return `<option value="${escapeHtml(bus.id)}">${escapeHtml(label)}</option>`;
        })
      ].join("");
    }
  } catch (error) {
    console.error("Failed to load fleet for defect report", error);
    if (busEl) busEl.innerHTML = `<option value="">Fleet failed to load</option>`;
    showFormMessage("Unable to load the Fleet list. Please try again.");
  }

  async function refreshRecentReports() {
    try {
      const reports = await loadMyReports(auth.currentUser?.uid || "");
      renderRecentReports(reports);
    } catch (error) {
      console.error("Failed to load defect reports", error);
      const listEl = document.getElementById("defectRecentList");
      if (listEl) {
        listEl.innerHTML = `
          <div class="defect-empty-state defect-load-error">
            Unable to load recent reports.
          </div>
        `;
      }
    }
  }

  await refreshRecentReports();

  if (!submitBtn) return;

  submitBtn.onclick = async () => {
    showError("");
    showFormMessage("");

    const selectedBus = fleet.find((bus) => String(bus.id) === String(busEl?.value || ""));
    const defectDate = String(dateEl?.value || "").trim();
    const category = String(categoryEl?.value || "").trim();
    const safeToDrive = String(safeToDriveEl?.value || "").trim();
    const priority = safeToDrive === "No" ? "Critical" : "Medium";
    const description = String(descriptionEl?.value || "").trim();
    const photoFiles = Array.from(photosEl?.files || []);

    if (!defectDate) return showFormMessage("Please select the defect date.");
    if (defectDate > localDateString()) return showFormMessage("Defect date cannot be in the future.");
    if (!selectedBus) return showFormMessage("Please select the bus.");
    if (!category) return showFormMessage("Please select the defect category.");
    if (!safeToDrive) return showFormMessage("Please confirm whether the bus is safe to drive.");
    if (!description) return showFormMessage("Please describe the defect.");

    const photoError = validatePhotos(photoFiles);
    if (photoError) return showFormMessage(photoError);

    const reportRef = doc(collection(db, "defectReports"));
    const reportNumber = `DR-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${reportRef.id.slice(0, 6).toUpperCase()}`;
    const uploadedRefs = [];

    submitBtn.disabled = true;
    submitBtn.textContent = photoFiles.length ? "Uploading photos…" : "Submitting…";

    try {
      const photos = [];

      for (let index = 0; index < photoFiles.length; index += 1) {
        const file = photoFiles[index];
        submitBtn.textContent = `Uploading photo ${index + 1} of ${photoFiles.length}…`;

        const storagePath = `defect-reports/${reportRef.id}/${Date.now()}-${index + 1}-${safeFileName(file.name)}`;
        const photoRef = ref(storage, storagePath);
        uploadedRefs.push(photoRef);

        await uploadBytes(photoRef, file, {
          contentType: file.type,
          customMetadata: {
            reportId: reportRef.id,
            reportedByUid: auth.currentUser?.uid || ""
          }
        });

        photos.push({
          url: await getDownloadURL(photoRef),
          storagePath,
          fileName: file.name,
          contentType: file.type,
          size: file.size
        });
      }

      submitBtn.textContent = "Saving report…";

      await setDoc(reportRef, {
        reportNumber,
        status: "New",
        priority,
        defectDate,
        category,
        safeToDrive,
        description,

        busId: selectedBus.id,
        fleetNumber: String(selectedBus.fleetNumber || selectedBus.id || "").trim(),
        rego: String(selectedBus.rego || "").trim(),
        depot: String(selectedBus.depot || "").trim(),

        photos,
        photoCount: photos.length,

        reportedByUid: auth.currentUser?.uid || "",
        reportedByEmail: auth.currentUser?.email || "",
        reportedByName: reporterName,
        reportedByEmployeeNumber: employeeNumber,
        reportedAtIso: new Date().toISOString(),

        adminNotes: "",
        deleted: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });

      showFormMessage(
        `${reportNumber} submitted successfully.`,
        "success"
      );

      if (categoryEl) categoryEl.value = "";
      if (dateEl) dateEl.value = localDateString();
      if (safeToDriveEl) safeToDriveEl.value = "";
      if (descriptionEl) descriptionEl.value = "";
      if (photosEl) photosEl.value = "";
      if (photoHelpEl) photoHelpEl.textContent = "Choose up to 3 images · maximum 8 MB each";
      if (criticalWarningEl) criticalWarningEl.hidden = true;
      renderPhotoPreview([]);

      await refreshRecentReports();
      messageEl?.scrollIntoView({ behavior: "smooth", block: "center" });
    } catch (error) {
      console.error("Failed to submit defect report", error);

      await Promise.allSettled(
        uploadedRefs.map((photoRef) => deleteObject(photoRef))
      );

      showFormMessage(
        error?.message || "Failed to submit the defect report. Please try again."
      );
    } finally {
      submitBtn.disabled = false;
      submitBtn.innerHTML = `
        <i data-lucide="send" aria-hidden="true"></i>
        <span>Submit Defect Report</span>
      `;
      window.lucide?.createIcons?.();
    }
  };
}
