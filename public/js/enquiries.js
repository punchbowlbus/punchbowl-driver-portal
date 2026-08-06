import "./customer_search.js";

import {
  collection,
  addDoc,
  query,
  orderBy,
  limit,
  onSnapshot,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut
} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-auth.js";

import { auth, db, provider } from "./firebase.js";
import { ADMIN_EMAILS } from "./config.js";
import { normalizeEmail, escapeHtml } from "./utils.js";

const els = {
  authText: document.getElementById("authText"),
  loginBtn: document.getElementById("loginBtn"),
  logoutBtn: document.getElementById("logoutBtn"),
  status: document.getElementById("status"),
  form: document.getElementById("enquiryForm"),
  saveBtn: document.getElementById("saveBtn"),
  resetBtn: document.getElementById("resetBtn"),
  queue: document.getElementById("queue")
};

let currentUser = null;
let unsubscribeEnquiries = null;

function isAdminEmail(email) {
  const normalized = normalizeEmail(email || "");
  return ADMIN_EMAILS.map(normalizeEmail).includes(normalized);
}

function showStatus(message, type = "success") {
  els.status.className = `status ${type}`;
  els.status.textContent = message;
}

function clearStatus() {
  els.status.className = "status";
  els.status.textContent = "";
}

function value(id) {
  return String(document.getElementById(id)?.value || "").trim();
}

function optionalNumber(id) {
  const raw = value(id);
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function buildEnquiryPayload() {
  const contactName = value("contactName");
  const serviceDate = value("serviceDate");
  const pickupLocation = value("pickupLocation");
  const destination = value("destination");
  const phone = value("phone");
  const email = normalizeEmail(value("email"));

  if (!contactName || !serviceDate || !pickupLocation || !destination) {
    throw new Error("Complete the required customer and trip fields.");
  }

  if (!phone && !email) {
    throw new Error("Add at least one customer contact method: phone or email.");
  }

  return {
    source: value("source"),
    priority: value("priority") || "Normal",
    status: "New",
    deleted: false,
    organisationName: value("organisationName"),
    contactName,
    phone,
    email,
    journeyType: value("journeyType") || "One way",
    serviceDate,
    returnDate: value("returnDate"),
    pickupTime: value("pickupTime"),
    pickupLocation,
    destination,
    stops: value("stops")
      .split("\n")
      .map((item) => item.trim())
      .filter(Boolean),
    passengerCount: optionalNumber("passengerCount"),
    vehiclePreference: value("vehiclePreference"),
    specialRequirements: value("specialRequirements"),
    notes: value("notes"),
    assignedToEmail: normalizeEmail(currentUser?.email || ""),
    createdByEmail: normalizeEmail(currentUser?.email || ""),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    schemaVersion: 1,
    aiProcessingStatus: "Not started"
  };
}

function formatDate(value) {
  if (!value) return "Date not set";
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("en-AU", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  }).format(parsed);
}

function renderQueue(enquiries) {
  if (!enquiries.length) {
    els.queue.innerHTML = `<div class="empty">No enquiries have been created yet.</div>`;
    return;
  }

  els.queue.innerHTML = enquiries
    .filter((item) => !item.deleted)
    .map((item) => {
      const sourceClass = String(item.source || "").toLowerCase().replace(/[^a-z]/g, "");
      const customer = item.organisationName || item.contactName || "Unnamed customer";
      const route = `${item.pickupLocation || "Pickup pending"} → ${item.destination || "Destination pending"}`;
      const contact = item.phone || item.email || "No contact details";

      return `
        <article class="enquiry">
          <div class="enquiry-top">
            <div>
              <div class="enquiry-name">${escapeHtml(customer)}</div>
              <div class="muted">${escapeHtml(item.contactName || "")}</div>
            </div>
            <span class="badge ${escapeHtml(sourceClass)}">${escapeHtml(item.source || "Other")}</span>
          </div>
          <div class="enquiry-meta">
            <div><b>${escapeHtml(formatDate(item.serviceDate))}</b>${item.pickupTime ? ` at ${escapeHtml(item.pickupTime)}` : ""}</div>
            <div>${escapeHtml(route)}</div>
            <div>${escapeHtml(contact)}</div>
            <div class="muted">Status: ${escapeHtml(item.status || "New")} · Priority: ${escapeHtml(item.priority || "Normal")}</div>
          </div>
        </article>
      `;
    })
    .join("");
}

function startQueueListener() {
  if (unsubscribeEnquiries) unsubscribeEnquiries();

  const enquiriesQuery = query(
    collection(db, "enquiries"),
    orderBy("createdAt", "desc"),
    limit(25)
  );

  unsubscribeEnquiries = onSnapshot(
    enquiriesQuery,
    (snapshot) => {
      renderQueue(snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() })));
    },
    (error) => {
      els.queue.innerHTML = `<div class="empty">Unable to load enquiries.</div>`;
      showStatus(error?.message || "Unable to load enquiries.", "error");
    }
  );
}

async function saveEnquiry(event) {
  event.preventDefault();
  clearStatus();

  if (!currentUser || !isAdminEmail(currentUser.email)) {
    showStatus("Admin access is required to create an enquiry.", "error");
    return;
  }

  els.saveBtn.disabled = true;
  els.saveBtn.textContent = "Saving...";

  try {
    const payload = buildEnquiryPayload();
    const docRef = await addDoc(collection(db, "enquiries"), payload);
    els.form.reset();
    document.getElementById("source").value = "Phone";
    document.getElementById("priority").value = "Normal";
    document.getElementById("journeyType").value = "One way";
    showStatus(`Enquiry saved successfully. Reference: ${docRef.id}`);
  } catch (error) {
    showStatus(error?.message || "Unable to save enquiry.", "error");
  } finally {
    els.saveBtn.disabled = false;
    els.saveBtn.textContent = "Save enquiry";
  }
}

els.form.addEventListener("submit", saveEnquiry);
els.resetBtn.addEventListener("click", () => {
  els.form.reset();
  clearStatus();
});
els.loginBtn.addEventListener("click", () => signInWithPopup(auth, provider));
els.logoutBtn.addEventListener("click", () => signOut(auth));

onAuthStateChanged(auth, (user) => {
  currentUser = user;

  if (!user) {
    els.authText.textContent = "Not signed in";
    els.loginBtn.style.display = "inline-flex";
    els.logoutBtn.style.display = "none";
    els.form.style.display = "none";
    els.queue.innerHTML = `<div class="empty">Sign in to load enquiries.</div>`;
    if (unsubscribeEnquiries) unsubscribeEnquiries();
    return;
  }

  const isAdmin = isAdminEmail(user.email);
  els.authText.textContent = isAdmin ? `Admin: ${user.email}` : `Signed in: ${user.email}`;
  els.loginBtn.style.display = "none";
  els.logoutBtn.style.display = "inline-flex";
  els.form.style.display = isAdmin ? "block" : "none";

  if (!isAdmin) {
    els.queue.innerHTML = `<div class="empty">This workspace is restricted to administrators.</div>`;
    showStatus("Your account does not have enquiry-management access.", "error");
    return;
  }

  clearStatus();
  startQueueListener();
});
