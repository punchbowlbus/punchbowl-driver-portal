/* eslint-disable require-jsdoc, max-len */
const {setGlobalOptions} = require("firebase-functions");
const {onRequest} = require("firebase-functions/v2/https");
const {
  onDocumentCreated,
  onDocumentUpdated,
} = require("firebase-functions/v2/firestore");
const {defineSecret} = require("firebase-functions/params");
const admin = require("firebase-admin");

const ms365TenantId = defineSecret("MS365_TENANT_ID");
const ms365ClientId = defineSecret("MS365_CLIENT_ID");
const ms365ClientSecret = defineSecret("MS365_CLIENT_SECRET");
const ms365SenderEmail = defineSecret("MS365_SENDER_EMAIL");

setGlobalOptions({maxInstances: 10});

admin.initializeApp();

function minToTime(min) {
  const safeMin = Number(min || 0);
  const h = String(Math.floor(safeMin / 60)).padStart(2, "0");
  const m = String(safeMin % 60).padStart(2, "0");
  return `${h}:${m}`;
}

function normalized(value) {
  return String(value || "").trim().toLowerCase();
}

function defectNotificationGroups(employee) {
  const status = normalized(employee.status);
  const department = normalized(employee.department);
  const role = normalized(employee.role);
  const accessLevel = normalized(employee.accessLevel);

  if (status !== "active") return {occ: false, supervisor: false};

  const occ =
    department.includes("operation") ||
    department === "occ" ||
    role === "dispatcher";

  const supervisor =
    department.includes("management") ||
    role === "manager" ||
    role === "supervisor" ||
    accessLevel.includes("super admin");

  return {occ, supervisor};
}

function escapeEmailHtml(value) {
  return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
}

async function sendMicrosoftGraphEmail({to, subject, report, unsafe}) {
  if (!to.length) return {status: "No email recipients", recipientCount: 0};

  const tenantId = ms365TenantId.value();
  const clientId = ms365ClientId.value();
  const clientSecret = ms365ClientSecret.value();
  const senderEmail = ms365SenderEmail.value();

  const tokenBody = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials",
  });

  const tokenResponse = await fetch(
      `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`,
      {
        method: "POST",
        headers: {"Content-Type": "application/x-www-form-urlencoded"},
        body: tokenBody,
      },
  );

  if (!tokenResponse.ok) {
    throw new Error(`Microsoft token request failed (${tokenResponse.status})`);
  }

  const tokenData = await tokenResponse.json();
  const reportNumber = String(report.reportNumber || "Defect report");
  const fleetNumber = String(report.fleetNumber || "Unknown bus");
  const category = String(report.category || "Vehicle defect");
  const driverName = String(report.reportedByName || "Driver");
  const safeToDrive = unsafe ? "NO — vehicle marked unsafe" : "Yes";
  const photos = Array.isArray(report.photos) ? report.photos : [];
  const photoLinks = photos.length ? `
    <p><strong>Photos:</strong></p>
    <ul>${photos.map((photo, index) => `
      <li><a href="${escapeEmailHtml(photo.url || "")}">Open photo ${index + 1}</a></li>
    `).join("")}</ul>
  ` : "";

  const html = `
    <div style="font-family:Arial,sans-serif;color:#1f2937;line-height:1.5">
      <h2 style="color:${unsafe ? "#b91c1c" : "#1f2937"}">${escapeEmailHtml(subject)}</h2>
      <table style="border-collapse:collapse;width:100%;max-width:680px">
        <tr><td style="padding:6px 0;font-weight:bold">Report</td><td>${escapeEmailHtml(reportNumber)}</td></tr>
        <tr><td style="padding:6px 0;font-weight:bold">Defect date</td><td>${escapeEmailHtml(report.defectDate || "Not recorded")}</td></tr>
        <tr><td style="padding:6px 0;font-weight:bold">Bus</td><td>${escapeEmailHtml(fleetNumber)}</td></tr>
        <tr><td style="padding:6px 0;font-weight:bold">Category</td><td>${escapeEmailHtml(category)}</td></tr>
        <tr><td style="padding:6px 0;font-weight:bold">Driver</td><td>${escapeEmailHtml(driverName)}</td></tr>
        <tr><td style="padding:6px 0;font-weight:bold">Safe to drive</td><td>${escapeEmailHtml(safeToDrive)}</td></tr>
      </table>
      <h3>Driver description</h3>
      <p style="white-space:pre-wrap">${escapeEmailHtml(report.description || "No description")}</p>
      ${photoLinks}
      <p><a href="https://punchbowl-driver-portal.web.app">Open Punchbowl Driver Portal</a></p>
    </div>
  `;

  const graphResponse = await fetch(
      `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(senderEmail)}/sendMail`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: {
            subject,
            body: {contentType: "HTML", content: html},
            toRecipients: [{emailAddress: {address: senderEmail}}],
            bccRecipients: to.map((address) => ({
              emailAddress: {address},
            })),
          },
          saveToSentItems: true,
        }),
      },
  );

  if (!graphResponse.ok) {
    const details = await graphResponse.text();
    throw new Error(
        `Microsoft Graph sendMail failed (${graphResponse.status}): ${details.slice(0, 300)}`,
    );
  }

  return {status: "Sent", recipientCount: to.length};
}

