const {setGlobalOptions} = require("firebase-functions");
const {onRequest} = require("firebase-functions/v2/https");
const admin = require("firebase-admin");

setGlobalOptions({maxInstances: 10});

admin.initializeApp();

exports.testNotificationFunction = onRequest((req, res) => {
  res.send("Notification function is working");
});

exports.sendTestNotificationToDriver = onRequest(async (req, res) => {
  try {
    const empNo = String(req.query.empNo || "101010").trim();

    const employeeSnap = await admin
        .firestore()
        .doc(`employees/${empNo}`)
        .get();

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
      token: token.substring(0, 20) + "...",
      response,
    });
  } catch (err) {
    console.error("Test notification failed:", err);
    res.status(500).send(err.message || "Notification failed");
  }
});
