import {
  collection,
  doc,
  getDocs,
  limit,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  addDoc
} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";
import {
  httpsCallable
} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-functions.js";

import { auth, db, functions } from "./firebase.js";
import { state } from "./state.js";
import { els, showError } from "./ui.js";
import { escapeHtml } from "./utils.js";
import {
  initMap,
  attachAutocomplete,
  detachAllAutocomplete,
  calculateRoute,
  calculateLegDuration,
  getRouteResult,
  isMapReady,
  getStaticMapUrl,
  onMapClick,
  clearMapRoute
} from "./charter_map.js";
import { generateQuotationPDF, renderPdfPreview, downloadPdf } from "./charter_pdf.js?v=3";
import { go } from "./main.js";

const BOOKING_STATUSES = ["Draft", "Quoted", "Sent", "Confirmed", "Operational", "Completed", "Cancelled"];
const JOURNEY_TYPES = ["One Way", "Forward + Return", "Multiple Journeys"];
const VEHICLE_TYPES = ["To be recommended", "Mini Bus", "Standard Bus", "Coach", "Accessible Vehicle", "Multiple Vehicle Types"];

let bookings = [];
let organisations = [];
let contacts = [];
let employees = [];
let buses = [];
let selectedBookingId = "";
let stopSequence = 0;
let saving = false;
let mapInitialisedForSession = false;
let currentPdfBlob = null;
let historyUnsubscribe = null;
let focusedStopRowId = null; // Track which stop input is focused for map click

// Smart Time Engine — tracks which arrival fields the user manually edited
const userOverriddenArrivals = new Set();
// Leg duration cache keyed by "stopRowId" → { durationMinutes, distanceKm }
const legEstimates = new Map();
// Multiple Journeys data
let multipleJourneys = [];
let journeySequence = 0;

// Geocoded data stored per stop (keyed by stop row ID)
const stopGeoData = new Map();
let returnStopsManuallyEdited = false;

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
  const [bookingSnapshot, organisationSnapshot, contactSnapshot, employeeSnapshot, busSnapshot] = await Promise.all([
    getDocs(query(collection(db, "charterBookings"), limit(500))),
    getDocs(query(collection(db, "organisations"), limit(500))),
    getDocs(query(collection(db, "customerContacts"), limit(1000))),
    getDocs(query(collection(db, "employees"), limit(500))),
    getDocs(query(collection(db, "buses"), limit(200)))
  ]);
  bookings = bookingSnapshot.docs.map((item) => ({id: item.id, ...item.data()})).filter((item) => item.deleted !== true)
    .sort((a, b) => String(b.createdAtIso || b.serviceDate || "").localeCompare(String(a.createdAtIso || a.serviceDate || "")));
  organisations = organisationSnapshot.docs.map((item) => ({id: item.id, ...item.data()})).filter((item) => item.deleted !== true && item.active !== false)
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
  contacts = contactSnapshot.docs.map((item) => ({id: item.id, ...item.data()})).filter((item) => item.deleted !== true && item.active !== false);
  employees = employeeSnapshot.docs.map((d) => d.data()).filter((i) => i.deleted !== true && i.status !== "Inactive" && i.email)
    .sort((a, b) => String(a.displayName || a.email).localeCompare(String(b.displayName || b.email)));
  buses = busSnapshot.docs.map((d) => ({id: d.id, ...d.data()})).filter((i) => i.deleted !== true)
    .sort((a, b) => String(a.busNumber || a.registration || "").localeCompare(String(b.busNumber || b.registration || "")));
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

function stopRow(stop = {}, index = 0, prefix = "") {
  const rowId = stop.id || `${prefix}stop_${++stopSequence}`;
  // Store geo data if the stop already has coordinates
  if (stop.latitude && stop.longitude) {
    stopGeoData.set(rowId, {
      placeId: stop.placeId || "",
      latitude: stop.latitude,
      longitude: stop.longitude,
      formattedAddress: stop.name || ""
    });
  }
  return `<div class="charter-stop-row" data-stop-row="${escapeHtml(rowId)}">
    <div class="charter-stop-number">${index + 1}</div>
    <label class="charter-stop-type"><span>Stop type</span><select class="charterStopType"><option ${stop.type === "Pickup" ? "selected" : ""}>Pickup</option><option ${stop.type === "Drop-off" ? "selected" : ""}>Drop-off</option><option ${stop.type === "Stop" ? "selected" : ""}>Stop</option><option ${stop.type === "Depot" ? "selected" : ""}>Depot</option></select></label>
    <label class="charter-stop-location"><span>Location</span><input class="charterStopLocation" value="${escapeHtml(stop.name || "")}" placeholder="Search address, venue or point of interest" /></label>
    <label><span>Arrive</span><input class="charterStopArrival" type="time" value="${escapeHtml(stop.arrivalTime || "")}" /></label>
    <label><span>Buffer (min)</span><input class="charterStopBuffer" type="number" min="0" step="5" value="${escapeHtml(String(stop.bufferMinutes || 0))}" /></label>
    <button type="button" class="btn danger charter-stop-remove" title="Remove stop"><i data-lucide="trash-2"></i><span>Remove</span></button>
  </div>`;
}

function renderStops(stops = [], prefix = "", containerId = "charterStops") {
  const container = byId(containerId);
  if (!container) return;
  const list = stops.length ? stops : [
    {type: "Pickup", departureTime: ""},
    {type: "Drop-off", arrivalTime: ""}
  ];
  container.innerHTML = list.map((s, i) => stopRow(s, i, prefix)).join("");
  rewireStops(containerId);
}

function rewireStops(containerId = "charterStops") {
  const container = byId(containerId);
  if (!container) return;
  const rows = [...container.querySelectorAll("[data-stop-row]")];
  rows.forEach((row, index) => {
    row.querySelector(".charter-stop-number").textContent = String(index + 1);
    const remove = row.querySelector(".charter-stop-remove");
    remove.disabled = rows.length <= 2;
    remove.onclick = () => {
      if (container.querySelectorAll("[data-stop-row]").length <= 2) return showPageMessage("A journey requires at least a pickup and destination.", "error");
      const rowId = row.dataset.stopRow;
      stopGeoData.delete(rowId);
      legEstimates.delete(rowId);
      row.remove();
      rewireStops(containerId);
      updateJourneySummary();
      triggerRouteCalculation();
      if (containerId === "charterStopsFwd" && !returnStopsManuallyEdited) autoMirrorReturnStops();
    };

    // Track focused stop for map click-to-pin
    const locationInput = row.querySelector(".charterStopLocation");
    if (locationInput) {
      locationInput.addEventListener("focus", () => { focusedStopRowId = row.dataset.stopRow; });

      // Attach Google Places Autocomplete to location inputs
      if (isMapReady()) {
        attachAutocomplete(locationInput, (placeData) => {
          const stopRowId = row.dataset.stopRow;
          stopGeoData.set(stopRowId, placeData);
          updateJourneySummary();
          triggerRouteCalculation();
          autoCalculateArrivalTimes(containerId);
          if (containerId === "charterStopsFwd" && !returnStopsManuallyEdited) autoMirrorReturnStops();
        });
      }
    }

    // Track user manual override of arrival times
    const arrivalInput = row.querySelector(".charterStopArrival");
    if (arrivalInput) {
      arrivalInput.addEventListener("input", () => {
        userOverriddenArrivals.add(row.dataset.stopRow);
        autoCalculateArrivalTimes(containerId);
      });
    }

    // Buffer change triggers recalculation
    const bufferInput = row.querySelector(".charterStopBuffer");
    if (bufferInput) {
      bufferInput.addEventListener("input", () => {
        autoCalculateArrivalTimes(containerId);
        updateJourneySummary();
      });
    }

    row.querySelectorAll("input, select").forEach((input) => input.addEventListener("input", (e) => {
      updateJourneySummary();
      if (containerId === "charterReturnStops" && !e.target.classList.contains("charterStopArrival")) {
        returnStopsManuallyEdited = true;
      }
      if (containerId === "charterStopsFwd" && !returnStopsManuallyEdited && !e.target.classList.contains("charterStopArrival")) {
        autoMirrorReturnStops();
      }
    }));
  });
  window.lucide?.createIcons?.();
}

/* =========================================================
   Smart Time Engine — auto-calculate arrival times
========================================================= */
let smartTimeDebounce = null;

function autoCalculateArrivalTimes(containerId = "charterStops") {
  clearTimeout(smartTimeDebounce);
  smartTimeDebounce = setTimeout(() => _doAutoCalculate(containerId), 300);
}

