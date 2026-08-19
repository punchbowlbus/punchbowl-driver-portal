import {
  listenEmployees,
  listenBuses,
  listenBlocksByDate,
  listenDutySpansByDate,
  listenJobGroups,
  addDutySpan,
  updateDutySpan,
  transferDutySpanWithBlocks,
  deleteDutySpan,
  updateDutySpanDispatchStatus,
  updateBlock
} from "./db.js";

import { els, showError } from "./ui.js";
import { calculateFatigue } from "./dispatch_fatigue.js";
import { assignBlockToDriver } from "./dispatch_assignments.js";
import { unassignBlockFromDriver } from "./dispatch_assignments.js";

let nowLineTimer = null;

export function renderDispatchBoardPage() {
  showError("");

  function getLocalTodayStr() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  const today = getLocalTodayStr();

els.contentArea.innerHTML = `
  <section id="dispatchBoardShell" class="dispatch-pro-shell" aria-label="Dispatch Board">
    <header class="dispatch-pro-header">
      <div>
        <div class="dispatch-pro-kicker">PBC OPERATIONS CONTROL</div>
        <h2>Dispatch Board</h2>
        <p>Allocate work, monitor duties and resolve operational exceptions.</p>
      </div>
      <div class="dispatch-pro-header-actions">
        <button id="refreshDispatchBtn" type="button" class="dispatch-quiet-btn">↻ Refresh</button>
        <select id="boardViewMode" class="dispatch-view-select" aria-label="Board view">
          <option value="standard">Standard View</option>
          <option value="fit">Fit Full Board</option>
          <option value="control">Control Room</option>
          <option value="fullscreen">Enter Full Screen</option>
        </select>
      </div>
    </header>

    <div class="dispatch-pro-toolbar">
      <label><span>Dispatch date</span><input id="dispatchDate" type="date" value="${today}" /></label>
      <button id="loadDispatchBtn" class="dispatch-primary-btn" type="button">Load Dispatch</button>
      <label><span>Sort drivers</span><select id="driverSortBy">
        <option value="name">Alphabetical</option>
        <option value="empno">Employee Number</option>
        <option value="type_name">Employee Type</option>
      </select></label>
      <label><span>Driver view</span><select id="driverViewFilter">
        <option value="all">All Drivers</option>
        <option value="working" selected>Working Drivers</option>
        <option value="on_leave">On Leave</option>
        <option value="no_jobs">No Jobs Assigned</option>
      </select></label>
      <label class="dispatch-driver-picker"><span>Select drivers</span><input id="driverSearchFilter" type="search" placeholder="Name or employee number" /></label>
      <button id="clearDriverFilterBtn" class="dispatch-quiet-btn" type="button" hidden>Clear</button>
    </div>

    <div id="dispatchOperationalSummary" class="dispatch-summary-grid" aria-live="polite"></div>
    <div id="dispatchPageMessage" class="dispatch-page-message" hidden role="status"></div>

    <section id="unassignedJobsPanel" class="dispatch-unassigned-panel compact">
      <div class="dispatch-unassigned-head">
        <button id="toggleUnassignedJobsBtn" class="dispatch-unassigned-title" type="button" aria-expanded="true">
          <span class="dispatch-unassigned-chevron">⌄</span>
          <span>Unassigned Work</span>
          <strong id="unassignedJobsCount">0</strong>
        </button>
        <div class="dispatch-unassigned-tools">
          <input id="unassignedJobsSearch" type="search" placeholder="Search customer, route or reference" />
          <select id="unassignedJobsTimeFilter" aria-label="Unassigned work time">
            <option value="all">All times</option>
            <option value="urgent">Starting within 60 min</option>
            <option value="morning">Morning</option>
            <option value="midday">Midday</option>
            <option value="afternoon">Afternoon</option>
            <option value="evening">Evening / overnight</option>
          </select>
          <button id="unassignedDensityBtn" class="dispatch-quiet-btn" type="button">Expand</button>
          <span id="unassignedJobsDateLabel" class="dispatch-unassigned-date">${today}</span>
        </div>
      </div>
      <div class="dispatch-unassigned-axis-row">
        <div id="unassignedJobsGutter" class="dispatch-unassigned-gutter" aria-hidden="true">
          <div class="dispatch-unassigned-gutter-header">Unassigned</div>
          <div id="unassignedJobsGroupLabels" class="dispatch-unassigned-group-labels"></div>
        </div>
        <div id="unassignedJobsPanelBody" class="dispatch-unassigned-scroll">
          <div class="dispatch-unassigned-empty">Load a dispatch date to view unassigned work.</div>
        </div>
      </div>
    </section>

    <div id="dispatchMainWorkArea" class="dispatch-pro-workarea">
      <section class="dispatch-drivers-panel">
        <div class="dispatch-panel-heading"><span>Drivers</span><small id="visibleDriverCount">0 shown</small></div>
        <div id="dispatchDriversTopSpacer" class="dispatch-driver-spacer"></div>
        <div id="dispatchDriversScroll"><div id="dispatchDriversList"></div></div>
      </section>

      <section class="dispatch-timeline-panel">
        <div class="dispatch-panel-heading"><span>Timeline</span><small>Drag empty space to move the board</small></div>
        <div id="dispatchTimelineOuter">
          <div id="dispatchTimelineInner">
            <div id="dispatchTimelineHeader"></div>
            <div id="dispatchTimelineBody"></div>
          </div>
        </div>
      </section>

      <aside id="dispatchRightPanel" class="dispatch-detail-panel">
        <div class="dispatch-panel-heading dispatch-detail-heading">
          <button id="toggleDetailPanelBtn" type="button" class="dispatch-icon-btn" title="Hide details">›</button>
          <span id="dispatchRightPanelTitle">Driver / Duty Details</span>
        </div>
        <div id="dispatchDetailPanel"><div class="dispatch-empty-state">Select a driver or numbered job to view details.</div></div>
      </aside>
    </div>
  </section>

  <div id="dispatchModalLayer" class="dispatch-modal-layer" hidden>
    <div class="dispatch-modal" role="dialog" aria-modal="true" aria-labelledby="dispatchModalTitle">
      <div id="dispatchModalIcon" class="dispatch-modal-icon">!</div>
      <div><h3 id="dispatchModalTitle">Confirm action</h3><div id="dispatchModalMessage"></div></div>
      <div class="dispatch-modal-actions">
        <button id="dispatchModalCancel" type="button" class="dispatch-quiet-btn">Cancel</button>
        <button id="dispatchModalConfirm" type="button" class="dispatch-primary-btn">Confirm</button>
      </div>
    </div>
  </div>
`;

const dispatchDateEl = document.getElementById("dispatchDate");
const loadBtn = document.getElementById("loadDispatchBtn");
const driversTopSpacerEl = document.getElementById("dispatchDriversTopSpacer");
const driversScrollEl = document.getElementById("dispatchDriversScroll");
const driversListEl = document.getElementById("dispatchDriversList");
const timelineOuterEl = document.getElementById("dispatchTimelineOuter");
const timelineHeaderEl = document.getElementById("dispatchTimelineHeader");
const timelineBodyEl = document.getElementById("dispatchTimelineBody");
const detailPanelEl = document.getElementById("dispatchDetailPanel");
const driverSortByEl = document.getElementById("driverSortBy");
const driverViewFilterEl = document.getElementById("driverViewFilter");
const driverSearchFilterEl = document.getElementById("driverSearchFilter");
const clearDriverFilterBtn = document.getElementById("clearDriverFilterBtn");
const refreshDispatchBtn = document.getElementById("refreshDispatchBtn");
const boardViewModeEl = document.getElementById("boardViewMode");
const operationalSummaryEl = document.getElementById("dispatchOperationalSummary");
const pageMessageEl = document.getElementById("dispatchPageMessage");
const visibleDriverCountEl = document.getElementById("visibleDriverCount");
const toggleDetailPanelBtn = document.getElementById("toggleDetailPanelBtn");

toggleDetailPanelBtn.onclick = () => {
  const mainWorkArea = document.getElementById("dispatchMainWorkArea");
  const rightPanel = detailPanelEl.parentElement;

  if (!mainWorkArea || !rightPanel) return;

  if (detailPanelEl.style.display === "none") {
    detailPanelEl.style.display = "block";
    rightPanel.classList.remove("collapsed");
    mainWorkArea.classList.remove("details-collapsed");
    toggleDetailPanelBtn.textContent = "›";
    toggleDetailPanelBtn.title = "Hide details";
  } else {
    detailPanelEl.style.display = "none";
    rightPanel.classList.add("collapsed");
    mainWorkArea.classList.add("details-collapsed");
    toggleDetailPanelBtn.textContent = "‹";
    toggleDetailPanelBtn.title = "Show details";
  }
};

const unassignedJobsPanelEl = document.getElementById("unassignedJobsPanel");
const toggleUnassignedJobsBtn = document.getElementById("toggleUnassignedJobsBtn");
const unassignedDensityBtn = document.getElementById("unassignedDensityBtn");
const unassignedJobsSearchEl = document.getElementById("unassignedJobsSearch");
const unassignedJobsTimeFilterEl = document.getElementById("unassignedJobsTimeFilter");
const unassignedJobsCountEl = document.getElementById("unassignedJobsCount");
const unassignedJobsDateLabelEl = document.getElementById("unassignedJobsDateLabel");
const unassignedJobsPanelBodyEl = document.getElementById("unassignedJobsPanelBody");
const unassignedJobsGroupLabelsEl = document.getElementById("unassignedJobsGroupLabels");
const modalLayerEl = document.getElementById("dispatchModalLayer");
const modalTitleEl = document.getElementById("dispatchModalTitle");
const modalMessageEl = document.getElementById("dispatchModalMessage");
const modalIconEl = document.getElementById("dispatchModalIcon");
const modalCancelBtn = document.getElementById("dispatchModalCancel");
const modalConfirmBtn = document.getElementById("dispatchModalConfirm");

let employeesCache = [];
let busesCache = [];
let dutySpansCache = [];
let jobGroupsCache = [];
let selectedDriverEmpNo = "";
let slotWidth = 10;
let unsubscribeDutySpans = null;
let unsubscribeBlocks = null;
let blocksCache = [];
let draggedBlockId = "";
let draggedDutySpanId = "";
let selectedBlockId = "";
let unassignedDensity = "compact";
let messageTimer = null;

  const SLOT_MINUTES = 15;
  const TOTAL_SLOTS = 144;
  const OPERATIONAL_START_MIN = 22 * 60;
  let ROW_HEIGHT = 44;

  function timelineMinute(minute, dayShift = 0) {
    return Number(minute || 0) + (24 * 60) + (Number(dayShift || 0) * 24 * 60);
  }

  function dispatchMinuteToLeft(minute, dayShift = 0) {
    return ((timelineMinute(minute, dayShift) - OPERATIONAL_START_MIN) / SLOT_MINUTES) * slotWidth;
  }

  function getDutyTimelineShift(span) {
    if (Number.isFinite(Number(span?.timelineDayShift))) return Number(span.timelineDayShift);
    const start = Number(span?.startMin || 0);
    const end = Number(span?.endMin || 0);
    return start >= OPERATIONAL_START_MIN && end > 24 * 60 ? -1 : 0;
  }

  function minToTimeStr(min) {
    const safeMin = Number(min || 0);
    const h = Math.floor(safeMin / 60);
    const m = safeMin % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }

  async function applyBoardView(mode = "standard") {
    const shell = document.getElementById("dispatchBoardShell");
    if (!shell) return;

    shell.classList.toggle("control-room", mode === "control");
    ROW_HEIGHT = mode === "control" ? 54 : 44;
    document.body.classList.toggle("dispatch-board-fullscreen", mode === "fullscreen");

    if (mode === "fullscreen") {
      try {
        if (!document.fullscreenElement) await shell.requestFullscreen();
      } catch {
        showPageMessage("Browser full screen could not be opened. Use the browser's full-screen command instead.", "warning");
      }
    } else if (document.fullscreenElement) {
      try { await document.exitFullscreen(); } catch {}
    }

    if (mode === "fit") {
      const availableWidth = Math.max(900, timelineOuterEl?.clientWidth || 1200);
      applyZoom(Math.max(8, Math.floor(availableWidth / TOTAL_SLOTS)));
    } else if (mode === "control") {
      applyZoom(Math.max(14, Number(localStorage.getItem("dispatch-control-slot-width") || 16)));
    } else if (mode === "standard") {
      applyZoom(10);
    }

    try { localStorage.setItem("dispatch-board-view", mode); } catch {}
    setTimeout(() => {
      buildTimelineHeader();
      syncDriverSpacerHeight();
      renderDrivers();
      renderUnassignedJobs(blocksCache, getSelectedDate());
      renderNowLine();
    }, 50);
  }
  function timeStrToMin(value) {
    const v = String(value || "").trim();

    if (!/^\d{1,2}:\d{2}$/.test(v)) return NaN;

    const [h, m] = v.split(":").map(Number);

    if (Number.isNaN(h) || Number.isNaN(m)) return NaN;
    if (m < 0 || m > 59) return NaN;
    if (h < 0 || h > 48) return NaN;

    return h * 60 + m;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function showPageMessage(message, type = "success", timeout = 4200) {
    if (!pageMessageEl) return;
    if (messageTimer) clearTimeout(messageTimer);
    pageMessageEl.className = `dispatch-page-message ${type}`;
    pageMessageEl.textContent = String(message || "");
    pageMessageEl.hidden = !message;
    if (message && timeout > 0) {
      messageTimer = setTimeout(() => { pageMessageEl.hidden = true; }, timeout);
    }
  }

  function confirmDispatchAction({
    title = "Confirm action",
    message = "Are you sure?",
    confirmLabel = "Confirm",
    tone = "primary"
  } = {}) {
    if (!modalLayerEl) {
      showPageMessage("The confirmation panel could not be opened. No changes were made.", "error");
      return Promise.resolve(false);
    }
    modalTitleEl.textContent = title;
    modalMessageEl.innerHTML = message;
    modalIconEl.textContent = tone === "danger" ? "!" : "✓";
    modalIconEl.className = `dispatch-modal-icon ${tone}`;
    modalConfirmBtn.textContent = confirmLabel;
    modalConfirmBtn.className = tone === "danger" ? "dispatch-danger-btn" : "dispatch-primary-btn";
    modalLayerEl.hidden = false;

    return new Promise((resolve) => {
      const close = (answer) => {
        modalLayerEl.hidden = true;
        modalConfirmBtn.onclick = null;
        modalCancelBtn.onclick = null;
        resolve(answer);
      };
      modalConfirmBtn.onclick = () => close(true);
      modalCancelBtn.onclick = () => close(false);
      modalLayerEl.onclick = (event) => {
        if (event.target === modalLayerEl) close(false);
      };
    });
  }

  function getSelectedDate() {
    return String(dispatchDateEl?.value || "").trim();
  }

  function getActiveDrivers() {
    let drivers = employeesCache.filter((e) => {
      const role = String(e.role || "").toLowerCase().trim();
      const status = String(e.status || "").toLowerCase().trim();

      const isDriver = role === "driver";
      const isNotInactive = status !== "inactive";

      if (!isDriver || !isNotInactive) return false;

      const view = driverViewFilterEl?.value || "all";
      const empNo = String(e.employeeNumber || "");
      const hasDutySpan = getDriverDutySpans(empNo).length > 0;
      const hasAssignedJobs = getAssignedBlocksForDriver(empNo).length > 0;
      const isOnLeave = status === "on leave" || status === "leave" || status === "unavailable";

      if (view === "working" && !hasDutySpan) return false;
      if (view === "on_leave" && !isOnLeave) return false;
      if (view === "no_jobs" && (isOnLeave || hasAssignedJobs)) return false;

      const search = String(driverSearchFilterEl?.value || "").trim().toLowerCase();
      if (search) {
        const haystack = [e.displayName, e.firstName, e.lastName, e.employeeNumber]
          .filter(Boolean).join(" ").toLowerCase();
        if (!haystack.includes(search)) return false;
      }

      return true;
    });

    const sortBy = driverSortByEl?.value || "type_name";

    drivers.sort((a, b) => {
      const aName = String(a.displayName || a.firstName || "").toLowerCase();
      const bName = String(b.displayName || b.firstName || "").toLowerCase();

      const aEmp = String(a.employeeNumber || "");
      const bEmp = String(b.employeeNumber || "");

      const aType = String(a.employeeType || a.employmentType || a.empType || "").toLowerCase();
      const bType = String(b.employeeType || b.employmentType || b.empType || "").toLowerCase();

      const typeRank = (v) => {
        if (v.includes("full")) return 1;
        if (v.includes("part")) return 2;
        if (v.includes("casual")) return 3;
        return 9;
      };

      if (sortBy === "name") {
        return aName.localeCompare(bName);
      }

      if (sortBy === "empno") {
        return aEmp.localeCompare(bEmp, undefined, { numeric: true, sensitivity: "base" });
      }

      const typeCompare = typeRank(aType) - typeRank(bType);
      if (typeCompare !== 0) return typeCompare;

      return aName.localeCompare(bName);
    });

    return drivers;
  }

  function getBusOptionsHtml(selectedValue = "") {
    const activeBuses = busesCache.filter(
      (b) => String(b.status || "").toLowerCase() !== "inactive"
    );

    return `
      <option value="">Bus</option>
      ${activeBuses
        .map((b) => {
          const fleet = String(b.fleetNumber || "").trim();
          const selected = String(selectedValue) === String(fleet) ? "selected" : "";
          return `<option value="${escapeHtml(fleet)}" ${selected}>${escapeHtml(fleet)}</option>`;
        })
        .join("")}
    `;
  }

  function getDriverDutySpans(empNo) {
    const selectedDate = getSelectedDate();
    return dutySpansCache
      .filter(
        (d) =>
          String(d.driverEmployeeNumber || "") === String(empNo || "") &&
          String(d.serviceDate || "") === String(selectedDate || "")
      )
      .sort((a, b) => Number(a.startMin || 0) - Number(b.startMin || 0));
  }
  function getAssignedBlocksForDriver(empNo) {
    const selectedDate = getSelectedDate();

    return (blocksCache || [])
      .filter((b) => {
        const sameDate = String(b.serviceDate || b.date || "") === String(selectedDate || "");
        const assignedToDriver =
          String(
            b.assignedDriverEmployeeNumber ||
            b.assignedDriverId ||
            b.driverId ||
            ""
          ).trim() === String(empNo || "").trim();

        return sameDate && assignedToDriver;
      })
      .sort((a, b) => {
        const aStart = Number(a.startMin ?? a.startMinutes ?? 0);
        const bStart = Number(b.startMin ?? b.startMinutes ?? 0);
        return aStart - bStart;
      });
  }

  function getUnassignedBlocks() {
    const selectedDate = getSelectedDate();
    return (blocksCache || []).filter((block) => {
      const sameDate = String(block.serviceDate || block.date || "") === selectedDate;
      const driver = String(
        block.assignedDriverEmployeeNumber || block.assignedDriverId || block.driverId || ""
      ).trim();
      return sameDate && !driver && !block.deleted;
    });
  }

  function countBusConflicts(spans) {
    const byBus = new Map();
    spans.forEach((span) => {
      const bus = String(span.assignedBus || "").trim();
      if (!bus || span.deleted || String(span.dispatchStatus || "").toLowerCase() === "cancelled") return;
      if (!byBus.has(bus)) byBus.set(bus, []);
      byBus.get(bus).push(span);
    });
    let conflicts = 0;
    byBus.forEach((items) => {
      const sorted = items.slice().sort((a, b) => Number(a.startMin || 0) - Number(b.startMin || 0));
      for (let i = 0; i < sorted.length; i += 1) {
        for (let j = i + 1; j < sorted.length; j += 1) {
          if (spansOverlap(Number(sorted[i].startMin || 0), Number(sorted[i].endMin || 0), Number(sorted[j].startMin || 0), Number(sorted[j].endMin || 0))) {
            conflicts += 1;
          }
        }
      }
    });
    return conflicts;
  }

  function renderOperationalSummary() {
    if (!operationalSummaryEl) return;
    const selectedDate = getSelectedDate();
    const drivers = employeesCache.filter((employee) => {
      const role = String(employee.role || "").toLowerCase().trim();
      const status = String(employee.status || "").toLowerCase().trim();
      return role === "driver" && status !== "inactive";
    });
    const activeSpans = dutySpansCache.filter((span) =>
      String(span.serviceDate || "") === selectedDate && !span.deleted &&
      String(span.dispatchStatus || "").toLowerCase() !== "cancelled"
    );
    const workingDriverIds = new Set(activeSpans.map((span) => String(span.driverEmployeeNumber || "")).filter(Boolean));
    const onLeave = drivers.filter((driver) => ["on leave", "leave", "unavailable"].includes(String(driver.status || "").toLowerCase())).length;
    const driversWithoutJobs = drivers.filter((driver) => {
      const status = String(driver.status || "").toLowerCase();
      return !["on leave", "leave", "unavailable"].includes(status) &&
        getAssignedBlocksForDriver(driver.employeeNumber).length === 0;
    }).length;
    const busesInUse = new Set(activeSpans.map((span) => String(span.assignedBus || "").trim()).filter(Boolean));
    const activeBuses = busesCache.filter((bus) => String(bus.status || "").toLowerCase() === "active");
    const withoutBus = activeSpans.filter((span) => !String(span.assignedBus || "").trim()).length;
    const unassignedJobs = getUnassignedBlocks().length;
    const conflicts = countBusConflicts(activeSpans);

    const cards = [
      ["working", "Drivers Working", workingDriverIds.size, "green"],
      ["on_leave", "On Leave", onLeave, "grey"],
      ["no_jobs", "No Jobs Assigned", driversWithoutJobs, "amber"],
      ["buses", "Buses in Use", busesInUse.size, "blue"],
      ["available_buses", "Buses Available", Math.max(0, activeBuses.length - busesInUse.size), "green"],
      ["without_bus", "Duty Spans Without Bus", withoutBus, withoutBus ? "amber" : "grey"],
      ["unassigned", "Unassigned Jobs", unassignedJobs, unassignedJobs ? "red" : "grey"],
      ["conflicts", "Bus Conflicts", conflicts, conflicts ? "red" : "grey"]
    ];

    operationalSummaryEl.innerHTML = cards.map(([key, label, value, tone]) => `
      <button type="button" class="dispatch-summary-card ${tone}" data-summary-filter="${key}">
        <span>${escapeHtml(label)}</span><strong>${Number(value || 0)}</strong>
      </button>`).join("");

    operationalSummaryEl.querySelectorAll("[data-summary-filter]").forEach((button) => {
      button.onclick = () => {
        const key = button.dataset.summaryFilter;
        if (["working", "on_leave", "no_jobs"].includes(key)) {
          driverViewFilterEl.value = key;
          renderDrivers();
        } else if (key === "unassigned") {
          setUnassignedPanelState("expanded");
        } else {
          showPageMessage(`${button.querySelector("span")?.textContent || "Operational metric"}: ${button.querySelector("strong")?.textContent || "0"}`, "info");
        }
      };
    });
  }
  function getDriverDispatchStatus(empNo) {
    const spans = getDriverDutySpans(empNo);
    if (!spans.length) return "Pending";
    return String(spans[0].dispatchStatus || "Pending");
  }

  function getDriverAcknowledgment(empNo) {
    const spans = getDriverDutySpans(empNo);
    if (!spans.length) return "Pending";
    return String(spans[0].driverAcknowledgment || "Pending");
  }

  function renderAckBadgeByValue(rawValue) {
    const status = String(rawValue || "").toLowerCase().trim();

    let label = "P";
    let bg = "#fff3cd";
    let color = "#856404";

    if (status === "yes" || status === "y" || status === "accepted") {
      label = "Y";
      bg = "#d4edda";
      color = "#155724";
    } else if (status === "no" || status === "n" || status === "declined") {
      label = "N";
      bg = "#f8d7da";
      color = "#721c24";
    }

    return `
      <span
        title="Driver acknowledgment"
        style="
          display:inline-flex;
          align-items:center;
          justify-content:center;
          min-width:16px;
          height:16px;
          padding:0 5px;
          border-radius:999px;
          background:${bg};
          color:${color};
          font-size:9px;
          font-weight:700;
          line-height:1;
          box-sizing:border-box;
          flex:0 0 auto;
        "
      >
        ${label}
      </span>
    `;
  }

  function buildTimelineHeader() {
    timelineHeaderEl.innerHTML = buildTimeScaleHtml("dispatch-time-scale-main");
  }

  function buildTimeScaleHtml(extraClass = "") {
    return `<div class="dispatch-time-scale ${extraClass}" style="width:${TOTAL_SLOTS * slotWidth}px;grid-template-columns:repeat(${TOTAL_SLOTS},${slotWidth}px)">
      ${Array.from({ length: TOTAL_SLOTS }).map((_, index) => {
        const operationalMinute = OPERATIONAL_START_MIN + index * SLOT_MINUTES;
        const clockMinute = operationalMinute % (24 * 60);
        const isHour = index % 4 === 0;
        const isDayBoundary = clockMinute === 0;
        const dayOffset = Math.floor(operationalMinute / (24 * 60));
        const label = isHour ? minToTimeStr(clockMinute) : String(clockMinute % 60).padStart(2, "0");
        const dayName = dayOffset === 0 ? "Previous day" : dayOffset === 1 ? "Selected day" : "Next day";
        return `<div class="dispatch-time-cell ${isHour ? "hour" : "quarter-hour"} ${isDayBoundary ? "day-boundary" : ""}" title="${dayName} ${minToTimeStr(clockMinute)}"><span>${label}</span></div>`;
      }).join("")}
    </div>`;
  }

  function syncDriverSpacerHeight() {
    if (!timelineHeaderEl || !driversTopSpacerEl) return;
    const headerHeight = Math.ceil(timelineHeaderEl.getBoundingClientRect().height) || 30;
    driversTopSpacerEl.style.height = `${headerHeight}px`;
    driversTopSpacerEl.style.minHeight = `${headerHeight}px`;
    driversTopSpacerEl.style.maxHeight = `${headerHeight}px`;
    driversTopSpacerEl.style.flex = `0 0 ${headerHeight}px`;
  }

  function syncDriverListHeight() {
    if (!driversListEl || !timelineBodyEl) return;

    const timelineHeight = timelineBodyEl.scrollHeight || 0;
    driversListEl.style.height = `${timelineHeight}px`;
    driversListEl.style.minHeight = `${timelineHeight}px`;
  }

  function spansOverlap(startA, endA, startB, endB) {
    return startA < endB && endA > startB;
  }

  function validateDriverSpanOverlap(empNo, startMin, endMin, editingSpanId = "") {
    const spans = getDriverDutySpans(empNo);

    return spans.some((span) => {
      if (editingSpanId && String(span.id) === String(editingSpanId)) return false;
      return spansOverlap(startMin, endMin, Number(span.startMin || 0), Number(span.endMin || 0));
    });
  }

function renderDriverDetail(driver) {
  if (!driver) {
    detailPanelEl.innerHTML = `<div class="muted">Click a driver row to view details.</div>`;
    return;
  }

  const empNo = String(driver.employeeNumber || "");
  const spans = getDriverDutySpans(empNo);
  const assignedBlocks = getAssignedBlocksForDriver(empNo);

  function getDetailJobNumber(block, fallbackIndex) {
    const start = Number(block.startMin ?? block.startMinutes ?? 0);
    const end = Number(block.endMin ?? block.endMinutes ?? 0);
    let spanIndex = spans.findIndex((span) => String(block.dutySpanId || "") && String(span.id) === String(block.dutySpanId));
    if (spanIndex < 0) spanIndex = spans.findIndex((span) => start >= Number(span.startMin || 0) && end <= Number(span.endMin || 0));
    if (spanIndex < 0) return `J${fallbackIndex + 1}`;
    const span = spans[spanIndex];
    const jobs = assignedBlocks.filter((item) => {
      if (String(item.dutySpanId || "") && String(item.dutySpanId) === String(span.id)) return true;
      const itemStart = Number(item.startMin ?? item.startMinutes ?? 0);
      const itemEnd = Number(item.endMin ?? item.endMinutes ?? 0);
      return itemStart >= Number(span.startMin || 0) && itemEnd <= Number(span.endMin || 0);
    });
    const jobIndex = Math.max(0, jobs.findIndex((item) => String(item.id) === String(block.id)));
    return `${spanIndex + 1}.${jobIndex + 1}`;
  }

  function getDetailGroupName(block) {
    const direct = block.jobGroupName || block.groupName || block.schoolName || block.school || block.title || block.name || block.jobName;
    if (direct) return String(direct);
    const group = jobGroupsCache.find((item) => String(item.id) === String(block.jobGroupId || ""));
    return String(group?.title || group?.name || group?.clientName || "Assigned job");
  }

  function renderAssignedJobsMarkup() {
    if (!assignedBlocks.length) return `<div class="muted" style="font-size:13px;">No assigned jobs.</div>`;
    const ordered = assignedBlocks.slice().sort((a, b) => Number(a.startMin ?? 0) - Number(b.startMin ?? 0));
    const used = new Set();
    const groups = spans.map((span, dutyIndex) => {
      const jobs = ordered.filter((block) => {
        const directMatch = String(block.dutySpanId || "") && String(block.dutySpanId) === String(span.id || "");
        const start = Number(block.startMin ?? block.startMinutes ?? 0);
        const end = Number(block.endMin ?? block.endMinutes ?? 0);
        const timeMatch = !block.dutySpanId && start >= Number(span.startMin || 0) && end <= Number(span.endMin || 0);
        if (directMatch || timeMatch) used.add(String(block.id));
        return directMatch || timeMatch;
      });
      return { span, dutyIndex, jobs };
    }).filter((group) => group.jobs.length);
    const unlinked = ordered.filter((block) => !used.has(String(block.id)));
    if (unlinked.length) groups.push({ span: null, dutyIndex: groups.length, jobs: unlinked });

    return groups.map(({ span, dutyIndex, jobs }) => `
      <section class="dispatch-assigned-duty-group">
        <div class="dispatch-assigned-duty-head">
          <strong>D${dutyIndex + 1}${span?.dutyNumber ? ` · ${escapeHtml(span.dutyNumber)}` : ""}</strong>
          <span>${span ? `${minToTimeStr(span.startMin)}–${minToTimeStr(span.endMin)}` : "Unlinked jobs"}</span>
        </div>
        <div class="dispatch-assigned-duty-jobs">
          ${jobs.map((block, blockIndex) => {
            const startMin = Number(block.startMin ?? block.startMinutes ?? 0);
            const endMin = Number(block.endMin ?? block.endMinutes ?? 0);
            const fromText = String(block.fromName || block.from || block.pickup || block.startLocation || "").trim();
            const toText = String(block.toName || block.to || block.dropoff || block.endLocation || "").trim();
            const groupName = getDetailGroupName(block);
            const colors = getGroupColors(block.jobGroupId || groupName);
            const displayNumber = getDetailJobNumber(block, blockIndex);
            const direction = String(block.routeDirection || block.direction || block.blockType || "Service");
            const bus = String(block.assignedBus || block.busNumber || block.bus || span?.assignedBus || "Unassigned");
            const status = String(block.dispatchStatus || "Assigned");
            const isSelectedJob = String(selectedBlockId) === String(block.id);
            return `<article data-job-detail="${escapeHtml(block.id || "")}" class="dispatch-job-detail-card ${isSelectedJob ? "selected" : ""}" style="--job-group-color:${colors.bg};--job-group-text:${colors.text}">
              <div class="dispatch-job-card-top"><span class="dispatch-job-number">${escapeHtml(displayNumber)}</span><strong>${minToTimeStr(startMin)}–${minToTimeStr(endMin)}</strong></div>
              <div class="dispatch-job-detail-group">${escapeHtml(groupName)}</div>
              <div class="dispatch-job-route">${escapeHtml(fromText || "—")} <span>→</span> ${escapeHtml(toText || "—")}</div>
              <div class="dispatch-job-meta"><span>${escapeHtml(direction)}</span><span>Bus: ${escapeHtml(bus)}</span><span>${escapeHtml(status)}</span></div>
              <div class="dispatch-job-actions"><button type="button" data-edit-assigned-block="${escapeHtml(block.id || "")}">Edit</button><button type="button" data-unassign-block="${escapeHtml(block.id || "")}">Unassign</button></div>
            </article>`;
          }).join("")}
        </div>
      </section>`).join("");
  }

  function getBreakRowHtml(breakItem = {}) {
    const type = String(breakItem.type || "meal").toLowerCase();
    const startValue =
      typeof breakItem.startMin === "number" ? minToTimeStr(breakItem.startMin) : "";
    const endValue =
      typeof breakItem.endMin === "number" ? minToTimeStr(breakItem.endMin) : "";
    const locationValue = String(breakItem.location || "");

    return `
      <div
        data-break-row="1"
        style="
          padding:8px;
          border:1px solid #e5e5e5;
          border-radius:8px;
          background:#fff;
          display:grid;
          gap:8px;
        "
      >
        <div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
          <div style="font-weight:700; font-size:12px;">Break</div>
          <button type="button" data-remove-break-row="1" style="font-size:11px; padding:2px 8px;">
            Remove
          </button>
        </div>

        <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:8px;">
          <div>
            <div class="muted" style="margin-bottom:4px; font-size:12px;">Type</div>
            <select data-break-type="1">
              <option value="meal" ${type === "meal" ? "selected" : ""}>Meal (Unpaid)</option>
              <option value="crib" ${type === "crib" ? "selected" : ""}>Crib (Paid)</option>
            </select>
          </div>

          <div>
            <div class="muted" style="margin-bottom:4px; font-size:12px;">Start</div>
            <input data-break-start="1" type="text" placeholder="HH:MM" value="${escapeHtml(startValue)}" />
          </div>

          <div>
            <div class="muted" style="margin-bottom:4px; font-size:12px;">End</div>
            <input data-break-end="1" type="text" placeholder="HH:MM" value="${escapeHtml(endValue)}" />
          </div>
        </div>

        <div>
          <div class="muted" style="margin-bottom:4px; font-size:12px;">Location (optional)</div>
          <input data-break-location="1" type="text" placeholder="Break location" value="${escapeHtml(locationValue)}" />
        </div>
      </div>
    `;
  }

  detailPanelEl.innerHTML = `
    <div style="display:grid; gap:10px;">
      <div style="padding-bottom:2px;">
        <div style="font-size:18px; font-weight:700; line-height:1.2;">
          ${escapeHtml(driver.displayName || driver.firstName || driver.employeeNumber || "Driver")}
        </div>
        <div class="muted" style="margin-top:4px; font-size:12px;">
          Emp No: ${escapeHtml(empNo)}
        </div>
      </div>

      <div style="padding:10px; border:1px solid #eee; border-radius:10px; background:#fafafa;">
        <div style="font-weight:700; margin-bottom:8px;">Duty Spans</div>

        <div id="driverDutySpanList_${empNo}" style="display:grid; gap:8px;">
          ${
            spans.length
              ? spans
                  .map((span, spanIndex) => {
                    const breaks = Array.isArray(span.breaks) ? span.breaks : [];

                    const fatigueColor =
                      span.fatigueStatus === "BREACH"
                        ? "#dc2626"
                        : span.fatigueStatus === "WARNING"
                        ? "#f59e0b"
                        : "#16a34a";

                    return `
                      <div class="dispatch-duty-detail-card" style="padding:8px; border:1px solid #e5e5e5; border-radius:8px; background:#fff; position:relative;">
                        <div style="position:absolute; top:8px; right:8px; display:flex; gap:6px;">
                          <button
                            type="button"
                            data-edit-duty-span="${span.id}"
                            style="font-size:10px; padding:2px 6px;"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            data-delete-duty-span="${span.id}"
                            style="font-size:10px; padding:2px 6px;"
                          >
                            Delete
                          </button>
                        </div>
                          ${
                            span.dutyNumber
                              ? `
                                <div style="font-weight:800; font-size:14px; margin-bottom:6px; color:#1d4ed8; padding-right:92px;">
                                  Duty ${spanIndex + 1}: ${escapeHtml(span.dutyNumber)}
                                </div>
                              `
                              : ""
                          }
                        <div style="font-weight:700; font-size:13px; padding-right:92px;">
                          ${minToTimeStr(span.startMin)} - ${minToTimeStr(span.endMin)}
                        </div>

                          <div class="muted" style="font-size:12px; margin-top:3px;">
                            Duty Type: ${escapeHtml(span.dutyType || "Charter")}
                          </div>

                          ${
                            span.dutyType === "Rail Replacement"
                              ? `
                                <div class="muted" style="font-size:12px; margin-top:3px;">
                                  Route: ${escapeHtml(span.routeNumber || "-")}
                                </div>
                                <div class="muted" style="font-size:12px; margin-top:3px;">
                                  ${escapeHtml(span.startLocation || "")} → ${escapeHtml(span.endLocation || "")}
                                </div>
                                ${
                                  span.routePdfUrl
                                    ? `
                                      <div class="muted" style="font-size:12px; margin-top:3px;">
                                        <a href="${span.routePdfUrl}" target="_blank">Route Description</a>
                                      </div>
                                    `
                                    : ""
                                }
                              `
                              : `
                                <div class="muted" style="font-size:12px; margin-top:3px;">
                                  ${escapeHtml(span.startLocation || "")} → ${escapeHtml(span.endLocation || "")}
                                </div>
                              `
                          }

                        <div class="muted" style="font-size:12px; margin-top:3px;">
                          Bus: ${escapeHtml(span.assignedBus || "Unassigned")}
                        </div>

                        <div class="muted" style="font-size:12px; margin-top:3px;">
                          Status: ${escapeHtml(span.dispatchStatus || "Pending")} | Driver: ${escapeHtml(span.driverAcknowledgment || "Pending")}
                        </div>

                        <div class="muted" style="font-size:12px; margin-top:3px;">
                          Breaks: ${
                            breaks.length
                              ? breaks
                                  .map((b) => {
                                    const paidLabel =
                                      String(b.type || "").toLowerCase() === "meal"
                                        ? "Unpaid"
                                        : "Paid";
                                    return `${escapeHtml(b.type || "")} ${minToTimeStr(b.startMin)}-${minToTimeStr(b.endMin)} (${paidLabel})`;
                                  })
                                  .join(" | ")
                              : "None"
                          }
                        </div>

                        <div class="muted" style="font-size:12px; margin-top:3px;">
                          Total: ${Number(span.totalSpanMinutes || 0)} min | Paid: ${Number(span.paidMinutes || 0)} min | Unpaid: ${Number(span.unpaidMinutes || 0)} min
                        </div>

                        <div style="font-size:12px; margin-top:4px;">
                          Fatigue:
                          <span style="font-weight:700; color:${fatigueColor};">
                            ${escapeHtml(span.fatigueStatus || "OK")}
                          </span>
                        </div>

                        ${
                          span.fatigueWarning
                            ? `
                              <div class="muted" style="font-size:11px; margin-top:2px;">
                                ${escapeHtml(span.fatigueWarning)}
                              </div>
                            `
                            : ""
                        }
                      </div>
                    `;
                  })
                  .join("")
              : `<div class="muted" style="font-size:13px;">No duty spans for this driver yet.</div>`
          }
        </div>

        <div style="margin-top:10px;">
          <button type="button" id="showAddDutySpanBtn_${empNo}">Add Duty Span</button>
        </div>
      </div>

      <div style="padding:10px; border:1px solid #dbeafe; border-radius:10px; background:#eff6ff;">
        <div style="font-weight:700; margin-bottom:8px; color:#1d4ed8;">
          Assigned Jobs
        </div>

        <div style="display:grid; gap:8px;">
          ${renderAssignedJobsMarkup()}
        </div>
      </div>

      <div
        id="editAssignedBlockWrap_${empNo}"
        style="
          display:none;
          padding:10px;
          border:1px solid #dbeafe;
          border-radius:10px;
          background:#f8fbff;
        "
      >
        <div style="font-weight:700; margin-bottom:10px;">
          Edit Assigned Job
        </div>

        <input type="hidden" id="editAssignedBlockId_${empNo}" />

        <div style="display:grid; gap:10px;">
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
            <div>
              <div class="muted" style="margin-bottom:4px; font-size:12px;">Start Time</div>
              <input id="editAssignedStart_${empNo}" type="text" placeholder="HH:MM" />
            </div>

            <div>
              <div class="muted" style="margin-bottom:4px; font-size:12px;">End Time</div>
              <input id="editAssignedEnd_${empNo}" type="text" placeholder="HH:MM" />
            </div>
          </div>

          <div>
            <div class="muted" style="margin-bottom:4px; font-size:12px;">From</div>
            <input id="editAssignedFrom_${empNo}" type="text" placeholder="From location" />
          </div>

          <div>
            <div class="muted" style="margin-bottom:4px; font-size:12px;">To</div>
            <input id="editAssignedTo_${empNo}" type="text" placeholder="To location" />
          </div>

          <div style="display:flex; gap:8px; flex-wrap:wrap;">
            <button type="button" id="saveAssignedBlockBtn_${empNo}">Save Job</button>
            <button type="button" id="cancelAssignedBlockBtn_${empNo}">Cancel</button>
          </div>
        </div>
      </div>

      <div
        id="driverDutySpanFormWrap_${empNo}"
        style="display:none; padding:10px; border:1px solid #eee; border-radius:10px; background:#fafafa;"
      >
        <div id="driverDutySpanFormTitle_${empNo}" style="font-weight:700; margin-bottom:10px;">Create Duty Span</div>

        <div style="display:grid; gap:10px;">
          <div>
            <div class="muted" style="margin-bottom:4px; font-size:12px;">Duty Type</div>
            <select id="dutyType_${empNo}">
              <option value="Charter" selected>Charter</option>
              <option value="Rail Replacement">Rail Replacement</option>
              <option value="Yard">Yard</option>
              <option value="Mechanic">Mechanic</option>
              <option value="Office">Office</option>
            </select>
          </div>

          <div>
            <div class="muted" style="margin-bottom:4px; font-size:12px;">Duty Number</div>
            <input id="dutyNumber_${empNo}" type="text" placeholder="e.g. 101" />
          </div>

          <div id="railFields_${empNo}" style="display:none; gap:10px;">
            <div>
              <div class="muted" style="margin-bottom:4px; font-size:12px;">Route Number</div>
              <input id="routeNumber_${empNo}" type="text" placeholder="e.g. T4" />
            </div>

            <div>
              <div class="muted" style="margin-bottom:4px; font-size:12px;">Route Description (PDF link)</div>
              <input id="routePdf_${empNo}" type="text" placeholder="https://..." />
            </div>
          </div>

          <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
            <div>
              <div class="muted" style="margin-bottom:4px; font-size:12px;">Duty Start</div>
              <input id="dutyStart_${empNo}" type="text" placeholder="HH:MM (e.g. 27:00)" />
            </div>
            <div>
              <div class="muted" style="margin-bottom:4px; font-size:12px;">Duty End</div>
              <input id="dutyEnd_${empNo}" type="text" placeholder="HH:MM (e.g. 27:00)" />
            </div>
          </div>

          <div class="muted" style="font-size:11px;">
            Overnight duties are automatic (e.g. 22:00 to 00:30 continues into the selected day).
          </div>

          <div id="charterLocationFields_${empNo}" style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
            <div>
              <div class="muted" style="margin-bottom:4px; font-size:12px;">Start Location</div>
              <select id="dutyStartLocation_${empNo}">
                <option value="">Select location</option>
                <option value="Hannans Depot">Hannans Depot</option>
                <option value="Bounds Depot">Bounds Depot</option>
              </select>
            </div>
            <div>
              <div class="muted" style="margin-bottom:4px; font-size:12px;">End Location</div>
              <select id="dutyEndLocation_${empNo}">
                <option value="">Select location</option>
                <option value="Hannans Depot">Hannans Depot</option>
                <option value="Bounds Depot">Bounds Depot</option>
              </select>
            </div>
          </div>

          <div id="railLocationFields_${empNo}" style="display:none; grid-template-columns:1fr 1fr; gap:8px;">
            <div>
              <div class="muted" style="margin-bottom:4px; font-size:12px;">Start Station</div>
              <input id="railStart_${empNo}" type="text" placeholder="e.g. Central" />
            </div>
            <div>
              <div class="muted" style="margin-bottom:4px; font-size:12px;">End Station</div>
              <input id="railEnd_${empNo}" type="text" placeholder="e.g. Parramatta" />
            </div>
          </div>

          <div>
            <div class="muted" style="margin-bottom:6px; font-size:12px;">Assigned Bus (optional)</div>
            <select id="dutyAssignedBus_${empNo}">
              ${getBusOptionsHtml("")}
            </select>
          </div>

          <div style="padding:10px; border:1px solid #eee; border-radius:8px; background:#fff;">
            <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; margin-bottom:8px;">
              <div style="font-weight:700;">Breaks</div>
              <div style="display:flex; gap:6px; flex-wrap:wrap;">
                <button type="button" id="addMealBreakBtn_${empNo}" style="font-size:12px; padding:4px 8px;">
                  + Meal
                </button>
                <button type="button" id="addCribBreakBtn_${empNo}" style="font-size:12px; padding:4px 8px;">
                  + Crib
                </button>
              </div>
            </div>

            <div class="muted" style="font-size:11px; margin-bottom:8px;">
              Add one or more meal or crib breaks. You can edit or remove any break.
            </div>

            <div id="breakRowsWrap_${empNo}" style="display:grid; gap:8px;"></div>
          </div>

          <div style="display:flex; gap:8px; flex-wrap:wrap;">
            <button type="button" id="saveDutySpanBtn_${empNo}">Save Duty Span</button>
            <button type="button" id="cancelDutySpanBtn_${empNo}">Cancel</button>
          </div>
        </div>
      </div>
  `;

  const showBtn = document.getElementById(`showAddDutySpanBtn_${empNo}`);
  const cancelBtn = document.getElementById(`cancelDutySpanBtn_${empNo}`);
  const saveBtn = document.getElementById(`saveDutySpanBtn_${empNo}`);
  const formWrap = document.getElementById(`driverDutySpanFormWrap_${empNo}`);
  const startEl = document.getElementById(`dutyStart_${empNo}`);
  const formTitleEl = document.getElementById(`driverDutySpanFormTitle_${empNo}`);
  const breakRowsWrap = document.getElementById(`breakRowsWrap_${empNo}`);
  const addMealBreakBtn = document.getElementById(`addMealBreakBtn_${empNo}`);
  const addCribBreakBtn = document.getElementById(`addCribBreakBtn_${empNo}`);
  const dutyTypeEl = document.getElementById(`dutyType_${empNo}`);
  const railFieldsEl = document.getElementById(`railFields_${empNo}`);
  const charterLocationFieldsEl = document.getElementById(`charterLocationFields_${empNo}`);
  const railLocationFieldsEl = document.getElementById(`railLocationFields_${empNo}`);

    function updateRailFields() {
      if (!dutyTypeEl) return;

      const isRail = dutyTypeEl.value === "Rail Replacement";

      if (railFieldsEl) {
        railFieldsEl.style.display = isRail ? "grid" : "none";
      }

      if (charterLocationFieldsEl) {
        charterLocationFieldsEl.style.display = isRail ? "none" : "grid";
      }

      if (railLocationFieldsEl) {
        railLocationFieldsEl.style.display = isRail ? "grid" : "none";
      }
    }

  // run once
  updateRailFields();

  // run on change
  if (dutyTypeEl) {
    dutyTypeEl.addEventListener("change", updateRailFields);
  }

  const editAssignedWrap = document.getElementById(`editAssignedBlockWrap_${empNo}`);
  const editAssignedBlockIdEl = document.getElementById(`editAssignedBlockId_${empNo}`);
  const editAssignedStartEl = document.getElementById(`editAssignedStart_${empNo}`);
  const editAssignedEndEl = document.getElementById(`editAssignedEnd_${empNo}`);
  const editAssignedFromEl = document.getElementById(`editAssignedFrom_${empNo}`);
  const editAssignedToEl = document.getElementById(`editAssignedTo_${empNo}`);
  const saveAssignedBlockBtn = document.getElementById(`saveAssignedBlockBtn_${empNo}`);
  const cancelAssignedBlockBtn = document.getElementById(`cancelAssignedBlockBtn_${empNo}`);

  const editAssignedButtons = detailPanelEl.querySelectorAll("[data-edit-assigned-block]");

  editAssignedButtons.forEach((btn) => {
    btn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();

      const blockId = String(btn.getAttribute("data-edit-assigned-block") || "");

      const block = (blocksCache || []).find(
        (b) => String(b.id) === String(blockId)
      );

      if (!block) {
        showPageMessage("The selected job could not be found. Refresh the board and try again.", "error");
        return;
      }

      editAssignedBlockIdEl.value = blockId;
      editAssignedStartEl.value = minToTimeStr(block.startMin);
      editAssignedEndEl.value = minToTimeStr(block.endMin);
      editAssignedFromEl.value = block.from || block.fromName || "";
      editAssignedToEl.value = block.to || block.toName || "";
      editAssignedWrap.style.display = "block";
      editAssignedStartEl.focus();
    };
  });

  if (cancelAssignedBlockBtn) {
    cancelAssignedBlockBtn.onclick = () => {
      editAssignedWrap.style.display = "none";
      editAssignedBlockIdEl.value = "";
    };
  }

  if (saveAssignedBlockBtn) {
    saveAssignedBlockBtn.onclick = async () => {
      const blockId = String(editAssignedBlockIdEl.value || "");
      const startMin = timeStrToMin(editAssignedStartEl.value);
      const endMin = timeStrToMin(editAssignedEndEl.value);
      const from = editAssignedFromEl.value.trim();
      const to = editAssignedToEl.value.trim();
      if (!blockId || !Number.isFinite(startMin) || !Number.isFinite(endMin) || endMin <= startMin) {
        return showPageMessage("Enter a valid start and end time.", "error");
      }
      if (!from || !to) return showPageMessage("From and To locations are required.", "error");
      const driverEmpNo = String(selectedDriverEmpNo || "");
      if (driverHasAssignedBlockOverlap(driverEmpNo, startMin, endMin, blockId)) {
        return showPageMessage("Update blocked: the new time overlaps another assigned job.", "error", 6000);
      }
      if (!driverHasDutySpanCoverage(driverEmpNo, startMin, endMin)) {
        return showPageMessage("Update blocked: the new job time is outside the driver's duty span.", "error", 6000);
      }
      saveAssignedBlockBtn.disabled = true;
      saveAssignedBlockBtn.textContent = "Saving…";
      try {
        await updateBlock(blockId, { startMin, endMin, from, to });
        editAssignedWrap.style.display = "none";
        showPageMessage("Assigned job updated successfully.", "success");
      } catch (err) {
        showPageMessage(err?.message || "Failed to update the assigned job.", "error", 6000);
      } finally {
        saveAssignedBlockBtn.disabled = false;
        saveAssignedBlockBtn.textContent = "Save Job";
      }
    };
  }

  function attachBreakRowEvents() {
    if (!breakRowsWrap) return;

    const removeButtons = breakRowsWrap.querySelectorAll("[data-remove-break-row]");
    removeButtons.forEach((btn) => {
      btn.onclick = () => {
        const row = btn.closest("[data-break-row]");
        if (row) row.remove();
      };
    });
  }

  detailPanelEl.onclick = async (e) => {
    const unassignBtn = e.target.closest("[data-unassign-block]");
    if (unassignBtn) {
      e.preventDefault();
      e.stopPropagation();

      const blockId = String(unassignBtn.getAttribute("data-unassign-block") || "");
      console.log("UNASSIGN CLICK", { blockId });

      if (!blockId) return;

      const block = blocksCache.find((item) => String(item.id) === blockId);
      const ok = await confirmDispatchAction({
        title: "Return job to unassigned work",
        message: `<p>Remove this job from the selected driver?</p><div class="dispatch-confirm-grid"><span>Time</span><strong>${minToTimeStr(block?.startMin)}–${minToTimeStr(block?.endMin)}</strong><span>Route</span><strong>${escapeHtml(block?.from || "—")} → ${escapeHtml(block?.to || "—")}</strong></div>`,
        confirmLabel: "Unassign Job",
        tone: "danger"
      });
      if (!ok) return;

      try {
        await unassignBlockFromDriver(blockId);
        console.log("UNASSIGNED OK", { blockId });
        showPageMessage("Job returned to the Unassigned Work timeline.", "success");
      } catch (err) {
        console.error("UNASSIGN ERROR", err);
        showError(err?.message || "Failed to unassign job.");
      }
    }
  };

  function appendBreakRow(breakItem = {}) {
    if (!breakRowsWrap) return;
    breakRowsWrap.insertAdjacentHTML("beforeend", getBreakRowHtml(breakItem));
    attachBreakRowEvents();
  }

  function clearBreakRows() {
    if (!breakRowsWrap) return;
    breakRowsWrap.innerHTML = "";
  }

  if (addMealBreakBtn) {
    addMealBreakBtn.onclick = () => {
      appendBreakRow({ type: "meal" });
    };
  }

  if (addCribBreakBtn) {
    addCribBreakBtn.onclick = () => {
      appendBreakRow({ type: "crib" });
    };
  }

  if (showBtn && formWrap) {
    showBtn.onclick = () => {
      formWrap.style.display = "block";
      formWrap.dataset.editingSpanId = "";
      if (formTitleEl) formTitleEl.textContent = "Create Duty Span";

      document.getElementById(`dutyStart_${empNo}`).value = "";
      document.getElementById(`dutyEnd_${empNo}`).value = "";
      document.getElementById(`dutyStartLocation_${empNo}`).value = "";
      document.getElementById(`dutyEndLocation_${empNo}`).value = "";
      document.getElementById(`dutyAssignedBus_${empNo}`).value = "";
      document.getElementById(`dutyType_${empNo}`).value = "Charter";
      updateRailFields();
      clearBreakRows();

      if (startEl) startEl.focus();
    };
    }

    if (cancelBtn && formWrap) {
      cancelBtn.onclick = () => {
        formWrap.style.display = "none";
        formWrap.dataset.editingSpanId = "";
      };
    }

  if (saveBtn) {
    saveBtn.onclick = async () => {
      showError("");

      const dutyStart = document.getElementById(`dutyStart_${empNo}`)?.value || "";
      const dutyEnd = document.getElementById(`dutyEnd_${empNo}`)?.value || "";
      const dutyType = document.getElementById(`dutyType_${empNo}`)?.value || "Charter";
      const routeNumber = document.getElementById(`routeNumber_${empNo}`)?.value || "";
      const routePdfUrl = document.getElementById(`routePdf_${empNo}`)?.value || "";

      const startLocation =
        dutyType === "Rail Replacement"
          ? document.getElementById(`railStart_${empNo}`)?.value || ""
          : document.getElementById(`dutyStartLocation_${empNo}`)?.value || "";

      const endLocation =
        dutyType === "Rail Replacement"
          ? document.getElementById(`railEnd_${empNo}`)?.value || ""
          : document.getElementById(`dutyEndLocation_${empNo}`)?.value || "";

      const assignedBus = document.getElementById(`dutyAssignedBus_${empNo}`)?.value || "";
      const dutyNumber = document.getElementById(`dutyNumber_${empNo}`)?.value || "";
      const startMin = timeStrToMin(dutyStart);
      let endMin = timeStrToMin(dutyEnd);

      if (Number.isNaN(startMin) || Number.isNaN(endMin)) {
        showError("Duty start and end are required. Use HH:MM format; overnight duties such as 22:00 to 00:30 are handled automatically.");
        return;
      }

      if (startMin === endMin) {
        showError("Duty start and end cannot be the same time.");
        return;
      }

      const crossesMidnight = endMin < startMin;
      if (crossesMidnight) endMin += 24 * 60;
      const timelineDayShift = startMin >= OPERATIONAL_START_MIN && endMin > 24 * 60 ? -1 : 0;

      if (!startLocation || !endLocation) {
        showError("Start and end location are required.");
        return;
      }

      const editingSpanId = String(formWrap.dataset.editingSpanId || "");

      if (validateDriverSpanOverlap(empNo, startMin, endMin, editingSpanId)) {
        showError("Duty span overlaps an existing span for this driver.");
        return;
      }
      const breakRows = Array.from(
        breakRowsWrap ? breakRowsWrap.querySelectorAll("[data-break-row]") : []
      );

      const breaks = [];

      for (const row of breakRows) {
        const type = String(row.querySelector("[data-break-type]")?.value || "meal").toLowerCase();
        const startValue = row.querySelector("[data-break-start]")?.value || "";
        const endValue = row.querySelector("[data-break-end]")?.value || "";
        const locationValue = row.querySelector("[data-break-location]")?.value || "";

        let bs = timeStrToMin(startValue);
        let be = timeStrToMin(endValue);

        if (bs < startMin) bs += 24 * 60;
        if (be <= bs) be += 24 * 60;

        if (Number.isNaN(bs) || Number.isNaN(be) || bs >= be) {
          showError("One or more break times are invalid.");
          return;
        }

        if (bs < startMin || be > endMin) {
          showError("All breaks must stay inside the duty span.");
          return;
        }

        breaks.push({
          type,
          paid: type === "crib",
          startMin: bs,
          endMin: be,
          location: String(locationValue || "").trim()
        });
      }

      breaks.sort((a, b) => a.startMin - b.startMin);

      for (let i = 1; i < breaks.length; i += 1) {
        if (breaks[i].startMin < breaks[i - 1].endMin) {
          showError("Breaks cannot overlap each other.");
          return;
        }
      }

      const fatigue = calculateFatigue({
        startMin,
        endMin,
        breaks
      });
      if (fatigue.fatigueStatus === "BREACH") {
        const proceed = await confirmDispatchAction({
          title: "Fatigue breach detected",
          message: `<p>This duty does not currently meet the fatigue rules.</p><div class="dispatch-confirm-warning">${escapeHtml(fatigue.fatigueWarning || "Review the duty length and breaks before allocation.")}</div><p>You may save it for operational review, but it will remain clearly marked as a breach.</p>`,
          confirmLabel: "Save for Review",
          tone: "danger"
        });
        if (!proceed) return;
      }
       console.log("PDF VALUE:", routePdfUrl);
      saveBtn.disabled = true;
      saveBtn.textContent = editingSpanId ? "Saving changes…" : "Creating duty…";
      try {
        const payload = {
          serviceDate: getSelectedDate(),
          driverEmployeeNumber: empNo,
          driverName: String(driver.displayName || driver.firstName || "").trim(),
          dutyType,
          dutyNumber,
          routeNumber,
          routePdfUrl,
          startMin,
          endMin,
          timelineDayShift,
          startLocation,
          endLocation,
          assignedBus,
          dispatchStatus: "Pending",
          driverAcknowledgment: "Pending",
          breaks,
          totalSpanMinutes: fatigue.totalSpanMinutes,
          unpaidMinutes: fatigue.unpaidMinutes,
          paidMinutes: fatigue.paidMinutes,
          fatigueStatus: fatigue.fatigueStatus,
          fatigueWarning: fatigue.fatigueWarning
        };

        if (editingSpanId) {
          await updateDutySpan(editingSpanId, payload);
        } else {
          console.log("CREATE PAYLOAD:", payload);
          await addDutySpan(payload);
        }

        formWrap.style.display = "none";
        formWrap.dataset.editingSpanId = "";
        showPageMessage(editingSpanId ? "Duty span updated successfully." : "Duty span created successfully. Driver confirmation is pending.", "success", 6000);
      } catch (e) {
        showPageMessage(e?.message || "Failed to save duty span.", "error", 6000);
      } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = "Save Duty Span";
      }
    };
  }

  const editButtons = detailPanelEl.querySelectorAll("[data-edit-duty-span]");
  editButtons.forEach((btn) => {
    btn.onclick = () => {
      const spanId = String(btn.getAttribute("data-edit-duty-span") || "");
      const span = spans.find((s) => String(s.id) === spanId);
      if (!span || !formWrap) return;

      formWrap.style.display = "block";
      formWrap.dataset.editingSpanId = spanId;
      if (formTitleEl) formTitleEl.textContent = "Edit Duty Span";

      document.getElementById(`dutyStart_${empNo}`).value = minToTimeStr(span.startMin);
      document.getElementById(`dutyEnd_${empNo}`).value = minToTimeStr(span.endMin);
      document.getElementById(`dutyStartLocation_${empNo}`).value = span.startLocation || "";
      document.getElementById(`dutyEndLocation_${empNo}`).value = span.endLocation || "";
      document.getElementById(`dutyAssignedBus_${empNo}`).value = span.assignedBus || "";
      document.getElementById(`dutyNumber_${empNo}`).value = span.dutyNumber || "";
      document.getElementById(`dutyType_${empNo}`).value = span.dutyType || "Charter";

      // load rail fields
        document.getElementById(`routeNumber_${empNo}`).value = span.routeNumber || "";
        document.getElementById(`routePdf_${empNo}`).value = span.routePdfUrl || "";

        // load correct locations
        if (span.dutyType === "Rail Replacement") {
          document.getElementById(`railStart_${empNo}`).value = span.startLocation || "";
          document.getElementById(`railEnd_${empNo}`).value = span.endLocation || "";
        } else {
          document.getElementById(`dutyStartLocation_${empNo}`).value = span.startLocation || "";
          document.getElementById(`dutyEndLocation_${empNo}`).value = span.endLocation || "";
        }

        // VERY IMPORTANT → update UI
        const dutyTypeEl = document.getElementById(`dutyType_${empNo}`);
        if (dutyTypeEl && typeof updateRailFields === "function") {
          updateRailFields();
        }

      clearBreakRows();
      (Array.isArray(span.breaks) ? span.breaks : []).forEach((b) => appendBreakRow(b));

      if (startEl) startEl.focus();
    };
  });

  const deleteButtons = detailPanelEl.querySelectorAll("[data-delete-duty-span]");
  deleteButtons.forEach((btn) => {
    btn.onclick = async () => {
      const spanId = String(btn.getAttribute("data-delete-duty-span") || "");
      if (!spanId) return;

      const span = dutySpansCache.find((item) => String(item.id) === spanId);
      const linkedJobs = span ? getBlocksForDutySpan(span).length : 0;
      const ok = await confirmDispatchAction({
        title: "Delete duty span",
        message: `<p>Delete this duty span?</p><div class="dispatch-confirm-grid"><span>Time</span><strong>${minToTimeStr(span?.startMin)}–${minToTimeStr(span?.endMin)}</strong><span>Assigned jobs</span><strong>${linkedJobs}</strong></div>${linkedJobs ? '<div class="dispatch-confirm-warning">This duty has assigned jobs. Reassign or unassign those jobs before deleting the duty.</div>' : ''}`,
        confirmLabel: "Delete Duty",
        tone: "danger"
      });
      if (!ok) return;

      if (linkedJobs) {
        showPageMessage("Duty deletion blocked because assigned jobs are still linked to it.", "error", 6500);
        return;
      }

      try {
        await deleteDutySpan(spanId);
        showPageMessage("Duty span deleted successfully.", "success");
      } catch (e) {
        showError(e?.message || "Failed to delete duty span.");
      }
    };
  });
}



