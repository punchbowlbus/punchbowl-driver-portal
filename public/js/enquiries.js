import {
  collection,
  doc,
  query,
  orderBy,
  limit,
  onSnapshot,
  serverTimestamp,
  writeBatch
} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";
import { onAuthStateChanged, signInWithPopup, signOut } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-auth.js";

import { auth, db, provider } from "./firebase.js";
import { ADMIN_EMAILS } from "./config.js";
import { normalizeEmail, escapeHtml } from "./utils.js";
import { initialiseCustomerSearch, stopCustomerSearch } from "./customer_search.js";

const el = (id) => document.getElementById(id);
const value = (id) => String(el(id)?.value || "").trim();
const els = {
  authText: el("authText"), loginBtn: el("loginBtn"), logoutBtn: el("logoutBtn"),
  status: el("status"), form: el("enquiryForm"), saveBtn: el("saveBtn"),
  resetBtn: el("resetBtn"), queue: el("queue"), assignedTo: el("assignedTo")
};

let currentUser = null;
let selectedCustomer = null;
let saving = false;
let unsubscribeEnquiries = null;
let unsubscribeEmployees = null;

function isAdmin(email) {
  return ADMIN_EMAILS.map(normalizeEmail).includes(normalizeEmail(email));
}

function showStatus(message, type = "success") {
  els.status.className = `notice ${type}`;
  els.status.innerHTML = `<strong>${type === "success" ? "Saved" : "Action required"}</strong><span>${escapeHtml(message)}</span>`;
  els.status.scrollIntoView({behavior: "smooth", block: "nearest"});
}

function clearStatus() {
  els.status.className = "notice";
  els.status.innerHTML = "";
}

