import {
  collection,
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc
} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";
import { auth, db } from "./firebase.js";

const $ = (id) => document.getElementById(id);
const norm = (v) => String(v || "").trim().toLowerCase();
const esc = (v) => String(v ?? "").replace(/[&<>'\"]/g, (m) => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'\"':"&quot;"}[m]));

let buses = [];
let jobs = [];
let pendingFleetSave = null;
let maintenanceObserver = null;
let fleetObserver = null;
let maintenanceEnhanceTimer = null;
let fleetEnhanceTimer = null;

function fleetNo(bus) {
  return String(bus?.fleetNumber || bus?.busNumber || bus?.number || bus?.id || "").trim();
}

function localDateString(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
}

function addDays(dateString, days) {
  if (!dateString) return "";
  const d = new Date(`${dateString}T00:00:00`);
  if (Number.isNaN(d.getTime())) return "";
  d.setDate(d.getDate() + days);
  return localDateString(d);
}

function fmtDate(dateString) {
  if (!dateString) return "—";
  const d = new Date(`${dateString}T00:00:00`);
  if (Number.isNaN(d.getTime())) return String(dateString);
  return new Intl.DateTimeFormat("en-AU", { day:"2-digit", month:"short", year:"numeric" }).format(d);
}

function dateFromTimestamp(value) {
  const d = value?.toDate?.() || (value ? new Date(value) : null);
  return d && !Number.isNaN(d.getTime()) ? localDateString(d) : "";
}

function daysUntil(dateString) {
  if (!dateString) return null;
  const due = new Date(`${dateString}T00:00:00`);
  const today = new Date(`${localDateString()}T00:00:00`);
  if (Number.isNaN(due.getTime())) return null;
  return Math.round((due - today) / 86400000);
}

function safetyState(bus) {
  const due = String(bus.next90DaySafetyCheckDate || "").trim();
  const days = daysUntil(due);
  if (days == null) return { kind:"unset", days:null, detail:"90 Day Safety Check date not set" };
  if (days < 0) return { kind:"overdue", days, detail:`Overdue by ${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"}` };
  if (days === 0) return { kind:"overdue", days, detail:"Due today" };
  if (days <= 7) return { kind:"soon", days, detail:`Due in ${days} day${days === 1 ? "" : "s"}` };
  return { kind:"ok", days, detail:`Due in ${days} days` };
}

function stateBadge(state) {
  if (state.kind === "overdue") return `<span class="badge bad">${state.days === 0 ? "DUE TODAY" : "OVERDUE"}</span>`;
  if (state.kind === "soon") return `<span class="badge warn">DUE SOON</span>`;
  if (state.kind === "ok") return `<span class="badge good">ON TRACK</span>`;
  return `<span class="badge">NOT SET</span>`;
}

function ensureDashboardUi() {
  const dashboard = $("dashboardView");
  if (!dashboard) return;

  const metrics = dashboard.querySelector(".metrics-grid");
  if (metrics && !$("metric90DayDueSoon")) {
    metrics.insertAdjacentHTML("beforeend", `
      <article class="metric warning"><span>90 Day Due Soon</span><strong id="metric90DayDueSoon">0</strong></article>
      <article class="metric danger"><span>90 Day Overdue</span><strong id="metric90DayOverdue">0</strong></article>`);
  }

  // 90 Day warnings now live inside the main Maintenance Due panel.
  $("safety90Panel")?.remove();
  const maintenance = $("maintenanceDueList")?.closest(".panel");
  const hint = maintenance?.querySelector(".panel-head .hint");
  if (hint) hint.textContent = "Service and 90 Day Safety Check due";
}

function dueSafetyBuses() {
  return buses
    .map((bus) => ({ bus, state:safetyState(bus) }))
    .filter((x) => x.state.kind === "overdue" || x.state.kind === "soon")
    .sort((a,b) => String(a.bus.next90DaySafetyCheckDate || "").localeCompare(String(b.bus.next90DaySafetyCheckDate || "")));
}

function augmentMaintenanceDue() {
  ensureDashboardUi();
  const wrap = $("maintenanceDueList");
  if (!wrap) return;

  const due = dueSafetyBuses();
  const signature = due.map(({bus,state}) => `${bus.id}:${state.kind}:${bus.next90DaySafetyCheckDate || ""}`).join("|");
  const existing = [...wrap.querySelectorAll("[data-safety90-dashboard]")];
  if (wrap.dataset.safety90Signature === signature && existing.length === due.length) return;

  existing.forEach((el) => el.remove());
  wrap.dataset.safety90Signature = signature;

  if (!due.length) return;

  [...wrap.querySelectorAll(".empty")].forEach((el) => {
    if (/no buses currently due based on recorded schedules/i.test(el.textContent || "")) el.remove();
  });

  due.forEach(({bus,state}) => {
    const item = document.createElement("div");
    item.className = "list-item";
    item.dataset.safety90Dashboard = bus.id || fleetNo(bus);
    item.innerHTML = `
      <div class="list-top">
        <div>
          <div class="list-title">${esc(fleetNo(bus))} · 90 Day Safety Check</div>
          <div class="list-meta">Last check: ${esc(fmtDate(bus.last90DaySafetyCheckDate))} · Next due: ${esc(fmtDate(bus.next90DaySafetyCheckDate))}</div>
        </div>
        ${stateBadge(state)}
      </div>
      <div class="list-meta">${esc(state.detail)}</div>`;
    wrap.appendChild(item);
  });
}

function renderDashboardSafety() {
  ensureDashboardUi();
  const list = buses.map((bus) => ({ bus, state:safetyState(bus) }));
  const overdue = list.filter((x) => x.state.kind === "overdue");
  const soon = list.filter((x) => x.state.kind === "soon");

  if ($("metric90DayDueSoon")) $("metric90DayDueSoon").textContent = String(soon.length);
  if ($("metric90DayOverdue")) $("metric90DayOverdue").textContent = String(overdue.length);
  augmentMaintenanceDue();
}

function findBusForFleetRow(row) {
  const key = row?.cells?.[0]?.querySelector("strong")?.textContent?.trim()
    || row?.cells?.[0]?.textContent?.split(/\s+/)?.[0]
    || "";
  return buses.find((bus) => norm(fleetNo(bus)) === norm(key));
}

function ensureFleetSafetyColumn() {
  const table = $("fleetTableBody")?.closest("table");
  if (!table) return;
  const headRow = table.querySelector("thead tr");
  if (headRow && !headRow.querySelector("[data-safety90-head]")) {
    const th = document.createElement("th");
    th.dataset.safety90Head = "1";
    th.textContent = "90 DAY SAFETY";
    const serviceHead = [...headRow.children].find((cell) => /service/i.test(cell.textContent || ""));
    if (serviceHead) serviceHead.insertAdjacentElement("afterend", th);
    else headRow.appendChild(th);
  }
}

function enhanceFleetRows() {
  ensureFleetSafetyColumn();
  const body = $("fleetTableBody");
  if (!body) return;

  [...body.querySelectorAll("tr")].forEach((row) => {
    const bus = findBusForFleetRow(row);
    if (!bus) return;

    const state = safetyState(bus);
    let cell = row.querySelector("[data-safety90-cell]");
    if (!cell) {
      cell = document.createElement("td");
      cell.dataset.safety90Cell = "1";
      const serviceCell = row.cells[5];
      if (serviceCell) serviceCell.insertAdjacentElement("afterend", cell);
      else row.appendChild(cell);
    }

    const signature = `${bus.next90DaySafetyCheckDate || ""}:${state.kind}:${state.days}`;
    if (cell.dataset.signature === signature) return;
    cell.dataset.signature = signature;
    cell.innerHTML = `
      ${stateBadge(state)}
      <div class="list-meta" style="margin-top:4px">${esc(state.detail)}</div>
      <div class="list-meta">Due: ${esc(fmtDate(bus.next90DaySafetyCheckDate))}</div>`;
  });
}

function observeRenderedAreas() {
  const maintenance = $("maintenanceDueList");
  if (maintenance && !maintenanceObserver) {
    maintenanceObserver = new MutationObserver(() => {
      clearTimeout(maintenanceEnhanceTimer);
      maintenanceEnhanceTimer = setTimeout(augmentMaintenanceDue, 0);
    });
    maintenanceObserver.observe(maintenance, { childList:true, subtree:true });
  }

  const fleetBody = $("fleetTableBody");
  if (fleetBody && !fleetObserver) {
    fleetObserver = new MutationObserver(() => {
      clearTimeout(fleetEnhanceTimer);
      fleetEnhanceTimer = setTimeout(enhanceFleetRows, 0);
    });
    fleetObserver.observe(fleetBody, { childList:true, subtree:true });
  }
}

function ensureFleetEditorFields() {
  const form = $("wfEditForm");
  const body = $("wfEditBody");
  if (!form || !body || $("wfLast90DaySafetyCheck")) return;

  const fleetNumber = String($("wfFleetNumber")?.value || "").trim();
  const bus = buses.find((b) => norm(fleetNo(b)) === norm(fleetNumber));
  const notesLabel = $("wfNotes")?.closest("label");
  if (!notesLabel) return;

  const section = document.createElement("div");
  section.className = "wf-section-title";
  section.textContent = "90 Day Safety Check";
  notesLabel.insertAdjacentElement("beforebegin", section);

  const lastLabel = document.createElement("label");
  lastLabel.innerHTML = `Last 90 Day Safety Check<input id="wfLast90DaySafetyCheck" type="date" value="${esc(bus?.last90DaySafetyCheckDate || "")}">`;
  section.insertAdjacentElement("afterend", lastLabel);

  const nextLabel = document.createElement("label");
  nextLabel.innerHTML = `Next 90 Day Safety Check Due<input id="wfNext90DaySafetyCheck" type="date" value="${esc(bus?.next90DaySafetyCheckDate || addDays(bus?.last90DaySafetyCheckDate || "", 90))}" readonly>`;
  lastLabel.insertAdjacentElement("afterend", nextLabel);

  $("wfLast90DaySafetyCheck")?.addEventListener("change", () => {
    if ($("wfNext90DaySafetyCheck")) $("wfNext90DaySafetyCheck").value = addDays($("wfLast90DaySafetyCheck").value, 90);
  });
}

function enhanceFleetDetails() {
  const body = $("wfBusBody");
  if (!body || body.querySelector("[data-safety90-summary]")) return;
  const title = body.querySelector(".wf-title")?.textContent?.trim() || "";
  const bus = buses.find((b) => norm(fleetNo(b)) === norm(title));
  if (!bus) return;
  const grid = body.querySelector(".wf-grid");
  if (!grid) return;
  const state = safetyState(bus);
  const card = document.createElement("section");
  card.className = "wf-card";
  card.dataset.safety90Summary = "1";
  card.innerHTML = `<h3>90 Day Safety Check</h3><div class="wf-kv">
    <span>Last check</span><span>${esc(fmtDate(bus.last90DaySafetyCheckDate))}</span>
    <span>Next due</span><span>${esc(fmtDate(bus.next90DaySafetyCheckDate))}</span>
    <span>Status</span><span>${stateBadge(state)}</span>
    <span>Detail</span><span>${esc(state.detail)}</span>
  </div>`;
  grid.insertBefore(card, grid.children[3] || null);
}

async function savePendingFleetSafety() {
  const pending = pendingFleetSave;
  pendingFleetSave = null;
  if (!pending) return;

  const status = $("status")?.textContent || "";
  if (!/vehicle .* (updated|created) successfully/i.test(status)) return;

  const bus = buses.find((b) => norm(fleetNo(b)) === norm(pending.fleetNumber));
  const refId = bus?.id || pending.fleetNumber;
  if (!refId) return;

  try {
    await setDoc(doc(db, "buses", refId), {
      last90DaySafetyCheckDate:pending.lastDate,
      next90DaySafetyCheckDate:pending.nextDate,
      safety90TrackingUpdatedAt:serverTimestamp(),
      safety90TrackingUpdatedBy:norm(auth.currentUser?.email)
    }, { merge:true });
  } catch (error) {
    console.error("Unable to save 90 Day Safety Check dates", error);
  }
}

function wireFleetEditor() {
  document.addEventListener("click", () => {
    setTimeout(() => {
      ensureFleetEditorFields();
      enhanceFleetDetails();
      enhanceFleetRows();
      augmentMaintenanceDue();
    }, 30);
  }, true);

  document.addEventListener("submit", (event) => {
    if (event.target?.id !== "wfEditForm") return;
    const lastDate = String($("wfLast90DaySafetyCheck")?.value || "").trim();
    pendingFleetSave = {
      fleetNumber:String($("wfFleetNumber")?.value || "").trim(),
      lastDate,
      nextDate:addDays(lastDate, 90)
    };
  }, true);

  document.addEventListener("close", (event) => {
    if (event.target?.id !== "wfEditDialog") return;
    setTimeout(savePendingFleetSafety, 0);
  }, true);
}

async function applyClosed90DayJobs() {
  for (const job of jobs) {
    if (String(job.jobType || "") !== "90 Day Safety Check" || String(job.status || "") !== "Closed") continue;
    const bus = buses.find((b) => b.id === job.busId || norm(fleetNo(b)) === norm(job.fleetNumber));
    if (!bus?.id || bus.last90DaySafetyCheckJobId === job.id) continue;

    const lastDate = dateFromTimestamp(job.closedAt) || localDateString();
    try {
      await updateDoc(doc(db, "buses", bus.id), {
        last90DaySafetyCheckDate:lastDate,
        next90DaySafetyCheckDate:addDays(lastDate, 90),
        last90DaySafetyCheckJobId:job.id,
        last90DaySafetyCheckJobNumber:job.jobNumber || "",
        safety90TrackingUpdatedAt:serverTimestamp(),
        safety90TrackingUpdatedBy:norm(job.closedByEmail || auth.currentUser?.email)
      });
    } catch (error) {
      console.error("Unable to advance 90 Day Safety Check due date", error);
    }
  }
}

onSnapshot(collection(db, "buses"), (snap) => {
  buses = snap.docs.map((d) => ({ id:d.id, ...d.data() }));
  renderDashboardSafety();
  setTimeout(() => {
    ensureFleetEditorFields();
    enhanceFleetDetails();
    enhanceFleetRows();
    observeRenderedAreas();
  }, 30);
  applyClosed90DayJobs();
});

onSnapshot(collection(db, "workshopJobs"), (snap) => {
  jobs = snap.docs.map((d) => ({ id:d.id, ...d.data() }));
  applyClosed90DayJobs();
});

wireFleetEditor();
setTimeout(() => {
  renderDashboardSafety();
  enhanceFleetRows();
  observeRenderedAreas();
}, 100);
