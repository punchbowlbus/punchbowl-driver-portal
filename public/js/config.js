export const FIREBASE_CONFIG = {
  apiKey: "AIzaSyC-uze0wbaYlG1LBZKaC3MBXcMgsCfGEAc",
  authDomain: "punchbowl-driver-portal.firebaseapp.com",
  projectId: "punchbowl-driver-portal",
  storageBucket: "punchbowl-driver-portal.firebasestorage.app",
  messagingSenderId: "352420537161",
  appId: "1:352420537161:web:4ec51dcb476934a9373098"
};

export const ADMIN_EMAILS = [
  "info@punchbowlbus.com",
  "nalin.rajapaksha82@gmail.com",
  "nalin@punchbowlbus.com.au",
  "christine@punchbowlbus.com.au"
];

/**
 * ✅ NEW (Option 2): Split roster into Shifts (depot→depot) + Legs (jobs inside shift)
 * We keep JOBS_COLLECTION for backward compatibility (old data), but new code will use SHIFTS + LEGS.
 */
export const JOBS_COLLECTION = "jobs";      // legacy (old mixed records)
export const SHIFTS_COLLECTION = "shifts";  // new
export const LEGS_COLLECTION = "legs";      // new

// Keep your charter status list (can be used on legs or bookings later)
export const CHARTER_STATUS = ["Draft", "Confirmed", "Cancelled"];

// Optional: Job types for legs (you can change these anytime)
export const JOB_TYPES = ["School", "Charter", "Rail", "Loop", "Dead-run", "Other"];