import {
  collection,
  query,
  orderBy,
  limit,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-auth.js";

import { auth, db } from "./firebase.js";
import { ADMIN_EMAILS } from "./config.js";
import { normalizeEmail, escapeHtml } from "./utils.js";

const CUSTOMER_FIELDS = [
  "organisationName",
  "contactName",
  "phone",
  "email"
];

const TRIP_FIELDS = [
  "journeyType",
  "pickupTime",
  "pickupLocation",
  "destination",
  "passengerCount",
  "vehiclePreference",
  "specialRequirements"
];

let enquiryHistory = [];
let unsubscribe = null;

function isAdmin(email) {
  const normalized = normalizeEmail(email || "");
  return ADMIN_EMAILS.map(normalizeEmail).includes(normalized);
}

function normalizeSearch(value) {
  return String(value || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function setField(id, value) {
  const input = document.getElementById(id);
  if (!input) return;
  input.value = value ?? "";
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function applyCustomer(enquiry) {
  CUSTOMER_FIELDS.forEach((field) => setField(field, enquiry[field]));
  setField("source", "Repeat customer");
  document.getElementById("contactName")?.focus();
}

function applyTrip(enquiry) {
  applyCustomer(enquiry);
  TRIP_FIELDS.forEach((field) => setField(field, enquiry[field]));
  setField("stops", Array.isArray(enquiry.stops) ? enquiry.stops.join("\n") : enquiry.stops);
  setField("returnDate", "");
  setField("serviceDate", "");
}

function formatDate(value) {
  if (!value) return "Date not recorded";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-AU", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  }).format(date);
}

function buildCustomerGroups(items) {
  const groups = new Map();

  items.forEach((item) => {
    if (item.deleted) return;

    const key = normalizeSearch(
      item.organisationName || item.email || item.phone || item.contactName || item.id
    );
    if (!key) return;

    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  });

  return [...groups.values()].map((history) => {
    history.sort((a, b) => String(b.serviceDate || "").localeCompare(String(a.serviceDate || "")));
    return {
      latest: history[0],
      history,
      searchText: normalizeSearch(
        history
          .flatMap((item) => [
            item.organisationName,
            item.contactName,
            item.phone,
            item.email,
            item.pickupLocation,
            item.destination
          ])
          .filter(Boolean)
          .join(" ")
      )
    };
  });
}

function renderResults(searchTerm = "") {
  const results = document.getElementById("customerSearchResults");
  if (!results) return;

  const term = normalizeSearch(searchTerm);
  if (term.length < 2) {
    results.innerHTML = `<div class="customer-search-empty">Enter at least two characters to search previous enquiries.</div>`;
    return;
  }

  const matches = buildCustomerGroups(enquiryHistory)
    .filter((group) => group.searchText.includes(term))
    .slice(0, 8);

  if (!matches.length) {
    results.innerHTML = `<div class="customer-search-empty">No previous customer found. Continue entering this as a new customer.</div>`;
    return;
  }

  results.innerHTML = matches
    .map(({ latest, history }) => {
      const customer = latest.organisationName || latest.contactName || "Unnamed customer";
      const route = [latest.pickupLocation, latest.destination].filter(Boolean).join(" → ");

      return `
        <article class="customer-result">
          <div class="customer-result-main">
            <div class="customer-result-name">${escapeHtml(customer)}</div>
            <div>${escapeHtml(latest.contactName || "")}</div>
            <div>${escapeHtml(latest.phone || latest.email || "No contact recorded")}</div>
            <div class="customer-result-muted">${history.length} previous ${history.length === 1 ? "enquiry" : "enquiries"}</div>
            <div class="customer-result-muted">Latest: ${escapeHtml(formatDate(latest.serviceDate))}${route ? ` · ${escapeHtml(route)}` : ""}</div>
          </div>
          <div class="customer-result-actions">
            <button type="button" data-use-customer="${escapeHtml(latest.id)}">Use customer</button>
            <button type="button" data-use-trip="${escapeHtml(latest.id)}">Duplicate trip</button>
          </div>
        </article>
      `;
    })
    .join("");

  results.querySelectorAll("[data-use-customer]").forEach((button) => {
    button.addEventListener("click", () => {
      const enquiry = enquiryHistory.find((item) => item.id === button.dataset.useCustomer);
      if (enquiry) applyCustomer(enquiry);
    });
  });

  results.querySelectorAll("[data-use-trip]").forEach((button) => {
    button.addEventListener("click", () => {
      const enquiry = enquiryHistory.find((item) => item.id === button.dataset.useTrip);
      if (enquiry) applyTrip(enquiry);
    });
  });
}

function installSearchUi() {
  if (document.getElementById("customerSearchPanel")) return;

  const customerTitle = [...document.querySelectorAll(".section-title")]
    .find((element) => element.textContent.trim() === "Customer");
  if (!customerTitle) return;

  const panel = document.createElement("section");
  panel.id = "customerSearchPanel";
  panel.className = "customer-search-panel";
  panel.innerHTML = `
    <div class="customer-search-heading">Find repeat customer</div>
    <div class="customer-search-help">Search organisation, contact, phone or email. Select a match to reuse customer details or duplicate the previous trip.</div>
    <input id="customerSearchInput" type="search" autocomplete="off" placeholder="Search previous customers" />
    <div id="customerSearchResults" class="customer-search-results">
      <div class="customer-search-empty">Enter at least two characters to search previous enquiries.</div>
    </div>
  `;

  customerTitle.insertAdjacentElement("afterend", panel);

  const style = document.createElement("style");
  style.textContent = `
    .customer-search-panel{margin:10px 0 16px;padding:14px;border:1px solid #dfe3e8;border-radius:12px;background:#f8fafc}
    .customer-search-heading{font-weight:900;margin-bottom:3px}
    .customer-search-help,.customer-result-muted{font-size:12px;color:#637381}
    #customerSearchInput{margin-top:10px}
    .customer-search-results{display:grid;gap:8px;margin-top:10px}
    .customer-search-empty{padding:12px;border:1px dashed #d5dbe1;border-radius:10px;color:#637381;font-size:13px;background:#fff}
    .customer-result{display:flex;justify-content:space-between;gap:12px;padding:12px;border:1px solid #dfe3e8;border-radius:10px;background:#fff}
    .customer-result-name{font-weight:900}
    .customer-result-main{font-size:13px;line-height:1.45}
    .customer-result-actions{display:flex;align-items:flex-start;gap:7px;flex-wrap:wrap;justify-content:flex-end}
    .customer-result-actions button{padding:7px 9px;font-size:12px}
    @media(max-width:640px){.customer-result{flex-direction:column}.customer-result-actions{justify-content:flex-start}}
  `;
  document.head.appendChild(style);

  const input = document.getElementById("customerSearchInput");
  input.addEventListener("input", () => renderResults(input.value));
}

function startHistoryListener() {
  if (unsubscribe) unsubscribe();

  const historyQuery = query(
    collection(db, "enquiries"),
    orderBy("createdAt", "desc"),
    limit(200)
  );

  unsubscribe = onSnapshot(
    historyQuery,
    (snapshot) => {
      enquiryHistory = snapshot.docs.map((document) => ({ id: document.id, ...document.data() }));
      const input = document.getElementById("customerSearchInput");
      if (input?.value) renderResults(input.value);
    },
    () => {
      const results = document.getElementById("customerSearchResults");
      if (results) results.innerHTML = `<div class="customer-search-empty">Customer history could not be loaded.</div>`;
    }
  );
}

installSearchUi();

onAuthStateChanged(auth, (user) => {
  if (user && isAdmin(user.email)) {
    installSearchUi();
    startHistoryListener();
    return;
  }

  if (unsubscribe) unsubscribe();
  unsubscribe = null;
  enquiryHistory = [];
});