async function _doAutoCalculate(containerId) {
  const container = byId(containerId);
  if (!container || !isMapReady()) return;

  const rows = [...container.querySelectorAll("[data-stop-row]")];
  if (rows.length < 2) return;

  for (let i = 1; i < rows.length; i++) {
    const prevRow = rows[i - 1];
    const currRow = rows[i];
    const prevRowId = prevRow.dataset.stopRow;
    const currRowId = currRow.dataset.stopRow;

    // Skip if user manually overrode this arrival
    if (userOverriddenArrivals.has(currRowId)) continue;

    const prevGeo = stopGeoData.get(prevRowId);
    const currGeo = stopGeoData.get(currRowId);
    if (!prevGeo?.latitude || !currGeo?.latitude) continue;

    const prevArrival = prevRow.querySelector(".charterStopArrival")?.value || "";
    const prevBuffer = Number(prevRow.querySelector(".charterStopBuffer")?.value || 0);

    if (!prevArrival) continue;

    // Calculate departure from previous stop
    const prevArrivalMin = timeStrToMinutes(prevArrival);
    if (prevArrivalMin === null) continue;
    const departureMin = prevArrivalMin + prevBuffer;

    try {
      const leg = await calculateLegDuration(
        { lat: prevGeo.latitude, lng: prevGeo.longitude },
        { lat: currGeo.latitude, lng: currGeo.longitude }
      );
      if (!leg) continue;

      legEstimates.set(currRowId, leg);

      const arrivalMin = departureMin + leg.durationMinutes;
      const arrivalInput = currRow.querySelector(".charterStopArrival");
      if (arrivalInput) {
        arrivalInput.value = minutesToTimeStr(arrivalMin);
      }
    } catch (err) {
      console.warn("Leg estimate failed:", err);
    }
  }
}

function timeStrToMinutes(timeStr) {
  if (!timeStr) return null;
  const p = String(timeStr).trim().split(":");
  if (p.length < 2) return null;
  return parseInt(p[0], 10) * 60 + parseInt(p[1], 10);
}