exports.testNotificationFunction = onRequest((req, res) => {
  res.send("Notification function is working");
});

exports.sendTestNotificationToDriver = onRequest(async (req, res) => {
  try {
    const empNo = String(req.query.empNo || "101010").trim();

    const employeeSnap = await admin.firestore().doc(`employees/${empNo}`).get();

    if (!employeeSnap.exists) {
      res.status(404).send(`Employee ${empNo} not found`);
      return;
    }

    const employee = employeeSnap.data() || {};
    const token = String(employee.fcmToken || "").trim();

    if (!token) {
      res.status(400).send(`No FCM token found for employee ${empNo}`);
      return;
    }

    const message = {
      token,
      webpush: {
        notification: {
          title: "PBC Dispatch Test",
          body: "This is a test notification from Punchbowl Dispatch.",
          icon: "https://punchbowl-driver-portal.web.app/icons/icon-192.png",
          badge: "https://punchbowl-driver-portal.web.app/icons/icon-192.png",
          requireInteraction: true,
        },
        fcmOptions: {
          link: "https://punchbowl-driver-portal.web.app",
        },
      },
    };

    const response = await admin.messaging().send(message);

    console.log("FCM sent:", response);

    res.send({
      ok: true,
      empNo,
      token: `${token.substring(0, 20)}...`,
      response,
    });
  } catch (err) {
    console.error("Test notification failed:", err);
    res.status(500).send(err.message || "Notification failed");
  }
});

exports.notifyDriverOnDutyAssigned = onDocumentUpdated(
    "dutySpans/{dutySpanId}",
    async (event) => {
      const before = event.data.before.data() || {};
      const after = event.data.after.data() || {};

      if (
        before.dispatchStatus === "Assigned" ||
      after.dispatchStatus !== "Assigned"
      ) {
        return;
      }

      const empNo = String(after.driverEmployeeNumber || "").trim();

      if (!empNo) {
        console.log("No driverEmployeeNumber on duty span");
        return;
      }

      const employeeSnap = await admin
          .firestore()
          .doc(`employees/${empNo}`)
          .get();

      if (!employeeSnap.exists) {
        console.log("Assigned driver not found:", empNo);
        return;
      }

      const employee = employeeSnap.data() || {};
      const status = String(employee.status || "").trim().toLowerCase();
      const role = String(employee.role || "").trim().toLowerCase();
      const accessLevel = String(employee.accessLevel || "").trim().toLowerCase();
      const token = String(employee.fcmToken || "").trim();

      const isActiveDriver =
      status === "active" &&
      (role === "driver" || accessLevel.includes("driver"));

      if (!isActiveDriver || !token) {
        console.log("Driver not active or no token:", empNo);
        return;
      }

      const startTime = minToTime(after.startMin || 0);
      const endTime = minToTime(after.endMin || 0);
      const dutyNumber = String(after.dutyNumber || "").trim();

      const body = dutyNumber ?
      `Duty ${dutyNumber} - ${startTime} to ${endTime}` :
      `${startTime} to ${endTime}`;

      const message = {
        token,
        webpush: {
          notification: {
            title: "New Duty Assigned",
            body,
            icon: "https://punchbowl-driver-portal.web.app/icons/icon-192.png",
            badge: "https://punchbowl-driver-portal.web.app/icons/icon-192.png",
            requireInteraction: true,
          },
          fcmOptions: {
            link: "https://punchbowl-driver-portal.web.app",
          },
        },
      };

      const response = await admin.messaging().send(message);

      console.log("Duty assigned notification sent:", {
        dutySpanId: event.params.dutySpanId,
        driver: empNo,
        response,
      });
    },
);