function makeReference() {
  const date = new Date();
  const stamp = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
  return `ENQ-${stamp}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
}

function optionalNumber(id) {
  const raw = value(id);
  if (!raw) return null;
  const number = Number(raw);
  return Number.isFinite(number) ? number : null;
}

function setValue(id, newValue) {
  const input = el(id);
  if (input) input.value = newValue ?? "";
}

function applyCustomer(customer) {
  selectedCustomer = customer;
  setValue("organisationName", customer.organisationName);
  setValue("contactName", customer.contactName);
  setValue("phone", customer.phone);
  setValue("email", customer.email);
  setValue("billingEmail", customer.billingEmail);
  setValue("paymentTerms", customer.paymentTerms);
  setValue("accountManagerEmail", customer.accountManagerEmail);
  setValue("source", "Repeat customer");
  el("selectedCustomerName").textContent = customer.organisationName || customer.contactName;
  el("selectedCustomer").hidden = false;
  el("customerSearchInput").value = "";
  el("customerSearchResults").innerHTML = "";
}

function clearSelectedCustomer() {
  selectedCustomer = null;
  el("selectedCustomer").hidden = true;
  el("selectedCustomerName").textContent = "";
}

function validate() {
  const required = [
    ["contactName", "Contact name"], ["serviceDate", "Outward date"],
    ["pickupTime", "Pickup time"], ["pickupLocation", "Pickup location"],
    ["destination", "Destination"], ["passengerCount", "Passenger count"]
  ];
  for (const [id, label] of required) {
    if (!value(id)) throw new Error(`${label} is required.`);
  }
  if (!value("phone") && !value("email")) throw new Error("Enter a phone number or email address.");
  if (value("journeyType") === "Return" && (!value("returnDate") || !value("returnTime"))) {
    throw new Error("Return date and return time are required for a return journey.");
  }
  if (value("followUpDate") && value("followUpDate") < new Date().toISOString().slice(0, 10)) {
    throw new Error("Follow-up date cannot be in the past.");
  }
}

function buildPayload(reference, organisationId, contactId) {
  const email = normalizeEmail(value("email"));
  const passengers = optionalNumber("passengerCount");
  const stops = value("stops").split("\n").map((item) => item.trim()).filter(Boolean);
  const assignedOption = els.assignedTo.selectedOptions[0];
  const assignedToEmail = normalizeEmail(value("assignedTo") || currentUser.email);
  const customer = {
    organisationName: value("organisationName"), contactName: value("contactName"),
    phone: value("phone"), email, billingEmail: normalizeEmail(value("billingEmail")),
    paymentTerms: value("paymentTerms"), accountManagerEmail: normalizeEmail(value("accountManagerEmail"))
  };
  const trip = {
    journeyType: value("journeyType"), outwardDate: value("serviceDate"),
    outwardTime: value("pickupTime"), returnDate: value("returnDate"), returnTime: value("returnTime"),
    pickupLocation: value("pickupLocation"), destination: value("destination"), stops,
    passengerCount: passengers, vehicleRequirements: value("vehiclePreference"),
    specialInstructions: value("specialRequirements")
  };

  return {
    reference, schemaVersion: 2, deleted: false,
    source: value("source"), channel: value("source"), priority: value("priority") || "Normal",
    status: value("enquiryStatus") || "New", organisationId, contactId, customer, trip,
    assignedToEmail, assignedToName: assignedOption?.dataset.name || assignedToEmail,
    followUpDate: value("followUpDate"), notes: value("notes"), aiProcessingStatus: "Not started",
    createdByEmail: normalizeEmail(currentUser.email), createdByUid: currentUser.uid,
    createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    // Compatibility fields used by the existing portal and previous-enquiry search.
    organisationName: customer.organisationName, contactName: customer.contactName,
    phone: customer.phone, email: customer.email, journeyType: trip.journeyType,
    serviceDate: trip.outwardDate, returnDate: trip.returnDate, pickupTime: trip.outwardTime,
    returnTime: trip.returnTime, pickupLocation: trip.pickupLocation, destination: trip.destination,
    stops, passengerCount: passengers, vehiclePreference: trip.vehicleRequirements,
    specialRequirements: trip.specialInstructions
  };
}

async function saveEnquiry(event) {
  event.preventDefault();
  if (saving) return;
  clearStatus();
  if (!currentUser || !isAdmin(currentUser.email)) return showStatus("Administrator access is required.", "error");

  try {
    validate();
    saving = true;
    els.saveBtn.disabled = true;
    els.saveBtn.innerHTML = `<span class="spinner"></span> Saving enquiry…`;

    const batch = writeBatch(db);
    const organisationRef = selectedCustomer?.organisationId
      ? doc(db, "organisations", selectedCustomer.organisationId)
      : doc(collection(db, "organisations"));
    const contactRef = selectedCustomer?.contactId
      ? doc(db, "customerContacts", selectedCustomer.contactId)
      : doc(collection(db, "customerContacts"));
    const enquiryRef = doc(collection(db, "enquiries"));
    const reference = makeReference();

    batch.set(organisationRef, {
      name: value("organisationName") || value("contactName"), billingEmail: normalizeEmail(value("billingEmail")),
      paymentTerms: value("paymentTerms"), accountManagerEmail: normalizeEmail(value("accountManagerEmail")),
      phone: value("phone"), email: normalizeEmail(value("email")), active: true,
      updatedAt: serverTimestamp(), updatedByEmail: normalizeEmail(currentUser.email),
      ...(!selectedCustomer?.organisationId ? {createdAt: serverTimestamp(), createdByEmail: normalizeEmail(currentUser.email)} : {})
    }, {merge: true});
    batch.set(contactRef, {
      organisationId: organisationRef.id, displayName: value("contactName"), phone: value("phone"),
      email: normalizeEmail(value("email")), isPrimary: true, active: true,
      updatedAt: serverTimestamp(), updatedByEmail: normalizeEmail(currentUser.email)
    }, {merge: true});
    batch.set(enquiryRef, buildPayload(reference, organisationRef.id, contactRef.id));
    await batch.commit();

    resetForm();
    showStatus(`Enquiry ${reference} was saved successfully.`);
  } catch (error) {
    showStatus(error?.message || "Unable to save the enquiry.", "error");
  } finally {
    saving = false;
    els.saveBtn.disabled = false;
    els.saveBtn.textContent = "Save enquiry";
  }
}

function resetForm() {
  els.form.reset();
  setValue("source", "Phone"); setValue("priority", "Normal"); setValue("enquiryStatus", "New");
  setValue("journeyType", "One way"); setValue("assignedTo", normalizeEmail(currentUser?.email));
  clearSelectedCustomer();
  toggleReturnFields();
}

function toggleReturnFields() {
  el("returnFields").hidden = value("journeyType") !== "Return";
}

function formatDate(date) {
  if (!date) return "Date pending";
  const parsed = new Date(`${date}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? date : new Intl.DateTimeFormat("en-AU", {day: "2-digit", month: "short", year: "numeric"}).format(parsed);
}

