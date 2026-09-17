importScripts("https://www.gstatic.com/firebasejs/12.9.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/12.9.0/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyC-uze0wbaYlG1LBZKaC3MBXcMgsCfGEAc",
  authDomain: "punchbowl-driver-portal.firebaseapp.com",
  projectId: "punchbowl-driver-portal",
  storageBucket: "punchbowl-driver-portal.firebasestorage.app",
  messagingSenderId: "352420537161",
  appId: "1:352420537161:web:4ec51dcb476934a9373098"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  console.log("Background message received:", payload);
});

self.addEventListener("notificationclick", (event) => {
  const link = event.notification?.data?.portalLink;
  if (!link) return;

  event.notification.close();
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const existing = windows.find((client) => new URL(client.url).origin === self.location.origin);
    if (existing) {
      await existing.navigate(link);
      return existing.focus();
    }
    return self.clients.openWindow(link);
  })());
});
