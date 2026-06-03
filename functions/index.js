/* eslint-disable require-jsdoc, max-len */
const {setGlobalOptions} = require("firebase-functions");
const {onRequest} = require("firebase-functions/v2/https");
const {onDocumentUpdated} = require("firebase-functions/v2/firestore");
const admin = require("firebase-admin");

setGlobalOptions({maxInstances: 10});

admin.initializeApp();

function minToTime(min) {
  const safeMin = Number(min || 0);
  const h = String(Math.floor(safeMin / 60)).padStart(2, "0");
  const m = String(safeMin % 60).padStart(2, "0");
  return `${h}:${m}`;
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
