import {
  collection,
  doc,
  getDocs,
  serverTimestamp,
  setDoc
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

function employeeDisplayName(employee) {
  return String(
    employee?.displayName ||
    employee?.name ||
    `${employee?.firstName || ""} ${employee?.lastName || ""}`.trim() ||
    auth.currentUser?.displayName ||
    auth.currentUser?.email ||
    "Driver"
  ).trim();
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
    .sort((a, b) => String(a.fleetNumber || a.id).localeCompare(
      String(b.fleetNumber || b.id),
      undefined,
      { numeric: true }
    ));
}

function validatePhotos(files) {
  if (files.length > MAX_PHOTOS) return "Please select no more than 3 photos.";
  for (const file of files) {
    if (!String(file.type || "").startsWith("image/")) return `${file.name} is not an image.`;
    if (file.size > MAX_PHOTO_BYTES) return `${file.name} is larger than 8 MB.`;
  }
  return "";
}

function renderPhotoPreview(files) {
  const previewEl = document.getElementById("lostPropertyPhotoPreview");
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

const ADMIN_LOST_PROPERTY_STATUSES = [
  "Submitted",
  "In Storage",
  "Owner Contacted",
  "Returned",
  "Closed"
];

function isResolvedReport(report) {
  return ["returned", "closed"].includes(
    String(report?.status || "").trim().toLowerCase()
  );
}

async function loadAllReports() {
  const snapshot = await getDocs(collection(db, "lostPropertyReports"));
  return snapshot.docs
    .map((item) => ({ id: item.id, ...item.data() }))
    .filter((report) => report.deleted !== true)
    .sort((a, b) => {
      const aTime = a.createdAt?.toMillis?.() || Date.parse(a.reportedAtIso || "") || 0;
      const bTime = b.createdAt?.toMillis?.() || Date.parse(b.reportedAtIso || "") || 0;
      return bTime - aTime;
    });
}

async function renderAdminLostPropertyPage() {
  els.contentArea.innerHTML = `
    <div class="lost-admin-page">
      <header class="lost-admin-hero">
        <div class="lost-admin-hero-title">
          <span><i data-lucide="package-search"></i></span>
          <div>
            <div class="lost-property-eyebrow">Customer property</div>
            <h2>Lost Property Register</h2>
            <p>Review items reported by drivers and track their return status.</p>
          </div>
        </div>
        <button id="refreshLostPropertyAdmin" type="button" class="btn">
          <i data-lucide="refresh-cw"></i> Refresh
        </button>
      </header>

      <nav class="lost-admin-tabs" aria-label="Lost property sections">
        <button type="button" class="active" data-lost-tab="overview">Overview</button>
        <button type="button" data-lost-tab="open">Open Items</button>
        <button type="button" data-lost-tab="resolved">Returned / Closed</button>
      </nav>

      <section id="lostAdminSummary" class="lost-admin-summary"></section>

      <section class="card lost-admin-workspace">
        <div class="lost-admin-filters">
          <label>
            <span>Search</span>
            <input id="lostAdminSearch" type="search" placeholder="Report, bus, driver, location or description" />
          </label>
          <label>
            <span>Date found</span>
            <input id="lostAdminDate" type="date" />
          </label>
          <label>
            <span>Status</span>
            <select id="lostAdminStatus">
              <option value="">All statuses</option>
              ${ADMIN_LOST_PROPERTY_STATUSES.map((status) => `<option value="${status}">${status}</option>`).join("")}
            </select>
          </label>
          <button id="clearLostAdminFilters" type="button" class="btn">Clear filters</button>
        </div>

        <div id="lostAdminList" class="lost-admin-list">
          <div class="lost-property-empty">Loading lost property reports…</div>
        </div>
      </section>
    </div>
  `;

  window.lucide?.createIcons?.();

  const summaryEl = document.getElementById("lostAdminSummary");
  const listEl = document.getElementById("lostAdminList");
  const searchEl = document.getElementById("lostAdminSearch");
  const dateEl = document.getElementById("lostAdminDate");
  const statusEl = document.getElementById("lostAdminStatus");
  const refreshBtn = document.getElementById("refreshLostPropertyAdmin");
  const clearBtn = document.getElementById("clearLostAdminFilters");

  let reports = [];
  let activeTab = "overview";

  function renderSummary() {
    if (!summaryEl) return;
    const open = reports.filter((report) => !isResolvedReport(report)).length;
    const returned = reports.filter(
      (report) => String(report.status || "").toLowerCase() === "returned"
    ).length;
    const today = localDateString();
    const todayCount = reports.filter((report) => report.dateFound === today).length;

    summaryEl.innerHTML = `
      <article><span>Total reports</span><strong>${reports.length}</strong></article>
      <article class="open"><span>Open items</span><strong>${open}</strong></article>
      <article class="today"><span>Found today</span><strong>${todayCount}</strong></article>
      <article class="returned"><span>Returned</span><strong>${returned}</strong></article>
    `;
  }

  function filteredReports() {
    const search = String(searchEl?.value || "").trim().toLowerCase();
    const date = String(dateEl?.value || "").trim();
    const status = String(statusEl?.value || "").trim();

    return reports.filter((report) => {
      if (activeTab === "open" && isResolvedReport(report)) return false;
      if (activeTab === "resolved" && !isResolvedReport(report)) return false;
      if (date && report.dateFound !== date) return false;
      if (status && (report.status || "Submitted") !== status) return false;

      if (search) {
        const haystack = [
          report.reportNumber,
          report.fleetNumber,
          report.rego,
          report.reportedByName,
          report.reportedByEmployeeNumber,
          report.foundLocation,
          report.description,
          report.status,
          report.adminNotes
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
      listEl.innerHTML = `<div class="lost-property-empty">No lost property reports match these filters.</div>`;
      return;
    }

    listEl.innerHTML = filtered.map((report) => {
      const photos = Array.isArray(report.photos) ? report.photos : [];
      const currentStatus = report.status || "Submitted";
      const resolved = isResolvedReport(report);

      return `
        <article class="lost-admin-report ${resolved ? "resolved" : ""}">
          <div class="lost-admin-report-head">
            <div>
              <div class="lost-admin-report-number">${escapeHtml(report.reportNumber || report.id)}</div>
              <div class="lost-admin-report-date">Found ${escapeHtml(report.dateFound || "-")} at ${escapeHtml(report.timeFound || "-")}</div>
            </div>
            <span class="lost-admin-status ${resolved ? "resolved" : "open"}">${escapeHtml(currentStatus)}</span>
          </div>

          <div class="lost-admin-info-grid">
            <div><span>Bus</span><strong>${escapeHtml(uniqueBusLabel(report) || "-")}</strong></div>
            <div><span>Found location</span><strong>${escapeHtml(report.foundLocation || "-")}</strong></div>
            <div><span>Reported by</span><strong>${escapeHtml(report.reportedByName || "Unknown")}</strong><small>${escapeHtml(report.reportedByEmployeeNumber || "")}</small></div>
          </div>

          <div class="lost-admin-description">${escapeHtml(report.description || "No description")}</div>

          ${photos.length ? `
            <div class="lost-admin-photos">
              ${photos.map((photo, index) => `
                <a href="${escapeHtml(photo.url || "")}" target="_blank" rel="noopener noreferrer">
                  <img src="${escapeHtml(photo.url || "")}" alt="Lost property photo ${index + 1}" />
                </a>
              `).join("")}
            </div>
          ` : ""}

          <div class="lost-admin-actions">
            <label>
              <span>Status</span>
              <select data-lost-admin-status="${escapeHtml(report.id)}">
                ${ADMIN_LOST_PROPERTY_STATUSES.map((status) => `<option value="${status}" ${status === currentStatus ? "selected" : ""}>${status}</option>`).join("")}
              </select>
            </label>
            <label class="notes">
              <span>Operations notes</span>
              <input data-lost-admin-notes="${escapeHtml(report.id)}" value="${escapeHtml(report.adminNotes || "")}" maxlength="1000" placeholder="Storage location, claimant or return details" />
            </label>
            <button type="button" data-save-lost-report="${escapeHtml(report.id)}">Save update</button>
          </div>
          <div class="lost-admin-save-message" data-lost-admin-message="${escapeHtml(report.id)}"></div>
        </article>
      `;
    }).join("");

    [...listEl.querySelectorAll("[data-save-lost-report]")].forEach((button) => {
      button.onclick = async () => {
        const id = button.getAttribute("data-save-lost-report");
        const report = reports.find((item) => item.id === id);
        if (!report) return;

        const statusInput = listEl.querySelector(`[data-lost-admin-status="${CSS.escape(id)}"]`);
        const notesInput = listEl.querySelector(`[data-lost-admin-notes="${CSS.escape(id)}"]`);
        const messageEl = listEl.querySelector(`[data-lost-admin-message="${CSS.escape(id)}"]`);
        const status = String(statusInput?.value || "Submitted");
        const adminNotes = String(notesInput?.value || "").trim();

        button.disabled = true;
        button.textContent = "Saving…";
        if (messageEl) messageEl.textContent = "";

        try {
          await setDoc(doc(db, "lostPropertyReports", id), {
            status,
            adminNotes,
            updatedAt: serverTimestamp(),
            updatedByUid: auth.currentUser?.uid || "",
            updatedByEmail: auth.currentUser?.email || ""
          }, { merge: true });

          report.status = status;
          report.adminNotes = adminNotes;
          renderSummary();
          if (messageEl) messageEl.textContent = "Update saved.";
        } catch (error) {
          console.error("Failed to update lost property report", error);
          if (messageEl) messageEl.textContent = error?.message || "Update failed.";
        } finally {
          button.disabled = false;
          button.textContent = "Save update";
        }
      };
    });
  }

  async function refresh() {
    if (listEl) listEl.innerHTML = `<div class="lost-property-empty">Loading lost property reports…</div>`;
    if (refreshBtn) refreshBtn.disabled = true;
    try {
      reports = await loadAllReports();
      renderSummary();
      renderList();
    } catch (error) {
      console.error("Failed to load lost property register", error);
      if (listEl) listEl.innerHTML = `<div class="lost-property-empty error">Unable to load lost property reports.</div>`;
    } finally {
      if (refreshBtn) refreshBtn.disabled = false;
    }
  }

  [...document.querySelectorAll("[data-lost-tab]")].forEach((button) => {
    button.onclick = () => {
      activeTab = button.getAttribute("data-lost-tab") || "overview";
      document.querySelectorAll("[data-lost-tab]").forEach((item) => {
        item.classList.toggle("active", item === button);
      });
      renderList();
    };
  });

  searchEl?.addEventListener("input", renderList);
  dateEl?.addEventListener("change", renderList);
  statusEl?.addEventListener("change", renderList);
  clearBtn?.addEventListener("click", () => {
    if (searchEl) searchEl.value = "";
    if (dateEl) dateEl.value = "";
    if (statusEl) statusEl.value = "";
    renderList();
  });
  refreshBtn?.addEventListener("click", refresh);

  await refresh();
}

export async function renderLostPropertyPage() {
  showError("");

  if (state.isAdmin && !state.isDriver) {
    await renderAdminLostPropertyPage();
    return;
  }

  const employee = state.employee || {};
  const reporterName = employeeDisplayName(employee);
  const employeeNumber = String(employee.employeeNumber || "").trim();

  els.contentArea.innerHTML = `
    <div class="lost-property-page">
      <header class="lost-property-hero">
        <div class="lost-property-hero-icon"><i data-lucide="package-search"></i></div>
        <div class="lost-property-hero-copy">
          <div class="lost-property-eyebrow">Customer property</div>
          <h2>Report found property</h2>
          <p>Record and secure items found on a vehicle as soon as possible.</p>
        </div>
        <div class="lost-property-reporter">
          <span>Reporting as</span><strong>${escapeHtml(reporterName)}</strong>
          ${employeeNumber ? `<small>Employee ${escapeHtml(employeeNumber)}</small>` : ""}
        </div>
      </header>

      <div class="lost-property-layout">
        <section class="card lost-property-form-card">
          <div id="lostPropertyMessage" class="lost-property-message" hidden></div>

          <div class="lost-property-section">
            <div class="lost-property-section-heading"><span>1</span><div><h3>Journey details</h3><p>Tell Operations when and where the item was found.</p></div></div>
            <div class="lost-property-grid">
              <label><span>Date found <b>*</b></span><input id="lostPropertyDate" type="date" required /></label>
              <label><span>Time found <b>*</b></span><input id="lostPropertyTime" type="time" required /></label>
              <label><span>Bus number <b>*</b></span><select id="lostPropertyBus" required><option value="">Loading fleet…</option></select></label>
              <label><span>Location found <b>*</b></span><input id="lostPropertyLocation" placeholder="Seat number, bus area or stop" maxlength="200" /></label>
            </div>

            <label class="lost-property-field"><span>Item description <b>*</b></span><textarea id="lostPropertyDescription" maxlength="1500" required placeholder="Describe the item, colour, brand, condition and identifying details. Do not enter full card, licence or identity numbers."></textarea></label>

            <label class="lost-property-upload" for="lostPropertyPhotos">
              <input id="lostPropertyPhotos" type="file" accept="image/*" multiple />
              <span class="lost-property-upload-icon"><i data-lucide="camera"></i></span>
              <span class="lost-property-upload-copy"><strong>Add item photos</strong><small id="lostPropertyPhotoHelp">Choose up to 3 images · maximum 8 MB each</small></span>
              <span class="lost-property-upload-action">Choose photos</span>
            </label>
            <div id="lostPropertyPhotoPreview" class="lost-property-photo-preview"></div>
          </div>

          <div class="lost-property-actions">
            <button id="submitLostProperty" type="button"><i data-lucide="send"></i><span>Submit Lost Property Report</span></button>
            <small>Your report will be sent to Operations for review.</small>
          </div>
        </section>

      </div>
    </div>
  `;

  window.lucide?.createIcons?.();

  const dateEl = document.getElementById("lostPropertyDate");
  const timeEl = document.getElementById("lostPropertyTime");
  const busEl = document.getElementById("lostPropertyBus");
  const locationEl = document.getElementById("lostPropertyLocation");
  const descriptionEl = document.getElementById("lostPropertyDescription");
  const photosEl = document.getElementById("lostPropertyPhotos");
  const photoHelpEl = document.getElementById("lostPropertyPhotoHelp");
  const submitBtn = document.getElementById("submitLostProperty");
  const messageEl = document.getElementById("lostPropertyMessage");

  const now = new Date();
  if (dateEl) {
    dateEl.value = localDateString(now);
    dateEl.max = localDateString(now);
  }
  if (timeEl) timeEl.value = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

  let fleet = [];

  function showMessage(message, type = "error") {
    if (!messageEl) return;
    messageEl.textContent = message;
    messageEl.className = `lost-property-message ${type}`;
    messageEl.hidden = !message;
  }

  photosEl?.addEventListener("change", () => {
    const files = Array.from(photosEl.files || []);
    const error = validatePhotos(files);
    if (error) {
      showMessage(error);
      photosEl.value = "";
      if (photoHelpEl) photoHelpEl.textContent = "Choose up to 3 images · maximum 8 MB each";
      renderPhotoPreview([]);
      return;
    }
    showMessage("");
    if (photoHelpEl) photoHelpEl.textContent = files.length ? `${files.length} photo${files.length === 1 ? "" : "s"} selected` : "Choose up to 3 images · maximum 8 MB each";
    renderPhotoPreview(files);
  });

  try {
    fleet = await loadFleet();
    if (busEl) {
      busEl.innerHTML = [
        `<option value="">Select bus</option>`,
        ...fleet.map((bus) => `<option value="${escapeHtml(bus.id)}">${escapeHtml(uniqueBusLabel(bus))}</option>`)
      ].join("");
    }
  } catch (error) {
    console.error("Failed to load fleet for lost property", error);
    if (busEl) busEl.innerHTML = `<option value="">Fleet failed to load</option>`;
    showMessage("Unable to load the Fleet list. Please try again.");
  }

  if (!submitBtn) return;

  submitBtn.onclick = async () => {
    showError("");
    showMessage("");

    const dateFound = String(dateEl?.value || "").trim();
    const timeFound = String(timeEl?.value || "").trim();
    const selectedBus = fleet.find((bus) => String(bus.id) === String(busEl?.value || ""));
    const foundLocation = String(locationEl?.value || "").trim();
    const description = String(descriptionEl?.value || "").trim();
    const photoFiles = Array.from(photosEl?.files || []);

    if (!dateFound) return showMessage("Please select the date found.");
    if (dateFound > localDateString()) return showMessage("Date found cannot be in the future.");
    if (!timeFound) return showMessage("Please enter the time found.");
    if (!selectedBus) return showMessage("Please select the bus.");
    if (!foundLocation) return showMessage("Please enter where the item was found.");
    if (!description) return showMessage("Please describe the item.");
    const photoError = validatePhotos(photoFiles);
    if (photoError) return showMessage(photoError);

    const reportRef = doc(collection(db, "lostPropertyReports"));
    const reportNumber = `LP-${dateFound.replaceAll("-", "")}-${reportRef.id.slice(0, 6).toUpperCase()}`;
    const uploadedRefs = [];

    submitBtn.disabled = true;
    submitBtn.textContent = photoFiles.length ? "Uploading photos…" : "Submitting…";

    try {
      const photos = [];
      for (let index = 0; index < photoFiles.length; index += 1) {
        const file = photoFiles[index];
        submitBtn.textContent = `Uploading photo ${index + 1} of ${photoFiles.length}…`;
        const storagePath = `lost-property/${reportRef.id}/${Date.now()}-${index + 1}-${safeFileName(file.name)}`;
        const photoRef = ref(storage, storagePath);
        uploadedRefs.push(photoRef);
        await uploadBytes(photoRef, file, { contentType: file.type });
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
        status: "Submitted",
        dateFound,
        timeFound,
        foundLocation,
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

      showMessage(`${reportNumber} submitted successfully.`, "success");
      if (locationEl) locationEl.value = "";
      if (descriptionEl) descriptionEl.value = "";
      if (photosEl) photosEl.value = "";
      if (photoHelpEl) photoHelpEl.textContent = "Choose up to 3 images · maximum 8 MB each";
      renderPhotoPreview([]);
      messageEl?.scrollIntoView({ behavior: "smooth", block: "center" });
    } catch (error) {
      console.error("Failed to submit lost property report", error);
      await Promise.allSettled(uploadedRefs.map((photoRef) => deleteObject(photoRef)));
      showMessage(error?.message || "Failed to submit the report. Please try again.");
    } finally {
      submitBtn.disabled = false;
      submitBtn.innerHTML = `<i data-lucide="send"></i><span>Submit Lost Property Report</span>`;
      window.lucide?.createIcons?.();
    }
  };
}
