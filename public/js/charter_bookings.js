import {
  collection,
  doc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  setDoc
} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";

import { auth, db } from "./firebase.js";
import { state } from "./state.js";
import { els, showError } from "./ui.js";
import { escapeHtml } from "./utils.js";

const BOOKING_STATUSES = ["Draft", "Quoted", "Sent", "Confirmed", "Operational", "Completed", "Cancelled"];
const JOURNEY_TYPES = ["One Way", "Forward + Return", "Multi-stop", "Multiple Journeys"];
const VEHICLE_TYPES = ["To be recommended", "Mini Bus", "Standard Bus", "Coach", "Accessible Vehicle", "Multiple Vehicle Types"];

let bookings = [];
let organisations = [];
let contacts = [];
let selectedBookingId = "";
let stopSequence = 0;
let saving = false;

const byId = (id) => document.getElementById(id);
const value = (id) => String(byId(id)?.value || "").trim();
const numberValue = (id) => Number(byId(id)?.value || 0);
const money = (amount) => new Intl.NumberFormat("en-AU", {style: "currency", currency: "AUD"}).format(Number(amount || 0));

function localDate(date = new Date()) {
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

function displayDate(date) {
  if (!date) return "Date pending";
  const parsed = new Date(`${date}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? date : new Intl.DateTimeFormat("en-AU", {day: "2-digit", month: "short", year: "numeric"}).format(parsed);
}

function employeeName() {
  const employee = state.employee || {};
  return String(employee.displayName || employee.name || `${employee.firstName || ""} ${employee.lastName || ""}`.trim() || auth.currentUser?.email || "Portal user");
}

function statusClass(status) {
  return String(status || "draft").toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

function showPageMessage(message, type = "success") {
  const element = byId("charterMessage");
  if (!element) return;
  element.className = `charter-message ${type}`;
  element.innerHTML = `<strong>${type === "success" ? "Saved" : "Action required"}</strong><span>${escapeHtml(message)}</span>`;
  element.hidden = !message;
  element.scrollIntoView({behavior: "smooth", block: "nearest"});
}

function clearPageMessage() {
  const element = byId("charterMessage");
  if (element) { element.hidden = true; element.innerHTML = ""; }
}

async function loadData() {
  const [bookingSnapshot, organisationSnapshot, contactSnapshot] = await Promise.all([
    getDocs(query(collection(db, "charterBookings"), limit(500))),
    getDocs(query(collection(db, "organisations"), limit(500))),
    getDocs(query(collection(db, "customerContacts"), limit(1000)))
  ]);
  bookings = bookingSnapshot.docs.map((item) => ({id: item.id, ...item.data()})).filter((item) => item.deleted !== true)
    .sort((a, b) => String(b.createdAtIso || b.serviceDate || "").localeCompare(String(a.createdAtIso || a.serviceDate || "")));
  organisations = organisationSnapshot.docs.map((item) => ({id: item.id, ...item.data()})).filter((item) => item.deleted !== true && item.active !== false)
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
  contacts = contactSnapshot.docs.map((item) => ({id: item.id, ...item.data()})).filter((item) => item.deleted !== true && item.active !== false);
}

function renderPageShell() {
  els.contentArea.innerHTML = `
    <div class="charter-page">
      <header class="charter-hero">
        <div class="charter-hero-icon"><i data-lucide="notebook-tabs"></i></div>
        <div><div class="charter-kicker">Charter management</div><h2>Charter Bookings</h2><p>Manage customer requests, mapped itineraries, quotations and operational conversion in one workspace.</p></div>
        <div class="charter-hero-actions"><button id="refreshCharters" type="button" class="btn"><i data-lucide="refresh-cw"></i> Refresh</button><button id="newCharter" type="button" class="btn primary"><i data-lucide="plus"></i> New Charter</button></div>
      </header>
      <div id="charterMessage" class="charter-message" hidden></div>
      <div id="charterSummary" class="charter-summary"></div>
      <section class="charter-filters">
        <label><span>Search bookings</span><input id="charterSearch" placeholder="Reference, customer, location or contact" /></label>
        <label><span>Status</span><select id="charterStatusFilter"><option value="">All statuses</option>${BOOKING_STATUSES.map((status) => `<option>${status}</option>`).join("")}</select></label>
        <label><span>Travel date</span><input id="charterDateFilter" type="date" /></label>
      </section>
      <div class="charter-workspace">
        <aside class="charter-list-card"><div class="charter-list-head"><h3>Bookings</h3><span id="charterResultCount"></span></div><div id="charterBookingList"></div></aside>
        <main id="charterEditor" class="charter-editor"></main>
      </div>
    </div>`;
  window.lucide?.createIcons?.();
}

function renderSummary() {
  const count = (status) => bookings.filter((item) => item.status === status).length;
  byId("charterSummary").innerHTML = `
    <div><span>Active records</span><strong>${bookings.filter((item) => !["Completed", "Cancelled"].includes(item.status)).length}</strong></div>
    <div><span>Draft quotes</span><strong>${count("Draft") + count("Quoted")}</strong></div>
    <div><span>Sent</span><strong>${count("Sent")}</strong></div>
    <div><span>Confirmed</span><strong>${count("Confirmed")}</strong></div>
    <div><span>Operational</span><strong>${count("Operational")}</strong></div>`;
}

function filteredBookings() {
  const search = value("charterSearch").toLowerCase();
  const status = value("charterStatusFilter");
  const date = value("charterDateFilter");
  return bookings.filter((item) => {
    if (status && item.status !== status) return false;
    if (date && item.serviceDate !== date) return false;
    if (!search) return true;
    return [item.bookingNumber, item.organisationName, item.contactName, item.pickupLocation, item.destination, item.status]
      .filter(Boolean).join(" ").toLowerCase().includes(search);
  });
}

function renderBookingList() {
  const visible = filteredBookings();
  byId("charterResultCount").textContent = `${visible.length} result${visible.length === 1 ? "" : "s"}`;
  if (!visible.some((item) => item.id === selectedBookingId)) selectedBookingId = "";
  byId("charterBookingList").innerHTML = visible.length ? visible.map((item) => `
    <button type="button" class="charter-list-item ${item.id === selectedBookingId ? "selected" : ""}" data-charter-id="${escapeHtml(item.id)}">
      <div><strong>${escapeHtml(item.bookingNumber || item.id)}</strong><span class="charter-status ${statusClass(item.status)}">${escapeHtml(item.status || "Draft")}</span></div>
      <h4>${escapeHtml(item.organisationName || "Customer pending")}</h4>
      <p>${escapeHtml(item.pickupLocation || "Pickup pending")} → ${escapeHtml(item.destination || "Destination pending")}</p>
      <small>${escapeHtml(displayDate(item.serviceDate))} · ${escapeHtml(String(item.passengerCount || "Pax pending"))}${item.passengerCount ? " passengers" : ""}</small>
    </button>`).join("") : `<div class="charter-empty">No charter bookings match these filters.</div>`;
  byId("charterBookingList").querySelectorAll("[data-charter-id]").forEach((button) => button.onclick = () => {
    selectedBookingId = button.dataset.charterId;
    renderBookingList();
    renderEditor(bookings.find((item) => item.id === selectedBookingId));
  });
}

function organisationOptions(selectedId = "") {
  return `<option value="">Select customer</option>${organisations.map((item) => `<option value="${escapeHtml(item.id)}" ${item.id === selectedId ? "selected" : ""}>${escapeHtml(item.name || "Unnamed customer")}</option>`).join("")}`;
}

function stopRow(stop = {}, index = 0) {
  const rowId = stop.id || `stop_${++stopSequence}`;
  return `<div class="charter-stop-row" data-stop-row="${escapeHtml(rowId)}">
    <div class="charter-stop-number">${index + 1}</div>
    <label class="charter-stop-type"><span>Stop type</span><select class="charterStopType"><option ${stop.type === "Pickup" ? "selected" : ""}>Pickup</option><option ${stop.type === "Drop-off" ? "selected" : ""}>Drop-off</option><option ${stop.type === "Stop" ? "selected" : ""}>Stop</option><option ${stop.type === "Depot" ? "selected" : ""}>Depot</option></select></label>
    <label class="charter-stop-location"><span>Location</span><input class="charterStopLocation" value="${escapeHtml(stop.name || "")}" placeholder="Search address, venue or point of interest" /></label>
    <label><span>Arrive</span><input class="charterStopArrival" type="time" value="${escapeHtml(stop.arrivalTime || "")}" /></label>
    <label><span>Depart</span><input class="charterStopDeparture" type="time" value="${escapeHtml(stop.departureTime || "")}" /></label>
    <label><span>Buffer</span><input class="charterStopBuffer" type="number" min="0" step="5" value="${escapeHtml(String(stop.bufferMinutes || 0))}" /></label>
    <button type="button" class="btn danger charter-stop-remove" title="Remove stop"><i data-lucide="trash-2"></i><span>Remove</span></button>
  </div>`;
}

function renderStops(stops = []) {
  const list = stops.length ? stops : [
    {type: "Pickup", departureTime: ""},
    {type: "Drop-off", arrivalTime: ""}
  ];
  byId("charterStops").innerHTML = list.map(stopRow).join("");
  rewireStops();
}

function rewireStops() {
  const rows = [...byId("charterStops").querySelectorAll("[data-stop-row]")];
  rows.forEach((row, index) => {
    row.querySelector(".charter-stop-number").textContent = String(index + 1);
    const remove = row.querySelector(".charter-stop-remove");
    remove.disabled = rows.length <= 2;
    remove.onclick = () => {
      if (byId("charterStops").querySelectorAll("[data-stop-row]").length <= 2) return showPageMessage("A journey requires at least a pickup and destination.", "error");
      row.remove();
      rewireStops();
      updateJourneySummary();
    };
    row.querySelectorAll("input, select").forEach((input) => input.addEventListener("input", updateJourneySummary));
  });
  window.lucide?.createIcons?.();
}

function collectStops() {
  return [...byId("charterStops").querySelectorAll("[data-stop-row]")].map((row, index) => ({
    id: row.dataset.stopRow,
    stopNo: index + 1,
    type: row.querySelector(".charterStopType").value,
    name: row.querySelector(".charterStopLocation").value.trim(),
    placeId: "",
    latitude: null,
    longitude: null,
    arrivalTime: row.querySelector(".charterStopArrival").value,
    departureTime: row.querySelector(".charterStopDeparture").value,
    bufferMinutes: Number(row.querySelector(".charterStopBuffer").value || 0)
  }));
}

function calculatePricing() {
  const base = numberValue("charterBaseCharge");
  const distance = numberValue("charterDistanceCharge");
  const waiting = numberValue("charterWaitingCharge");
  const extras = numberValue("charterAdditionalCharge");
  const discount = numberValue("charterDiscount");
  const subtotalBeforeDiscount = base + distance + waiting + extras;
  const subtotal = Math.max(0, subtotalBeforeDiscount - discount);
  const gst = subtotal * 0.1;
  const total = subtotal + gst;
  byId("charterPricingSummary").innerHTML = `<div><span>Charges</span><strong>${money(subtotalBeforeDiscount)}</strong></div><div><span>Discount</span><strong>− ${money(discount)}</strong></div><div><span>Subtotal</span><strong>${money(subtotal)}</strong></div><div><span>GST</span><strong>${money(gst)}</strong></div><div class="total"><span>Total</span><strong>${money(total)}</strong></div>`;
  return {baseCharge: base, distanceCharge: distance, waitingCharge: waiting, additionalCharge: extras, discount, subtotal, gst, total, currency: "AUD"};
}

function updateJourneySummary() {
  const stops = collectStops();
  const named = stops.filter((item) => item.name);
  const start = named[0]?.name || "Pickup pending";
  const end = named[named.length - 1]?.name || "Destination pending";
  byId("charterRouteSummary").innerHTML = `<strong>${escapeHtml(start)} → ${escapeHtml(end)}</strong><span>${stops.length} stops · Route calculation not yet run</span>`;
}

function editorTemplate(booking = null) {
  const pricing = booking?.pricing || {};
  return `
    <form id="charterForm" class="charter-form">
      <div class="charter-editor-head"><div><div class="charter-kicker">${booking ? "Charter record" : "New charter"}</div><h3>${escapeHtml(booking?.bookingNumber || "Create Charter Booking")}</h3><p>${booking ? "Update the customer, journey and quotation foundation." : "Capture the customer request and build a structured itinerary."}</p></div><span class="charter-status ${statusClass(booking?.status || "Draft")}">${escapeHtml(booking?.status || "Draft")}</span></div>
      <nav class="charter-tabs" aria-label="Charter workspace"><button type="button" class="active" data-charter-tab="overview">Overview</button><button type="button" data-charter-tab="itinerary">Itinerary & Map</button><button type="button" data-charter-tab="quotation">Quotation</button><button type="button" data-charter-tab="operations">Operations</button><button type="button" data-charter-tab="history">History</button></nav>

      <div class="charter-tab-panel" data-charter-panel="overview">
        <section class="charter-section"><div class="charter-section-title"><span>1</span><div><h4>Customer and booking</h4><p>Link the charter to an existing customer and primary contact.</p></div></div><div class="charter-grid">
          <label><span>Customer <b>*</b></span><select id="charterOrganisation">${organisationOptions(booking?.organisationId || "")}</select></label>
          <label><span>Contact name <b>*</b></span><input id="charterContactName" value="${escapeHtml(booking?.contactName || "")}" placeholder="Booking contact" /></label>
          <label><span>Contact phone</span><input id="charterContactPhone" value="${escapeHtml(booking?.contactPhone || "")}" placeholder="Phone number" /></label>
          <label><span>Contact email</span><input id="charterContactEmail" type="email" value="${escapeHtml(booking?.contactEmail || "")}" placeholder="Email address" /></label>
          <label><span>Service date <b>*</b></span><input id="charterServiceDate" type="date" value="${escapeHtml(booking?.serviceDate || "")}" /></label>
          <label><span>Passengers <b>*</b></span><input id="charterPassengers" type="number" min="1" value="${escapeHtml(String(booking?.passengerCount || ""))}" placeholder="Passenger quantity" /></label>
          <label><span>Journey type <b>*</b></span><select id="charterJourneyType">${JOURNEY_TYPES.map((item) => `<option ${item === (booking?.journeyType || "One Way") ? "selected" : ""}>${item}</option>`).join("")}</select></label>
          <label><span>Status</span><select id="charterStatus">${BOOKING_STATUSES.map((item) => `<option ${item === (booking?.status || "Draft") ? "selected" : ""}>${item}</option>`).join("")}</select></label>
          <label><span>Vehicle requirement</span><select id="charterVehicleType">${VEHICLE_TYPES.map((item) => `<option ${item === (booking?.vehicleType || "To be recommended") ? "selected" : ""}>${item}</option>`).join("")}</select></label>
          <label><span>Number of buses</span><input id="charterBusCount" type="number" min="1" value="${escapeHtml(String(booking?.busCount || 1))}" /></label>
          <label class="charter-full"><span>Special instructions</span><textarea id="charterInstructions" placeholder="Accessibility, luggage, permits, passenger requirements or customer instructions">${escapeHtml(booking?.specialInstructions || "")}</textarea></label>
          <label class="charter-full"><span>Internal notes</span><textarea id="charterInternalNotes" placeholder="Internal Charter Department notes — not included in the customer PDF">${escapeHtml(booking?.internalNotes || "")}</textarea></label>
        </div></section>
      </div>

      <div class="charter-tab-panel" data-charter-panel="itinerary" hidden>
        <section class="charter-section"><div class="charter-section-title"><span>2</span><div><h4>Journey and route</h4><p>Build the stop order now. Google place search and route calculation will connect to this structure.</p></div></div>
          <div class="charter-route-layout"><div><div id="charterStops" class="charter-stops"></div><button id="addCharterStop" type="button" class="btn"><i data-lucide="map-pin-plus"></i> Add stop</button></div><aside class="charter-map-placeholder"><i data-lucide="map"></i><h4>Google route preview</h4><p>Prepared for Places Autocomplete, route distance, travel time and polyline display.</p><div id="charterRouteSummary"></div><button type="button" class="btn" disabled>Calculate route — setup required</button></aside></div>
        </section>
      </div>

      <div class="charter-tab-panel" data-charter-panel="quotation" hidden>
        <section class="charter-section"><div class="charter-section-title"><span>3</span><div><h4>Quotation pricing</h4><p>Enter or adjust the commercial charges. Google distance pricing will be connected later.</p></div></div><div class="charter-grid">
          <label><span>Vehicle/base charge</span><input id="charterBaseCharge" type="number" min="0" step="0.01" value="${escapeHtml(String(pricing.baseCharge || 0))}" /></label>
          <label><span>Distance charge</span><input id="charterDistanceCharge" type="number" min="0" step="0.01" value="${escapeHtml(String(pricing.distanceCharge || 0))}" /></label>
          <label><span>Waiting/driver charge</span><input id="charterWaitingCharge" type="number" min="0" step="0.01" value="${escapeHtml(String(pricing.waitingCharge || 0))}" /></label>
          <label><span>Additional charges</span><input id="charterAdditionalCharge" type="number" min="0" step="0.01" value="${escapeHtml(String(pricing.additionalCharge || 0))}" /></label>
          <label><span>Discount</span><input id="charterDiscount" type="number" min="0" step="0.01" value="${escapeHtml(String(pricing.discount || 0))}" /></label>
          <label><span>Quote expiry date</span><input id="charterQuoteExpiry" type="date" value="${escapeHtml(booking?.quoteExpiryDate || "")}" /></label>
          <label class="charter-full"><span>Customer-facing quotation notes</span><textarea id="charterQuoteNotes" placeholder="Information included on the quotation PDF">${escapeHtml(booking?.quoteNotes || "")}</textarea></label>
        </div><div id="charterPricingSummary" class="charter-pricing-summary"></div><div class="charter-feature-note"><i data-lucide="file-text"></i><div><strong>PDF quotation generation</strong><span>The pricing structure is ready. Branded PDF generation will be activated in the quotation build.</span></div><button type="button" class="btn" disabled>Generate PDF</button></div></section>
      </div>

      <div class="charter-tab-panel" data-charter-panel="operations" hidden><section class="charter-section charter-coming"><i data-lucide="blocks"></i><h4>Operational conversion</h4><p>After customer confirmation, this area will preview the Job Group and blocks generated from the accepted itinerary.</p><button type="button" class="btn" disabled>Create operational blocks</button></section></div>
      <div class="charter-tab-panel" data-charter-panel="history" hidden><section class="charter-section charter-coming"><i data-lucide="history"></i><h4>Booking history</h4><p>${booking ? `Created by ${escapeHtml(booking.createdByName || booking.createdByEmail || "Portal user")}. Full quote and conversion history will be recorded here.` : "History begins when the draft charter is saved."}</p></section></div>

      <footer class="charter-save-bar"><span id="charterSaveHint">Drafts do not create operational blocks or driver work.</span><button id="saveCharter" type="submit" class="btn primary"><i data-lucide="save"></i> Save Charter Draft</button></footer>
    </form>`;
}

function selectCustomer() {
  const organisation = organisations.find((item) => item.id === value("charterOrganisation"));
  if (!organisation) return;
  const primary = contacts.find((item) => item.organisationId === organisation.id && item.isPrimary) || contacts.find((item) => item.organisationId === organisation.id) || {};
  byId("charterContactName").value = primary.displayName || "";
  byId("charterContactPhone").value = primary.phone || organisation.phone || "";
  byId("charterContactEmail").value = primary.email || organisation.email || "";
}

function setupTabs() {
  const buttons = [...document.querySelectorAll("[data-charter-tab]")];
  const panels = [...document.querySelectorAll("[data-charter-panel]")];
  buttons.forEach((button) => button.onclick = () => {
    buttons.forEach((item) => item.classList.toggle("active", item === button));
    panels.forEach((panel) => { panel.hidden = panel.dataset.charterPanel !== button.dataset.charterTab; });
  });
}

function renderEditor(booking = null) {
  byId("charterEditor").innerHTML = editorTemplate(booking);
  setupTabs();
  renderStops(Array.isArray(booking?.stops) ? booking.stops : []);
  updateJourneySummary();
  calculatePricing();
  byId("charterOrganisation").onchange = selectCustomer;
  byId("addCharterStop").onclick = () => {
    byId("charterStops").insertAdjacentHTML("beforeend", stopRow({type: "Stop"}, byId("charterStops").children.length));
    rewireStops(); updateJourneySummary();
  };
  ["charterBaseCharge", "charterDistanceCharge", "charterWaitingCharge", "charterAdditionalCharge", "charterDiscount"].forEach((id) => byId(id).addEventListener("input", calculatePricing));
  byId("charterForm").onsubmit = saveCharter;
  window.lucide?.createIcons?.();
}

function validateForm(stops) {
  if (!value("charterOrganisation")) return "Select an existing customer.";
  if (!value("charterContactName")) return "Contact name is required.";
  if (!value("charterServiceDate")) return "Service date is required.";
  if (numberValue("charterPassengers") < 1) return "Passenger quantity must be at least 1.";
  if (numberValue("charterBusCount") < 1) return "Number of buses must be at least 1.";
  if (stops.length < 2) return "Add at least a pickup and destination.";
  if (!stops[0].name) return "Enter the pickup location.";
  if (!stops[stops.length - 1].name) return "Enter the destination.";
  return "";
}

async function saveCharter(event) {
  event.preventDefault();
  if (saving) return;
  clearPageMessage(); showError("");
  const stops = collectStops();
  const error = validateForm(stops);
  if (error) return showPageMessage(error, "error");
  const organisation = organisations.find((item) => item.id === value("charterOrganisation"));
  const existing = bookings.find((item) => item.id === selectedBookingId) || null;
  const bookingRef = existing ? doc(db, "charterBookings", existing.id) : doc(collection(db, "charterBookings"));
  const nowIso = new Date().toISOString();
  const bookingNumber = existing?.bookingNumber || `CB-${new Date().getFullYear()}-${bookingRef.id.slice(0, 6).toUpperCase()}`;
  const pricing = calculatePricing();
  const saveButton = byId("saveCharter");
  saving = true; saveButton.disabled = true; saveButton.textContent = existing ? "Saving changes…" : "Creating draft…";
  try {
    const payload = {
      schemaVersion: 1,
      bookingNumber,
      status: value("charterStatus") || "Draft",
      organisationId: organisation.id,
      organisationName: organisation.name || "",
      contactName: value("charterContactName"),
      contactPhone: value("charterContactPhone"),
      contactEmail: value("charterContactEmail").toLowerCase(),
      serviceDate: value("charterServiceDate"),
      passengerCount: numberValue("charterPassengers"),
      journeyType: value("charterJourneyType"),
      vehicleType: value("charterVehicleType"),
      busCount: numberValue("charterBusCount"),
      specialInstructions: value("charterInstructions"),
      internalNotes: value("charterInternalNotes"),
      stops,
      pickupLocation: stops[0].name,
      destination: stops[stops.length - 1].name,
      routeStatus: existing?.routeStatus || "Not calculated",
      routeSnapshot: existing?.routeSnapshot || null,
      pricing,
      quoteExpiryDate: value("charterQuoteExpiry"),
      quoteNotes: value("charterQuoteNotes"),
      updatedAt: serverTimestamp(),
      updatedAtIso: nowIso,
      updatedByUid: auth.currentUser?.uid || "",
      updatedByEmail: auth.currentUser?.email || "",
      updatedByName: employeeName(),
      deleted: false,
      ...(existing ? {} : {createdAt: serverTimestamp(), createdAtIso: nowIso, createdByUid: auth.currentUser?.uid || "", createdByEmail: auth.currentUser?.email || "", createdByName: employeeName(), blocksGenerated: false})
    };
    await setDoc(bookingRef, payload, {merge: true});
    const saved = {id: bookingRef.id, ...(existing || {}), ...payload};
    const index = bookings.findIndex((item) => item.id === bookingRef.id);
    if (index >= 0) bookings[index] = saved; else bookings.unshift(saved);
    selectedBookingId = bookingRef.id;
    renderSummary(); renderBookingList(); renderEditor(saved);
    showPageMessage(`${bookingNumber} saved successfully.`, "success");
  } catch (saveError) {
    console.error("Unable to save charter booking", saveError);
    showPageMessage(saveError?.message || "Unable to save the charter booking.", "error");
  } finally {
    saving = false;
    const currentButton = byId("saveCharter");
    if (currentButton) { currentButton.disabled = false; currentButton.innerHTML = `<i data-lucide="save"></i> Save Charter Draft`; window.lucide?.createIcons?.(); }
  }
}

function renderEmptyEditor() {
  byId("charterEditor").innerHTML = `<div class="charter-empty-editor"><i data-lucide="notebook-tabs"></i><h3>Select a charter booking</h3><p>Choose a record to review or create a new charter request and quotation.</p><button id="emptyNewCharter" type="button" class="btn primary"><i data-lucide="plus"></i> New Charter</button></div>`;
  byId("emptyNewCharter").onclick = () => { selectedBookingId = ""; renderBookingList(); renderEditor(); };
  window.lucide?.createIcons?.();
}

export async function renderCharterBookingsPage() {
  showError("");
  renderPageShell();
  byId("charterBookingList").innerHTML = `<div class="charter-empty">Loading charter bookings…</div>`;
  byId("charterEditor").innerHTML = `<div class="charter-empty-editor"><span class="spinner"></span><p>Loading workspace…</p></div>`;
  try {
    await loadData();
    renderSummary(); renderBookingList(); renderEmptyEditor();
  } catch (error) {
    console.error("Unable to load Charter Bookings", error);
    showError(error?.message || "Unable to load Charter Bookings.");
    byId("charterBookingList").innerHTML = `<div class="charter-empty">Unable to load bookings.</div>`;
    renderEmptyEditor();
  }

  byId("newCharter").onclick = () => { selectedBookingId = ""; clearPageMessage(); renderBookingList(); renderEditor(); };
  byId("refreshCharters").onclick = async () => {
    const button = byId("refreshCharters"); button.disabled = true; button.textContent = "Refreshing…";
    try { await loadData(); renderSummary(); renderBookingList(); if (selectedBookingId) renderEditor(bookings.find((item) => item.id === selectedBookingId)); }
    catch (error) { showError(error?.message || "Unable to refresh Charter Bookings."); }
    finally { button.disabled = false; button.innerHTML = `<i data-lucide="refresh-cw"></i> Refresh`; window.lucide?.createIcons?.(); }
  };
  ["charterSearch", "charterStatusFilter", "charterDateFilter"].forEach((id) => byId(id).addEventListener(id === "charterSearch" ? "input" : "change", renderBookingList));
}
