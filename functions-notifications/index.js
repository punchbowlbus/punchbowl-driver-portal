/**
 * Punchbowl Driver Portal — isolated push-notification Cloud Functions.
 * This codebase intentionally has no Charter/Brevo dependencies or parameters.
 */
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const admin = require("firebase-admin");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { getMessaging } = require("firebase-admin/messaging");

admin.initializeApp();
const db = getFirestore();

const PORTAL_ADMIN_EMAILS = new Set([
  "info@punchbowlbus.com",
  "nalin.rajapaksha82@gmail.com",
  "nalin@punchbowlbus.com.au",
  "christine@punchbowlbus.com.au"
]);

function normalized(value) {
  return String(value || "").trim().toLowerCase();
}

async function requirePortalAdmin(request) {
  if (!request.auth?.uid) {
    throw new HttpsError("unauthenticated", "Please sign in before sending notifications.");
  }

  const email = normalized(request.auth.token?.email);
  if (!email || request.auth.token?.email_verified !== true) {
    throw new HttpsError("permission-denied", "A verified portal administrator account is required.");
  }

  if (PORTAL_ADMIN_EMAILS.has(email)) return email;

  const employeeSnap = await db.collection("employees")
    .where("email", "==", email)
    .limit(1)
    .get();
  const employee = employeeSnap.empty ? {} : employeeSnap.docs[0].data() || {};
  const accessLevel = normalized(employee.accessLevel);
  const role = normalized(employee.role);
  const active = normalized(employee.status) === "active";

  if (!active || (role !== "admin" && !accessLevel.includes("admin"))) {
    throw new HttpsError("permission-denied", "Only active portal administrators can send notifications.");
  }

  return email;
}

exports.registerPortalAdminNotificationDevice = onCall({
  region: "australia-southeast1",
  maxInstances: 10
}, async (request) => {
  const email = await requirePortalAdmin(request);
  const token = String(request.data?.token || "").trim();
  if (!token || token.length > 4096) {
    throw new HttpsError("invalid-argument", "A valid notification device token is required.");
  }

  const displayName = String(
    request.auth.token?.name || request.data?.displayName || email
  ).trim().slice(0, 120);
  const recipient = {
    id: `portalAdmin:${request.auth.uid}`,
    displayName,
    email,
    role: "Portal Super Admin",
    accessLevel: "Super Admin",
    status: "Active",
    pushReady: true
  };

  await db.collection("portalNotificationUsers").doc(request.auth.uid).set({
    displayName,
    email,
    role: "Portal Super Admin",
    accessLevel: "Super Admin",
    status: "Active",
    fcmToken: token,
    fcmTokenUpdatedAt: FieldValue.serverTimestamp(),
    updatedByUid: request.auth.uid
  }, { merge: true });

  return { registered: true, recipient };
});

exports.getPortalAdminNotificationRecipients = onCall({
  region: "australia-southeast1",
  maxInstances: 10
}, async (request) => {
  await requirePortalAdmin(request);
  const snapshot = await db.collection("portalNotificationUsers").get();
  const recipients = snapshot.docs
    .map((recipientDoc) => ({ id: recipientDoc.id, ...recipientDoc.data() }))
    .filter((recipient) => normalized(recipient.status) === "active")
    .map((recipient) => ({
      id: `portalAdmin:${recipient.id}`,
      displayName: String(recipient.displayName || recipient.email || "Portal administrator"),
      email: String(recipient.email || ""),
      role: "Portal Super Admin",
      accessLevel: "Super Admin",
      status: "Active",
      pushReady: Boolean(String(recipient.fcmToken || "").trim())
    }));

  return { recipients };
});

