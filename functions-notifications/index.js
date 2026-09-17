/**
 * Punchbowl Driver Portal — isolated push-notification Cloud Functions.
 * This codebase intentionally has no Charter/Brevo dependencies or parameters.
 */
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onDocumentCreated, onDocumentWritten } = require("firebase-functions/v2/firestore");
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
   Driver duty alerts — Firestore trigger
========================================================= */
function normalizedDutyStatus(value) {
  const status = normalized(value);
  if (status === "assigned") return "assigned";
  if (status === "cancelled" || status === "canceled") return "cancelled";
  return "pending";
}

function formatDutyTime(value) {
  const minutes = Number(value);
  if (!Number.isFinite(minutes)) return "--:--";
  const safeMinutes = Math.max(0, Math.round(minutes));
  return `${String(Math.floor(safeMinutes / 60)).padStart(2, "0")}:${String(safeMinutes % 60).padStart(2, "0")}`;
}

function formatDutyDate(value) {
  const raw = String(value || "").trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!match) return raw || "date not provided";
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return new Intl.DateTimeFormat("en-AU", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Australia/Sydney"
  }).format(date);
}

function dutySummary(duty) {
  const dutyNumber = String(duty.dutyNumber || "").trim();
  const dutyType = String(duty.dutyType || "Duty").trim();
  const date = formatDutyDate(duty.serviceDate || duty.date);
  const times = `${formatDutyTime(duty.startMin)}–${formatDutyTime(duty.endMin)}`;
  const bus = String(duty.assignedBus || "").trim();
  return `${dutyNumber ? `Duty ${dutyNumber}` : dutyType} • ${date} • ${times}${bus ? ` • Bus ${bus}` : ""}`.slice(0, 240);
}

function dutyChanged(before, after) {
  const relevantFields = [
    "serviceDate", "date", "startMin", "endMin", "assignedBus", "dutyNumber",
    "dutyType", "startLocation", "endLocation", "routeNumber", "routePdfUrl", "breaks"
  ];
  return relevantFields.some((field) =>
    JSON.stringify(before?.[field] ?? null) !== JSON.stringify(after?.[field] ?? null)
  );
}

function classifyDutyNotifications(before, after) {
  const notifications = [];
  const beforeDriver = String(before?.driverEmployeeNumber || "").trim();
  const afterDriver = String(after?.driverEmployeeNumber || "").trim();
  const beforeStatus = normalizedDutyStatus(before?.dispatchStatus);
  const afterStatus = normalizedDutyStatus(after?.dispatchStatus);

  if (!after) {
    if (beforeDriver && beforeStatus === "assigned") {
      notifications.push({
        employeeNumber: beforeDriver,
        eventType: "removed",
        title: "Duty removed",
        body: "This duty has been removed from your work.",
        linkToDuty: false
      });
    }
    return notifications;
  }

  const driverChanged = Boolean(beforeDriver && beforeDriver !== afterDriver);
  const removed = before?.deleted !== true && after?.deleted === true;

  if (driverChanged && beforeStatus === "assigned") {
    notifications.push({
      employeeNumber: beforeDriver,
      eventType: "reassigned-away",
      title: "Duty reassigned",
      body: "This duty has been removed from your work.",
      linkToDuty: false
    });
  }

  if (!afterDriver) return notifications;

  if (removed && beforeStatus === "assigned") {
    notifications.push({
      employeeNumber: afterDriver,
      eventType: "removed",
      title: "Duty removed",
      body: "This duty has been removed from your work.",
      linkToDuty: false
    });
    return notifications;
  }

  if (afterStatus === "cancelled" && beforeStatus !== "cancelled") {
    notifications.push({
      employeeNumber: afterDriver,
      eventType: "cancelled",
      title: "Duty cancelled",
      body: dutySummary(after),
      linkToDuty: true
    });
    return notifications;
  }

  if (afterStatus !== "assigned") {
    if (beforeStatus === "assigned" && !driverChanged) {
      notifications.push({
        employeeNumber: afterDriver,
        eventType: "withdrawn",
        title: "Duty returned to pending",
        body: "This duty is no longer confirmed in your work.",
        linkToDuty: false
      });
    }
    return notifications;
  }

  if (!before || beforeStatus !== "assigned" || driverChanged) {
    notifications.push({
      employeeNumber: afterDriver,
      eventType: driverChanged ? "reassigned-to" : "assigned",
      title: "New duty assigned",
      body: dutySummary(after),
      linkToDuty: true
    });
    return notifications;
  }

  if (dutyChanged(before, after)) {
    notifications.push({
      employeeNumber: afterDriver,
      eventType: "updated",
      title: "Duty updated",
      body: dutySummary(after),
      linkToDuty: true
    });
  }

  return notifications;
}