function getGroupColors(groupKey) {
  const palette = [
    { bg: "#1d4ed8", border: "#1e40af", text: "#ffffff" }, // blue
    { bg: "#16a34a", border: "#15803d", text: "#ffffff" }, // green
    { bg: "#f59e0b", border: "#d97706", text: "#111827" }, // amber
    { bg: "#db2777", border: "#be185d", text: "#ffffff" }, // pink
    { bg: "#7c3aed", border: "#6d28d9", text: "#ffffff" }, // purple
    { bg: "#0891b2", border: "#0e7490", text: "#ffffff" }, // cyan
    { bg: "#dc2626", border: "#b91c1c", text: "#ffffff" }, // red
    { bg: "#2563eb", border: "#1d4ed8", text: "#ffffff" }  // strong blue alt
  ];

  let hash = 0;
  const str = String(groupKey || "default");

  for (let i = 0; i < str.length; i += 1) {
    hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  }

  return palette[hash % palette.length];
}

function renderDutySpansForDriver(empNo) {
  const spans = getDriverDutySpans(empNo);

  return spans
    .map((span, spanIndex) => {
      const startMin = Number(span.startMin || 0);
      const endMin = Number(span.endMin || 0);
      const dayShift = getDutyTimelineShift(span);
      const left = dispatchMinuteToLeft(startMin, dayShift);
      const width = ((endMin - startMin) / SLOT_MINUTES) * slotWidth;

      const breaks = Array.isArray(span.breaks) ? span.breaks : [];

      const breakHtml = breaks
        .map((brk) => {
          const brkStart = Number(brk.startMin || 0);
          const brkEnd = Number(brk.endMin || 0);

          const breakLeft =
            ((brkStart - startMin) / SLOT_MINUTES) * slotWidth;

          const breakWidth =
            ((brkEnd - brkStart) / SLOT_MINUTES) * slotWidth;

          const isMeal = String(brk.type || "").toLowerCase() === "meal";
          const bg = isMeal ? "#ea580c" : "#ca8a04";
          const border = isMeal ? "#c2410c" : "#a16207";

          return `
            <div
              title="${escapeHtml(String(brk.type || ""))} (${isMeal ? "Unpaid" : "Paid"}) ${minToTimeStr(brkStart)}-${minToTimeStr(brkEnd)}"
              style="
                position:absolute;
                left:${breakLeft}px;
                top:2px;
                width:${Math.max(4, breakWidth)}px;
                height:6px;
                background:${bg};
                border:1px solid ${border};
                border-radius:4px;
                z-index:2;
                opacity:0.95;
                box-sizing:border-box;
              "
            ></div>
          `;
        })
        .join("");

      return `
        <div
          class="dispatch-duty-bar"
          draggable="true"
          data-duty-span-bar="${escapeHtml(span.id || "")}"
          data-duty-owner="${escapeHtml(empNo || "")}"
          data-duty-number="${spanIndex + 1}"
          title="Duty ${spanIndex + 1} · ${escapeHtml(span.dutyNumber || span.dutyType || "Duty")} · ${minToTimeStr(startMin)}-${minToTimeStr(endMin)}"
          style="
            position:absolute;
            left:${left}px;
            top:50%;
            transform:translateY(-50%);
            width:${Math.max(6, width)}px;
            height:24px;
            background:${
              span.fatigueStatus === "BREACH"
                ? "#fecaca"
                : span.fatigueStatus === "WARNING"
                ? "#fde68a"
                : "#93c5fd"
            };
            border:1px solid ${
              span.fatigueStatus === "BREACH"
                ? "#dc2626"
                : span.fatigueStatus === "WARNING"
                ? "#f59e0b"
                : "#60a5fa"
            };
            border-radius:6px;
            box-sizing:border-box;
            z-index:1;
            overflow:hidden;
          "
        >
          ${breakHtml}

          <div style="
            font-size:11px;
            font-weight:700;
            padding:2px 6px;
            white-space:nowrap;
          ">
            D${spanIndex + 1} · ${minToTimeStr(startMin)}-${minToTimeStr(endMin)}
          </div>
        </div>
      `;
    })
    .join("");
}

