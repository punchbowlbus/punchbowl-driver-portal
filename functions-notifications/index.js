/**
 * Punchbowl Driver Portal — isolated push-notification Cloud Functions.
 * This codebase intentionally has no Charter/Brevo dependencies or parameters.
 */
const { onCall, HttpsError } = require("firebase-functions/v2/https");
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
