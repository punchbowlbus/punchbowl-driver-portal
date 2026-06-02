const {setGlobalOptions} = require("firebase-functions");
const {onRequest} = require("firebase-functions/v2/https");
const admin = require("firebase-admin");

setGlobalOptions({maxInstances: 10});

admin.initializeApp();

exports.testNotificationFunction = onRequest((req, res) => {
  res.send("Notification function is working");
});
