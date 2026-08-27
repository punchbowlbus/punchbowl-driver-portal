import {
  collection,
  doc,
  query,
  limit,
  onSnapshot,
  serverTimestamp,
  writeBatch,
  updateDoc
} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";
import { onAuthStateChanged, signInWithPopup, signOut } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-auth.js";

import { auth, db, provider } from "./firebase.js";
import { ADMIN_EMAILS } from "./config.js";
import { normalizeEmail, escapeHtml } from "./utils.js";

const byId = (id) => document.getElementById(id);
const value = (id) => String(byId(id)?.value || "").trim();
const setValue = (id, newValue) => { if (byId(id)) byId(id).value = newValue ?? ""; };
const els = {
  authText: byId("authText"), loginBtn: byId("loginBtn"), logoutBtn: byId("logoutBtn"),
  status: byId("status"), list: byId("customerList"), count: byId("customerCount"),
  search: byId("customerSearch"), welcome: byId("customerWelcome"), form: byId("customerForm"),
  profileTitle: byId("profileTitle"), profileSubtitle: byId("profileSubtitle"),
  deactivateBtn: byId("deactivateBtn"), saveBtn: byId("saveCustomerBtn"),
  contactList: byId("contactList"), contactEditor: byId("contactEditor"), historyList: byId("historyList")
};

let currentUser = null;
let organisations = [];
let contacts = [];
let enquiries = [];
let selectedOrganisationId = null;
let editingContactId = null;
let activeFilter = "active";
let saving = false;
let unsubscribers = [];
let requestedOrganisationId = new URLSearchParams(window.location.search).get("organisationId") || "";

function isAdmin(email) {
  return ADMIN_EMAILS.map(normalizeEmail).includes(normalizeEmail(email));
}

function normalise(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9@+]+/g, " ").trim();
}

function lines(value) {
  return String(value || "").split("\n").map((item) => item.trim()).filter(Boolean);
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

function organisationContacts(id) {
  return contacts.filter((item) => item.organisationId === id && item.deleted !== true);
}

function organisationEnquiries(organisation) {
  const name = normalise(organisation?.name || organisation?.organisationName);
  return enquiries.filter((item) => {
    if (item.deleted) return false;
    if (item.organisationId === organisation.id) return true;
    return !item.organisationId && name && normalise(item.organisationName) === name;
  }).sort((a, b) => String(b.serviceDate || "").localeCompare(String(a.serviceDate || "")));
}

function renderDirectory() {
  const term = normalise(els.search.value);
  const filtered = organisations
    .filter((item) => item.deleted !== true)
    .filter((item) => activeFilter === "all" || (activeFilter === "active" ? item.active !== false : item.active === false))
    .filter((item) => {
      if (!term) return true;
      const linkedContacts = organisationContacts(item.id);
      return normalise([item.name, item.phone, item.email, ...linkedContacts.flatMap((contact) => [contact.displayName, contact.phone, contact.email])].join(" ")).includes(term);
    })
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));

  const activeCount = organisations.filter((item) => item.deleted !== true && item.active !== false).length;
  els.count.textContent = `${activeCount} active · ${organisations.filter((item) => !item.deleted).length} total`;
  if (!filtered.length) {
    els.list.innerHTML = `<div class="empty">No matching customers.</div>`;
    return;
  }

  els.list.innerHTML = filtered.map((item) => {
    const primary = organisationContacts(item.id).find((contact) => contact.isPrimary) || organisationContacts(item.id)[0] || {};
    const historyCount = organisationEnquiries(item).length;
    return `<button class="customer-row ${selectedOrganisationId === item.id ? "active" : ""}" type="button" data-organisation-id="${escapeHtml(item.id)}">
      <strong>${escapeHtml(item.name || "Unnamed customer")}</strong>
      <small>${escapeHtml(primary.displayName || item.email || item.phone || "No primary contact")}</small>
      <span class="row-bottom"><span class="pill ${item.active === false ? "inactive" : ""}">${item.active === false ? "Inactive" : "Active"}</span><span>${historyCount} enquir${historyCount === 1 ? "y" : "ies"}</span></span>
    </button>`;
  }).join("");

  els.list.querySelectorAll("[data-organisation-id]").forEach((button) => {
    button.addEventListener("click", () => selectOrganisation(button.dataset.organisationId));
  });
}