function minutesToTimeStr(totalMin) {
  const h = Math.floor(totalMin / 60) % 24;
  const m = totalMin % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/* =========================================================
   Data collection — stops and journeys
========================================================= */
function collectStopsFrom(containerId = "charterStops") {
  const container = byId(containerId);
  if (!container) return [];
  return [...container.querySelectorAll("[data-stop-row]")].map((row, index) => {
    const rowId = row.dataset.stopRow;
    const geo = stopGeoData.get(rowId) || {};
    return {
      id: rowId,
      stopNo: index + 1,
      type: row.querySelector(".charterStopType").value,
      name: row.querySelector(".charterStopLocation").value.trim(),
      placeId: geo.placeId || "",
      latitude: geo.latitude || null,
      longitude: geo.longitude || null,
      arrivalTime: row.querySelector(".charterStopArrival").value,
      bufferMinutes: Number(row.querySelector(".charterStopBuffer").value || 0)
    };
  });
}

function collectStops() { return collectStopsFrom("charterStops"); }
function collectReturnStops() { return collectStopsFrom("charterReturnStops"); }



function renderReturnStops(stops = []) {
  const container = byId("charterReturnStops");
  if (!container) return;
  const list = stops.length ? stops : [{type: "Drop-off"}, {type: "Pickup"}];
  container.innerHTML = list.map((s, i) => stopRow(s, i, "ret_")).join("");
  rewireStops("charterReturnStops");
}

function wireGenerator() {
  if (isMapReady()) {
    const pickupInput = byId("mjGenPickup");
    const dropoffInput = byId("mjGenDropoff");
    if (pickupInput) {
      attachAutocomplete(pickupInput, (pd) => {
        stopGeoData.set("mj_gen_pickup", pd);
        triggerRouteCalculation();
        updateJourneySummary();
      });
      pickupInput.addEventListener("focus", () => { focusedStopRowId = "mj_gen_pickup"; });
    }
    if (dropoffInput) {
      attachAutocomplete(dropoffInput, (pd) => {
        stopGeoData.set("mj_gen_dropoff", pd);
        triggerRouteCalculation();
        updateJourneySummary();
      });
      dropoffInput.addEventListener("focus", () => { focusedStopRowId = "mj_gen_dropoff"; });
    }
  }
}

function renderMultipleJourneys(config = null) {
  if (!config) return;
  if (byId("mjGenStart")) byId("mjGenStart").value = config.startDate || "";
  if (byId("mjGenEnd")) byId("mjGenEnd").value = config.endDate || "";
  if (byId("mjGenType")) byId("mjGenType").value = config.recurringType || "Weekly";
  if (byId("mjGenStartTime")) byId("mjGenStartTime").value = config.startTime || "";
  if (byId("mjGenPickup")) byId("mjGenPickup").value = config.pickup || "";
  if (byId("mjGenDropoff")) byId("mjGenDropoff").value = config.dropoff || "";
  
  if (config.pickupGeo) stopGeoData.set("mj_gen_pickup", config.pickupGeo);
  if (config.dropoffGeo) stopGeoData.set("mj_gen_dropoff", config.dropoffGeo);

  const days = config.days || [];
  document.querySelectorAll(".mjGenDay").forEach(cb => {
    cb.checked = days.includes(parseInt(cb.value, 10));
  });
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

function triggerRouteCalculation() {
  const jt = value("charterJourneyType") || "One Way";
  
  let stops = [];
  let summaryId = "charterRouteSummary";
  if (jt === "Multiple Journeys") {
    summaryId = "charterRouteSummaryMJ";
    const pGeo = stopGeoData.get("mj_gen_pickup");
    const dGeo = stopGeoData.get("mj_gen_dropoff");
    if (pGeo && pGeo.latitude) stops.push({name: value("mjGenPickup") || pGeo.name, latitude: pGeo.latitude, longitude: pGeo.longitude, placeId: pGeo.placeId});
    if (dGeo && dGeo.latitude) stops.push({name: value("mjGenDropoff") || dGeo.name, latitude: dGeo.latitude, longitude: dGeo.longitude, placeId: dGeo.placeId});
  } else if (jt === "Forward + Return") {
    summaryId = "charterRouteSummaryFR";
    stops = collectStopsFrom("charterStopsFwd");
  } else {
    summaryId = "charterRouteSummary";
    stops = collectStopsFrom("charterStops");
  }

  calculateRoute(stops, (result, error) => {
    const summaryEl = byId(summaryId);
    if (!summaryEl) return;
    if (error) {
      summaryEl.innerHTML = `<strong>${escapeHtml(stops.filter((s) => s.name).map((s) => s.name).join(" → ") || "Route pending")}</strong><span>${stops.length} stops · ${escapeHtml(error)}</span>`;
    } else if (result) {
      summaryEl.innerHTML = `<strong>${escapeHtml(stops.filter((s) => s.name).map((s) => s.name).join(" → ") || "Route pending")}</strong><span>${stops.length} stops · ${result.distanceKm} km · ~${result.durationMinutes} min</span>`;
    }
  });
}

function updateJourneySummary() {
  const jt = value("charterJourneyType") || "One Way";

  let stops = [];
  let summaryId = "charterRouteSummary";
  if (jt === "Multiple Journeys") {
    summaryId = "charterRouteSummaryMJ";
    const pGeo = stopGeoData.get("mj_gen_pickup");
    const dGeo = stopGeoData.get("mj_gen_dropoff");
    if (pGeo && pGeo.latitude) stops.push({name: value("mjGenPickup") || pGeo.name});
    if (dGeo && dGeo.latitude) stops.push({name: value("mjGenDropoff") || dGeo.name});
  } else if (jt === "Forward + Return") {
    summaryId = "charterRouteSummaryFR";
    stops = collectStopsFrom("charterStopsFwd");
  } else {
    summaryId = "charterRouteSummary";
    stops = collectStopsFrom("charterStops");
  }
  
  const summaryEl = byId(summaryId);
  if (!summaryEl) return;

  const named = stops.filter((item) => item.name);
  const start = named[0]?.name || "Pickup pending";
  const end = named[named.length - 1]?.name || "Destination pending";
  const route = getRouteResult();
  const routeInfo = route ? `${route.distanceKm} km · ~${route.durationMinutes} min` : "Route calculation pending";
  summaryEl.innerHTML = `<strong>${escapeHtml(start)} → ${escapeHtml(end)}</strong><span>${stops.length} stops · ${routeInfo}</span>`;
}

/* =========================================================
   Editor template — all tabs
========================================================= */
function editorTemplate(booking = null) {
  const pricing = booking?.pricing || {};
  const status = booking?.status || "Draft";
  const isConfirmed = ["Confirmed", "Operational", "Completed"].includes(status);
  const isSent = status === "Sent";
  const isOperational = status === "Operational" || status === "Completed";

  return `
    <form id="charterForm" class="charter-form">
      <div class="charter-editor-head"><div><div class="charter-kicker">${booking ? "Charter record" : "New charter"}</div><h3>${escapeHtml(booking?.bookingNumber || "Create Charter Booking")}</h3><p>${booking ? "Update the customer, journey and quotation foundation." : "Capture the customer request and build a structured itinerary."}</p></div><span class="charter-status ${statusClass(status)}">${escapeHtml(status)}</span></div>
      <nav class="charter-tabs" aria-label="Charter workspace"><button type="button" class="active" data-charter-tab="overview">Overview</button><button type="button" data-charter-tab="itinerary">Itinerary & Map</button><button type="button" data-charter-tab="quotation">Quotation</button><button type="button" data-charter-tab="operations">Operations</button><button type="button" data-charter-tab="history">History</button></nav>

      <!-- ===== OVERVIEW TAB ===== -->
      <div class="charter-tab-panel" data-charter-panel="overview">
        <section class="charter-section"><div class="charter-section-title"><span>1</span><div><h4>Customer and booking</h4><p>Link the charter to an existing customer and primary contact.</p></div></div><div class="charter-grid">
          <label><span>Customer <b>*</b></span><select id="charterOrganisation">${organisationOptions(booking?.organisationId || "")}</select></label>
          <label><span>Contact name <b>*</b></span><input id="charterContactName" value="${escapeHtml(booking?.contactName || "")}" placeholder="Booking contact" /></label>
          <label><span>Contact phone</span><input id="charterContactPhone" value="${escapeHtml(booking?.contactPhone || "")}" placeholder="Phone number" /></label>
          <label><span>Contact email <b>*</b></span><input id="charterContactEmail" type="email" value="${escapeHtml(booking?.contactEmail || "")}" placeholder="Email address" required /></label>
          <label><span>Service date <b>*</b></span><input id="charterServiceDate" type="date" value="${escapeHtml(booking?.serviceDate || "")}" /></label>
          <label><span>Passengers <b>*</b></span><input id="charterPassengers" type="number" min="1" value="${escapeHtml(String(booking?.passengerCount || ""))}" placeholder="Passenger quantity" /></label>
          <label><span>Status</span><select id="charterStatus">${BOOKING_STATUSES.map((item) => `<option ${item === status ? "selected" : ""}>${item}</option>`).join("")}</select></label>
          <label class="charter-full"><span>Special instructions</span><textarea id="charterInstructions" placeholder="Accessibility, luggage, permits, passenger requirements or customer instructions">${escapeHtml(booking?.specialInstructions || "")}</textarea></label>
          <label class="charter-full"><span>Internal notes</span><textarea id="charterInternalNotes" placeholder="Internal Charter Department notes — not included in the customer PDF">${escapeHtml(booking?.internalNotes || "")}</textarea></label>
        </div></section>
        <div class="charter-tab-bar"><span class="charter-tab-hint">Complete required customer fields to continue.</span><button type="button" id="nextToItinerary" class="btn primary">Next: Itinerary →</button></div>
      </div>

      <!-- ===== ITINERARY & MAP TAB ===== -->
      <div class="charter-tab-panel" data-charter-panel="itinerary" hidden>
        <section class="charter-section"><div class="charter-section-title"><span>2</span><div><h4>Journey type and route</h4><p>Select the journey type, build the stop order, and use the map to search or click exact locations.</p></div></div>
          <div id="charterJourneyTypeSelector" class="charter-journey-types">
            ${JOURNEY_TYPES.map((jt) => {
              const icons = {"One Way": "→", "Forward + Return": "⇄", "Multiple Journeys": "▤"};
              const descs = {"One Way": "Pickup to drop-off", "Forward + Return": "There and back", "Multiple Journeys": "Multiple separate trips"};
              const sel = jt === (booking?.journeyType || "One Way") ? "selected" : "";
              return `<button type="button" class="charter-journey-card ${sel}" data-journey-type="${escapeHtml(jt)}"><div class="charter-journey-card-icon">${icons[jt] || "→"}</div><div class="charter-journey-card-label">${escapeHtml(jt)}</div><div class="charter-journey-card-desc">${escapeHtml(descs[jt] || "")}</div></button>`;
            }).join("")}
          </div>
          <input type="hidden" id="charterJourneyType" value="${escapeHtml(booking?.journeyType || "One Way")}" />
          <div class="charter-grid" style="margin-bottom:14px">
            <label><span>Vehicle requirement</span><select id="charterVehicleType">${VEHICLE_TYPES.map((item) => `<option ${item === (booking?.vehicleType || "To be recommended") ? "selected" : ""}>${item}</option>`).join("")}</select></label>
            <label><span>Number of buses</span><input id="charterBusCount" type="number" min="1" value="${escapeHtml(String(booking?.busCount || 1))}" /></label>
          </div>

          <!-- ONE WAY panel -->
          <div id="panelOneWay" class="charter-journey-panel" ${(booking?.journeyType || "One Way") === "One Way" ? "" : "hidden"}>
            <div class="charter-route-layout"><div><div id="charterStops" class="charter-stops"></div><button id="addCharterStop" type="button" class="btn"><i data-lucide="map-pin-plus"></i> Add stop</button></div><aside class="charter-map-aside"><div id="charterMapContainer" class="charter-map-container"></div><div class="charter-map-click-hint"><i data-lucide="mouse-pointer-click"></i> Click on the map to set a stop location</div><div id="charterRouteSummary" class="charter-route-summary"></div></aside></div>
          </div>

          <!-- FORWARD + RETURN panel -->
          <div id="panelForwardReturn" class="charter-journey-panel" ${(booking?.journeyType) === "Forward + Return" ? "" : "hidden"}>
            <div class="charter-fr-section">
              <h5 class="charter-fr-heading"><i data-lucide="arrow-right"></i> Forward Journey</h5>
              <div id="charterStopsFwd" class="charter-stops"></div>
              <button id="addCharterStopFwd" type="button" class="btn"><i data-lucide="map-pin-plus"></i> Add stop</button>
            </div>
            <div class="charter-fr-section charter-fr-return">
              <h5 class="charter-fr-heading"><i data-lucide="arrow-left"></i> Return Journey</h5>
              <div class="charter-grid" style="margin-bottom:10px">
                <label><span>Return departure time *</span><input id="charterReturnDepartureTime" type="time" value="${escapeHtml(booking?.returnDepartureTime || "")}" /></label>
                <label><span>Return buffer (min)</span><input id="charterReturnBuffer" type="number" min="0" step="5" value="${escapeHtml(String(booking?.returnBuffer || 0))}" /></label>
              </div>
              <div id="charterReturnStops" class="charter-stops"></div>
            </div>
            <aside class="charter-map-aside"><div id="charterMapContainerFR" class="charter-map-container"></div><div id="charterRouteSummaryFR" class="charter-route-summary"></div></aside>
          </div>

          <!-- MULTIPLE JOURNEYS panel -->
          <div id="panelMultipleJourneys" class="charter-journey-panel" ${(booking?.journeyType) === "Multiple Journeys" ? "" : "hidden"}>
            <div class="charter-generator-box">
              <div class="charter-grid">
                <label><span>Start Date *</span><input type="date" id="mjGenStart" /></label>
                <label><span>End Date *</span><input type="date" id="mjGenEnd" /></label>
                <label><span>Recurring Type</span><select id="mjGenType"><option>Weekly</option></select></label>
              </div>
              <div class="charter-days-section">
                <span>Weekly days</span>
                <div class="charter-days-grid">
                  <label><input type="checkbox" class="mjGenDay" value="1"> <span>Mon</span></label>
                  <label><input type="checkbox" class="mjGenDay" value="2"> <span>Tue</span></label>
                  <label><input type="checkbox" class="mjGenDay" value="3"> <span>Wed</span></label>
                  <label><input type="checkbox" class="mjGenDay" value="4"> <span>Thu</span></label>
                  <label><input type="checkbox" class="mjGenDay" value="5"> <span>Fri</span></label>
                  <label><input type="checkbox" class="mjGenDay" value="6"> <span>Sat</span></label>
                  <label><input type="checkbox" class="mjGenDay" value="0"> <span>Sun</span></label>
                </div>
              </div>
              <div class="charter-grid" style="margin-top: 12px; border-top: 1px solid var(--charter-line, #e2e8f0); padding-top: 12px;">
                <label><span>Start Time *</span><input type="time" id="mjGenStartTime" /></label>
                <label><span>Pickup *</span><input id="mjGenPickup" placeholder="Shared pickup location" /></label>
                <label><span>Drop-off *</span><input id="mjGenDropoff" placeholder="Shared drop-off location" /></label>
              </div>
            </div>
            <aside class="charter-map-aside" style="margin-top:14px"><div id="charterMapContainerMJ" class="charter-map-container"></div><div id="charterRouteSummaryMJ" class="charter-route-summary"></div></aside>
          </div>

        </section>
        <div class="charter-tab-bar"><span class="charter-tab-hint">Define the journey stops before moving to quotation.</span><button type="button" class="charter-save-draft" id="saveDraftItinerary">Save Draft</button><button type="button" id="nextToQuotation" class="btn primary">Next: Quotation →</button></div>
      </div>

      <!-- ===== QUOTATION TAB ===== -->
      <div class="charter-tab-panel" data-charter-panel="quotation" hidden>
        <section class="charter-section"><div class="charter-section-title"><span>3</span><div><h4>Quotation pricing</h4><p>Enter or adjust the commercial charges. Preview the PDF before sending to the customer.</p></div></div><div class="charter-grid">
          <label><span>Vehicle/base charge</span><input id="charterBaseCharge" type="number" min="0" step="0.01" value="${escapeHtml(String(pricing.baseCharge || 0))}" /></label>
          <label><span>Distance charge</span><input id="charterDistanceCharge" type="number" min="0" step="0.01" value="${escapeHtml(String(pricing.distanceCharge || 0))}" /></label>
          <label><span>Waiting/driver charge</span><input id="charterWaitingCharge" type="number" min="0" step="0.01" value="${escapeHtml(String(pricing.waitingCharge || 0))}" /></label>
          <label><span>Additional charges</span><input id="charterAdditionalCharge" type="number" min="0" step="0.01" value="${escapeHtml(String(pricing.additionalCharge || 0))}" /></label>
          <label><span>Discount</span><input id="charterDiscount" type="number" min="0" step="0.01" value="${escapeHtml(String(pricing.discount || 0))}" /></label>
          <label><span>Quote expiry date</span><input id="charterQuoteExpiry" type="date" value="${escapeHtml(booking?.quoteExpiryDate || "")}" /></label>
          <label class="charter-full"><span>Customer-facing quotation notes</span><textarea id="charterQuoteNotes" placeholder="Information included on the quotation PDF">${escapeHtml(booking?.quoteNotes || "")}</textarea></label>
        </div><div id="charterPricingSummary" class="charter-pricing-summary"></div>

        <!-- PDF Preview + Send area -->
        <div class="charter-pdf-actions">
          <div class="charter-pdf-buttons">
            <button type="button" id="previewQuotationBtn" class="btn"><i data-lucide="eye"></i> Preview Quotation</button>
            <button type="button" id="downloadPdfBtn" class="btn" hidden><i data-lucide="download"></i> Download PDF</button>
            <button type="button" id="sendQuotationBtn" class="btn primary" hidden><i data-lucide="send"></i> Send Quotation to Customer</button>
          </div>
          <div id="charterPdfPreview" class="charter-pdf-preview"></div>
        </div>
        </section>
        <div class="charter-tab-bar"><span class="charter-tab-hint">${getSaveHint(status)}</span><button type="button" class="charter-save-draft" id="saveDraftQuotation">Save Draft</button><button id="saveCharter" type="submit" class="btn primary"><i data-lucide="save"></i> Save Charter</button></div>
      </div>

      <!-- ===== OPERATIONS TAB ===== -->
      <div class="charter-tab-panel" data-charter-panel="operations" hidden>
        <section class="charter-section">
          <div class="charter-section-title"><span>4</span><div><h4>Operational conversion</h4><p>${isConfirmed || isOperational ? "Convert the confirmed booking into dispatch blocks." : "This area becomes available after customer confirmation."}</p></div></div>
          <div id="charterOperationsContent">${renderOperationsContent(booking)}</div>
        </section>
      </div>

      <!-- ===== HISTORY TAB ===== -->
      <div class="charter-tab-panel" data-charter-panel="history" hidden>
        <section class="charter-section">
          <div class="charter-section-title"><span>5</span><div><h4>Booking history</h4><p>Complete audit trail of all changes, communications, and customer responses.</p></div></div>
          <div id="charterHistoryTimeline" class="charter-history-timeline">
            ${booking ? `<div class="charter-history-loading"><span class="spinner"></span> Loading history…</div>` : `<div class="charter-empty">History begins when the draft charter is saved.</div>`}
          </div>
        </section>
      </div>

    </form>`;
}

function getSaveHint(status) {
  switch (status) {
    case "Draft": return "Drafts do not create operational blocks or driver work.";
    case "Quoted": return "Quotation ready. Preview and send to the customer.";
    case "Sent": return "Quotation sent. Awaiting customer response.";
    case "Confirmed": return "Customer confirmed. Create operational blocks when ready.";
    case "Operational": return "Operational blocks created. Changes will update the linked blocks.";
    default: return "Save your changes.";
  }
}

/* =========================================================
   Operations tab content (Phase 5)
========================================================= */
function renderOperationsContent(booking) {
  if (!booking) return `<div class="charter-coming"><i data-lucide="blocks"></i><h4>Save the charter first</h4><p>The operations panel will be available after the charter is saved and confirmed by the customer.</p></div>`;

  const status = booking.status || "Draft";

  if (["Draft", "Quoted", "Sent"].includes(status)) {
    const statusIcon = status === "Sent" ? "mail" : "clock";
    return `<div class="charter-coming"><i data-lucide="${statusIcon}"></i><h4>Awaiting customer confirmation</h4><p>Status: <strong>${escapeHtml(status)}</strong>. The operations preview will appear once the customer accepts the quotation.</p>
      ${status === "Sent" ? `<div class="charter-awaiting-badge"><i data-lucide="loader"></i> Quotation sent — waiting for customer response</div>` : ""}
    </div>`;
  }

  if (status === "Cancelled") {
    return `<div class="charter-coming"><i data-lucide="x-circle"></i><h4>Booking cancelled</h4><p>This charter was cancelled. No operational blocks were created.</p></div>`;
  }

  // Confirmed / Operational / Completed — show job group preview
  const stops = Array.isArray(booking.stops) ? booking.stops : [];
  const route = booking.routeSnapshot || {};
  const isAlreadyOperational = status === "Operational" || status === "Completed";

  const blocksPreview = stops.map((s, i) => {
    return `<div class="charter-block-row">
      <div class="charter-block-seq">${i + 1}</div>
      <div class="charter-block-detail">
        <strong>${escapeHtml(s.type || "Stop")}: ${escapeHtml(s.name || "Location pending")}</strong>
        <span>${s.arrivalTime ? `Arrive ${s.arrivalTime}` : ""}${s.bufferMinutes ? ` · ${s.bufferMinutes}min buffer` : ""}</span>
      </div>
    </div>`;
  }).join("");

  return `
    <div class="charter-ops-preview">
      <div class="charter-ops-summary">
        <div><span>Route</span><strong>${escapeHtml(booking.pickupLocation || "—")} → ${escapeHtml(booking.destination || "—")}</strong></div>
        <div><span>Distance</span><strong>${route.distanceKm ? `${route.distanceKm} km` : "Not calculated"}</strong></div>
        <div><span>Duration</span><strong>${route.durationMinutes ? `~${route.durationMinutes} min` : "Not calculated"}</strong></div>
        <div><span>Passengers</span><strong>${booking.passengerCount || "—"}</strong></div>
        <div><span>Buses</span><strong>${booking.busCount || 1}</strong></div>
      </div>

      <h4 class="charter-ops-heading">Block preview</h4>
      <div class="charter-blocks-preview">${blocksPreview || "<p>No stops defined.</p>"}</div>

      ${!isAlreadyOperational ? `
      <div class="charter-ops-actions">
        <button type="button" id="createOpsBlocksBtn" class="btn primary"><i data-lucide="blocks"></i> Create Operational Blocks & Open Dispatch</button>
      </div>
      ` : `
      <div class="charter-ops-created">
        <div class="charter-ops-created-badge"><i data-lucide="check-circle"></i> Operational blocks created</div>
        ${booking.operationalJobGroupId ? `<p>Job Group: <strong>${escapeHtml(booking.operationalJobGroupId)}</strong></p>` : ""}
        <div class="charter-ops-actions" style="justify-content:center"><button type="button" id="openDispatchBtn" class="btn primary"><i data-lucide="layout-dashboard"></i> Open Dispatch Board</button></div>
      </div>
      `}
    </div>`;
}

/* =========================================================
   History tab (Phase 6)
========================================================= */
function listenHistory(bookingId) {
  if (historyUnsubscribe) { historyUnsubscribe(); historyUnsubscribe = null; }
  if (!bookingId) return;

  const historyRef = collection(db, "charterBookings", bookingId, "history");
  historyUnsubscribe = onSnapshot(query(historyRef, limit(100)), (snapshot) => {
    const events = snapshot.docs.map((d) => ({id: d.id, ...d.data()}))
      .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));

    const timeline = byId("charterHistoryTimeline");
    if (!timeline) return;

    if (!events.length) {
      // Show basic creation info if no history subcollection yet
      const booking = bookings.find((b) => b.id === bookingId);
      timeline.innerHTML = `<div class="charter-history-entry">
        <div class="charter-history-icon" style="background:#e2e8f0;color:#475569;">📝</div>
        <div class="charter-history-content">
          <strong>Charter created</strong>
          <span>${booking?.createdByName || booking?.createdByEmail || "Portal user"}</span>
          <small>${booking?.createdAtIso ? new Date(booking.createdAtIso).toLocaleString("en-AU") : "—"}</small>
        </div>
      </div>`;
      return;
    }

    timeline.innerHTML = events.map((e) => {
      const icon = getHistoryIcon(e.action);
      const ts = e.createdAt?.toDate?.() ? e.createdAt.toDate().toLocaleString("en-AU") : "—";
      return `<div class="charter-history-entry">
        <div class="charter-history-icon" style="background:${icon.bg};color:${icon.color};">${icon.emoji}</div>
        <div class="charter-history-content">
          <strong>${escapeHtml(e.summary || "Update")}</strong>
          <span>${escapeHtml(e.createdByName || e.createdByEmail || "System")}</span>
          <small>${ts}</small>
        </div>
      </div>`;
    }).join("");
  }, () => {
    const timeline = byId("charterHistoryTimeline");
    if (timeline) timeline.innerHTML = `<div class="charter-empty">Unable to load history.</div>`;
  });
}

