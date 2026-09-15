import {
  collection,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc
} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-functions.js";

import { auth, db, functions } from "./firebase.js";
import { els, showError } from "./ui.js";
import { escapeHtml } from "./utils.js";

const SETTINGS_PATH = "systemSettings/defectNotifications";

function employeeName(employee) {
  return String(
    employee.displayName ||
    employee.name ||
    `${employee.firstName || ""} ${employee.lastName || ""}`.trim() ||
    employee.employeeNumber ||
    employee.id
  ).trim();
}

function employeeOption(employee, group, selectedIds) {
  const id = String(employee.id || employee.employeeNumber || "");
  const tokenReady = Boolean(String(employee.fcmToken || "").trim());
  const emailReady = String(employee.email || "").includes("@");
  const detail = [employee.role, employee.department, employee.accessLevel]
    .filter(Boolean)
    .join(" · ");

  return `
    <label class="settings-recipient-option">
      <input
        type="checkbox"
        data-defect-recipient="${group}"
        value="${escapeHtml(id)}"
        ${selectedIds.includes(id) ? "checked" : ""}
      />
      <span class="settings-recipient-copy">
        <strong>${escapeHtml(employeeName(employee))}</strong>
        <small>${escapeHtml(id)}${detail ? ` · ${escapeHtml(detail)}` : ""}</small>
      </span>
      <span class="settings-recipient-statuses">
        <span class="settings-token-status ${tokenReady ? "ready" : "missing"}">
          ${tokenReady ? "Push ready" : "No push device"}
        </span>
        <span class="settings-token-status ${emailReady ? "ready" : "missing"}">
          ${emailReady ? "Email ready" : "No email"}
        </span>
      </span>
    </label>
  `;
}

