import {
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
  doc,
  addDoc,
  updateDoc,
  setDoc,
  getDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";

import { db } from "./firebase.js";

/* =========================================================
   SHIFTS
========================================================= */

export function listenShifts({ isAdmin, driverEmail }, onData, onErr) {
  let qy = query(collection(db, "shifts"), orderBy("serviceDate", "desc"));

  if (!isAdmin && driverEmail) {
    qy = query(
      collection(db, "shifts"),
      where("driverEmail", "==", driverEmail),
      where("dispatchStatus", "==", "Assigned"),
      orderBy("serviceDate", "desc")
    );
  }

  return onSnapshot(
    qy,
    (snap) => onData(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    onErr
  );
}

/* =========================================================
   LEGS
========================================================= */

export function listenLegs(shiftId, onData, onErr) {
  const qy = query(
    collection(db, "legs"),
    where("shiftId", "==", shiftId),
    orderBy("startMin", "asc")
  );

  return onSnapshot(
    qy,
    (snap) => onData(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    onErr
  );
}

/* =========================================================
   PATCH HELPERS
========================================================= */

export async function patchShift(shiftId, patch) {
  await updateDoc(doc(db, "shifts", shiftId), {
    ...patch,
    updatedAt: serverTimestamp()
  });
}

export async function patchLeg(legId, patch) {
  await updateDoc(doc(db, "legs", legId), {
    ...patch,
    updatedAt: serverTimestamp()
  });
}

/* =========================================================
   BLOCKS
========================================================= */

export async function addBlock(blockData) {
  return await addDoc(collection(db, "blocks"), {
    deleted: false,
    published: false,
    ...blockData,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
}

export async function updateBlock(blockId, patch) {
  await updateDoc(doc(db, "blocks", blockId), {
    ...patch,
    updatedAt: serverTimestamp()
  });
}

export function listenBlocksAll(onData, onErr) {
  const qy = query(
    collection(db, "blocks"),
    orderBy("serviceDate", "desc"),
    orderBy("startMin", "asc")
  );

  return onSnapshot(
    qy,
    (snap) => onData(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    onErr
  );
}

export function listenBlocksByDate(date, onData, onErr) {
  if (!date) return listenBlocksAll(onData, onErr);

  const qy = query(
    collection(db, "blocks"),
    where("serviceDate", "==", date),
    orderBy("startMin", "asc")
  );

  return onSnapshot(
    qy,
    (snap) => onData(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    onErr
  );
}

/* =========================================================
   DUTY SPANS
========================================================= */

function normalizeDispatchStatus(value) {
  const v = String(value || "").trim().toLowerCase();

  if (v === "assigned") return "Assigned";
  if (v === "cancelled" || v === "canceled") return "Cancelled";
  return "Pending";
}

function normalizeDriverAcknowledgment(value) {
  const v = String(value || "").trim().toLowerCase();

  if (v === "yes" || v === "y" || v === "accepted") return "Yes";
  if (v === "no" || v === "n" || v === "declined") return "No";
  return "Pending";
}

export async function addDutySpan(data) {
  return await addDoc(collection(db, "dutySpans"), {
    deleted: false,

    serviceDate: String(data.serviceDate || "").trim(),
    driverEmployeeNumber: String(data.driverEmployeeNumber || "").trim(),
    driverName: String(data.driverName || "").trim(),

    startMin: Number(data.startMin || 0),
    endMin: Number(data.endMin || 0),

    startLocation: String(data.startLocation || "").trim(),
    endLocation: String(data.endLocation || "").trim(),

    assignedBus: String(data.assignedBus || "").trim(),

    dispatchStatus: normalizeDispatchStatus(data.dispatchStatus || "Pending"),
    driverAcknowledgment: normalizeDriverAcknowledgment(
      data.driverAcknowledgment || "Pending"
    ),

    breaks: Array.isArray(data.breaks) ? data.breaks : [],

    totalSpanMinutes: Number(data.totalSpanMinutes || 0),
    unpaidMinutes: Number(data.unpaidMinutes || 0),
    paidMinutes: Number(data.paidMinutes || 0),
    fatigueStatus: String(data.fatigueStatus || "OK").trim(),
    fatigueWarning: String(data.fatigueWarning || "").trim(),

    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
}

export async function updateDutySpan(dutySpanId, patch) {
  const nextPatch = {
    ...patch,
    updatedAt: serverTimestamp()
  };

  if ("serviceDate" in nextPatch) {
    nextPatch.serviceDate = String(nextPatch.serviceDate || "").trim();
  }

  if ("driverEmployeeNumber" in nextPatch) {
    nextPatch.driverEmployeeNumber = String(nextPatch.driverEmployeeNumber || "").trim();
  }

  if ("driverName" in nextPatch) {
    nextPatch.driverName = String(nextPatch.driverName || "").trim();
  }

  if ("startMin" in nextPatch) {
    nextPatch.startMin = Number(nextPatch.startMin || 0);
  }

  if ("endMin" in nextPatch) {
    nextPatch.endMin = Number(nextPatch.endMin || 0);
  }

  if ("startLocation" in nextPatch) {
    nextPatch.startLocation = String(nextPatch.startLocation || "").trim();
  }

  if ("endLocation" in nextPatch) {
    nextPatch.endLocation = String(nextPatch.endLocation || "").trim();
  }

  if ("assignedBus" in nextPatch) {
    nextPatch.assignedBus = String(nextPatch.assignedBus || "").trim();
  }

  if ("dispatchStatus" in nextPatch) {
    nextPatch.dispatchStatus = normalizeDispatchStatus(nextPatch.dispatchStatus);
  }

  if ("driverAcknowledgment" in nextPatch) {
    nextPatch.driverAcknowledgment = normalizeDriverAcknowledgment(
      nextPatch.driverAcknowledgment
    );
  }

  if ("breaks" in nextPatch) {
    nextPatch.breaks = Array.isArray(nextPatch.breaks) ? nextPatch.breaks : [];
  }

  if ("totalSpanMinutes" in nextPatch) {
    nextPatch.totalSpanMinutes = Number(nextPatch.totalSpanMinutes || 0);
  }

  if ("unpaidMinutes" in nextPatch) {
    nextPatch.unpaidMinutes = Number(nextPatch.unpaidMinutes || 0);
  }

  if ("paidMinutes" in nextPatch) {
    nextPatch.paidMinutes = Number(nextPatch.paidMinutes || 0);
  }

  if ("fatigueStatus" in nextPatch) {
    nextPatch.fatigueStatus = String(nextPatch.fatigueStatus || "OK").trim();
  }

  if ("fatigueWarning" in nextPatch) {
    nextPatch.fatigueWarning = String(nextPatch.fatigueWarning || "").trim();
  }

  await updateDoc(doc(db, "dutySpans", dutySpanId), nextPatch);
}

export async function updateDutySpanDispatchStatus(dutySpanId, dispatchStatus) {
  const nextStatus = normalizeDispatchStatus(dispatchStatus);

  const patch = {
    dispatchStatus: nextStatus,
    updatedAt: serverTimestamp()
  };

  if (nextStatus === "Pending" || nextStatus === "Cancelled") {
    patch.driverAcknowledgment = "Pending";
  }

  await updateDoc(doc(db, "dutySpans", dutySpanId), patch);
}

export async function updateDutySpanDriverAcknowledgment(dutySpanId, driverAcknowledgment) {
  await updateDoc(doc(db, "dutySpans", dutySpanId), {
    driverAcknowledgment: normalizeDriverAcknowledgment(driverAcknowledgment),
    updatedAt: serverTimestamp()
  });
}

export async function deleteDutySpan(dutySpanId) {
  await updateDoc(doc(db, "dutySpans", dutySpanId), {
    deleted: true,
    updatedAt: serverTimestamp()
  });
}

export function listenDutySpansByDate(date, onData, onErr) {
  if (!date) {
    onData([]);
    return () => {};
  }

  const qy = query(
    collection(db, "dutySpans"),
    where("serviceDate", "==", String(date).trim()),
    orderBy("startMin", "asc")
  );

  return onSnapshot(
    qy,
    (snap) => {
      const list = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((item) => item.deleted !== true);

      onData(list);
    },
    onErr
  );
}

export function listenDutySpansByDriverAndDate(driverEmployeeNumber, date, onData, onErr) {
  if (!driverEmployeeNumber || !date) {
    onData([]);
    return () => {};
  }

  const qy = query(
    collection(db, "dutySpans"),
    where("driverEmployeeNumber", "==", String(driverEmployeeNumber).trim()),
    where("serviceDate", "==", String(date).trim()),
    orderBy("startMin", "asc")
  );

  return onSnapshot(
    qy,
    (snap) => {
      const list = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((item) => item.deleted !== true);

      onData(list);
    },
    onErr
  );
}

/* =========================================================
   JOB GROUPS
========================================================= */

export function listenJobGroups(onData, onErr) {
  const qy = query(collection(db, "jobGroups"));

  return onSnapshot(
    qy,
    (snap) => {
      const list = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((jg) => jg.deleted !== true)
        .sort((a, b) => {
          const at = (a.title || a.name || "").toString().toLowerCase();
          const bt = (b.title || b.name || "").toString().toLowerCase();
          return at.localeCompare(bt);
        });

      onData(list);
    },
    onErr
  );
}

export async function addJobGroup(data) {
  return await addDoc(collection(db, "jobGroups"), {
    deleted: false,
    ...data,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
}

export async function updateJobGroup(jobGroupId, patch) {
  await updateDoc(doc(db, "jobGroups", jobGroupId), {
    ...patch,
    updatedAt: serverTimestamp()
  });
}

export async function deleteJobGroup(jobGroupId) {
  await updateDoc(doc(db, "jobGroups", jobGroupId), {
    deleted: true,
    updatedAt: serverTimestamp()
  });
}

/* =========================================================
   RECURRING TEMPLATES
========================================================= */

export function listenRecurringTemplates(onData, onErr) {
  const qy = query(collection(db, "recurringTemplates"));

  return onSnapshot(
    qy,
    (snap) => {
      const list = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((t) => t.deleted !== true)
        .sort((a, b) => ((a.title || a.name || "") + "").localeCompare((b.title || b.name || "") + ""));

      onData(list);
    },
    onErr
  );
}

export async function addRecurringTemplate(data) {
  return await addDoc(collection(db, "recurringTemplates"), {
    deleted: false,
    generated: false,
    ...data,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
}

export async function updateRecurringTemplate(templateId, patch) {
  await updateDoc(doc(db, "recurringTemplates", templateId), {
    ...patch,
    updatedAt: serverTimestamp()
  });
}

export async function deleteRecurringTemplate(templateId) {
  await updateDoc(doc(db, "recurringTemplates", templateId), {
    deleted: true,
    updatedAt: serverTimestamp()
  });
}

export async function markRecurringTemplateGenerated(templateId, patch = {}) {
  await updateDoc(doc(db, "recurringTemplates", templateId), {
    generated: true,
    generatedAt: serverTimestamp(),
    ...patch,
    updatedAt: serverTimestamp()
  });
}

/* =========================================================
   TEMPLATE LEGS
========================================================= */

export function listenTemplateLegs(templateId, onData, onErr) {
  const qy = query(
    collection(db, "templateLegs"),
    where("templateId", "==", templateId),
    orderBy("sortOrder", "asc")
  );

  return onSnapshot(
    qy,
    (snap) => {
      const list = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((leg) => leg.deleted !== true);

      onData(list);
    },
    onErr
  );
}

export async function addTemplateLeg(data) {
  return await addDoc(collection(db, "templateLegs"), {
    deleted: false,
    ...data,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
}

export async function updateTemplateLeg(legId, patch) {
  await updateDoc(doc(db, "templateLegs", legId), {
    ...patch,
    updatedAt: serverTimestamp()
  });
}

export async function deleteTemplateLeg(legId) {
  await updateDoc(doc(db, "templateLegs", legId), {
    deleted: true,
    updatedAt: serverTimestamp()
  });
}

export async function deleteBlock(blockId) {
  await updateDoc(doc(db, "blocks", blockId), {
    deleted: true,
    updatedAt: serverTimestamp()
  });
}

/* =========================================================
   EMPLOYEES
========================================================= */

export async function saveEmployee(employee) {
  const employeeNumber = String(employee.employeeNumber || "").trim();

  if (!employeeNumber) {
    throw new Error("Employee Number is required.");
  }

  const ref = doc(db, "employees", employeeNumber);
  const snap = await getDoc(ref);

  await setDoc(
    ref,
    {
      employeeNumber,
      firstName: String(employee.firstName || "").trim(),
      lastName: String(employee.lastName || "").trim(),
      displayName: String(employee.displayName || "").trim(),
      email: String(employee.email || "").trim().toLowerCase(),
      phoneNumber: String(employee.phoneNumber || "").trim(),
      department: String(employee.department || "").trim(),
      role: String(employee.role || "").trim(),
      employmentType: String(employee.employmentType || "").trim(),
      accessLevel: String(employee.accessLevel || "").trim(),
      status: String(employee.status || "Active").trim(),

      // Driver fields
      licenceNumber: String(employee.licenceNumber || "").trim(),
      licenceExpiry: String(employee.licenceExpiry || "").trim(),
      daNumber: String(employee.daNumber || "").trim(),
      daExpiry: String(employee.daExpiry || "").trim(),
      wwccNumber: String(employee.wwccNumber || "").trim(),
      wwccExpiry: String(employee.wwccExpiry || "").trim(),
      medicalExpiry: String(employee.medicalExpiry || "").trim(),
      fatigueCategory: String(employee.fatigueCategory || "").trim(),
      homeDepot: String(employee.homeDepot || "").trim(),

      updatedAt: serverTimestamp(),
      createdAt: snap.exists() ? (snap.data().createdAt || serverTimestamp()) : serverTimestamp()
    },
    { merge: true }
  );
}

export async function getEmployee(employeeNumber) {
  const ref = doc(db, "employees", String(employeeNumber).trim());
  const snap = await getDoc(ref);

  if (!snap.exists()) return null;

  return {
    id: snap.id,
    ...snap.data()
  };
}

export function listenEmployees(onData, onErr) {
  const qy = query(collection(db, "employees"), orderBy("employeeNumber", "asc"));

  return onSnapshot(
    qy,
    (snap) => onData(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    onErr
  );
}

export async function updateEmployee(employeeNumber, patch) {
  await updateDoc(doc(db, "employees", String(employeeNumber).trim()), {
    ...patch,
    updatedAt: serverTimestamp()
  });
}

export async function deactivateEmployee(employeeNumber) {
  await updateDoc(doc(db, "employees", String(employeeNumber).trim()), {
    status: "Inactive",
    updatedAt: serverTimestamp()
  });
}

/* =========================================================
   BUSES
========================================================= */

export async function saveBus(bus) {
  const fleetNumber = String(bus.fleetNumber || "").trim().toUpperCase();

  if (!fleetNumber) {
    throw new Error("Fleet Number is required.");
  }

  const ref = doc(db, "buses", fleetNumber);
  const snap = await getDoc(ref);

  await setDoc(
    ref,
    {
      fleetNumber,
      rego: String(bus.rego || fleetNumber).trim().toUpperCase(),
      accessType: String(bus.accessType || "").trim(),
      year: String(bus.year || "").trim(),
      make: String(bus.make || "").trim(),
      model: String(bus.model || "").trim(),
      euro: String(bus.euro || "").trim(),
      adblue: String(bus.adblue || "").trim(),
      fuelType: String(bus.fuelType || "").trim(),
      vin: String(bus.vin || "").trim(),
      airConditioned: String(bus.airConditioned || "").trim(),
      tare: String(bus.tare || "").trim(),
      gvm: String(bus.gvm || "").trim(),
      regoExpiry: String(bus.regoExpiry || "").trim(),
      rearDoor: String(bus.rearDoor || "").trim(),
      seatCount: String(bus.seatCount || "").trim(),
      standCount: String(bus.standCount || "").trim(),
      bodyBy: String(bus.bodyBy || "").trim(),
      bodyModel: String(bus.bodyModel || "").trim(),
      colour: String(bus.colour || "").trim(),
      cctvCount: String(bus.cctvCount || "").trim(),
      fireSuppression: String(bus.fireSuppression || "").trim(),
      luggageBins: String(bus.luggageBins || "").trim(),
      depot: String(bus.depot || "").trim(),
      status: String(bus.status || "Active").trim(),
      notes: String(bus.notes || "").trim(),

      updatedAt: serverTimestamp(),
      createdAt: snap.exists()
        ? (snap.data().createdAt || serverTimestamp())
        : serverTimestamp()
    },
    { merge: true }
  );
}

export async function getBus(fleetNumber) {
  const ref = doc(db, "buses", String(fleetNumber || "").trim().toUpperCase());
  const snap = await getDoc(ref);

  if (!snap.exists()) return null;

  return {
    id: snap.id,
    ...snap.data()
  };
}

export function listenBuses(onData, onErr) {
  const qy = query(collection(db, "buses"), orderBy("fleetNumber", "asc"));

  return onSnapshot(
    qy,
    (snap) => onData(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    onErr
  );
}

export async function updateBus(fleetNumber, patch) {
  await updateDoc(doc(db, "buses", String(fleetNumber || "").trim().toUpperCase()), {
    ...patch,
    updatedAt: serverTimestamp()
  });
}

export async function deactivateBus(fleetNumber) {
  await updateDoc(doc(db, "buses", String(fleetNumber || "").trim().toUpperCase()), {
    status: "Inactive",
    updatedAt: serverTimestamp()
  });
}