function getHistoryIcon(action) {
  switch (action) {
    case "created": return { emoji: "📝", bg: "#e2e8f0", color: "#475569" };
    case "updated": return { emoji: "✏️", bg: "#dbeafe", color: "#1e40af" };
    case "quoted": return { emoji: "📄", bg: "#f3e8ff", color: "#6b21a8" };
    case "sent": return { emoji: "📧", bg: "#dbeafe", color: "#1e40af" };
    case "accepted": return { emoji: "✅", bg: "#dcfce7", color: "#166534" };
    case "rejected": return { emoji: "❌", bg: "#fee2e2", color: "#991b1b" };
    case "expired": return { emoji: "⏰", bg: "#fef3c7", color: "#92400e" };
    case "operational": return { emoji: "🔧", bg: "#cffafe", color: "#075985" };
    default: return { emoji: "•", bg: "#e2e8f0", color: "#475569" };
  }
}

/* =========================================================
   Select customer (autofill contact)
========================================================= */
function selectCustomer() {
  const organisation = organisations.find((item) => item.id === value("charterOrganisation"));
  if (!organisation) return;
  const primary = contacts.find((item) => item.organisationId === organisation.id && item.isPrimary) || contacts.find((item) => item.organisationId === organisation.id) || {};
  byId("charterContactName").value = primary.displayName || "";
  byId("charterContactPhone").value = primary.phone || organisation.phone || "";
  byId("charterContactEmail").value = primary.email || organisation.email || "";
}

