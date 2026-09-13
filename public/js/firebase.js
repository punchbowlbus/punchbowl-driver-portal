import { initializeApp } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-app.js";
import { getAuth, GoogleAuthProvider } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";
import { FIREBASE_CONFIG } from "./config.js";
import { getMessaging } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-messaging.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-storage.js";
import { getFunctions, connectFunctionsEmulator } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-functions.js";

export const app = initializeApp(FIREBASE_CONFIG);
export const auth = getAuth(app);
export const provider = new GoogleAuthProvider();
export const db = getFirestore(app);
export const messaging = getMessaging(app);
export const storage = getStorage(app);
export const functions = getFunctions(app, "australia-southeast1");

if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
  connectFunctionsEmulator(functions, "127.0.0.1", 5001);
}