exports.sendGeneralPushNotification = onCall({
  region: "australia-southeast1",
  maxInstances: 10
}, async (request) => {
  const sentByEmail = await requirePortalAdmin(request);
  const title = String(request.data?.title || "").trim();
  const message = String(request.data?.message || "").trim();

  if (!title || !message) {
    throw new HttpsError("invalid-argument", "A title and message are required.");
  }
  if (title.length > 60 || message.length > 240) {
    throw new HttpsError("invalid-argument", "The notification title or message is too long.");
  }

  // Local UI testing must never read production recipients or send real pushes.
  if (process.env.FUNCTIONS_EMULATOR === "true") {
    console.log("General push notification emulator dry run", {
      sentByEmail,
      titleLength: title.length,
      messageLength: message.length
    });
    return {
      notificationId: "emulator-dry-run",
      successCount: 0,
      failureCount: 0,
      noDeviceCount: 0,
      dryRun: true
    };
  }

  const employeeSnap = await db.collection("employees").get();
  const activeEmployees = employeeSnap.docs
    .map((employeeDoc) => ({ id: employeeDoc.id, ...employeeDoc.data() }))
    .filter((employee) => normalized(employee.status) === "active");
  const tokens = [...new Set(activeEmployees
    .map((employee) => String(employee.fcmToken || "").trim())
    .filter(Boolean))];
  const noDeviceCount = activeEmployees.filter(
    (employee) => !String(employee.fcmToken || "").trim()
  ).length;

  let successCount = 0;
  let failureCount = 0;
  const failureCodes = [];

  for (let start = 0; start < tokens.length; start += 500) {
    const tokenBatch = tokens.slice(start, start + 500);
    const response = await getMessaging().sendEachForMulticast({
      tokens: tokenBatch,
      data: { type: "generalNotification" },
      webpush: {
        notification: {
          title,
          body: message,
          icon: "https://punchbowl-driver-portal.web.app/icons/icon-192.png",
          badge: "https://punchbowl-driver-portal.web.app/icons/icon-192.png",
          requireInteraction: true,
          tag: `general-${Date.now()}`
        },
        fcmOptions: { link: "https://punchbowl-driver-portal.web.app" }
      }
    });

    successCount += response.successCount;
    failureCount += response.failureCount;
    response.responses.forEach((result) => {
      if (!result.success) failureCodes.push(result.error?.code || "unknown");
    });
  }

  const logRef = await db.collection("generalNotifications").add({
    title,
    message,
    audience: "allActiveUsers",
    activeUserCount: activeEmployees.length,
    tokenCount: tokens.length,
    noDeviceCount,
    successCount,
    failureCount,
    failureCodes: [...new Set(failureCodes)],
    sentByUid: request.auth.uid,
    sentByEmail,
    sentAt: FieldValue.serverTimestamp()
  });

  console.log("General push notification completed", {
    notificationId: logRef.id,
    sentByEmail,
    successCount,
    failureCount,
    noDeviceCount
  });

  return { notificationId: logRef.id, successCount, failureCount, noDeviceCount };
});

