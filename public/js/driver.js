import { patchShift, patchLeg, serverTimestamp } from "./db.js";
import { getActor } from "./utils.js";
import { auth } from "./firebase.js";
import { showError } from "./ui.js";

export async function setShiftConfirmation(shiftId, value) {
  showError("");

  const safeValue = String(value || "").trim();
  if (safeValue !== "Yes" && safeValue !== "No") {
    showError("Invalid confirmation value");
    return;
  }

  try {
    const a = getActor(auth);
    await patchShift(shiftId, {
      driverAcknowledgment: safeValue,
      driverAcknowledgmentAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      updatedByUid: a.uid,
      updatedByEmail: a.email
    });
  } catch (e) {
    showError(e?.message || "Update failed");
  }
}

export async function softDeleteShift(shiftId) {
  showError("");
  try {
    const a = getActor(auth);
    await patchShift(shiftId, {
      deleted: true,
      deletedAt: serverTimestamp(),
      deletedByUid: a.uid,
      deletedByEmail: a.email,
      updatedAt: serverTimestamp(),
      updatedByUid: a.uid,
      updatedByEmail: a.email
    });
  } catch (e) {
    showError(e?.message || "Delete failed");
  }
}

export async function softDeleteLeg(legId) {
  showError("");
  try {
    const a = getActor(auth);
    await patchLeg(legId, {
      deleted: true,
      deletedAt: serverTimestamp(),
      deletedByUid: a.uid,
      deletedByEmail: a.email,
      updatedAt: serverTimestamp(),
      updatedByUid: a.uid,
      updatedByEmail: a.email
    });
  } catch (e) {
    showError(e?.message || "Delete failed");
  }
}