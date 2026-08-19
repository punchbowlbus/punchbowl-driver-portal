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