/* =========================================================
   Driver defect alerts — Firestore trigger
========================================================= */
exports.notifyOnDefectReportCreated = onDocumentCreated({
  document: "defectReports/{reportId}",
  region: "australia-southeast1",
  maxInstances: 10,
  retry: false
}, async (event) => {
  const reportSnapshot = event.data;
  if (!reportSnapshot?.exists) return;

  const report = reportSnapshot.data() || {};
  if (report.deleted === true) return;

  const settingsSnapshot = await db.doc("systemSettings/defectNotifications").get();
  if (!settingsSnapshot.exists) {
    console.log("Defect notification skipped: settings are not configured", {
      reportId: event.params.reportId
    });
    return;
  }

  const settings = settingsSnapshot.data() || {};
  if (settings.enabled === false) {
    console.log("Defect notification skipped: notifications are disabled", {
      reportId: event.params.reportId
    });
    return;
  }

  const unsafe = normalized(report.safeToDrive) === "no";
  const recipientIds = new Set();

  if (unsafe && settings.notifyOccForUnsafe !== false) {
    (settings.occRecipientIds || []).forEach((id) => recipientIds.add(String(id)));
  }
  if (!unsafe && settings.notifyOccForSafe !== false) {
    (settings.occRecipientIds || []).forEach((id) => recipientIds.add(String(id)));
  }
  if (unsafe && settings.notifySupervisorsForUnsafe !== false) {
    (settings.supervisorRecipientIds || []).forEach((id) => recipientIds.add(String(id)));
  }

  const selectedIds = [...recipientIds].filter(Boolean);
  if (!selectedIds.length) {
    console.log("Defect notification skipped: no recipients selected for this route", {
      reportId: event.params.reportId,
      unsafe
    });
    return;
  }

  const employeeIds = selectedIds.filter((id) => !id.startsWith("portalAdmin:"));
  const portalAdminIds = selectedIds
    .filter((id) => id.startsWith("portalAdmin:"))
    .map((id) => id.slice("portalAdmin:".length));
  const employeeSnapshots = employeeIds.length ? await db.getAll(
    ...employeeIds.map((id) => db.collection("employees").doc(id))
  ) : [];
  const portalAdminSnapshots = portalAdminIds.length ? await db.getAll(
    ...portalAdminIds.map((id) => db.collection("portalNotificationUsers").doc(id))
  ) : [];
  const activeEmployeeRecipients = employeeSnapshots
    .filter((snapshot) => snapshot.exists)
    .map((snapshot) => ({ id: snapshot.id, ...snapshot.data() }))
    .filter((employee) => normalized(employee.status) === "active");
  const activePortalAdminRecipients = portalAdminSnapshots
    .filter((snapshot) => snapshot.exists)
    .map((snapshot) => ({ id: `portalAdmin:${snapshot.id}`, ...snapshot.data() }))
    .filter((recipient) => normalized(recipient.status) === "active");
  const activeRecipients = [...activeEmployeeRecipients, ...activePortalAdminRecipients];
  const tokens = [...new Set(activeRecipients
    .map((employee) => String(employee.fcmToken || "").trim())
    .filter(Boolean))];
  const noDeviceCount = activeRecipients.filter(
    (employee) => !String(employee.fcmToken || "").trim()
  ).length;

  const reportNumber = String(report.reportNumber || event.params.reportId);
  const fleetNumber = String(report.fleetNumber || report.busNumber || "Unknown bus");
  const rego = String(report.rego || "").trim();
  const category = String(report.category || "Vehicle defect");
  const description = String(report.description || "No description supplied").trim();
  const reporter = String(report.reportedByName || "Driver");
  const busLabel = rego ? `Bus ${fleetNumber} (${rego})` : `Bus ${fleetNumber}`;
  const title = unsafe ? `UNSAFE VEHICLE — ${busLabel}` : `New vehicle defect — ${busLabel}`;
  const body = `${category}: ${description} • Reported by ${reporter} • ${reportNumber}`.slice(0, 240);

  let successCount = 0;
  let failureCount = 0;
  const failureCodes = [];

  for (let start = 0; start < tokens.length; start += 500) {
    const response = await getMessaging().sendEachForMulticast({
      tokens: tokens.slice(start, start + 500),
      data: {
        type: "driverDefect",
        reportId: String(event.params.reportId),
        reportNumber,
        safeToDrive: unsafe ? "No" : "Yes"
      },
      webpush: {
        notification: {
          title,
          body,
          icon: "https://punchbowl-driver-portal.web.app/icons/icon-192.png",
          badge: "https://punchbowl-driver-portal.web.app/icons/icon-192.png",
          requireInteraction: unsafe,
          tag: `defect-${event.params.reportId}`
        },
        fcmOptions: {
          link: `https://punchbowl-driver-portal.web.app/?page=defectReport&reportId=${encodeURIComponent(event.params.reportId)}`
        }
      }
    });

    successCount += response.successCount;
    failureCount += response.failureCount;
    response.responses.forEach((result) => {
      if (!result.success) failureCodes.push(result.error?.code || "unknown");
    });
  }

  await db.collection("defectNotificationDeliveries").doc(event.params.reportId).set({
    reportId: event.params.reportId,
    reportNumber,
    unsafe,
    recipientIds: selectedIds,
    activeRecipientCount: activeRecipients.length,
    tokenCount: tokens.length,
    noDeviceCount,
    successCount,
    failureCount,
    failureCodes: [...new Set(failureCodes)],
    emailRequested: settings.emailEnabled === true,
    emailSent: false,
    createdAt: FieldValue.serverTimestamp()
  }, { merge: true });

  console.log("Defect notification completed", {
    reportId: event.params.reportId,
    unsafe,
    successCount,
    failureCount,
    noDeviceCount
  });
});