function renderAssignedBlocksForDriver(empNo) {
  const assignedBlocks = getAssignedBlocksForDriver(empNo);
  const dutySpans = getDriverDutySpans(empNo);

  function getJobDisplayNumber(block, fallbackIndex) {
    const startMin = Number(block.startMin ?? block.startMinutes ?? 0);
    const endMin = Number(block.endMin ?? block.endMinutes ?? 0);
    let dutyIndex = dutySpans.findIndex((span) =>
      String(block.dutySpanId || "") && String(span.id || "") === String(block.dutySpanId || "")
    );
    if (dutyIndex < 0) {
      dutyIndex = dutySpans.findIndex((span) =>
        startMin >= Number(span.startMin || 0) && endMin <= Number(span.endMin || 0)
      );
    }
    if (dutyIndex < 0) return `J${fallbackIndex + 1}`;
    const duty = dutySpans[dutyIndex];
    const jobsInDuty = assignedBlocks.filter((item) => {
      if (String(item.dutySpanId || "") && String(item.dutySpanId || "") === String(duty.id || "")) return true;
      const itemStart = Number(item.startMin ?? item.startMinutes ?? 0);
      const itemEnd = Number(item.endMin ?? item.endMinutes ?? 0);
      return itemStart >= Number(duty.startMin || 0) && itemEnd <= Number(duty.endMin || 0);
    });
    const jobIndex = Math.max(0, jobsInDuty.findIndex((item) => String(item.id) === String(block.id)));
    return `${dutyIndex + 1}.${jobIndex + 1}`;
  }

  function getGroupName(block) {
    const directName = String(
      block.jobGroupName ||
      block.groupName ||
      block.schoolName ||
      block.school ||
      block.title ||
      block.name ||
      block.jobName ||
      block.group ||
      ""
    ).trim();

    if (directName) return directName;

    const groupId = String(block.jobGroupId || "").trim();
    if (!groupId) return "No Group";

    const jobGroup = (jobGroupsCache || []).find(
      (jg) => String(jg.id || "") === groupId
    );

    if (!jobGroup) return "No Group";

    return String(
      jobGroup.title ||
      jobGroup.name ||
      jobGroup.clientName ||
      "No Group"
    ).trim();
  }

  function shortenGroupName(name, maxLen = 12) {
    const clean = String(name || "").trim();
    if (!clean) return "";

    if (clean.length <= maxLen) return clean;

    const words = clean.split(/\s+/).filter(Boolean);

    if (words.length >= 2) {
      const initials = words.map((w) => w.charAt(0).toUpperCase()).join("");
      if (initials.length >= 2 && initials.length <= maxLen) return initials;
    }

    return `${clean.slice(0, Math.max(3, maxLen - 1)).trim()}…`;
  }

  return assignedBlocks
    .map((block, blockIndex) => {
      const startMin = Number(block.startMin ?? block.startMinutes ?? 0);
      const endMin = Number(block.endMin ?? block.endMinutes ?? 0);

      const left = dispatchMinuteToLeft(startMin);
      const width = ((endMin - startMin) / SLOT_MINUTES) * slotWidth;

      const groupId = block.jobGroupId || getGroupName(block) || "default";
      const colors = getGroupColors(groupId);
      const groupName = getGroupName(block);

      const blockWidth = Math.max(6, width);

      const displayNumber = getJobDisplayNumber(block, blockIndex);
      const isSelected = String(selectedBlockId) === String(block.id || "");

      return `
        <div
          class="dispatch-numbered-job ${isSelected ? "selected" : ""}"
          data-assigned-block-bar="${escapeHtml(block.id || "")}"
          data-display-number="${escapeHtml(displayNumber)}"
          title="Job ${escapeHtml(displayNumber)} · ${escapeHtml(groupName)} · ${minToTimeStr(startMin)} - ${minToTimeStr(endMin)}"
          style="
            position:absolute;
            left:${left}px;
            top:20px;
            transform:translateY(-50%);
            width:${blockWidth}px;
            height:18px;
            background:${colors.bg};
            border:1px solid ${colors.border};
            border-radius:5px;
            z-index:3;
            box-sizing:border-box;
            overflow:hidden;
            display:flex;
            align-items:center;
            justify-content:center;
            padding:0 3px;
            color:#ffffff;
            font-size:10px;
            font-weight:700;
          "
        >
          ${escapeHtml(displayNumber)}
        </div>
      `;
    })
    .join("");
  }