/* =========================================================
   Tabs & Navigation
========================================================= */
function registerMapClickListener() {
  onMapClick((geo) => {
    if (!focusedStopRowId) {
      showPageMessage("Please click inside a Stop Location field first.", "error");
      return;
    }
    
    // Handle Multiple Journeys fields
    if (focusedStopRowId === "mj_gen_pickup" || focusedStopRowId === "mj_gen_dropoff") {
      const locInput = document.getElementById(focusedStopRowId === "mj_gen_pickup" ? "mjGenPickup" : "mjGenDropoff");
      if (locInput) locInput.value = geo.name;
      stopGeoData.set(focusedStopRowId, geo);
      triggerRouteCalculation();
      updateJourneySummary();
      return; 
    }

    // Find the focused stop row and update it
    const row = document.querySelector(`[data-stop-row="${escapeHtml(focusedStopRowId)}"]`);
    if (row) {
      const locInput = row.querySelector(".charterStopLocation");
      if (locInput) locInput.value = geo.name;
      stopGeoData.set(focusedStopRowId, geo);
      updateJourneySummary();
      triggerRouteCalculation();
      if (focusedStopRowId.startsWith("fwd_") && !returnStopsManuallyEdited) autoMirrorReturnStops();
    }
  });
}

function switchTab(tabId) {
  const buttons = [...document.querySelectorAll("[data-charter-tab]")];
  const panels = [...document.querySelectorAll("[data-charter-panel]")];
  
  buttons.forEach((item) => item.classList.toggle("active", item.dataset.charterTab === tabId));
  panels.forEach((panel) => { panel.hidden = panel.dataset.charterPanel !== tabId; });

  // Initialise map when itinerary tab is shown
  if (tabId === "itinerary" && !mapInitialisedForSession) {
    mapInitialisedForSession = true;
    
    const jt = byId("charterJourneyType")?.value || "One Way";
    let mapId = "charterMapContainer";
    if (jt === "Forward + Return") mapId = "charterMapContainerFR";
    else if (jt === "Multiple Journeys") mapId = "charterMapContainerMJ";

    initMap(mapId).then(() => {
      rewireStops();
      wireGenerator();
      triggerRouteCalculation();
      registerMapClickListener();
    }).catch((err) => console.warn("Map init failed:", err));
  }
}

function setupTabs() {
  const buttons = [...document.querySelectorAll("[data-charter-tab]")];
  buttons.forEach((button) => {
    button.onclick = () => switchTab(button.dataset.charterTab);
  });
}



function resetBookingState() {
  stopGeoData.clear();
  legEstimates.clear();
  userOverriddenArrivals.clear();
  returnStopsManuallyEdited = false;
  journeySequence = 0;
  focusedStopRowId = null;
  clearMapRoute();
}

function autoMirrorReturnStops() {
  const fwdStops = collectStopsFrom("charterStopsFwd");
  if (!fwdStops.length) return;
  
  const revStops = [...fwdStops].reverse().map(stop => {
    let newType = stop.type;
    if (stop.type === "Pickup") newType = "Drop-off";
    else if (stop.type === "Drop-off") newType = "Pickup";
    
    return {
      type: newType,
      name: stop.name,
      placeId: stop.placeId,
      latitude: stop.latitude,
      longitude: stop.longitude,
      arrivalTime: "", 
      bufferMinutes: stop.bufferMinutes || 0
    };
  });
  
  renderReturnStops(revStops);
  
  const newReturnRows = [...document.getElementById("charterReturnStops").querySelectorAll("[data-stop-row]")];
  newReturnRows.forEach((row, idx) => {
    if (revStops[idx].latitude) {
      stopGeoData.set(row.dataset.stopRow, {
        placeId: revStops[idx].placeId,
        latitude: revStops[idx].latitude,
        longitude: revStops[idx].longitude,
        formattedAddress: revStops[idx].name
      });
    }
  });
}

function renderEditor(booking = null) {
  resetBookingState();
  mapInitialisedForSession = false;
  currentPdfBlob = null;
  journeySequence = 0;
  if (historyUnsubscribe) { historyUnsubscribe(); historyUnsubscribe = null; }

  byId("charterEditor").innerHTML = editorTemplate(booking);
  setupTabs();

  // Render stops for the current journey type
  const jt = booking?.journeyType || "One Way";
  if (jt === "Forward + Return") {
    renderStops(Array.isArray(booking?.stops) ? booking.stops : [{type: "Pickup"}, {type: "Drop-off"}], "fwd_", "charterStopsFwd");
    // Render return stops — auto-mirror if no return stops saved
    const returnStops = Array.isArray(booking?.returnStops) ? booking.returnStops : [];
    if (returnStops.length) {
      renderReturnStops(returnStops);
    } else {
      renderReturnStops([{type: "Drop-off"}, {type: "Pickup"}]);
    }
  } else if (jt === "Multiple Journeys") {
    renderMultipleJourneys(booking?.multipleJourneysConfig || null);
    wireGenerator();
  } else {
    renderStops(Array.isArray(booking?.stops) ? booking.stops : []);
  }

  updateJourneySummary();
  calculatePricing();

  // Wire overview
  byId("charterOrganisation").onchange = selectCustomer;
  
  // Wire journey types — panel switching
  const jtCards = document.querySelectorAll(".charter-journey-card");
  jtCards.forEach(card => {
    card.onclick = () => {
      jtCards.forEach(c => c.classList.remove("selected"));
      card.classList.add("selected");
      const type = card.dataset.journeyType;
      byId("charterJourneyType").value = type;
      
      // Toggle panels
      const panels = document.querySelectorAll(".charter-journey-panel");
      panels.forEach(p => { p.hidden = true; });
      if (type === "One Way") {
        if (byId("panelOneWay")) byId("panelOneWay").hidden = false;
        renderStops([{type: "Pickup"}, {type: "Drop-off"}]);
        if (mapInitialisedForSession) initMap("charterMapContainer").then(() => { triggerRouteCalculation(); registerMapClickListener(); }).catch(console.warn);
      } else if (type === "Forward + Return") {
        if (byId("panelForwardReturn")) byId("panelForwardReturn").hidden = false;
        renderStops([{type: "Pickup"}, {type: "Drop-off"}], "fwd_", "charterStopsFwd");
        if (booking?.returnStops && booking.returnStops.length > 0) {
          renderReturnStops(booking.returnStops);
          returnStopsManuallyEdited = true;
        } else {
          returnStopsManuallyEdited = false;
          autoMirrorReturnStops();
        }
        if (mapInitialisedForSession) initMap("charterMapContainerFR").then(() => { triggerRouteCalculation(); registerMapClickListener(); }).catch(console.warn);
      } else if (type === "Multiple Journeys") {
        if (byId("panelMultipleJourneys")) byId("panelMultipleJourneys").hidden = false;
        renderMultipleJourneys(booking?.multipleJourneysConfig || null);
        if (mapInitialisedForSession) initMap("charterMapContainerMJ").then(() => { wireGenerator(); registerMapClickListener(); }).catch(console.warn);
      }
    };
  });

  // Wire addCharterStop for One Way
  if (byId("addCharterStop")) {
    byId("addCharterStop").onclick = () => {
      byId("charterStops").insertAdjacentHTML("beforeend", stopRow({type: "Stop"}, byId("charterStops").children.length));
      rewireStops(); updateJourneySummary();
    };
  }

  // Wire addCharterStopFwd for Forward + Return
  if (byId("addCharterStopFwd")) {
    byId("addCharterStopFwd").onclick = () => {
      const container = byId("charterStopsFwd");
      if (!container) return;
      container.insertAdjacentHTML("beforeend", stopRow({type: "Stop"}, container.children.length, "fwd_"));
      rewireStops("charterStopsFwd"); updateJourneySummary();
      if (!returnStopsManuallyEdited) autoMirrorReturnStops();
    };
  }

  // Wire addJourneyCard for Multiple Journeys
  if (byId("addJourneyCard")) {
    byId("addJourneyCard").onclick = () => {
      const container = byId("charterJourneyCards");
      if (!container) return;
      container.insertAdjacentHTML("beforeend", journeyCardHtml({}, container.children.length));
      rewireJourneyCards();
    };
  }
  ["charterBaseCharge", "charterDistanceCharge", "charterWaitingCharge", "charterAdditionalCharge", "charterDiscount"].forEach((id) => byId(id).addEventListener("input", calculatePricing));
  
  // Wire Wizard Navigation
  if (byId("nextToItinerary")) {
    byId("nextToItinerary").onclick = () => {
      const err = validateOverview();
      if (err) {
        showPageMessage(err, "error");
      } else {
        clearPageMessage();
        switchTab("itinerary");
      }
    };
  }
  if (byId("nextToQuotation")) byId("nextToQuotation").onclick = () => switchTab("quotation");
  
  // Wire Saves
  const triggerSave = (e) => { e?.preventDefault(); saveCharter(); };
  byId("charterForm").onsubmit = triggerSave;
  ["saveDraftItinerary", "saveDraftQuotation", "saveCharter"].forEach(id => {
    if (byId(id)) byId(id).onclick = triggerSave;
  });

  // Wire quotation buttons
  wireQuotationButtons(booking);

  // Wire operations buttons
  wireOperationsButtons(booking);

  // Start history listener
  if (booking?.id) {
    listenHistory(booking.id);
  }

  window.lucide?.createIcons?.();
}