async function sendDutyNotification({ dutySpanId, duty, notification }) {
  const employeeNumber = String(notification.employeeNumber || "").trim();
  if (!employeeNumber) return { status: "skipped", reason: "no-employee-number" };

  const employeeRef = db.collection("employees").doc(employeeNumber);
  const employeeSnapshot = await employeeRef.get();
  if (!employeeSnapshot.exists) return { status: "skipped", reason: "employee-not-found", employeeNumber };

  const employee = employeeSnapshot.data() || {};
  if (normalized(employee.status) !== "active") {
    return { status: "skipped", reason: "employee-inactive", employeeNumber };
  }

  const token = String(employee.fcmToken || "").trim();
  if (!token) return { status: "skipped", reason: "no-device", employeeNumber };

  const dutyLink = `https://punchbowl-driver-portal.web.app/?page=dutySheet&dutySpanId=${encodeURIComponent(dutySpanId)}`;
  const myWorkLink = "https://punchbowl-driver-portal.web.app/?page=myWork";
  const link = notification.linkToDuty ? dutyLink : myWorkLink;

  try {
    const messageId = await getMessaging().send({
      token,
      data: {
        type: "driverDuty",
        eventType: notification.eventType,
        dutySpanId: String(dutySpanId),
        serviceDate: String(duty?.serviceDate || duty?.date || ""),
        link
      },
      webpush: {
        notification: {
          title: notification.title,
          body: notification.body,
          icon: "https://punchbowl-driver-portal.web.app/icons/icon-192.png",
          badge: "https://punchbowl-driver-portal.web.app/icons/icon-192.png",
          requireInteraction: notification.eventType === "cancelled",
          tag: `duty-${dutySpanId}-${notification.eventType}`
        },
        fcmOptions: { link }
      }
    });
    return { status: "sent", employeeNumber, messageId };
  } catch (error) {
    const errorCode = String(error?.code || "unknown");
    if (
      errorCode === "messaging/registration-token-not-registered" ||
      errorCode === "messaging/invalid-registration-token"
    ) {
      await employeeRef.set({
        fcmToken: FieldValue.delete(),
        fcmTokenUpdatedAt: FieldValue.serverTimestamp()
      }, { merge: true });
    }
    return { status: "failed", employeeNumber, errorCode };
  }
}

exports.notifyDriverOnDutyWritten = onDocumentWritten({
  document: "dutySpans/{dutySpanId}",
  region: "australia-southeast1",
  maxInstances: 10,
  retry: false
}, async (event) => {
  const before = event.data?.before?.exists ? event.data.before.data() || {} : null;
  const after = event.data?.after?.exists ? event.data.after.data() || {} : null;
  const duty = after || before;
  if (!duty) return;

  const notifications = classifyDutyNotifications(before, after);
  if (!notifications.length) return;

  const results = [];
  for (const notification of notifications) {
    results.push(await sendDutyNotification({
      dutySpanId: event.params.dutySpanId,
      duty,
      notification
    }));
  }

  await db.collection("dutyNotificationDeliveries").doc(event.id).set({
    eventId: event.id,
    dutySpanId: event.params.dutySpanId,
    serviceDate: String(duty.serviceDate || duty.date || ""),
    eventTypes: notifications.map((item) => item.eventType),
    recipientEmployeeNumbers: notifications.map((item) => item.employeeNumber),
    results,
    createdAt: FieldValue.serverTimestamp()
  });

  console.log("Driver duty notification completed", {
    dutySpanId: event.params.dutySpanId,
    eventTypes: notifications.map((item) => item.eventType),
    results
  });
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
