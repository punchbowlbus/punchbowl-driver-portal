import {
  collection,
  query,
  orderBy,
  limit,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";

import { db } from "./firebase.js";
import { escapeHtml } from "./utils.js";

const state = {
  organisations: [],
  contacts: [],
  enquiries: [],
  unsubscribers: [],
  onSelect: null
};

function normalise(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9@+]+/g, " ").trim();
}

function dateLabel(value) {
  if (!value) return "No previous trip date";
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("en-AU", {day: "2-digit", month: "short", year: "numeric"}).format(date);
}

function enquiryCustomerKey(item) {
  return normalise(item.organisationName || item.email || item.phone || item.contactName || item.id);
}

function buildResults() {
  const contactByOrganisation = new Map();
  state.contacts.forEach((contact) => {
    const id = contact.organisationId || "unlinked";
    if (!contactByOrganisation.has(id)) contactByOrganisation.set(id, []);
    contactByOrganisation.get(id).push(contact);
  });

  const records = state.organisations.map((organisation) => {
    const contacts = contactByOrganisation.get(organisation.id) || [];
    const related = state.enquiries.filter((item) => item.organisationId === organisation.id);
    const primary = contacts.find((item) => item.isPrimary) || contacts[0] || {};
    return {
      key: `org:${organisation.id}`,
      organisationId: organisation.id,
      contactId: primary.id || null,
      organisationName: organisation.name || organisation.organisationName || "",
      contactName: primary.displayName || primary.contactName || "",
      phone: primary.phone || organisation.phone || "",
      email: primary.email || organisation.email || "",
      billingEmail: organisation.billingEmail || "",
      paymentTerms: organisation.paymentTerms || "",
      accountManagerEmail: organisation.accountManagerEmail || "",
      internalNotes: organisation.internalNotes || "",
      history: related,
      source: "customer"
    };
  });

  const knownKeys = new Set(records.map((item) => normalise(item.organisationName || item.email || item.phone)));
  const legacyGroups = new Map();
  state.enquiries.forEach((item) => {
    const key = enquiryCustomerKey(item);
    if (!key || knownKeys.has(key)) return;
    if (!legacyGroups.has(key)) legacyGroups.set(key, []);
    legacyGroups.get(key).push(item);
  });

  legacyGroups.forEach((history, key) => {
    const latest = history[0] || {};
    records.push({
      key: `history:${key}`,
      organisationId: null,
      contactId: null,
      organisationName: latest.organisationName || "",
      contactName: latest.contactName || "",
      phone: latest.phone || "",
      email: latest.email || "",
      history,
      source: "history"
    });
  });

  return records;
}

function render(term) {
  const container = document.getElementById("customerSearchResults");
  if (!container) return;
  const search = normalise(term);
  if (search.length < 2) {
    container.innerHTML = `<div class="search-empty">Type at least two characters to find an organisation, contact, phone or email.</div>`;
    return;
  }

  const results = buildResults()
    .map((record) => ({
      ...record,
      searchText: normalise([record.organisationName, record.contactName, record.phone, record.email].join(" "))
    }))
    .filter((record) => record.searchText.includes(search))
    .slice(0, 8);

  if (!results.length) {
    container.innerHTML = `<div class="search-empty">No customer found. Continue below to create a new customer with this enquiry.</div>`;
    return;
  }

  container.innerHTML = results.map((record) => {
    const latest = record.history?.[0] || {};
    const route = [latest.pickupLocation, latest.destination].filter(Boolean).join(" → ");
    return `
      <button class="customer-match" type="button" data-customer-key="${escapeHtml(record.key)}">
        <span><strong>${escapeHtml(record.organisationName || record.contactName || "Unnamed customer")}</strong>
          <small>${escapeHtml(record.contactName || "No contact name")} · ${escapeHtml(record.phone || record.email || "No contact method")}</small>
          <small>${record.history?.length || 0} previous enquir${record.history?.length === 1 ? "y" : "ies"}${route ? ` · ${escapeHtml(dateLabel(latest.serviceDate))} · ${escapeHtml(route)}` : ""}</small>
        </span>
        <b>Use customer</b>
      </button>`;
  }).join("");

  container.querySelectorAll("[data-customer-key]").forEach((button) => {
    button.addEventListener("click", () => {
      const selected = results.find((record) => record.key === button.dataset.customerKey);
      if (selected) state.onSelect?.(selected);
    });
  });
}

function listenSafely(collectionName, apply, options = {}) {
  const reference = options.ordered
    ? query(collection(db, collectionName), orderBy(options.ordered, "desc"), limit(options.limit || 250))
    : query(collection(db, collectionName), limit(options.limit || 250));
  return onSnapshot(reference, (snapshot) => {
    apply(snapshot.docs.map((item) => ({id: item.id, ...item.data()})));
    const input = document.getElementById("customerSearchInput");
    if (input?.value) render(input.value);
  }, () => apply([]));
}

export function initialiseCustomerSearch({onSelect}) {
  state.onSelect = onSelect;
  state.unsubscribers.forEach((unsubscribe) => unsubscribe());
  state.unsubscribers = [
    listenSafely("organisations", (items) => { state.organisations = items; }),
    listenSafely("customerContacts", (items) => { state.contacts = items; }),
    listenSafely("enquiries", (items) => { state.enquiries = items; }, {ordered: "createdAt", limit: 300})
  ];

  const input = document.getElementById("customerSearchInput");
  if (input) input.addEventListener("input", () => render(input.value));
}

export function stopCustomerSearch() {
  state.unsubscribers.forEach((unsubscribe) => unsubscribe());
  state.unsubscribers = [];
}