export async function renderSettingsPage() {
  showError("");

  els.contentArea.innerHTML = `
    <div class="settings-page">
      <header class="settings-hero">
        <div>
          <div class="defect-eyebrow">Administration</div>
          <h2>Settings</h2>
          <p>Manage operational notification recipients and routing.</p>
        </div>
        <button id="enableSettingsAlerts" type="button" class="btn">
          Enable alerts on this device
        </button>
      </header>

      <section class="card settings-panel">
        <div class="settings-panel-heading">
          <div class="settings-heading-icon"><i data-lucide="bell-ring"></i></div>
          <div>
            <h3>Defect Notification Settings</h3>
            <p>Select who receives safe and unsafe vehicle defect alerts.</p>
          </div>
          <label class="settings-master-toggle">
            <input id="defectNotificationsEnabled" type="checkbox" checked />
            <span>Notifications enabled</span>
          </label>
        </div>

        <div class="settings-routing-grid">
          <label class="settings-route-option">
            <input id="notifyOccSafe" type="checkbox" checked />
            <span><strong>Safe-to-drive reports</strong><small>Notify OCC / Operations</small></span>
          </label>
          <label class="settings-route-option">
            <input id="notifyOccUnsafe" type="checkbox" checked />
            <span><strong>Unsafe-to-drive reports</strong><small>Notify OCC / Operations</small></span>
          </label>
          <label class="settings-route-option critical">
            <input id="notifySupervisorsUnsafe" type="checkbox" checked />
            <span><strong>Critical unsafe reports</strong><small>Notify Supervisors</small></span>
          </label>
          <label class="settings-route-option">
            <input id="defectEmailsEnabled" type="checkbox" />
            <span><strong>Email notifications</strong><small>Send through Microsoft 365</small></span>
          </label>
        </div>

        <div class="settings-recipient-grid">
          <section>
            <div class="settings-recipient-heading">
              <div><h4>OCC / Operations recipients</h4><p>Receive alerts based on OCC routing above.</p></div>
              <span id="occRecipientCount">0 selected</span>
            </div>
            <div id="occRecipientList" class="settings-recipient-list">
              <div class="defect-empty-state">Loading employees…</div>
            </div>
          </section>

          <section>
            <div class="settings-recipient-heading">
              <div><h4>Supervisor recipients</h4><p>Receive critical unsafe-vehicle alerts.</p></div>
              <span id="supervisorRecipientCount">0 selected</span>
            </div>
            <div id="supervisorRecipientList" class="settings-recipient-list">
              <div class="defect-empty-state">Loading employees…</div>
            </div>
          </section>
        </div>

        <div class="settings-save-row">
          <div>
            <div id="settingsLastUpdated" class="muted"></div>
            <div id="settingsSaveMessage" class="settings-save-message"></div>
          </div>
          <button id="saveDefectNotificationSettings" type="button">Save notification settings</button>
        </div>
      </section>

      <section class="card settings-panel settings-broadcast-panel">
        <div class="settings-panel-heading">
          <div class="settings-heading-icon"><i data-lucide="send"></i></div>
          <div>
            <h3>Send General Push Notification</h3>
            <p>Send an operational message to all active portal users with notifications enabled.</p>
          </div>
          <span class="settings-audience-badge">All active users</span>
        </div>

        <div class="settings-broadcast-form">
          <label>
            <span>Notification title <strong>*</strong></span>
            <input id="generalPushTitle" type="text" maxlength="60" placeholder="Example: Important operations update" />
            <small><span id="generalPushTitleCount">0</span>/60 characters</small>
          </label>

          <label>
            <span>Message <strong>*</strong></span>
            <textarea id="generalPushMessage" maxlength="240" rows="4" placeholder="Enter the message drivers and staff should receive."></textarea>
            <small><span id="generalPushMessageCount">0</span>/240 characters</small>
          </label>
        </div>

        <div class="settings-broadcast-note">
          <i data-lucide="info"></i>
          <span>Users must have allowed notifications on at least one device to receive this message.</span>
        </div>

        <div class="settings-save-row">
          <div id="generalPushResult" class="settings-save-message" role="status" aria-live="polite"></div>
          <button id="sendGeneralPush" type="button">Review and send</button>
        </div>
      </section>

      <div id="generalPushReviewModal" class="settings-review-layer" hidden>
        <section
          class="settings-review-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="generalPushReviewHeading"
          aria-describedby="generalPushReviewWarning"
          tabindex="-1"
        >
          <header class="settings-review-header">
            <div class="settings-review-icon"><i data-lucide="bell-ring"></i></div>
            <div>
              <div class="defect-eyebrow">Final confirmation</div>
              <h3 id="generalPushReviewHeading">Review push notification</h3>
              <p>Check the audience and message before sending.</p>
            </div>
            <button id="cancelGeneralPushTop" class="settings-review-close" type="button" aria-label="Close review">
              <i data-lucide="x"></i>
            </button>
          </header>

          <div class="settings-review-body">
            <dl class="settings-review-meta">
              <div><dt>Audience</dt><dd>All active portal users</dd></div>
              <div><dt>Delivery</dt><dd>Push notification</dd></div>
              <div><dt>Sender</dt><dd id="generalPushReviewSender">Portal administrator</dd></div>
            </dl>

            <div class="settings-phone-preview" aria-label="Notification preview">
              <div class="settings-phone-preview-brand">
                <span class="settings-phone-preview-logo">PB</span>
                <strong>Punchbowl Driver Portal</strong>
                <span>now</span>
              </div>
              <h4 id="generalPushReviewTitle"></h4>
              <p id="generalPushReviewMessage"></p>
            </div>

            <div id="generalPushReviewWarning" class="settings-review-warning">
              <i data-lucide="triangle-alert"></i>
              <span>This message will be sent immediately and cannot be recalled. Only registered devices with notifications enabled will receive it.</span>
            </div>
          </div>

          <footer class="settings-review-actions">
            <button id="cancelGeneralPush" class="btn settings-review-cancel" type="button">Cancel</button>
            <button id="confirmGeneralPush" type="button">
              <i data-lucide="send"></i>
              Send notification
            </button>
          </footer>
        </section>
      </div>
    </div>
  `;

  window.lucide?.createIcons?.();

  const enabledEl = document.getElementById("defectNotificationsEnabled");
  const occSafeEl = document.getElementById("notifyOccSafe");
  const occUnsafeEl = document.getElementById("notifyOccUnsafe");
  const supervisorsUnsafeEl = document.getElementById("notifySupervisorsUnsafe");
  const emailsEnabledEl = document.getElementById("defectEmailsEnabled");
  const occListEl = document.getElementById("occRecipientList");
  const supervisorListEl = document.getElementById("supervisorRecipientList");
  const saveBtn = document.getElementById("saveDefectNotificationSettings");
  const messageEl = document.getElementById("settingsSaveMessage");
  const lastUpdatedEl = document.getElementById("settingsLastUpdated");
  const enableAlertsBtn = document.getElementById("enableSettingsAlerts");
  const generalTitleEl = document.getElementById("generalPushTitle");
  const generalMessageEl = document.getElementById("generalPushMessage");
  const generalTitleCountEl = document.getElementById("generalPushTitleCount");
  const generalMessageCountEl = document.getElementById("generalPushMessageCount");
  const generalSendBtn = document.getElementById("sendGeneralPush");
  const generalResultEl = document.getElementById("generalPushResult");
  const generalReviewModal = document.getElementById("generalPushReviewModal");
  const generalReviewDialog = generalReviewModal?.querySelector(".settings-review-dialog");
  const generalReviewTitle = document.getElementById("generalPushReviewTitle");
  const generalReviewMessage = document.getElementById("generalPushReviewMessage");
  const generalReviewSender = document.getElementById("generalPushReviewSender");
  const generalCancelBtn = document.getElementById("cancelGeneralPush");
  const generalCancelTopBtn = document.getElementById("cancelGeneralPushTop");
  const generalConfirmBtn = document.getElementById("confirmGeneralPush");

  let employees = [];
  let settings = {};
  let generalPushSending = false;
  let pendingGeneralPush = null;

  function updateGeneralPushCounts() {
    if (generalTitleCountEl) generalTitleCountEl.textContent = String(generalTitleEl?.value.length || 0);
    if (generalMessageCountEl) generalMessageCountEl.textContent = String(generalMessageEl?.value.length || 0);
  }

  generalTitleEl?.addEventListener("input", updateGeneralPushCounts);
  generalMessageEl?.addEventListener("input", updateGeneralPushCounts);

  function closeGeneralPushReview() {
    if (!generalReviewModal || generalPushSending) return;
    generalReviewModal.hidden = true;
    pendingGeneralPush = null;
    generalSendBtn?.focus();
  }

  function openGeneralPushReview(title, message) {
    if (!generalReviewModal) return;
    pendingGeneralPush = { title, message };
    if (generalReviewTitle) generalReviewTitle.textContent = title;
    if (generalReviewMessage) generalReviewMessage.textContent = message;
    if (generalReviewSender) {
      generalReviewSender.textContent =
        auth.currentUser?.displayName || auth.currentUser?.email || "Portal administrator";
    }
    generalReviewModal.hidden = false;
    generalReviewDialog?.focus();
  }

  generalCancelBtn?.addEventListener("click", closeGeneralPushReview);
  generalCancelTopBtn?.addEventListener("click", closeGeneralPushReview);
  generalReviewModal?.addEventListener("click", (event) => {
    if (event.target === generalReviewModal) closeGeneralPushReview();
  });
  generalReviewDialog?.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeGeneralPushReview();
  });

  generalSendBtn?.addEventListener("click", () => {
    if (generalPushSending) return;

    const title = String(generalTitleEl?.value || "").trim();
    const message = String(generalMessageEl?.value || "").trim();

    if (!title || !message) {
      if (generalResultEl) {
        generalResultEl.textContent = "Enter both a notification title and message.";
        generalResultEl.className = "settings-save-message error";
      }
      (!title ? generalTitleEl : generalMessageEl)?.focus();
      return;
    }

    if (generalResultEl) {
      generalResultEl.textContent = "";
      generalResultEl.className = "settings-save-message";
    }
    openGeneralPushReview(title, message);
  });

  generalConfirmBtn?.addEventListener("click", async () => {
    if (generalPushSending || !pendingGeneralPush) return;

    const { title, message } = pendingGeneralPush;

    generalPushSending = true;
    generalSendBtn.disabled = true;
    generalSendBtn.textContent = "Sending…";
    generalConfirmBtn.disabled = true;
    generalConfirmBtn.textContent = "Sending…";
    generalCancelBtn.disabled = true;
    generalCancelTopBtn.disabled = true;
    if (generalResultEl) {
      generalResultEl.textContent = "Sending notification. Please wait…";
      generalResultEl.className = "settings-save-message";
    }

    try {
      const sendGeneralNotification = httpsCallable(functions, "sendGeneralPushNotification");
      const response = await sendGeneralNotification({ title, message });
      const result = response.data || {};

      if (generalResultEl) {
        generalResultEl.textContent =
          `Notification sent to ${result.successCount || 0} device${result.successCount === 1 ? "" : "s"}. ` +
          `${result.noDeviceCount || 0} active user${result.noDeviceCount === 1 ? " has" : "s have"} no registered device` +
          `${result.failureCount ? `; ${result.failureCount} delivery failed` : ""}.`;
        generalResultEl.className = "settings-save-message success";
      }

      generalTitleEl.value = "";
      generalMessageEl.value = "";
      updateGeneralPushCounts();
      generalReviewModal.hidden = true;
      pendingGeneralPush = null;
    } catch (error) {
      console.error("General push notification failed", error);
      if (generalResultEl) {
        generalResultEl.textContent = error?.message || "Unable to send the notification.";
        generalResultEl.className = "settings-save-message error";
      }
    } finally {
      generalPushSending = false;
      generalSendBtn.disabled = false;
      generalSendBtn.textContent = "Review and send";
      generalConfirmBtn.disabled = false;
      generalConfirmBtn.innerHTML = '<i data-lucide="send"></i> Send notification';
      generalCancelBtn.disabled = false;
      generalCancelTopBtn.disabled = false;
      window.lucide?.createIcons?.();
    }
  });

  function selectedIds(group) {
    return [...document.querySelectorAll(`[data-defect-recipient="${group}"]:checked`)]
      .map((input) => input.value);
  }

  function updateCounts() {
    const occCountEl = document.getElementById("occRecipientCount");
    const supervisorCountEl = document.getElementById("supervisorRecipientCount");
    if (occCountEl) occCountEl.textContent = `${selectedIds("occ").length} selected`;
    if (supervisorCountEl) supervisorCountEl.textContent = `${selectedIds("supervisor").length} selected`;
  }

  function renderRecipients() {
    const occIds = Array.isArray(settings.occRecipientIds) ? settings.occRecipientIds.map(String) : [];
    const supervisorIds = Array.isArray(settings.supervisorRecipientIds) ? settings.supervisorRecipientIds.map(String) : [];

    if (occListEl) {
      occListEl.innerHTML = employees.length ?
        employees.map((employee) => employeeOption(employee, "occ", occIds)).join("") :
        `<div class="defect-empty-state">No active employees found.</div>`;
    }
    if (supervisorListEl) {
      supervisorListEl.innerHTML = employees.length ?
        employees.map((employee) => employeeOption(employee, "supervisor", supervisorIds)).join("") :
        `<div class="defect-empty-state">No active employees found.</div>`;
    }

    document.querySelectorAll("[data-defect-recipient]").forEach((input) => {
      input.addEventListener("change", updateCounts);
    });
    updateCounts();
  }

  try {
    const [employeeSnapshot, settingsSnapshot] = await Promise.all([
      getDocs(collection(db, "employees")),
      getDoc(doc(db, SETTINGS_PATH))
    ]);

    employees = employeeSnapshot.docs
      .map((item) => ({ id: item.id, ...item.data() }))
      .filter((employee) => String(employee.status || "").trim().toLowerCase() === "active")
      .sort((a, b) => employeeName(a).localeCompare(employeeName(b)));

    settings = settingsSnapshot.exists() ? settingsSnapshot.data() : {};
    if (enabledEl) enabledEl.checked = settings.enabled !== false;
    if (occSafeEl) occSafeEl.checked = settings.notifyOccForSafe !== false;
    if (occUnsafeEl) occUnsafeEl.checked = settings.notifyOccForUnsafe !== false;
    if (supervisorsUnsafeEl) supervisorsUnsafeEl.checked = settings.notifySupervisorsForUnsafe !== false;
    if (emailsEnabledEl) emailsEnabledEl.checked = settings.emailEnabled === true;
    if (lastUpdatedEl && settings.updatedByEmail) {
      lastUpdatedEl.textContent = `Last updated by ${settings.updatedByEmail}`;
    }

    renderRecipients();
  } catch (error) {
    console.error("Failed to load notification settings", error);
    if (messageEl) messageEl.textContent = error?.message || "Unable to load notification settings.";
  }

  enableAlertsBtn?.addEventListener("click", async () => {
    enableAlertsBtn.disabled = true;
    try {
      await window.enablePortalNotifications?.();
      enableAlertsBtn.textContent = window.Notification?.permission === "granted" ?
        "Alerts enabled on this device" : "Alerts not enabled";
    } finally {
      enableAlertsBtn.disabled = false;
    }
  });

  saveBtn?.addEventListener("click", async () => {
    if (messageEl) {
      messageEl.textContent = "";
      messageEl.className = "settings-save-message";
    }

    const occRecipientIds = selectedIds("occ");
    const supervisorRecipientIds = selectedIds("supervisor");

    if (enabledEl?.checked && !occRecipientIds.length && !supervisorRecipientIds.length) {
      if (messageEl) messageEl.textContent = "Select at least one notification recipient.";
      return;
    }

    saveBtn.disabled = true;
    saveBtn.textContent = "Saving…";

    try {
      await setDoc(doc(db, SETTINGS_PATH), {
        enabled: Boolean(enabledEl?.checked),
        notifyOccForSafe: Boolean(occSafeEl?.checked),
        notifyOccForUnsafe: Boolean(occUnsafeEl?.checked),
        notifySupervisorsForUnsafe: Boolean(supervisorsUnsafeEl?.checked),
        emailEnabled: Boolean(emailsEnabledEl?.checked),
        occRecipientIds,
        supervisorRecipientIds,
        updatedAt: serverTimestamp(),
        updatedByUid: auth.currentUser?.uid || "",
        updatedByEmail: auth.currentUser?.email || ""
      }, { merge: true });

      if (messageEl) {
        messageEl.textContent = "Defect notification settings saved.";
        messageEl.className = "settings-save-message success";
      }
      if (lastUpdatedEl) lastUpdatedEl.textContent = `Last updated by ${auth.currentUser?.email || "current user"}`;
    } catch (error) {
      console.error("Failed to save notification settings", error);
      if (messageEl) messageEl.textContent = error?.message || "Unable to save notification settings.";
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = "Save notification settings";
    }
  });
}