function renderNowLine() {
  const oldLine = document.getElementById("globalNowLine");
  if (oldLine) oldLine.remove();

  const selectedDate = getSelectedDate();
  const todayStr = getLocalTodayStr();

  if (selectedDate !== todayStr) return;

  const headerGrid = timelineHeaderEl.firstElementChild;
  if (!headerGrid) return;

  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();

  const axisNowMin = timelineMinute(nowMin) - OPERATIONAL_START_MIN;
  const slotIndex = Math.floor(axisNowMin / SLOT_MINUTES);
  const minuteOffsetInSlot = axisNowMin % SLOT_MINUTES;

  const slotCell = headerGrid.children[slotIndex];
  if (!slotCell) return;

  const cellLeft = slotCell.offsetLeft;
  const cellWidth = slotCell.offsetWidth;
  const left = cellLeft + (minuteOffsetInSlot / SLOT_MINUTES) * cellWidth;
  const nowLabel = minToTimeStr(nowMin);

  const lineEl = document.createElement("div");
  lineEl.id = "globalNowLine";
  lineEl.style.position = "absolute";
  lineEl.style.left = `${left}px`;
  lineEl.style.top = "0";
  lineEl.style.height = "100%";
  lineEl.style.width = "2px";
  lineEl.style.background = "#ef4444";
  lineEl.style.boxShadow = "0 0 6px rgba(239,68,68,0.7)";
  lineEl.style.zIndex = "10";
  lineEl.style.pointerEvents = "none";

  const labelEl = document.createElement("div");
  labelEl.textContent = nowLabel;
  labelEl.style.position = "absolute";
  labelEl.style.top = "4px";
  labelEl.style.left = "4px";
  labelEl.style.fontSize = "10px";
  labelEl.style.background = "#ef4444";
  labelEl.style.color = "#fff";
  labelEl.style.padding = "2px 6px";
  labelEl.style.borderRadius = "4px";
  labelEl.style.whiteSpace = "nowrap";
  labelEl.style.fontWeight = "600";

  lineEl.appendChild(labelEl);

  const timelineInnerEl = document.getElementById("dispatchTimelineInner");
  if (timelineInnerEl) {
    timelineInnerEl.appendChild(lineEl);
  }
}

  function getDispatchStatusBg(status) {
    const s = String(status || "").toLowerCase();

    if (s === "assigned") return "#22c55e";   // green
    if (s === "cancelled") return "#ef4444";  // red
    return "#3b82f6"; // pending = blue
  }