function formatDate(date) {
  if (!date) return "Date pending";
  const parsed = new Date(`${date}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? date : new Intl.DateTimeFormat("en-AU", {day: "2-digit", month: "short", year: "numeric"}).format(parsed);
}

function renderHistory(organisation) {
  const history = organisationEnquiries(organisation);
  if (!history.length) {
    els.historyList.innerHTML = `<div class="empty">No enquiries linked to this customer.</div>`;
    return;
  }
  els.historyList.innerHTML = history.slice(0, 25).map((item) => `
    <article class="history-card"><div class="history-top"><strong>${escapeHtml(item.reference || item.id)}</strong><span class="pill">${escapeHtml(item.status || "New")}</span></div>
      <h4>${escapeHtml(item.pickupLocation || "Pickup pending")} → ${escapeHtml(item.destination || "Destination pending")}</h4>
      <p>${escapeHtml(formatDate(item.serviceDate))}${item.pickupTime ? ` · ${escapeHtml(item.pickupTime)}` : ""} · ${escapeHtml(item.passengerCount || "Passenger count pending")} passengers</p>
      <small>${escapeHtml(item.source || "Other")} · ${escapeHtml(item.assignedToName || item.assignedToEmail || "Unassigned")}</small>
    </article>`).join("");
}

function renderContacts(id) {
  const linked = organisationContacts(id).sort((a, b) => Number(Boolean(b.isPrimary)) - Number(Boolean(a.isPrimary)) || String(a.displayName || "").localeCompare(String(b.displayName || "")));
  if (!linked.length) {
    els.contactList.innerHTML = `<div class="empty">No contacts saved for this customer.</div>`;
    return;
  }
  els.contactList.innerHTML = linked.map((contact) => `<article class="contact-card"><div><strong>${escapeHtml(contact.displayName || "Unnamed contact")}${contact.isPrimary ? ` <span class="pill">Primary</span>` : ""}</strong><small>${escapeHtml(contact.role || contact.contactType || "Contact")} · ${escapeHtml(contact.phone || contact.email || "No contact method")}</small></div><button type="button" data-edit-contact="${escapeHtml(contact.id)}">Edit</button></article>`).join("");
  els.contactList.querySelectorAll("[data-edit-contact]").forEach((button) => button.addEventListener("click", () => editContact(button.dataset.editContact)));
}

function showContactEditor(contact = null) {
  editingContactId = contact?.id || null;
  byId("contactEditorTitle").textContent = contact ? "Edit contact" : selectedOrganisationId ? "Add contact" : "Primary contact";
  setValue("contactName", contact?.displayName || ""); setValue("contactRole", contact?.role || "");
  setValue("contactType", contact?.contactType || "Bookings"); setValue("contactPhone", contact?.phone || "");
  setValue("contactEmail", contact?.email || ""); setValue("contactPrimary", String(contact?.isPrimary ?? !organisationContacts(selectedOrganisationId).length));
  els.contactEditor.hidden = false;
}

function editContact(id) {
  const contact = contacts.find((item) => item.id === id);
  if (contact) showContactEditor(contact);
}

function fillOrganisationForm(item) {
  setValue("organisationName", item.name || item.organisationName); setValue("organisationType", item.organisationType || "Organisation");
  setValue("organisationStatus", item.active === false ? "Inactive" : "Active"); setValue("organisationPhone", item.phone);
  setValue("organisationEmail", item.email); setValue("accountManagerEmail", item.accountManagerEmail);
  setValue("billingName", item.billingName); setValue("abn", item.abn); setValue("billingEmail", item.billingEmail);
  setValue("paymentTerms", item.paymentTerms); setValue("billingAddress", item.billingAddress);
  setValue("preferredRoutes", Array.isArray(item.preferredRoutes) ? item.preferredRoutes.join("\n") : item.preferredRoutes);
  setValue("preferredVehicles", Array.isArray(item.preferredVehicles) ? item.preferredVehicles.join("\n") : item.preferredVehicles);
  setValue("internalNotes", item.internalNotes);
}

function selectOrganisation(id) {
  const organisation = organisations.find((item) => item.id === id);
  if (!organisation) return;
  clearStatus(); selectedOrganisationId = id; editingContactId = null;
  els.welcome.hidden = true; els.form.hidden = false; els.profileTitle.textContent = organisation.name || "Customer profile";
  els.profileSubtitle.textContent = `${organisationContacts(id).length} contact${organisationContacts(id).length === 1 ? "" : "s"} · ${organisationEnquiries(organisation).length} linked enquir${organisationEnquiries(organisation).length === 1 ? "y" : "ies"}`;
  els.deactivateBtn.hidden = false; els.deactivateBtn.textContent = organisation.active === false ? "Reactivate" : "Deactivate";
  fillOrganisationForm(organisation); renderContacts(id); renderHistory(organisation); els.contactEditor.hidden = true; renderDirectory();
}

function newCustomer() {
  clearStatus(); selectedOrganisationId = null; editingContactId = null; els.form.reset();
  els.welcome.hidden = true; els.form.hidden = false; els.profileTitle.textContent = "New customer";
  els.profileSubtitle.textContent = "Create a reusable organisation and primary contact record."; els.deactivateBtn.hidden = true;
  setValue("organisationType", "Organisation"); setValue("organisationStatus", "Active");
  els.contactList.innerHTML = `<div class="empty">The primary contact will be created when the customer is saved.</div>`;
  els.historyList.innerHTML = `<div class="empty">No enquiries linked to this customer.</div>`; showContactEditor(); renderDirectory();
  byId("organisationName").focus();
}

function organisationPayload() {
  return {
    name: value("organisationName"), organisationType: value("organisationType"), active: value("organisationStatus") !== "Inactive",
    phone: value("organisationPhone"), email: normalizeEmail(value("organisationEmail")),
    accountManagerEmail: normalizeEmail(value("accountManagerEmail")), billingName: value("billingName"),
    abn: value("abn"), billingEmail: normalizeEmail(value("billingEmail")), billingAddress: value("billingAddress"),
    paymentTerms: value("paymentTerms"), preferredRoutes: lines(value("preferredRoutes")),
    preferredVehicles: lines(value("preferredVehicles")), internalNotes: value("internalNotes"),
    updatedAt: serverTimestamp(), updatedByEmail: normalizeEmail(currentUser.email), schemaVersion: 1
  };
}

function contactPayload(organisationId) {
  return {
    organisationId, displayName: value("contactName"), role: value("contactRole"), contactType: value("contactType"),
    phone: value("contactPhone"), email: normalizeEmail(value("contactEmail")), isPrimary: value("contactPrimary") === "true",
    active: true, updatedAt: serverTimestamp(), updatedByEmail: normalizeEmail(currentUser.email), schemaVersion: 1
  };
}

async function saveCustomer(event) {
  event.preventDefault();
  if (saving) return;
  clearStatus();
  if (!value("organisationName")) return showStatus("Organisation or customer name is required.", "error");
  if (!selectedOrganisationId && !value("contactName")) return showStatus("A primary contact name is required for a new customer.", "error");

  saving = true; els.saveBtn.disabled = true; els.saveBtn.innerHTML = `<span class="spinner"></span> Saving customer…`;
  try {
    const batch = writeBatch(db);
    const organisationRef = selectedOrganisationId ? doc(db, "organisations", selectedOrganisationId) : doc(collection(db, "organisations"));
    batch.set(organisationRef, {
      ...organisationPayload(),
      ...(!selectedOrganisationId ? {createdAt: serverTimestamp(), createdByEmail: normalizeEmail(currentUser.email)} : {})
    }, {merge: true});
    if (!selectedOrganisationId) {
      const contactRef = doc(collection(db, "customerContacts"));
      batch.set(contactRef, {...contactPayload(organisationRef.id), isPrimary: true, createdAt: serverTimestamp(), createdByEmail: normalizeEmail(currentUser.email)});
    }
    await batch.commit();
    selectedOrganisationId = organisationRef.id;
    showStatus(`${value("organisationName")} was saved successfully.`);
  } catch (error) {
    showStatus(error?.message || "Unable to save the customer.", "error");
  } finally {
    saving = false; els.saveBtn.disabled = false; els.saveBtn.textContent = "Save customer";
  }
}

async function saveContact() {
  clearStatus();
  if (!selectedOrganisationId) return showStatus("Save the customer before adding another contact.", "error");
  if (!value("contactName")) return showStatus("Contact name is required.", "error");
  if (!value("contactPhone") && !value("contactEmail")) return showStatus("Enter a contact phone number or email address.", "error");
  const button = byId("saveContactBtn"); button.disabled = true; button.textContent = "Saving…";
  try {
    const batch = writeBatch(db);
    const contactRef = editingContactId ? doc(db, "customerContacts", editingContactId) : doc(collection(db, "customerContacts"));
    if (value("contactPrimary") === "true") {
      organisationContacts(selectedOrganisationId).filter((item) => item.id !== contactRef.id && item.isPrimary).forEach((item) => batch.set(doc(db, "customerContacts", item.id), {isPrimary: false, updatedAt: serverTimestamp()}, {merge: true}));
    }
    batch.set(contactRef, {...contactPayload(selectedOrganisationId), ...(!editingContactId ? {createdAt: serverTimestamp(), createdByEmail: normalizeEmail(currentUser.email)} : {})}, {merge: true});
    await batch.commit(); showStatus(`${value("contactName")} was saved successfully.`); els.contactEditor.hidden = true; editingContactId = null;
  } catch (error) {
    showStatus(error?.message || "Unable to save the contact.", "error");
  } finally { button.disabled = false; button.textContent = "Save contact"; }
}

async function toggleActive() {
  const organisation = organisations.find((item) => item.id === selectedOrganisationId);
  if (!organisation) return;
  const nextActive = organisation.active === false;
  if (!nextActive && !confirm(`Deactivate ${organisation.name}? The history will be retained.`)) return;
  try {
    await updateDoc(doc(db, "organisations", organisation.id), {active: nextActive, updatedAt: serverTimestamp(), updatedByEmail: normalizeEmail(currentUser.email)});
    showStatus(`${organisation.name} was ${nextActive ? "reactivated" : "deactivated"}.`);
  } catch (error) { showStatus(error?.message || "Unable to update customer status.", "error"); }
}

function startListeners() {
  unsubscribers.forEach((unsubscribe) => unsubscribe());
  unsubscribers = [
    onSnapshot(query(collection(db, "organisations"), limit(500)), (snapshot) => { organisations = snapshot.docs.map((item) => ({id: item.id, ...item.data()})); renderDirectory(); if (selectedOrganisationId) selectOrganisation(selectedOrganisationId); else if (requestedOrganisationId && organisations.some((item) => item.id === requestedOrganisationId)) { const id = requestedOrganisationId; requestedOrganisationId = ""; selectOrganisation(id); } }, (error) => showStatus(error.message, "error")),
    onSnapshot(query(collection(db, "customerContacts"), limit(1000)), (snapshot) => { contacts = snapshot.docs.map((item) => ({id: item.id, ...item.data()})); renderDirectory(); if (selectedOrganisationId) { renderContacts(selectedOrganisationId); const org = organisations.find((item) => item.id === selectedOrganisationId); if (org) renderHistory(org); } }, () => {}),
    onSnapshot(query(collection(db, "enquiries"), limit(1000)), (snapshot) => { enquiries = snapshot.docs.map((item) => ({id: item.id, ...item.data()})); renderDirectory(); if (selectedOrganisationId) { const org = organisations.find((item) => item.id === selectedOrganisationId); if (org) renderHistory(org); } }, () => {}),
    onSnapshot(query(collection(db, "employees"), limit(300)), (snapshot) => {
      const selected = value("accountManagerEmail");
      const staff = snapshot.docs.map((item) => item.data()).filter((item) => item.deleted !== true && item.status !== "Inactive" && item.email).sort((a, b) => String(a.displayName || a.email).localeCompare(String(b.displayName || b.email)));
      byId("accountManagerEmail").innerHTML = `<option value="">Unassigned</option>${staff.map((item) => `<option value="${escapeHtml(normalizeEmail(item.email))}">${escapeHtml(item.displayName || item.email)}</option>`).join("")}`;
      setValue("accountManagerEmail", selected);
    }, () => {})
  ];
}

byId("newCustomerBtn").addEventListener("click", newCustomer);
els.search.addEventListener("input", renderDirectory);
document.querySelectorAll("[data-filter]").forEach((button) => button.addEventListener("click", () => { activeFilter = button.dataset.filter; document.querySelectorAll("[data-filter]").forEach((item) => item.classList.toggle("active", item === button)); renderDirectory(); }));
els.form.addEventListener("submit", saveCustomer);
byId("addContactBtn").addEventListener("click", () => showContactEditor());
byId("saveContactBtn").addEventListener("click", saveContact);
byId("cancelContactBtn").addEventListener("click", () => { editingContactId = null; els.contactEditor.hidden = true; });
els.deactivateBtn.addEventListener("click", toggleActive);
els.loginBtn.addEventListener("click", () => signInWithPopup(auth, provider));
els.logoutBtn.addEventListener("click", () => signOut(auth));

onAuthStateChanged(auth, (user) => {
  currentUser = user;
  const allowed = user && isAdmin(user.email);
  els.authText.textContent = user ? (user.displayName || user.email) : "Not signed in";
  els.loginBtn.hidden = Boolean(user); els.logoutBtn.hidden = !user;
  if (!allowed) {
    unsubscribers.forEach((unsubscribe) => unsubscribe());
    unsubscribers = [];
    els.form.hidden = true;
    els.welcome.hidden = false;
  }
  if (!user) els.list.innerHTML = `<div class="empty">Sign in to load customers.</div>`;
  else if (!allowed) {
    els.list.innerHTML = `<div class="empty">Administrator access is required.</div>`;
    showStatus("Your account does not have customer-management access.", "error");
  }
  else { clearStatus(); startListeners(); }
});