exports.notifyOperationsOnDefectCreated = onDocumentCreated(
    {
      document: "defectReports/{reportId}",
      secrets: [
        ms365TenantId,
        ms365ClientId,
        ms365ClientSecret,
        ms365SenderEmail,
      ],
    },
    async (event) => {
      const report = event.data?.data() || {};
      const reportId = event.params.reportId;
      const unsafe = String(report.safeToDrive || "") === "No";
      const priority = unsafe ? "Critical" : "Medium";

      const settingsSnap = await admin.firestore()
          .doc("systemSettings/defectNotifications")
          .get();
      const settings = settingsSnap.exists ? settingsSnap.data() || {} : null;

      if (settings && settings.enabled === false) {
        await event.data.ref.set({
          notificationStatus: "Disabled",
          notificationPriority: priority,
          notificationRecipientCount: 0,
          notificationCheckedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, {merge: true});
        return;
      }

      const employeesSnap = await admin.firestore()
          .collection("employees")
          .get();

      const occRecipientIds = new Set(
          (settings?.occRecipientIds || []).map(String),
      );
      const supervisorRecipientIds = new Set(
          (settings?.supervisorRecipientIds || []).map(String),
      );

      const recipients = employeesSnap.docs
          .map((employeeDoc) => ({
            id: employeeDoc.id,
            ...employeeDoc.data(),
          }))
          .filter((employee) => {
            if (normalized(employee.status) !== "active") return false;

            if (settings) {
              const sendToOcc = unsafe ?
                settings.notifyOccForUnsafe !== false :
                settings.notifyOccForSafe !== false;
              const sendToSupervisors =
                unsafe && settings.notifySupervisorsForUnsafe !== false;

              return (
                (sendToOcc && occRecipientIds.has(String(employee.id))) ||
                (sendToSupervisors &&
                  supervisorRecipientIds.has(String(employee.id)))
              );
            }

            const groups = defectNotificationGroups(employee);
            return groups.occ || (unsafe && groups.supervisor);
          });

      const tokens = [...new Set(
        recipients
            .map((employee) => String(employee.fcmToken || "").trim())
            .filter(Boolean),
      )];
      const emailRecipients = [...new Set(
        recipients
            .map((employee) => normalized(employee.email))
            .filter((email) => email.includes("@")),
      )];

      const reportNumber = String(report.reportNumber || reportId).trim();
      const fleetNumber = String(report.fleetNumber || "Unknown bus").trim();
      const category = String(report.category || "Vehicle defect").trim();
      const driverName = String(report.reportedByName || "Driver").trim();

      const title = unsafe ?
        `CRITICAL: Bus ${fleetNumber} unsafe` :
        `New defect: Bus ${fleetNumber}`;
      const body = `${category} reported by ${driverName} · ${reportNumber}`;

      let pushResult = {
        status: "No push recipients",
        successCount: 0,
        failureCount: 0,
        failureCodes: [],
      };

      if (tokens.length) {
        const response = await admin.messaging().sendEachForMulticast({
          tokens,
          data: {
            type: "defectReport",
            reportId,
            reportNumber,
            priority,
            safeToDrive: unsafe ? "No" : "Yes",
          },
          webpush: {
            notification: {
              title,
              body,
              icon: "https://punchbowl-driver-portal.web.app/icons/icon-192.png",
              badge: "https://punchbowl-driver-portal.web.app/icons/icon-192.png",
              requireInteraction: unsafe,
              tag: `defect-${reportId}`,
            },
            fcmOptions: {
              link: "https://punchbowl-driver-portal.web.app",
            },
          },
        });

        const failures = response.responses
            .map((result, index) => ({result, token: tokens[index]}))
            .filter(({result}) => !result.success)
            .map(({result}) => result.error?.code || "unknown");

        pushResult = {
          status: failures.length ? "Partially sent" : "Sent",
          successCount: response.successCount,
          failureCount: response.failureCount,
          failureCodes: failures,
        };
      }

      let emailResult = {status: "Disabled", recipientCount: 0};
      if (settings?.emailEnabled === true) {
        try {
          emailResult = await sendMicrosoftGraphEmail({
            to: emailRecipients,
            subject: title,
            report,
            unsafe,
          });
        } catch (error) {
          console.error("Defect email failed:", error);
          emailResult = {status: "Failed", recipientCount: emailRecipients.length};
        }
      }

      await event.data.ref.set({
        notificationStatus: pushResult.status,
        notificationPriority: priority,
        notificationRecipientCount: tokens.length,
        notificationSuccessCount: pushResult.successCount,
        notificationFailureCount: pushResult.failureCount,
        notificationSentAt: admin.firestore.FieldValue.serverTimestamp(),
        emailNotificationStatus: emailResult.status,
        emailRecipientCount: emailResult.recipientCount,
        emailNotificationCheckedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, {merge: true});

      console.log("Defect notification completed:", {
        reportId,
        priority,
        recipients: tokens.length,
        successCount: pushResult.successCount,
        failureCount: pushResult.failureCount,
        failureCodes: pushResult.failureCodes,
        emailStatus: emailResult.status,
        emailRecipients: emailResult.recipientCount,
      });
    },
);