function renderDrivers() {
  const activeDrivers = getActiveDrivers();

  driversListEl.innerHTML = activeDrivers
    .map((d) => {
      const isSelected = String(selectedDriverEmpNo) === String(d.employeeNumber);
      const dispatchStatus = getDriverDispatchStatus(d.employeeNumber);
      const driverAck = getDriverAcknowledgment(d.employeeNumber);
      const hasSpan = getDriverDutySpans(d.employeeNumber).length > 0;

      return `
        <div
          class="dispatch-driver-row"
          data-driver-row="${escapeHtml(d.employeeNumber || "")}"
          style="
            height:${ROW_HEIGHT}px;
            min-height:${ROW_HEIGHT}px;
            max-height:${ROW_HEIGHT}px;
            box-sizing:border-box;
            padding:4px 8px;
            border-bottom:1px solid #eee;
            background:${isSelected ? "#eef6ff" : "#fff"};
            cursor:pointer;
            display:flex;
            align-items:center;
            overflow:hidden;
          "
        >
          <div style="width:100%; min-width:0; overflow:hidden;">
            <div style="
              font-weight:700;
              font-size:12px;
              line-height:1.1;
              white-space:nowrap;
              overflow:hidden;
              text-overflow:ellipsis;
              color:#111;
            ">
              ${escapeHtml(d.displayName || d.firstName || d.employeeNumber || "")}
            </div>

            <div style="
              display:flex;
              align-items:center;
              gap:5px;
              margin-top:3px;
              min-width:0;
            ">
              <select
                data-dispatch-status="${escapeHtml(d.employeeNumber || "")}"
                ${hasSpan ? "" : "disabled"}
                style="
                  height:16px;
                  width:52px;
                  min-width:52px;
                  max-width:52px;
                  font-size:7px;
                  line-height:1;
                  border-radius:999px;
                  padding:0 12px 0 4px;
                  border:1px solid #d1d5db;
                  background:${hasSpan ? getDispatchStatusBg(dispatchStatus) : "#f3f4f6"};
                  color:${hasSpan ? "#fff" : "#9ca3af"};
                  box-sizing:border-box;
                "
                onclick="event.stopPropagation()"
              >
                <option value="Pending" ${dispatchStatus === "Pending" ? "selected" : ""}>Pending</option>
                <option value="Assigned" ${dispatchStatus === "Assigned" ? "selected" : ""}>Assigned</option>
                <option value="Cancelled" ${dispatchStatus === "Cancelled" ? "selected" : ""}>Cancelled</option>
              </select>

              ${renderAckBadgeByValue(driverAck)}

              <div class="muted" style="
                font-size:10px;
                line-height:1;
                white-space:nowrap;
                overflow:hidden;
                text-overflow:ellipsis;
              ">
                ${escapeHtml(d.employeeNumber || "")}
              </div>
            </div>
          </div>
        </div>
      `;
    })
    .join("");

  renderTimelineRows(activeDrivers);
  syncDriverListHeight();
  attachDriverRowEvents(activeDrivers);
  setupDutySpanDragEvents();
  attachNumberedJobEvents(activeDrivers);
  attachDispatchStatusEvents();
  if (visibleDriverCountEl) visibleDriverCountEl.textContent = `${activeDrivers.length} shown`;
  renderOperationalSummary();
  renderNowLine();
}