/* =========================================================
   Quotation — Preview + Send (Phase 2 & 3)
========================================================= */
function wireQuotationButtons(booking) {
  const previewBtn = byId("previewQuotationBtn");
  const downloadBtn = byId("downloadPdfBtn");
  const sendBtn = byId("sendQuotationBtn");

  if (previewBtn) {
    previewBtn.onclick = () => {
      clearPageMessage();
      
      const jt = value("charterJourneyType") || "One Way";
      const stops = jt === "Forward + Return" ? collectStopsFrom("charterStopsFwd") : collectStopsFrom("charterStops");
      const returnStops = jt === "Forward + Return" ? collectReturnStops() : [];
      
      let mjConfig = null;
      if (jt === "Multiple Journeys") {
        mjConfig = {
          startDate: value("mjGenStart"),
          endDate: value("mjGenEnd"),
          recurringType: value("mjGenType") || "Weekly",
          days: [...document.querySelectorAll(".mjGenDay:checked")].map(cb => parseInt(cb.value, 10)),
          startTime: value("mjGenStartTime"),
          pickup: value("mjGenPickup"),
          dropoff: value("mjGenDropoff"),
          pickupGeo: stopGeoData.get("mj_gen_pickup") || null,
          dropoffGeo: stopGeoData.get("mj_gen_dropoff") || null
        };
      }
      
      const pricing = calculatePricing();

      if (pricing.total <= 0) {
        showPageMessage("Enter pricing before previewing the quotation.", "error");
        return;
      }

      // Build a temporary booking object with current form data
      const previewBooking = buildCurrentBookingData(booking, jt, stops, returnStops, mjConfig, pricing);

      try {
        const result = generateQuotationPDF(previewBooking);
        currentPdfBlob = result.blob;
        renderPdfPreview(result.dataUrl, "charterPdfPreview");
        if (downloadBtn) downloadBtn.hidden = false;
        if (sendBtn) sendBtn.hidden = false;
        showPageMessage("Quotation preview generated successfully.", "success");
      } catch (err) {
        showPageMessage(`PDF generation failed: ${err.message}`, "error");
      }
    };
  }

  if (downloadBtn) {
    downloadBtn.onclick = () => {
      if (!currentPdfBlob) return;
      const ref = booking?.bookingNumber || "quotation";
      downloadPdf(currentPdfBlob, `${ref}.pdf`);
    };
  }

  if (sendBtn) {
    sendBtn.onclick = () => sendQuotation(booking);
  }
}

function buildCurrentBookingData(existingBooking, jt, stops, returnStops, mjConfig, pricing) {
  const organisation = organisations.find((item) => item.id === value("charterOrganisation"));
  const payload = {
    ...(existingBooking || {}),
    bookingNumber: existingBooking?.bookingNumber || "DRAFT",
    organisationName: organisation?.name || "",
    contactName: value("charterContactName"),
    contactPhone: value("charterContactPhone"),
    contactEmail: value("charterContactEmail"),
    serviceDate: value("charterServiceDate"),
    passengerCount: numberValue("charterPassengers"),
    journeyType: jt,
    vehicleType: value("charterVehicleType"),
    busCount: numberValue("charterBusCount"),
    specialInstructions: value("charterInstructions"),
    quoteExpiryDate: value("charterQuoteExpiry"),
    quoteNotes: value("charterQuoteNotes"),
    stops,
    pricing,
    routeSnapshot: getRouteResult() || existingBooking?.routeSnapshot || null
  };

  if (jt === "Forward + Return") {
    payload.returnStops = returnStops;
    payload.returnDepartureTime = value("charterReturnDepartureTime");
    payload.returnBuffer = numberValue("charterReturnBuffer");
    payload.pickupLocation = stops[0]?.name || "";
    payload.destination = stops[stops.length - 1]?.name || "";
  } else if (jt === "Multiple Journeys") {
    payload.multipleJourneysConfig = mjConfig;
    payload.serviceDate = mjConfig?.startDate || value("charterServiceDate");
    payload.pickupLocation = mjConfig?.pickup || "";
    payload.destination = mjConfig?.dropoff || "";
  } else {
    payload.pickupLocation = stops[0]?.name || "";
    payload.destination = stops[stops.length - 1]?.name || "";
  }

  return payload;
}

async function sendQuotation(booking) {
  if (!booking?.id) {
    showPageMessage("Save the charter before sending a quotation.", "error");
    return;
  }

  const email = value("charterContactEmail");
  if (!email) {
    showPageMessage("Customer contact email is required before sending.", "error");
    return;
  }

  const expiry = value("charterQuoteExpiry");
  if (!expiry) {
    showPageMessage("Set a quote expiry date before sending.", "error");
    return;
  }

  const pricing = calculatePricing();
  if (pricing.total <= 0) {
    showPageMessage("Quotation total must be greater than $0.", "error");
    return;
  }

  // Confirm
  if (!confirm(`Send quotation ${booking.bookingNumber || ""} to ${email}?\n\nThe customer will receive an email with Accept and Reject buttons.`)) return;

  const sendBtn = byId("sendQuotationBtn");
  sendBtn.disabled = true;
  sendBtn.innerHTML = `<span class="spinner"></span> Sending…`;

  try {
    // First, save current state
    await saveCharterSilent(booking);

    // Call Cloud Function
    const sendFn = httpsCallable(functions, "sendCharterQuotation");
    const result = await sendFn({ bookingId: booking.id });

    // Update local state
    const updatedBooking = bookings.find((b) => b.id === booking.id);
    if (updatedBooking) {
      updatedBooking.status = "Sent";
    }

    renderSummary();
    renderBookingList();
    showPageMessage(result.data?.message || `Quotation sent to ${email}`, "success");

    // Refresh editor to show updated status
    const refreshed = bookings.find((b) => b.id === booking.id);
    if (refreshed) renderEditor(refreshed);

  } catch (err) {
    console.error("Send quotation failed:", err);
    showPageMessage(`Failed to send: ${err.message || "Unknown error"}`, "error");
  } finally {
    const btn = byId("sendQuotationBtn");
    if (btn) { btn.disabled = false; btn.innerHTML = `<i data-lucide="send"></i> Send Quotation to Customer`; window.lucide?.createIcons?.(); }
  }
}