function renderQueue(items) {
  const active = items.filter((item) => !item.deleted);
  if (!active.length) return els.queue.innerHTML = `<div class="empty">No enquiries have been created yet.</div>`;
  els.queue.innerHTML = active.map((item) => `
    <article class="queue-card">
      <div class="queue-top"><strong>${escapeHtml(item.reference || item.id)}</strong><span>${escapeHtml(item.status || "New")}</span></div>
      <h3>${escapeHtml(item.organisationName || item.contactName || "Unnamed customer")}</h3>
      <p>${escapeHtml(item.pickupLocation || "Pickup pending")} → ${escapeHtml(item.destination || "Destination pending")}</p>
      <div class="queue-meta"><b>${escapeHtml(formatDate(item.serviceDate))}${item.pickupTime ? ` · ${escapeHtml(item.pickupTime)}` : ""}</b><small>${escapeHtml(item.source || "Other")} · ${escapeHtml(item.assignedToName || item.assignedToEmail || "Unassigned")}</small></div>
    </article>`).join("");
}

function startListeners() {
  unsubscribeEnquiries?.(); unsubscribeEmployees?.();
  unsubscribeEnquiries = onSnapshot(query(collection(db, "enquiries"), orderBy("createdAt", "desc"), limit(40)),
    (snapshot) => renderQueue(snapshot.docs.map((item) => ({id: item.id, ...item.data()}))),
    (error) => showStatus(error?.message || "Unable to load enquiries.", "error"));
  unsubscribeEmployees = onSnapshot(query(collection(db, "employees"), limit(250)), (snapshot) => {
    const staff = snapshot.docs.map((item) => item.data()).filter((item) => item.deleted !== true && String(item.status || "Active") === "Active" && item.email);
    const ownEmail = normalizeEmail(currentUser.email);
    els.assignedTo.innerHTML = staff.sort((a, b) => String(a.displayName || a.email).localeCompare(String(b.displayName || b.email)))
      .map((item) => `<option value="${escapeHtml(normalizeEmail(item.email))}" data-name="${escapeHtml(item.displayName || item.email)}">${escapeHtml(item.displayName || item.email)}</option>`).join("");
    if (![...els.assignedTo.options].some((option) => option.value === ownEmail)) {
      els.assignedTo.insertAdjacentHTML("afterbegin", `<option value="${escapeHtml(ownEmail)}" data-name="${escapeHtml(currentUser.displayName || ownEmail)}">${escapeHtml(currentUser.displayName || ownEmail)}</option>`);
    }
    els.assignedTo.value = ownEmail;
  });
  initialiseCustomerSearch({onSelect: applyCustomer});
}

els.form.addEventListener("submit", saveEnquiry);
els.resetBtn.addEventListener("click", () => { resetForm(); clearStatus(); });
el("clearSelectedCustomer").addEventListener("click", clearSelectedCustomer);
el("journeyType").addEventListener("change", toggleReturnFields);
els.loginBtn.addEventListener("click", () => signInWithPopup(auth, provider));
els.logoutBtn.addEventListener("click", () => signOut(auth));

onAuthStateChanged(auth, (user) => {
  currentUser = user;
  const allowed = user && isAdmin(user.email);
  els.authText.textContent = user ? `${user.displayName || user.email}` : "Not signed in";
  els.loginBtn.hidden = Boolean(user); els.logoutBtn.hidden = !user;
  els.form.closest(".workspace-card").hidden = !allowed;
  if (!user) els.queue.innerHTML = `<div class="empty">Sign in to access enquiries.</div>`;
  else if (!allowed) showStatus("Your account does not have enquiry-management access.", "error");
  else { clearStatus(); startListeners(); }
});

toggleReturnFields();