function attachNumberedJobEvents(activeDrivers) {
  timelineBodyEl.querySelectorAll("[data-assigned-block-bar]").forEach((bar) => {
    bar.onclick = (event) => {
      event.stopPropagation();
      selectedBlockId = bar.dataset.assignedBlockBar || "";
      const block = blocksCache.find((item) => String(item.id) === String(selectedBlockId));
      selectedDriverEmpNo = String(block?.assignedDriverEmployeeNumber || block?.assignedDriverId || block?.driverId || "");
      const driver = activeDrivers.find((item) => String(item.employeeNumber) === selectedDriverEmpNo);
      renderDrivers();
      renderDriverDetail(driver || null);
      requestAnimationFrame(() => {
        detailPanelEl.querySelector(`[data-job-detail="${CSS.escape(selectedBlockId)}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    };
  });
}

function renderTimelineRows(drivers) {
  timelineBodyEl.innerHTML = drivers
    .map((d) => {
      const isSelected =
        String(selectedDriverEmpNo) === String(d.employeeNumber);

      const dutyBarsHtml = renderDutySpansForDriver(d.employeeNumber);
      const assignedBlocksHtml =
        renderAssignedBlocksForDriver(d.employeeNumber);

      return `
        <div
          data-timeline-row="${escapeHtml(d.employeeNumber || "")}"
          style="
            display:grid;
            grid-template-columns:repeat(${TOTAL_SLOTS}, ${slotWidth}px);
            min-width:max-content;
            height:${ROW_HEIGHT}px;
            min-height:${ROW_HEIGHT}px;
            max-height:${ROW_HEIGHT}px;
            border-bottom:1px solid #eee;
            background:${isSelected ? "#eef6ff" : "#fff"};
            position:relative;
            box-sizing:border-box;
            overflow:hidden;
          "
        >
          ${Array.from({ length: TOTAL_SLOTS })
            .map((_, i) => {
              const isHour = i % 4 === 0;

              return `
                <div
                  data-time-cell="1"
                  data-driver-empno="${escapeHtml(d.employeeNumber || "")}"
                  data-slot-index="${i}"
                  style="
                    width:${slotWidth}px;
                    height:${ROW_HEIGHT}px;
                    min-height:${ROW_HEIGHT}px;
                    max-height:${ROW_HEIGHT}px;
                    border-right:1px solid ${isHour ? "#d1d5db" : "#eee"};
                    box-sizing:border-box;
                    background:${isHour ? "rgba(246,255,240,0.35)" : "transparent"};
                  "
                ></div>
              `;
            })
            .join("")}

          ${dutyBarsHtml}
          ${assignedBlocksHtml}
        </div>
      `;
    })
    .join("");
}

function attachDispatchStatusEvents() {
  const controls = driversListEl.querySelectorAll("[data-dispatch-status]");

  controls.forEach((selectEl) => {
    selectEl.onchange = async (e) => {
      e.stopPropagation();

      const empNo = String(selectEl.getAttribute("data-dispatch-status") || "");
      const nextStatus = String(selectEl.value || "Pending");
      const spans = getDriverDutySpans(empNo);

      if (!spans.length) return;

      const previousStatus = String(spans[0]?.dispatchStatus || "Pending");
      if (nextStatus === "Cancelled") {
        const ok = await confirmDispatchAction({
          title: "Cancel all driver duties",
          message: `<p>Mark all <strong>${spans.length}</strong> duty span${spans.length === 1 ? "" : "s"} for this driver as cancelled?</p><div class="dispatch-confirm-warning">Assigned jobs are not deleted. Review or reassign them after cancellation.</div>`,
          confirmLabel: "Cancel Duties",
          tone: "danger"
        });
        if (!ok) {
          selectEl.value = previousStatus;
          return;
        }
      }

      try {
        selectEl.disabled = true;
        await Promise.all(
          spans.map((span) => updateDutySpanDispatchStatus(span.id, nextStatus))
        );
        showPageMessage(`Driver duty status changed to ${nextStatus}.`, "success");
      } catch (err) {
        console.error("Dispatch status update error:", err);
        selectEl.value = previousStatus;
        showPageMessage(err?.message || "Failed to update dispatch status.", "error", 6000);
      } finally {
        selectEl.disabled = false;
      }
    };

    selectEl.onclick = (e) => {
      e.stopPropagation();
    };
  });
}

function attachDriverRowEvents(activeDrivers) {
  const driverRows = driversListEl.querySelectorAll("[data-driver-row]");
  const timelineRows = timelineBodyEl.querySelectorAll("[data-timeline-row]");

  driverRows.forEach((row) => {
    row.onclick = () => {
      selectedDriverEmpNo = row.getAttribute("data-driver-row") || "";
      renderDrivers();

      const selectedDriver = activeDrivers.find(
        (d) => String(d.employeeNumber) === String(selectedDriverEmpNo)
      );
      renderDriverDetail(selectedDriver || null);
    };
  });

  timelineRows.forEach((row) => {
    row.onclick = () => {
      selectedDriverEmpNo = row.getAttribute("data-timeline-row") || "";
      renderDrivers();

      const selectedDriver = activeDrivers.find(
        (d) => String(d.employeeNumber) === String(selectedDriverEmpNo)
      );
      renderDriverDetail(selectedDriver || null);
    };
  });

  const timeCells = timelineBodyEl.querySelectorAll("[data-time-cell]");

  timeCells.forEach((cell) => {
    cell.onclick = (event) => {
      event.stopPropagation();

      selectedDriverEmpNo = cell.getAttribute("data-driver-empno") || "";
      renderDrivers();

      const selectedDriver = activeDrivers.find(
        (d) => String(d.employeeNumber) === String(selectedDriverEmpNo)
      );
      renderDriverDetail(selectedDriver || null);
    };

    cell.ondragover = (e) => {
      e.preventDefault();

      const driverEmpNo = cell.getAttribute("data-driver-empno") || "";

      if (draggedDutySpanId) {
        const span = dutySpansCache.find((item) => String(item.id) === String(draggedDutySpanId));
        if (!span || String(span.driverEmployeeNumber || "") === String(driverEmpNo)) return;
        const conflict = validateDriverSpanOverlap(
          driverEmpNo,
          Number(span.startMin || 0),
          Number(span.endMin || 0)
        );
        setTimelineRowDropState(driverEmpNo, conflict ? "overlap" : "valid");
        return;
      }

      if (!draggedBlockId) return;

      const block = (blocksCache || []).find(
        (b) => String(b.id) === String(draggedBlockId)
      );
      if (!block) return;

      const blockStart = Number(block.startMin ?? block.startMinutes ?? 0);
      const blockEnd = Number(block.endMin ?? block.endMinutes ?? 0);

      if (driverHasAssignedBlockOverlap(driverEmpNo, blockStart, blockEnd, draggedBlockId)) {
        setTimelineRowDropState(driverEmpNo, "overlap");
      } else {
        setTimelineRowDropState(driverEmpNo, "valid");
      }
    };

    cell.ondrop = async (e) => {
      e.preventDefault();

      const targetDriverEmpNo = cell.getAttribute("data-driver-empno") || "";
      const dutySpanId = e.dataTransfer.getData("dutySpanId") || draggedDutySpanId;
      if (dutySpanId) {
        draggedDutySpanId = "";
        clearAllTimelineRowDropStates();
        await transferDutySpanToDriver(dutySpanId, targetDriverEmpNo);
        return;
      }

      const blockId = e.dataTransfer.getData("blockId");
      if (!blockId) return;

      const start = Number(e.dataTransfer.getData("start"));
      const end = Number(e.dataTransfer.getData("end"));

      const driverEmpNo = targetDriverEmpNo;
      const targetDriver = employeesCache.find((item) => String(item.employeeNumber) === String(driverEmpNo));
      const driverName = targetDriver?.displayName || targetDriver?.firstName || driverEmpNo;
      const slotIndex = Number(cell.getAttribute("data-slot-index") || 0);

      console.log("DROP:", {
        blockId,
        driverEmpNo,
        start,
        end,
        slotIndex
      });

      const block = (blocksCache || []).find(
        (b) => String(b.id) === String(blockId)
      );
      if (!block) {
        showPageMessage("The selected job could not be found. Refresh the board and try again.", "error");
        return;
      }

    const blockStart = Number(block.startMin ?? block.startMinutes ?? 0);
    const blockEnd = Number(block.endMin ?? block.endMinutes ?? 0);

    const overlappingBlock = (blocksCache || []).find((b) => {
      if (String(b.id) === String(blockId)) return false;

      const sameDate =
        String(b.serviceDate || b.date || "") === String(getSelectedDate() || "");

      const assignedToDriver =
        String(
          b.assignedDriverEmployeeNumber ||
          b.assignedDriverId ||
          b.driverId ||
          ""
        ).trim() === String(driverEmpNo || "").trim();

      if (!sameDate || !assignedToDriver) return false;

      const existingStart = Number(b.startMin ?? b.startMinutes ?? 0);
      const existingEnd = Number(b.endMin ?? b.endMinutes ?? 0);

      return blocksOverlap(blockStart, blockEnd, existingStart, existingEnd);
    });

    if (overlappingBlock) {
      const existingStart = Number(
        overlappingBlock.startMin ?? overlappingBlock.startMinutes ?? 0
      );
      const existingEnd = Number(
        overlappingBlock.endMin ?? overlappingBlock.endMinutes ?? 0
      );

      showPageMessage(`Assignment blocked: this job overlaps an existing job (${minToTimeStr(existingStart)}–${minToTimeStr(existingEnd)}).`, "error", 6500);
      draggedBlockId = "";
      clearAllTimelineRowDropStates();
      return;
    }

    const matchingDutySpans = getDriverDutySpans(driverEmpNo).filter((span) => {
      const spanStart = Number(span.startMin || 0);
      const spanEnd = Number(span.endMin || 0);
      return blockStart >= spanStart && blockEnd <= spanEnd;
    });

    if (!matchingDutySpans.length) {
      showPageMessage("Assignment blocked: this job is outside the driver's duty span. Extend or edit the duty first.", "error", 6500);
      draggedBlockId = "";
      clearAllTimelineRowDropStates();
      return;
    }

    if (matchingDutySpans.length > 1) {
      showPageMessage("Assignment blocked: this job matches more than one duty span. Correct the overlapping duties first.", "error", 6500);
      draggedBlockId = "";
      clearAllTimelineRowDropStates();
      return;
    }

    const matchedDutySpan = matchingDutySpans[0];

    const confirmed = await confirmDispatchAction({
      title: "Assign job to driver",
      message: `<p>Assign this job to <strong>${escapeHtml(driverName)}</strong>?</p><div class="dispatch-confirm-grid"><span>Job</span><strong>${escapeHtml(getUnassignedDisplayCode(block))}</strong><span>Time</span><strong>${minToTimeStr(blockStart)}–${minToTimeStr(blockEnd)}</strong><span>Duty</span><strong>${escapeHtml(matchedDutySpan.dutyNumber || "Matched duty span")}</strong></div>`,
      confirmLabel: "Assign Job"
    });
    if (!confirmed) {
      draggedBlockId = "";
      clearAllTimelineRowDropStates();
      return;
    }

    try {
      await assignBlockToDriver({
        block,
        serviceDate: getSelectedDate(),
        driverEmployeeNumber: driverEmpNo,
        driverName,
        dutySpanId: String(matchedDutySpan.id || ""),
        createDutySpan: false
      });

        console.log("Assigned block", blockId, "to driver", driverEmpNo);
        showPageMessage(`Job assigned to ${driverName} successfully.`, "success");
      } catch (err) {
        console.error("Failed to assign block:", err);
        showPageMessage(err?.message || "Failed to assign the job.", "error", 6500);
      }
    };
  });
}

function getBusLabel(block) {
  const match = String(block.notes || "").match(/Bus\s+(\d+)/i);
  return match ? `Bus ${match[1]}` : "";
}

function getRouteRunCode(block) {
  const direct = block.runCode || block.routeCode || block.serviceCode || block.blockCode || block.dutyCode;
  if (direct) return String(direct).trim().toUpperCase();

  const notes = String(block.notes || "");
  const match = notes.match(/\b(?:BL|RUN|ROUTE)\s*[-#:]?\s*\d+[A-Z]?\b/i);
  return match ? match[0].replace(/[\s#:-]+/g, "").toUpperCase() : "";
}

function getUnassignedGroupName(block) {
  const direct = block.jobGroupName || block.groupName || block.schoolName || block.school || block.title || block.name || block.jobName || block.group;
  if (direct) return String(direct).trim();
  const group = jobGroupsCache.find((item) => String(item.id) === String(block.jobGroupId || ""));
  return String(group?.title || group?.name || group?.clientName || "No Group").trim();
}

function buildUnassignedWorkSets(source = blocksCache) {
  const items = (source || []).filter((block) => {
    const sameDate = String(block.serviceDate || block.date || "") === String(getSelectedDate() || "");
    const noDriver = !String(block.assignedDriverEmployeeNumber || block.assignedDriverId || block.driverId || "").trim();
    return sameDate && noDriver && !block.deleted;
  }).sort((a, b) => Number(a.startMin ?? a.startMinutes ?? 0) - Number(b.startMin ?? b.startMinutes ?? 0));

  const groups = new Map();
  items.forEach((block) => {
    const key = `${block.jobGroupId || getUnassignedGroupName(block)}|${getBusLabel(block) || "no-bus"}|${block.routePairId || block.pairId || ""}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(block);
  });

  return [...groups.values()]
    .sort((a, b) => Number(a[0]?.startMin || 0) - Number(b[0]?.startMin || 0))
    .map((blocks, setIndex) => ({
      setNumber: setIndex + 1,
      groupName: getUnassignedGroupName(blocks[0]),
      blocks: blocks.slice().sort((a, b) => Number(a.startMin || 0) - Number(b.startMin || 0)).map((block, blockIndex) => ({
        block,
        code: `U${String(setIndex + 1).padStart(2, "0")}${String.fromCharCode(65 + blockIndex)}`
      }))
    }));
}

function getUnassignedDisplayCode(block) {
  for (const set of buildUnassignedWorkSets()) {
    const entry = set.blocks.find((item) => String(item.block.id) === String(block?.id));
    if (entry) return entry.code;
  }
  return "U";
}

function setUnassignedPanelState(state = "compact") {
  unassignedDensity = state;
  if (!unassignedJobsPanelEl) return;
  unassignedJobsPanelEl.classList.remove("collapsed", "compact", "expanded");
  unassignedJobsPanelEl.classList.add(state);
  toggleUnassignedJobsBtn?.setAttribute("aria-expanded", String(state !== "collapsed"));
  if (unassignedDensityBtn) unassignedDensityBtn.textContent = state === "expanded" ? "Compact" : "Expand";
  try { localStorage.setItem("dispatch-unassigned-density", state); } catch {}
  renderUnassignedJobs(blocksCache, getSelectedDate());
}

function renderUnassignedBlockDetail(block, code) {
  if (!block || !detailPanelEl) return;
  const start = Number(block.startMin ?? block.startMinutes ?? 0);
  const end = Number(block.endMin ?? block.endMinutes ?? 0);
  const from = String(block.fromName || block.from || block.pickup || block.startLocation || "—");
  const to = String(block.toName || block.to || block.dropoff || block.endLocation || "—");
  const workSet = buildUnassignedWorkSets().find((set) => set.blocks.some((item) => String(item.block.id) === String(block.id)));
  detailPanelEl.innerHTML = `
    <div class="dispatch-inspector-hero"><span>UNASSIGNED WORK</span><h3>${escapeHtml(code)}</h3><p>${escapeHtml(getUnassignedGroupName(block))}</p></div>
    <div class="dispatch-inspector-section"><h4>Job details</h4><div class="dispatch-inspector-grid">
      <span>Time</span><strong>${minToTimeStr(start)}–${minToTimeStr(end)}</strong>
      <span>Duration</span><strong>${Math.max(0, end - start)} minutes</strong>
      <span>Route</span><strong>${escapeHtml(from)} → ${escapeHtml(to)}</strong>
      <span>Vehicle</span><strong>${escapeHtml(getBusLabel(block) || "Not specified")}</strong>
      <span>Work set</span><strong>${workSet?.blocks.length || 1} linked block${workSet?.blocks.length === 1 ? "" : "s"}</strong>
    </div></div>
    ${block.notes ? `<div class="dispatch-inspector-section"><h4>Notes</h4><p>${escapeHtml(block.notes)}</p></div>` : ""}
    <div class="dispatch-inspector-note">Drag this numbered block vertically onto a valid driver duty. The job time will remain unchanged.</div>`;
}

function renderUnassignedTimeline(blocks, selectedDate) {
  if (!unassignedJobsPanelBodyEl) return;
  const previousScrollTop = unassignedJobsPanelBodyEl.scrollTop;
  const search = String(unassignedJobsSearchEl?.value || "").trim().toLowerCase();
  const timeFilter = unassignedJobsTimeFilterEl?.value || "all";
  const now = new Date();
  const currentMin = now.getHours() * 60 + now.getMinutes();
  const isToday = selectedDate === getLocalTodayStr();
  const allSets = buildUnassignedWorkSets(blocks);
  const entries = allSets.flatMap((set) => set.blocks.map((item) => ({ ...item, set })));
  const filtered = entries.filter(({ block, set }) => {
    const start = Number(block.startMin ?? block.startMinutes ?? 0);
    const haystack = [set.groupName, block.from, block.to, block.notes, block.id, itemLabel(block)].filter(Boolean).join(" ").toLowerCase();
    if (search && !haystack.includes(search)) return false;
    if (timeFilter === "urgent" && (!isToday || start < currentMin || start > currentMin + 60)) return false;
    if (timeFilter === "morning" && !(start >= 300 && start < 720)) return false;
    if (timeFilter === "midday" && !(start >= 720 && start < 840)) return false;
    if (timeFilter === "afternoon" && !(start >= 840 && start < 1080)) return false;
    if (timeFilter === "evening" && !(start >= 1080 || start < 300)) return false;
    return true;
  });
  if (unassignedJobsCountEl) unassignedJobsCountEl.textContent = String(entries.length);
  if (unassignedDensity === "collapsed") {
    unassignedJobsPanelBodyEl.innerHTML = "";
    if (unassignedJobsGroupLabelsEl) unassignedJobsGroupLabelsEl.innerHTML = "";
    renderOperationalSummary();
    return;
  }
  if (!filtered.length) {
    unassignedJobsPanelBodyEl.innerHTML = `<div class="dispatch-unassigned-empty">No unassigned work matches the selected filters.</div>`;
    if (unassignedJobsGroupLabelsEl) unassignedJobsGroupLabelsEl.innerHTML = "";
    renderOperationalSummary();
    return;
  }

  const headerHeight = 30;
  const laneHeight = 42;
  const groupGap = 8;
  const width = TOTAL_SLOTS * slotWidth;

  const grouped = new Map();
  filtered.forEach((entry) => {
    const groupKey = String(entry.block.jobGroupId || entry.set.groupName || "No Group");
    if (!grouped.has(groupKey)) {
      grouped.set(groupKey, {
        key: groupKey,
        name: entry.set.groupName || "No Group",
        entries: []
      });
    }
    grouped.get(groupKey).entries.push(entry);
  });

  const groupRows = [...grouped.values()]
    .map((group) => {
      const laneEnds = [];
      const placed = group.entries
        .slice()
        .sort((a, b) => Number(a.block.startMin || 0) - Number(b.block.startMin || 0))
        .map((entry) => {
          const start = Number(entry.block.startMin ?? entry.block.startMinutes ?? 0);
          const end = Number(entry.block.endMin ?? entry.block.endMinutes ?? start + 15);
          const axisStart = timelineMinute(start);
          const axisEnd = timelineMinute(end);
          let lane = laneEnds.findIndex((lastEnd) => lastEnd <= axisStart);
          if (lane < 0) lane = laneEnds.length;
          laneEnds[lane] = axisEnd;
          return { ...entry, lane, start, end, axisStart, axisEnd };
        });
      return { ...group, placed, laneCount: Math.max(1, laneEnds.length) };
    })
    .sort((a, b) => {
      const aStart = Math.min(...a.placed.map((item) => item.axisStart));
      const bStart = Math.min(...b.placed.map((item) => item.axisStart));
      return aStart - bStart || a.name.localeCompare(b.name);
    });

  let currentTop = headerHeight;
  groupRows.forEach((group, groupIndex) => {
    group.top = currentTop;
    group.height = group.laneCount * laneHeight + groupGap;
    group.number = groupIndex + 1;
    currentTop += group.height;
  });

  const canvasHeight = Math.max(headerHeight + laneHeight, currentTop);
  unassignedJobsPanelBodyEl.innerHTML = `<div class="dispatch-unassigned-canvas" style="width:${width}px;height:${canvasHeight}px">
    <div class="dispatch-unassigned-time-header">${buildTimeScaleHtml("dispatch-time-scale-unassigned")}</div>
    ${Array.from({ length: TOTAL_SLOTS }).map((_, index) => `<span class="dispatch-unassigned-gridline ${index % 4 === 0 ? "hour" : ""}" style="left:${index * slotWidth}px"></span>`).join("")}
    ${groupRows.map((group) => {
      const colors = getGroupColors(group.key || group.name || "unassigned");
      return `<div class="dispatch-unassigned-group-band" style="top:${group.top}px;height:${group.height}px;--job-group-border:${colors.border}"></div>${group.placed.map(({ block, code, set, lane, start, end }) => {
        const left = dispatchMinuteToLeft(start);
        const blockWidth = Math.max(48, ((end - start) / SLOT_MINUTES) * slotWidth);
        const isSelected = String(selectedBlockId) === String(block.id || "");
        const runCode = getRouteRunCode(block);
        const displayCode = runCode || code;
        const route = `${String(block.fromName || block.from || block.pickup || block.startLocation || "")} → ${String(block.toName || block.to || block.dropoff || block.endLocation || "")}`;
        const title = `${displayCode} · ${set.groupName} · ${minToTimeStr(start)}-${minToTimeStr(end)}${route !== " → " ? ` · ${route}` : ""}`;
        return `<button type="button" draggable="true" class="dispatch-unassigned-block ${isSelected ? "selected" : ""}" data-block-id="${escapeHtml(block.id || "")}" data-code="${escapeHtml(displayCode)}" data-start="${start}" data-end="${end}" style="--job-group-bg:${colors.bg};--job-group-border:${colors.border};--job-group-text:${colors.text};left:${left}px;top:${group.top + lane * laneHeight + 4}px;width:${blockWidth}px" title="${escapeHtml(title)}"><strong>${escapeHtml(displayCode)}</strong><span>${escapeHtml(minToTimeStr(start))}–${escapeHtml(minToTimeStr(end))}</span><span class="dispatch-unassigned-route">${escapeHtml(set.groupName)}</span></button>`;
      }).join("")}`;
    }).join("")}
  </div>`;

  if (unassignedJobsGroupLabelsEl) {
    unassignedJobsGroupLabelsEl.style.height = `${canvasHeight - headerHeight}px`;
    unassignedJobsGroupLabelsEl.innerHTML = groupRows.map((group) => {
      const colors = getGroupColors(group.key || group.name || "unassigned");
      const runCodes = [...new Set(group.placed.map(({ block }) => getRouteRunCode(block)).filter(Boolean))];
      return `<div class="dispatch-unassigned-group-label" style="top:${group.top - headerHeight}px;height:${group.height}px;--job-group-border:${colors.border}"><strong>${escapeHtml(group.name)}</strong><span>${group.placed.length} job${group.placed.length === 1 ? "" : "s"}${runCodes.length ? ` · ${escapeHtml(runCodes.join(", "))}` : ""}</span></div>`;
    }).join("");
    unassignedJobsPanelBodyEl.scrollTop = previousScrollTop;
    unassignedJobsGroupLabelsEl.style.transform = `translateY(-${unassignedJobsPanelBodyEl.scrollTop}px)`;
  }

  unassignedJobsPanelBodyEl.querySelectorAll("[data-block-id]").forEach((card) => {
    card.onclick = () => {
      selectedBlockId = card.dataset.blockId || "";
      const block = blocksCache.find((item) => String(item.id) === selectedBlockId);
      renderUnassignedBlockDetail(block, card.dataset.code || "U");
    };
    card.ondragstart = (event) => {
      draggedBlockId = card.dataset.blockId || "";
      draggedDutySpanId = "";
      event.dataTransfer.setData("blockId", draggedBlockId);
      event.dataTransfer.setData("start", card.dataset.start || "");
      event.dataTransfer.setData("end", card.dataset.end || "");
      event.dataTransfer.effectAllowed = "move";
      card.classList.add("dragging");
    };
    card.ondragend = () => {
      draggedBlockId = "";
      card.classList.remove("dragging");
      clearAllTimelineRowDropStates();
    };
  });
  renderOperationalSummary();
}

function itemLabel(block) {
  return String(block.blockType || block.tripPattern || block.jobType || block.type || "");
}

function renderUnassignedJobs(blocks, selectedDate) {
  if (!unassignedJobsPanelBodyEl) return;

  return renderUnassignedTimeline(blocks, selectedDate);

  function getGroupKey(block) {
    const directName = String(
      block.jobGroupName ||
        block.groupName ||
        block.schoolName ||
        block.school ||
        block.title ||
        block.name ||
        block.jobName ||
        block.group ||
        ""
    ).trim();

    if (directName) return directName;

    const groupId = String(block.jobGroupId || "").trim();
    if (!groupId) return "No Group";

    const jobGroup = (jobGroupsCache || []).find(
      (jg) => String(jg.id || "") === groupId
    );

    if (!jobGroup) return "No Group";

    return String(
      jobGroup.title ||
        jobGroup.name ||
        jobGroup.clientName ||
        "No Group"
    ).trim();
  }

  function getDirectionText(block) {
    return String(
      block.direction ||
        block.tripDirection ||
        block.runDirection ||
        block.blockType ||
        ""
    ).trim();
  }

  function getTypeText(block) {
    return String(
      block.jobType ||
        block.type ||
        block.category ||
        block.tripPattern ||
        ""
    ).trim();
  }

  function getFromText(block) {
    return String(
      block.fromName ||
        block.from ||
        block.pickup ||
        block.startLocation ||
        block.origin ||
        ""
    ).trim();
  }

  function getToText(block) {
    return String(
      block.toName ||
        block.to ||
        block.dropoff ||
        block.endLocation ||
        block.destination ||
        ""
    ).trim();
  }

  function getStartMin(block) {
    return Number(block.startMin ?? block.startMinutes ?? 0);
  }

  function getEndMin(block) {
    return Number(block.endMin ?? block.endMinutes ?? 0);
  }

  const unassigned = (blocks || [])
    .filter((b) => {
      const sameDate =
        String(b.serviceDate || b.date || "") === String(selectedDate || "");

      const noDriver = !String(
        b.assignedDriverEmployeeNumber ||
          b.assignedDriverId ||
          b.driverId ||
          ""
      ).trim();

      return sameDate && noDriver;
    })
      .sort((a, b) => {
        const aGroup = getGroupKey(a).toLowerCase();
        const bGroup = getGroupKey(b).toLowerCase();
        const groupCompare = aGroup.localeCompare(bGroup);
        if (groupCompare !== 0) return groupCompare;

        const typeRank = (block) => {
          const t = String(getTypeText(block) || "").toLowerCase();
          if (t === "forward") return 1;
          if (t === "return") return 2;
          return 9;
        };

        const typeCompare = typeRank(a) - typeRank(b);
        if (typeCompare !== 0) return typeCompare;

        const getBusNo = (block) => {
          const match = String(block.notes || "").match(/Bus\s+(\d+)/i);
          return match ? Number(match[1]) : 0;
        };

        const busCompare = getBusNo(a) - getBusNo(b);
        if (busCompare !== 0) return busCompare;

        const aStart = getStartMin(a);
        const bStart = getStartMin(b);
        return aStart - bStart;
      });

  if (!unassigned.length) {
    unassignedJobsPanelBodyEl.innerHTML = `
      <div class="muted" style="padding:8px 4px;">
        No unassigned jobs for this date.
      </div>
    `;
    return;
  }

  let lastGroup = "";
  let lastType = "";
  unassignedJobsPanelBodyEl.innerHTML = unassigned
    .map((b) => {
      const groupName = getGroupKey(b);
      const directionText = getDirectionText(b);
      const typeText = getTypeText(b);
      let headerHtml = "";
      if (groupName !== lastGroup) {
        headerHtml += `
          <div style="
            font-weight:700;
            margin:10px 0 4px;
            font-size:13px;
          ">
            ${escapeHtml(groupName)}
          </div>
        `;
        lastGroup = groupName;
        lastType = "";
      }
      const fromText = getFromText(b);
      const toText = getToText(b);
      const startMin = getStartMin(b);
      const endMin = getEndMin(b);
      const durationMin = Math.max(0, endMin - startMin);
      const groupId = b.jobGroupId || groupName;
      const colors = getGroupColors(groupId);

      const timeText =
        startMin || endMin
          ? `${minToTimeStr(startMin)}-${minToTimeStr(endMin)}`
          : "";

      const metaParts = [
        directionText,
        timeText,
        durationMin ? `${durationMin} min` : ""
      ].filter(Boolean);

        return `
          ${headerHtml}
          <div
            draggable="true"
          data-block-id="${escapeHtml(b.id || b.blockId || "")}"
          data-start="${startMin}"
          data-end="${endMin}"
          style="
            border:1px solid #d1d5db;
            border-left:6px solid ${colors.border};
            border-radius:10px;
            padding:7px 9px;
            margin-bottom:7px;
            background:${colors.bg};
            color:${colors.text};
            cursor:grab;
            user-select:none;
            box-shadow:0 1px 2px rgba(0,0,0,0.06);
          "
            title="${escapeHtml(
              [
                groupName,
                timeText ? `Time: ${timeText}` : "",
                fromText || toText ? `Route: ${fromText} → ${toText}` : "",
                typeText ? `Type: ${typeText}` : "",
                getBusLabel(b) ? `Bus: ${getBusLabel(b)}` : "",
                b.notes ? `Notes: ${b.notes}` : ""
              ].filter(Boolean).join(" | ")
            )}"
        >
          <div style="
            font-weight:700;
            font-size:13px;
            line-height:1.15;
            color:${colors.text};
            white-space:nowrap;
            overflow:hidden;
            text-overflow:ellipsis;
            display:none;
          ">
            ${escapeHtml(groupName)}
          </div>

          ${
            metaParts.length
              ? `
                <div style="
                  font-size:11px;
                  margin-top:2px;
                  opacity:0.9;
                  white-space:nowrap;
                  overflow:hidden;
                  text-overflow:ellipsis;
                ">
                  ${escapeHtml(metaParts.join(" · "))}
                </div>
              `
              : ""
          }

          ${
            fromText || toText
              ? `
                <div style="
                  font-size:12px;
                  margin-top:4px;
                  line-height:1.2;
                  white-space:nowrap;
                  overflow:hidden;
                  text-overflow:ellipsis;
                ">
                  ${escapeHtml(fromText)}${fromText || toText ? " → " : ""}${escapeHtml(toText)}
                </div>
              `
              : ""
          }

          ${
            typeText || getBusLabel(b)
              ? `
                <div style="display:flex; gap:6px; margin-top:3px; align-items:center;">
                  ${typeText ? `<span style="font-size:10px; opacity:0.85;">${escapeHtml(typeText)}</span>` : ""}
                  ${getBusLabel(b) ? `<span style="font-size:10px; background:rgba(255,255,255,0.25); padding:2px 6px; border-radius:6px; font-weight:600;">${escapeHtml(getBusLabel(b))}</span>` : ""}
                </div>
              `
              : ""
          }
        </div>
      `;
    })
    .join("");

  const jobCards = unassignedJobsPanelBodyEl.querySelectorAll("[draggable='true']");

  jobCards.forEach((card) => {
    card.ondragstart = (e) => {
      draggedBlockId = card.dataset.blockId || "";

      e.dataTransfer.setData("blockId", draggedBlockId);
      e.dataTransfer.setData("start", card.dataset.start || "");
      e.dataTransfer.setData("end", card.dataset.end || "");
      e.dataTransfer.effectAllowed = "move";
    };

    card.ondragend = () => {
      draggedBlockId = "";
      clearAllTimelineRowDropStates();
      card.style.opacity = "1";
    };

    card.onmousedown = () => {
      card.style.cursor = "grabbing";
    };

    card.onmouseup = () => {
      card.style.cursor = "grab";
    };
  });
}

// stop previous blocks listener
if (unsubscribeBlocks) {
  unsubscribeBlocks();
  unsubscribeBlocks = null;
}

function loadUnassignedJobsForDate(selectedDate) {
  if (!selectedDate) {
    if (unassignedJobsPanelBodyEl) {
      unassignedJobsPanelBodyEl.innerHTML = `
        <div class="muted">Please select a dispatch date.</div>
      `;
    }
    return;
  }

    if (unsubscribeBlocks) {
    unsubscribeBlocks();
    unsubscribeBlocks = null;
  }

  if (unassignedJobsPanelBodyEl) {
    unassignedJobsPanelBodyEl.innerHTML = `
      <div class="muted">Loading unassigned jobs...</div>
    `;
  }

  unsubscribeBlocks = listenBlocksByDate(
    selectedDate,
    (blocks) => {
      blocksCache = blocks || [];

      renderUnassignedJobs(blocksCache, selectedDate);
      renderDrivers();

      if (selectedDriverEmpNo) {
        const selectedDriver = getActiveDrivers().find(
          (d) => String(d.employeeNumber) === String(selectedDriverEmpNo)
        );
        renderDriverDetail(selectedDriver || null);
      }
    },
    (err) => {
      console.error("Unassigned jobs error:", err);

      if (unassignedJobsPanelBodyEl) {
        unassignedJobsPanelBodyEl.innerHTML = `
          <div class="muted">Failed to load unassigned jobs.</div>
        `;
      }
    }
  );
}

function startDutySpanListener(selectedDate) {
  if (unsubscribeDutySpans) {
    try {
      unsubscribeDutySpans();
    } catch {}
    unsubscribeDutySpans = null;
  }

  if (!selectedDate) {
    dutySpansCache = [];
    renderDrivers();

    if (selectedDriverEmpNo) {
      const selectedDriver = getActiveDrivers().find(
        (d) => String(d.employeeNumber) === String(selectedDriverEmpNo)
      );
      renderDriverDetail(selectedDriver || null);
    }
    return;
  }

  unsubscribeDutySpans = listenDutySpansByDate(
    selectedDate,
    (items) => {
      dutySpansCache = items || [];
      renderDrivers();

      if (selectedDriverEmpNo) {
        const selectedDriver = getActiveDrivers().find(
          (d) => String(d.employeeNumber) === String(selectedDriverEmpNo)
        );
        renderDriverDetail(selectedDriver || null);
      }
    },
    (err) => {
      console.error("Duty spans error:", err);
      showError(err?.message || "Failed to load duty spans.");
    }
  );
}

function applyZoom(newSlotWidth, anchorClientX = null) {
  const oldSlotWidth = slotWidth;
  const rect = timelineOuterEl.getBoundingClientRect();
  const viewportX = anchorClientX == null
    ? timelineOuterEl.clientWidth / 2
    : Math.max(0, Math.min(timelineOuterEl.clientWidth, anchorClientX - rect.left));
  const anchoredMinutes = ((timelineOuterEl.scrollLeft + viewportX) / oldSlotWidth) * SLOT_MINUTES;

  slotWidth = Math.max(7, Math.min(52, newSlotWidth));
  document.documentElement.style.setProperty("--dispatch-slot-width", `${slotWidth}px`);

  buildTimelineHeader();
  syncDriverSpacerHeight();
  renderDrivers();
  renderUnassignedJobs(blocksCache, getSelectedDate());

  const newScrollLeft = (anchoredMinutes / SLOT_MINUTES) * slotWidth - viewportX;
  timelineOuterEl.scrollLeft = Math.max(0, newScrollLeft);
  if (unassignedJobsPanelBodyEl) unassignedJobsPanelBodyEl.scrollLeft = timelineOuterEl.scrollLeft;

  renderNowLine();
}

function blocksOverlap(startA, endA, startB, endB) {
  return startA < endB && endA > startB;
}

function driverHasAssignedBlockOverlap(empNo, startMin, endMin, ignoreBlockId = "") {
  const assignedBlocks = getAssignedBlocksForDriver(empNo);

  return assignedBlocks.some((block) => {
    if (ignoreBlockId && String(block.id) === String(ignoreBlockId)) {
      return false;
    }

    const blockStart = Number(block.startMin ?? block.startMinutes ?? 0);
    const blockEnd = Number(block.endMin ?? block.endMinutes ?? 0);

    return blocksOverlap(startMin, endMin, blockStart, blockEnd);
  });
}

function clearAllTimelineRowDropStates() {
  const rows = timelineBodyEl.querySelectorAll("[data-timeline-row]");

  rows.forEach((row) => {
    const empNo = row.getAttribute("data-timeline-row") || "";
    const isSelected = String(selectedDriverEmpNo) === String(empNo);
    row.style.background = isSelected ? "#eef6ff" : "#fff";
  });
}


function setTimelineRowDropState(empNo, state = "") {
  const row = timelineBodyEl.querySelector(
    `[data-timeline-row="${CSS.escape(String(empNo || ""))}"]`
  );

  if (!row) return;

  if (state === "overlap") {
    row.style.background = "#fee2e2";
  } else if (state === "valid") {
    row.style.background = "#dcfce7";
  } else {
    const isSelected = String(selectedDriverEmpNo) === String(empNo);
    row.style.background = isSelected ? "#eef6ff" : "#fff";
  }
}

function setupTimelineWheelZoom() {
  if (!timelineOuterEl) return;
  const zoomHandler = (event) => {
    if (!event.ctrlKey) return;
    event.preventDefault();
    const factor = event.deltaY < 0 ? 1.12 : 0.89;
    applyZoom(slotWidth * factor, event.clientX);
  };
  timelineOuterEl.addEventListener("wheel", zoomHandler, { passive: false });
  unassignedJobsPanelBodyEl?.addEventListener("wheel", zoomHandler, { passive: false });
}

function driverHasDutySpanCoverage(empNo, startMin, endMin) {
  const spans = getDriverDutySpans(empNo);

  return spans.some((span) => {
    const spanStart = Number(span.startMin || 0);
    const spanEnd = Number(span.endMin || 0);

    return startMin >= spanStart && endMin <= spanEnd;
  });
}

function getBlocksForDutySpan(span) {
  const direct = (blocksCache || []).filter((block) =>
    String(block.dutySpanId || "") === String(span.id || "")
  );
  if (direct.length) return direct;
  return (blocksCache || []).filter((block) => {
    const owner = String(block.assignedDriverEmployeeNumber || block.assignedDriverId || block.driverId || "");
    const start = Number(block.startMin ?? block.startMinutes ?? 0);
    const end = Number(block.endMin ?? block.endMinutes ?? 0);
    return owner === String(span.driverEmployeeNumber || "") &&
      start >= Number(span.startMin || 0) && end <= Number(span.endMin || 0);
  });
}

async function transferDutySpanToDriver(spanId, targetEmpNo) {
  const span = dutySpansCache.find((item) => String(item.id) === String(spanId));
  const target = employeesCache.find((item) => String(item.employeeNumber) === String(targetEmpNo));
  if (!span || !target) return showPageMessage("Duty span or target driver could not be found.", "error");
  const sourceEmpNo = String(span.driverEmployeeNumber || "");
  if (sourceEmpNo === String(targetEmpNo)) return;

  const targetStatus = String(target.status || "").toLowerCase();
  if (["inactive", "on leave", "leave", "unavailable"].includes(targetStatus)) {
    return showPageMessage("This driver is inactive, unavailable or on leave and cannot receive the duty.", "error", 6500);
  }

  if (validateDriverSpanOverlap(targetEmpNo, Number(span.startMin || 0), Number(span.endMin || 0))) {
    return showPageMessage("Transfer blocked: the target driver already has an overlapping duty span.", "error", 6500);
  }

  const movedBlocks = getBlocksForDutySpan(span);
  const movedIds = new Set(movedBlocks.map((block) => String(block.id)));
  const overlappingJob = getAssignedBlocksForDriver(targetEmpNo).find((existing) =>
    !movedIds.has(String(existing.id)) && movedBlocks.some((block) =>
      blocksOverlap(
        Number(block.startMin ?? block.startMinutes ?? 0),
        Number(block.endMin ?? block.endMinutes ?? 0),
        Number(existing.startMin ?? existing.startMinutes ?? 0),
        Number(existing.endMin ?? existing.endMinutes ?? 0)
      )
    )
  );
  if (overlappingJob) {
    return showPageMessage("Transfer blocked: one or more duty jobs overlap work already assigned to the target driver.", "error", 6500);
  }

  const source = employeesCache.find((item) => String(item.employeeNumber) === sourceEmpNo);
  const sourceName = source?.displayName || span.driverName || sourceEmpNo;
  const targetName = target.displayName || target.firstName || targetEmpNo;
  const bus = String(span.assignedBus || "").trim();
  const busConflict = bus && dutySpansCache.some((other) =>
    String(other.id) !== String(span.id) && String(other.assignedBus || "").trim() === bus &&
    spansOverlap(Number(span.startMin || 0), Number(span.endMin || 0), Number(other.startMin || 0), Number(other.endMin || 0))
  );
  const warning = busConflict
    ? `<div class="dispatch-confirm-warning">Warning: bus ${escapeHtml(bus)} has an overlapping allocation.</div>`
    : "";
  const confirmed = await confirmDispatchAction({
    title: "Transfer complete duty",
    message: `<p>Transfer <strong>${escapeHtml(span.dutyNumber || "this duty")}</strong> and <strong>${movedBlocks.length} assigned job${movedBlocks.length === 1 ? "" : "s"}</strong>?</p>
      <div class="dispatch-confirm-grid"><span>From</span><strong>${escapeHtml(sourceName)}</strong><span>To</span><strong>${escapeHtml(targetName)}</strong><span>Time</span><strong>${minToTimeStr(span.startMin)}–${minToTimeStr(span.endMin)}</strong></div>
      <p>The new driver will receive this duty as <strong>Pending confirmation</strong>.</p>${warning}`,
    confirmLabel: "Transfer Duty"
  });
  if (!confirmed) return;

  try {
    await transferDutySpanWithBlocks({
      dutySpanId: span.id,
      blockIds: movedBlocks.map((block) => block.id),
      driverEmployeeNumber: targetEmpNo,
      driverName: targetName
    });
    selectedDriverEmpNo = String(targetEmpNo);
    showPageMessage(`Duty transferred to ${targetName}. Driver confirmation is now pending.`, "success", 6500);
  } catch (error) {
    console.error("Duty transfer failed", error);
    showPageMessage(error?.message || "Duty transfer failed. No changes were completed.", "error", 6500);
  }
}

function setupDutySpanDragEvents() {
  timelineBodyEl.querySelectorAll("[data-duty-span-bar]").forEach((bar) => {
    bar.ondragstart = (event) => {
      draggedDutySpanId = bar.dataset.dutySpanBar || "";
      draggedBlockId = "";
      event.dataTransfer.setData("dutySpanId", draggedDutySpanId);
      event.dataTransfer.effectAllowed = "move";
      bar.classList.add("dragging");
    };
    bar.ondragend = () => {
      draggedDutySpanId = "";
      bar.classList.remove("dragging");
      clearAllTimelineRowDropStates();
    };
  });
}

function setupSyncedScroll() {
  if (!driversScrollEl || !timelineOuterEl) return;

  let syncingHorizontalScroll = false;

  timelineOuterEl.addEventListener("scroll", () => {
    driversScrollEl.scrollTop = timelineOuterEl.scrollTop;
    if (unassignedJobsPanelBodyEl && !syncingHorizontalScroll) {
      syncingHorizontalScroll = true;
      unassignedJobsPanelBodyEl.scrollLeft = timelineOuterEl.scrollLeft;
      requestAnimationFrame(() => { syncingHorizontalScroll = false; });
    }
  });

  unassignedJobsPanelBodyEl?.addEventListener("scroll", () => {
    if (unassignedJobsGroupLabelsEl) {
      unassignedJobsGroupLabelsEl.style.transform = `translateY(-${unassignedJobsPanelBodyEl.scrollTop}px)`;
    }
    if (syncingHorizontalScroll) return;
    syncingHorizontalScroll = true;
    timelineOuterEl.scrollLeft = unassignedJobsPanelBodyEl.scrollLeft;
    requestAnimationFrame(() => { syncingHorizontalScroll = false; });
  });

  driversScrollEl.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      timelineOuterEl.scrollTop += e.deltaY;
    },
    { passive: false }
  );
}

function setupTimelinePanning() {
  if (!timelineOuterEl) return;
  let active = false;
  let moved = false;
  let startX = 0;
  let startY = 0;
  let startLeft = 0;
  let startTop = 0;

  timelineOuterEl.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || draggedBlockId || draggedDutySpanId) return;
    if (event.target.closest("button,input,select,a,[draggable='true'],[data-assigned-block-bar],[data-duty-span-bar]")) return;
    active = true;
    moved = false;
    startX = event.clientX;
    startY = event.clientY;
    startLeft = timelineOuterEl.scrollLeft;
    startTop = timelineOuterEl.scrollTop;
    timelineOuterEl.setPointerCapture?.(event.pointerId);
    timelineOuterEl.classList.add("is-panning");
  });

  timelineOuterEl.addEventListener("pointermove", (event) => {
    if (!active) return;
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    if (Math.abs(dx) + Math.abs(dy) > 4) moved = true;
    timelineOuterEl.scrollLeft = startLeft - dx;
    timelineOuterEl.scrollTop = startTop - dy;
    if (moved) event.preventDefault();
  });

  const endPan = (event) => {
    if (!active) return;
    active = false;
    timelineOuterEl.releasePointerCapture?.(event.pointerId);
    timelineOuterEl.classList.remove("is-panning");
  };
  timelineOuterEl.addEventListener("pointerup", endPan);
  timelineOuterEl.addEventListener("pointercancel", endPan);
  timelineOuterEl.addEventListener("dragover", (event) => {
    const bounds = timelineOuterEl.getBoundingClientRect();
    if (event.clientY < bounds.top + 52) timelineOuterEl.scrollTop -= 12;
    if (event.clientY > bounds.bottom - 52) timelineOuterEl.scrollTop += 12;
    if (event.clientX < bounds.left + 52) timelineOuterEl.scrollLeft -= 14;
    if (event.clientX > bounds.right - 52) timelineOuterEl.scrollLeft += 14;
  });
}