/* =========================================================
   Operations — Create blocks (Phase 5)
========================================================= */
function wireOperationsButtons(booking) {
  const createBtn = byId("createOpsBlocksBtn");
  if (!createBtn) return;

  createBtn.onclick = async () => {
    if (!booking?.id) return;
    if (!confirm("Create operational blocks from this charter? This will generate a job group linked to the dispatch system.")) return;

    createBtn.disabled = true;
    createBtn.innerHTML = `<span class="spinner"></span> Creating blocks…`;

    try {
      // Create a job group document
      const jobGroupRef = doc(collection(db, "jobGroups"));
      const stops = Array.isArray(booking.stops) ? booking.stops : [];
      const route = booking.routeSnapshot || {};
      const nowIso = new Date().toISOString();

      await setDoc(jobGroupRef, {
        type: "Charter",
        charterBookingId: booking.id,
        bookingNumber: booking.bookingNumber || "",
        organisationName: booking.organisationName || "",
        serviceDate: booking.serviceDate || "",
        passengerCount: booking.passengerCount || 0,
        journeyType: booking.journeyType || "One Way",
        vehicleType: booking.vehicleType || "",
        busCount: booking.busCount || 1,
        pickupLocation: booking.pickupLocation || "",
        destination: booking.destination || "",
        distanceKm: route.distanceKm || null,
        durationMinutes: route.durationMinutes || null,
        stops,
        status: "Active",
        createdAt: serverTimestamp(),
        createdAtIso: nowIso,
        createdByEmail: auth.currentUser?.email || "",
        createdByName: employeeName(),
        deleted: false
      });

      // Create individual blocks for the dispatch board
      function timeStrToMin(timeStr) {
        if (!timeStr) return null;
        const p = String(timeStr).trim().split(":");
        if (p.length < 2) return null;
        return parseInt(p[0], 10) * 60 + parseInt(p[1], 10);
      }

      const numBuses = Number(booking.busCount) || 1;
      const blockPromises = [];
      const jt = booking.journeyType || "One Way";

      if (jt === "Multiple Journeys" && Array.isArray(booking.journeys)) {
        // Multiple Journeys: one block per journey per bus
        for (let i = 0; i < numBuses; i++) {
          booking.journeys.forEach((j, jIndex) => {
            const blockRef = doc(collection(db, "blocks"));
            let startMin = timeStrToMin(j.startTime) || 8 * 60;
            // Rough estimate of 1 hour if we don't have duration saved, ideally we'd store it.
            // For now, default to start + 60
            let endMin = startMin + 60;

            blockPromises.push(setDoc(blockRef, {
              jobGroupId: jobGroupRef.id,
              organisationName: booking.organisationName || "",
              jobGroupName: booking.bookingNumber ? `${booking.organisationName || "Customer"} (${booking.bookingNumber}) - J${jIndex + 1}` : `${booking.organisationName} - J${jIndex + 1}`,
              serviceDate: j.journeyDate || booking.serviceDate || "",
              startMin,
              endMin,
              from: j.pickup || "",
              to: j.dropoff || "",
              notes: booking.specialInstructions || "",
              deleted: false,
              published: false,
              createdAt: serverTimestamp(),
              createdAtIso: nowIso,
              createdByEmail: auth.currentUser?.email || ""
            }));
          });
        }
      } else if (jt === "Forward + Return") {
        // Forward + Return: two blocks per bus, linked with pairId
        const fwdStops = Array.isArray(booking.stops) ? booking.stops : [];
        const retStops = Array.isArray(booking.returnStops) ? booking.returnStops : [];
        
        for (let i = 0; i < numBuses; i++) {
          const pairId = `pair_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
          const blockRefFwd = doc(collection(db, "blocks"));
          const blockRefRet = doc(collection(db, "blocks"));

          let fwdStart = timeStrToMin(fwdStops[0]?.arrivalTime) ?? (8 * 60);
          let fwdEnd = timeStrToMin(fwdStops[fwdStops.length - 1]?.arrivalTime) ?? (fwdStart + 60);
          let retStart = timeStrToMin(retStops[0]?.arrivalTime) ?? (15 * 60);
          let retEnd = timeStrToMin(retStops[retStops.length - 1]?.arrivalTime) ?? (retStart + 60);

          blockPromises.push(setDoc(blockRefFwd, {
            jobGroupId: jobGroupRef.id,
            pairId,
            leg: "Forward",
            organisationName: booking.organisationName || "",
            jobGroupName: booking.bookingNumber ? `${booking.organisationName || "Customer"} (${booking.bookingNumber}) - Fwd` : `${booking.organisationName} - Fwd`,
            serviceDate: booking.serviceDate || "",
            startMin: fwdStart,
            endMin: fwdEnd,
            from: fwdStops[0]?.name || booking.pickupLocation || "",
            to: fwdStops[fwdStops.length - 1]?.name || booking.destination || "",
            notes: booking.specialInstructions || "",
            deleted: false,
            published: false,
            createdAt: serverTimestamp(),
            createdAtIso: nowIso,
            createdByEmail: auth.currentUser?.email || ""
          }));

          blockPromises.push(setDoc(blockRefRet, {
            jobGroupId: jobGroupRef.id,
            pairId,
            leg: "Return",
            organisationName: booking.organisationName || "",
            jobGroupName: booking.bookingNumber ? `${booking.organisationName || "Customer"} (${booking.bookingNumber}) - Ret` : `${booking.organisationName} - Ret`,
            serviceDate: booking.serviceDate || "",
            startMin: retStart,
            endMin: retEnd,
            from: retStops[0]?.name || booking.destination || "",
            to: retStops[retStops.length - 1]?.name || booking.pickupLocation || "",
            notes: booking.specialInstructions || "",
            deleted: false,
            published: false,
            createdAt: serverTimestamp(),
            createdAtIso: nowIso,
            createdByEmail: auth.currentUser?.email || ""
          }));
        }
      } else {
        // One Way (or legacy)
        let startMin = timeStrToMin(stops[0]?.arrivalTime);
        let endMin = timeStrToMin(stops[stops.length - 1]?.arrivalTime);
        if (startMin === null) startMin = 8 * 60; // 8:00 AM fallback
        if (endMin === null) endMin = startMin + 60; // 1 hr fallback

        for (let i = 0; i < numBuses; i++) {
          const blockRef = doc(collection(db, "blocks"));
          blockPromises.push(setDoc(blockRef, {
            jobGroupId: jobGroupRef.id,
            organisationName: booking.organisationName || "",
            jobGroupName: booking.bookingNumber ? `${booking.organisationName || "Customer"} (${booking.bookingNumber})` : booking.organisationName,
            serviceDate: booking.serviceDate || "",
            startMin: startMin,
            endMin: endMin,
            from: stops[0]?.name || booking.pickupLocation || "",
            to: stops[stops.length - 1]?.name || booking.destination || "",
            notes: booking.specialInstructions || "",
            deleted: false,
            published: false,
            createdAt: serverTimestamp(),
            createdAtIso: nowIso,
            createdByEmail: auth.currentUser?.email || ""
          }));
        }
      }

      await Promise.all(blockPromises);

      // Update charter booking
      const bookingRef = doc(db, "charterBookings", booking.id);
      await setDoc(bookingRef, {
        status: "Operational",
        operationalJobGroupId: jobGroupRef.id,
        updatedAt: serverTimestamp(),
        updatedAtIso: nowIso,
        updatedByUid: auth.currentUser?.uid || "",
        updatedByEmail: auth.currentUser?.email || "",
        updatedByName: employeeName()
      }, { merge: true });

      // Add history entry
      await addDoc(collection(db, "charterBookings", booking.id, "history"), {
        action: "operational",
        summary: `Operational blocks created — Job Group ${jobGroupRef.id}`,
        createdAt: serverTimestamp(),
        createdByEmail: auth.currentUser?.email || "",
        createdByName: employeeName(),
        metadata: {
          jobGroupId: jobGroupRef.id
        }
      });

      // Update local state
      const idx = bookings.findIndex((b) => b.id === booking.id);
      if (idx >= 0) {
        bookings[idx].status = "Operational";
        bookings[idx].operationalJobGroupId = jobGroupRef.id;
      }

      renderSummary();
      renderBookingList();
      
      // Auto-navigate to Dispatch Board
      showPageMessage(`Operational blocks created. Redirecting to Dispatch Board...`, "success");
      setTimeout(() => {
        state.dispatchDate = booking.serviceDate || null;
        go("adminDispatchBoard");
      }, 800);

    } catch (err) {
      console.error("Create operational blocks failed:", err);
      showPageMessage(`Failed to create blocks: ${err.message}`, "error");
    } finally {
      const btn = byId("createOpsBlocksBtn");
      if (btn) { btn.disabled = false; btn.innerHTML = `<i data-lucide="blocks"></i> Create Operational Blocks & Open Dispatch`; window.lucide?.createIcons?.(); }
    }
  };

  const openDispatchBtn = byId("openDispatchBtn");
  if (openDispatchBtn) {
    openDispatchBtn.onclick = () => {
      state.dispatchDate = booking?.serviceDate || null;
      go("adminDispatchBoard");
    };
  }
}

/* =========================================================
   Validation + Save
========================================================= */
function validateOverview() {
  if (!value("charterOrganisation")) return "Select an existing customer.";
  if (!value("charterContactName")) return "Contact name is required.";
  if (!value("charterContactEmail")) return "Contact email is required.";
  if (numberValue("charterPassengers") < 1) return "Passenger quantity must be at least 1.";
  if (numberValue("charterBusCount") < 1) return "Number of buses must be at least 1.";
  return "";
}

function validateForm(jt, stops, returnStops, config) {
  const overviewError = validateOverview();
  if (overviewError) return overviewError;

  if (jt === "Multiple Journeys") {
    if (!config.startDate) return "Start Date is required for Multiple Journeys.";
    if (!config.endDate) return "End Date is required for Multiple Journeys.";
    if (!config.days || config.days.length === 0) return "Select at least one day of the week.";
    if (!config.startTime) return "Start Time is required.";
    if (!config.pickup) return "Pickup location is required.";
    if (!config.dropoff) return "Drop-off location is required.";
    const sd = new Date(`${config.startDate}T00:00:00`);
    const ed = new Date(`${config.endDate}T00:00:00`);
    if (ed < sd) return "End Date must be after Start Date.";
  } else {
    if (!value("charterServiceDate")) return "Service date is required.";
    if (stops.length < 2) return "Add at least a pickup and destination.";
    if (!stops[0].name) return "Enter the pickup location.";
    if (!stops[stops.length - 1].name) return "Enter the destination.";

    if (jt === "Forward + Return") {
      if (returnStops.length < 2) return "Return journey must have a pickup and destination.";
      if (!returnStops[0].name) return "Enter the return pickup location.";
      if (!returnStops[returnStops.length - 1].name) return "Enter the return destination.";
      if (!value("charterReturnDepartureTime")) return "Return departure time is required.";
    }
  }
  return "";
}

function buildPayload(organisation, jt, stops, returnStops, mjConfig, pricing, existing) {
  const nowIso = new Date().toISOString();
  const routeResult = getRouteResult();
  const bookingNumber = existing?.bookingNumber || "DRAFT";

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
    journeyType: jt,
    vehicleType: value("charterVehicleType"),
    busCount: numberValue("charterBusCount"),
    specialInstructions: value("charterInstructions"),
    internalNotes: value("charterInternalNotes"),
    stops,
    routeStatus: routeResult ? "Calculated" : (existing?.routeStatus || "Not calculated"),
    routeSnapshot: routeResult || existing?.routeSnapshot || null,
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

  if (jt === "Forward + Return") {
    payload.returnStops = returnStops;
    payload.returnDepartureTime = value("charterReturnDepartureTime");
    payload.returnBuffer = numberValue("charterReturnBuffer");
    payload.pickupLocation = stops[0]?.name || "";
    payload.destination = stops[stops.length - 1]?.name || "";
  } else if (jt === "Multiple Journeys") {
    payload.multipleJourneysConfig = mjConfig;
    payload.serviceDate = mjConfig.startDate || "";
    payload.pickupLocation = mjConfig.pickup || "";
    payload.destination = mjConfig.dropoff || "";
  } else {
    payload.pickupLocation = stops[0]?.name || "";
    payload.destination = stops[stops.length - 1]?.name || "";
  }

  return payload;
}

async function saveCharter(event) {
  event?.preventDefault();
  if (saving) return;
  clearPageMessage(); showError("");
  
  const jt = value("charterJourneyType") || "One Way";
  const stops = jt === "Forward + Return" ? collectStopsFrom("charterStopsFwd") : collectStopsFrom("charterStops");
  const returnStops = jt === "Forward + Return" ? collectReturnStops() : [];
  
  let mjConfig = null;
  if (jt === "Multiple Journeys") {
    mjConfig = {
      startDate: value("mjGenStart"),
      endDate: value("mjGenEnd"),
      recurringType: value("mjGenType") || "Weekly",
      days: [...document.querySelectorAll(".mjGenDay:checked")].map(cb => parseInt(cb.value, 10)),
      startTime: value("mjGenStartTime"),
      pickup: value("mjGenPickup"),
      dropoff: value("mjGenDropoff"),
      pickupGeo: stopGeoData.get("mj_gen_pickup") || null,
      dropoffGeo: stopGeoData.get("mj_gen_dropoff") || null
    };
  }

  const error = validateForm(jt, stops, returnStops, mjConfig);
  if (error) return showPageMessage(error, "error");
  
  const organisation = organisations.find((item) => item.id === value("charterOrganisation"));
  const existing = bookings.find((item) => item.id === selectedBookingId) || null;
  const bookingRef = existing ? doc(db, "charterBookings", existing.id) : doc(collection(db, "charterBookings"));
  const pricing = calculatePricing();
  const saveButton = byId("saveCharter");
  saving = true; saveButton.disabled = true; saveButton.textContent = existing ? "Saving changes…" : "Creating draft…";
  try {
    const payload = buildPayload(organisation, jt, stops, returnStops, mjConfig, pricing, existing);
    // Fix bookingNumber for new docs
    if (!existing) {
      payload.bookingNumber = `CB-${new Date().getFullYear()}-${bookingRef.id.slice(0, 6).toUpperCase()}`;
    }
    await setDoc(bookingRef, payload, {merge: true});

    // Add history entry for creation/update
    const historyAction = existing ? "updated" : "created";
    await addDoc(collection(db, "charterBookings", bookingRef.id, "history"), {
      action: historyAction,
      summary: existing ? `Charter updated — ${payload.status}` : `Charter created — ${payload.bookingNumber}`,
      createdAt: serverTimestamp(),
      createdByEmail: auth.currentUser?.email || "",
      createdByName: employeeName(),
      metadata: { status: payload.status, total: pricing.total }
    });

    const saved = {id: bookingRef.id, ...(existing || {}), ...payload};
    const index = bookings.findIndex((item) => item.id === bookingRef.id);
    if (index >= 0) bookings[index] = saved; else bookings.unshift(saved);
    selectedBookingId = bookingRef.id;
    renderSummary(); renderBookingList(); renderEditor(saved);
    showPageMessage(`${payload.bookingNumber} saved successfully.`, "success");
  } catch (saveError) {
    console.error("Unable to save charter booking", saveError);
    showPageMessage(saveError?.message || "Unable to save the charter booking.", "error");
  } finally {
    saving = false;
    const currentButton = byId("saveCharter");
    if (currentButton) { currentButton.disabled = false; currentButton.innerHTML = `<i data-lucide="save"></i> Save Charter`; window.lucide?.createIcons?.(); }
  }
}

/** Silent save — used before sending quotation */
async function saveCharterSilent(existingBooking) {
  if (!existingBooking?.id) return;
  const jt = value("charterJourneyType") || "One Way";
  const stops = jt === "Forward + Return" ? collectStopsFrom("charterStopsFwd") : collectStopsFrom("charterStops");
  const returnStops = jt === "Forward + Return" ? collectReturnStops() : [];
  
  let mjConfig = null;
  if (jt === "Multiple Journeys") {
    mjConfig = {
      startDate: value("mjGenStart"),
      endDate: value("mjGenEnd"),
      recurringType: value("mjGenType") || "Weekly",
      days: [...document.querySelectorAll(".mjGenDay:checked")].map(cb => parseInt(cb.value, 10)),
      startTime: value("mjGenStartTime"),
      pickup: value("mjGenPickup"),
      dropoff: value("mjGenDropoff"),
      pickupGeo: stopGeoData.get("mj_gen_pickup") || null,
      dropoffGeo: stopGeoData.get("mj_gen_dropoff") || null
    };
  }
  
  const organisation = organisations.find((item) => item.id === value("charterOrganisation"));
  if (!organisation) return;
  const pricing = calculatePricing();
  const payload = buildPayload(organisation, jt, stops, returnStops, mjConfig, pricing, existingBooking);
  payload.bookingNumber = existingBooking.bookingNumber;
  const bookingRef = doc(db, "charterBookings", existingBooking.id);
  await setDoc(bookingRef, payload, {merge: true});
  // Update local
  const idx = bookings.findIndex((b) => b.id === existingBooking.id);
  if (idx >= 0) bookings[idx] = {...bookings[idx], ...payload};
}

/* =========================================================
   Empty editor
========================================================= */
function renderEmptyEditor() {
  byId("charterEditor").innerHTML = `<div class="charter-empty-editor"><i data-lucide="notebook-tabs"></i><h3>Select a charter booking</h3><p>Choose a record to review or create a new charter request and quotation.</p><button id="emptyNewCharter" type="button" class="btn primary"><i data-lucide="plus"></i> New Charter</button></div>`;
  byId("emptyNewCharter").onclick = () => { selectedBookingId = ""; renderBookingList(); renderEditor(); };
  window.lucide?.createIcons?.();
}

/* =========================================================
   Page entry point
========================================================= */
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