function loadDispatchForDate(selectedDate, { openPanel = false } = {}) {
  console.log("LOAD DISPATCH", { selectedDate, openPanel });

  if (!selectedDate) {
    showError("Please select a dispatch date.");
    return;
  }

  sessionStorage.setItem("dispatchDate", selectedDate);
  showError("");

  if (unassignedJobsDateLabelEl) {
    unassignedJobsDateLabelEl.textContent = selectedDate;
  }

  if (openPanel && unassignedDensity === "collapsed") {
    setUnassignedPanelState("compact");
  }

  loadUnassignedJobsForDate(selectedDate);
  startDutySpanListener(selectedDate);
}

loadBtn.onclick = () => {
  loadDispatchForDate(dispatchDateEl.value, { openPanel: true });
  showPageMessage("Dispatch board loaded.", "success");
};

dispatchDateEl.onchange = () => {
  loadDispatchForDate(dispatchDateEl.value, { openPanel: false });
};

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !modalLayerEl?.hidden) {
    modalCancelBtn?.click();
  }
});

driverSortByEl.onchange = () => {
  renderDrivers();
};

driverViewFilterEl.onchange = renderDrivers;
driverSearchFilterEl.oninput = () => {
  clearDriverFilterBtn.hidden = !driverSearchFilterEl.value;
  renderDrivers();
};
clearDriverFilterBtn.onclick = () => {
  driverSearchFilterEl.value = "";
  clearDriverFilterBtn.hidden = true;
  renderDrivers();
};

refreshDispatchBtn.onclick = () => {
  loadDispatchForDate(dispatchDateEl.value, { openPanel: false });
  showPageMessage("Dispatch data refreshed.", "success");
};

boardViewModeEl.onchange = () => applyBoardView(boardViewModeEl.value);
document.addEventListener("fullscreenchange", () => {
  if (!document.fullscreenElement && boardViewModeEl.value === "fullscreen") {
    boardViewModeEl.value = "standard";
    applyBoardView("standard");
  }
});

toggleUnassignedJobsBtn.onclick = () => {
  setUnassignedPanelState(unassignedDensity === "collapsed" ? "compact" : "collapsed");
};
unassignedDensityBtn.onclick = () => {
  setUnassignedPanelState(unassignedDensity === "expanded" ? "compact" : "expanded");
};
unassignedJobsSearchEl.oninput = () => renderUnassignedJobs(blocksCache, getSelectedDate());
unassignedJobsTimeFilterEl.onchange = () => renderUnassignedJobs(blocksCache, getSelectedDate());

listenEmployees(
  (employees) => {
    employeesCache = employees || [];
    renderDrivers();
  },
  (err) => {
    console.error("Dispatch employees error:", err);
    showError(err?.message || "Failed to load employees");
  }
);

listenBuses(
  (buses) => {
    busesCache = buses || [];
    renderDrivers();
  },
  (err) => {
    console.error("Dispatch buses error:", err);
    showError(err?.message || "Failed to load buses");
  }
);

listenJobGroups(
  (groups) => {
    jobGroupsCache = (groups || []).filter((x) => !x.deleted);
    renderDrivers();

    if (selectedDriverEmpNo) {
      const selectedDriver = getActiveDrivers().find(
        (d) => String(d.employeeNumber) === String(selectedDriverEmpNo)
      );
      renderDriverDetail(selectedDriver || null);
    }
  },
  (err) => {
    console.error("Dispatch job groups error:", err);
    showError(err?.message || "Failed to load job groups");
  }
);

buildTimelineHeader();
syncDriverSpacerHeight();
renderDrivers();
renderNowLine();
renderDriverDetail(null);
setupSyncedScroll();
setupTimelinePanning();
setupTimelineWheelZoom();

if (nowLineTimer) {
  clearInterval(nowLineTimer);
}

nowLineTimer = setInterval(() => {
  renderNowLine();
}, 60000);

const savedBoardView = localStorage.getItem("dispatch-board-view") || "standard";
boardViewModeEl.value = savedBoardView === "fullscreen" ? "standard" : savedBoardView;
applyBoardView(boardViewModeEl.value);
setUnassignedPanelState(localStorage.getItem("dispatch-unassigned-density") || "compact");

console.log("BOTTOM OF DISPATCH FILE REACHED");
loadDispatchForDate(today, { openPanel: false });
}

