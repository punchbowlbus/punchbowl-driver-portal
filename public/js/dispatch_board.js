import {
  listenEmployees,
  listenBuses,
  listenBlocksByDate,
  listenDutySpansByDate,
  listenJobGroups,
  addDutySpan,
  updateDutySpan,
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
  <h2 style="margin-top:0">Dispatch Board</h2>

  <div class="card" style="display:flex; flex-direction:column; height:calc(100vh - 120px); overflow:hidden;">

    <!-- Top Controls -->
    <div style="flex:0 0 auto; display:flex; gap:10px; flex-wrap:wrap; align-items:end; margin-bottom:10px;">
      <div>
        <div class="muted" style="margin-bottom:6px;">Dispatch Date</div>
        <input id="dispatchDate" type="date" value="${today}" />
      </div>

      <div>
        <button id="loadDispatchBtn">Load Dispatch</button>
      </div>

      <div>
        <div class="muted" style="margin-bottom:6px;">Sort Drivers</div>
        <select id="driverSortBy" style="height:38px;">
          <option value="type_name">Employee Type</option>
          <option value="name">Driver Name</option>
          <option value="empno">Emp Number</option>
        </select>
      </div>

      <div style="display:flex; align-items:center; gap:6px; height:38px;">
        <input id="workingDriversOnly" type="checkbox" checked />
        <label for="workingDriversOnly" class="muted">Working drivers only</label>
      </div>

      <div style="margin-left:auto; display:flex; gap:8px; align-items:end;">
        <div>
          <div class="muted" style="margin-bottom:6px;">Zoom</div>
          <div style="display:flex; gap:6px;">
            <button id="zoomOutBtn" type="button">-</button>
            <button id="zoomResetBtn" type="button">100%</button>
            <button id="zoomInBtn" type="button">+</button>
          </div>
        </div>
      </div>
    </div>

    <!-- Main Work Area -->
    <div id="dispatchMainWorkArea" style="flex:1; display:grid; grid-template-columns:220px minmax(0, 1fr) 300px; gap:12px; overflow:hidden; min-height:0;">

      <!-- Left -->
      <div style="border:1px solid #ddd; border-radius:12px; background:#fff; display:flex; flex-direction:column; overflow:hidden; min-height:0;">
        <div style="padding:10px 12px; font-weight:700; border-bottom:1px solid #eee; background:#f8f8f8;">
          Drivers
        </div>

        <div id="dispatchDriversTopSpacer" style="height:33px; border-bottom:1px solid #eee;"></div>

        <div id="dispatchDriversScroll" style="flex:1; overflow:hidden; min-height:0;">
          <div id="dispatchDriversList"></div>
        </div>
      </div>

      <!-- Middle -->
      <div style="border:1px solid #ddd; border-radius:12px; background:#fff; display:flex; flex-direction:column; overflow:hidden; min-width:0; min-height:0;">
        <div style="padding:10px 12px; font-weight:700; border-bottom:1px solid #eee; background:#f8f8f8;">
          Timeline
        </div>

        <div id="dispatchTimelineOuter" style="flex:1; overflow:auto; min-width:0; min-height:0; position:relative;">
          <div id="dispatchTimelineInner" style="min-width:max-content; position:relative;">
            <div
              id="dispatchTimelineHeader"
              style="position:sticky; top:0; z-index:2; background:#fff; border-bottom:1px solid #eee;"
            ></div>

            <div id="dispatchTimelineBody"></div>
          </div>
        </div>
      </div>

      <!-- Right -->
      <div
        id="dispatchRightPanel"
        style="border:1px solid #ddd; border-radius:12px; background:#fff; display:flex; flex-direction:column; overflow:hidden; min-height:0; position:relative;"
      >
          <div
            style="
              padding:10px 12px;
              font-weight:700;
              border-bottom:1px solid #eee;
              background:#f8f8f8;
              display:flex;
              align-items:center;
              gap:8px;
            "
          >
            <button
              id="toggleDetailPanelBtn"
              type="button"
              style="
                font-size:12px;
                padding:4px 6px;
                border:1px solid #ccc;
                border-radius:6px;
                background:#fff;
                cursor:pointer;
              "
            >
              Hide
            </button>

            <span id="dispatchRightPanelTitle">Driver / Duty Details</span>
          </div>

          <div
            id="dispatchDetailPanel"
            style="flex:1; padding:12px; overflow:auto; min-height:0;"
          >
          <div class="muted">Click a driver row to view details.</div>
        </div>
      </div>

    </div>
  </div>

  <!-- UNASSIGNED JOBS PANEL -->
  <div
    id="unassignedJobsPanel"
    style="
      position:fixed;
      top:80px;
      right:0;
      width:360px;
      height:calc(100vh - 80px);
      background:#fff;
      border-left:1px solid #ddd;
      box-shadow:-6px 0 16px rgba(0,0,0,0.15);
      display:none;
      flex-direction:column;
      z-index:9999;
    "
  >
    <div style="padding:12px; border-bottom:1px solid #eee; display:flex; justify-content:space-between; align-items:center;">
      <div>
        <div style="font-weight:700;">Unassigned Jobs</div>
        <div class="muted" style="font-size:12px;" id="unassignedJobsDateLabel">${today}</div>
      </div>

      <button id="closeUnassignedJobsPanel">✕</button>
    </div>

    <div id="unassignedJobsPanelBody" style="padding:12px; overflow:auto; flex:1;">
      <div class="muted">Click Load Dispatch to load unassigned jobs.</div>
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
const workingDriversOnlyEl = document.getElementById("workingDriversOnly");
const toggleDetailPanelBtn = document.getElementById("toggleDetailPanelBtn");

toggleDetailPanelBtn.onclick = () => {
  const mainWorkArea = document.getElementById("dispatchMainWorkArea");
  const rightPanel = detailPanelEl.parentElement;
  const rightHeader = toggleDetailPanelBtn.parentElement;
  const rightHeaderLabel = rightHeader.querySelector("span");

  if (!mainWorkArea || !rightPanel) return;

  if (detailPanelEl.style.display === "none") {
    detailPanelEl.style.display = "block";
    rightPanel.style.width = "";
    rightPanel.style.minWidth = "";
    mainWorkArea.style.gridTemplateColumns = "220px minmax(0, 1fr) 300px";
    if (rightHeaderLabel) rightHeaderLabel.style.display = "";
    toggleDetailPanelBtn.textContent = "Hide";
  } else {
    detailPanelEl.style.display = "none";
    rightPanel.style.width = "90px";
    rightPanel.style.minWidth = "90px";
    mainWorkArea.style.gridTemplateColumns = "220px minmax(0, 1fr) 90px";
    if (rightHeaderLabel) rightHeaderLabel.style.display = "none";
    toggleDetailPanelBtn.textContent = "Show";
  }
};

const zoomOutBtn = document.getElementById("zoomOutBtn");
const zoomResetBtn = document.getElementById("zoomResetBtn");
const zoomInBtn = document.getElementById("zoomInBtn");

const unassignedJobsPanelEl = document.getElementById("unassignedJobsPanel");
const closeUnassignedJobsPanelBtn = document.getElementById("closeUnassignedJobsPanel");
const unassignedJobsDateLabelEl = document.getElementById("unassignedJobsDateLabel");
const unassignedJobsPanelBodyEl = document.getElementById("unassignedJobsPanelBody");

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

  const SLOT_MINUTES = 15;
  const TOTAL_SLOTS = 144;
  const ROW_HEIGHT = 44;

  function minToTimeStr(min) {
    const safeMin = Number(min || 0);
    const h = Math.floor(safeMin / 60);
    const m = safeMin % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
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

      if (workingDriversOnlyEl?.checked) {
        const allowedStatuses = ["active", "working", "available", "on duty", "onduty", ""];
        if (!allowedStatuses.includes(status)) return false;
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
    timelineHeaderEl.innerHTML = `
      <div style="display:grid; grid-template-columns:repeat(${TOTAL_SLOTS}, ${slotWidth}px); min-width:max-content;">
        ${Array.from({ length: TOTAL_SLOTS })
          .map((_, i) => {
            const minutes = i * SLOT_MINUTES;
            const isHour = i % 4 === 0;

            return `
              <div style="
                box-sizing:border-box;
                width:${slotWidth}px;
                padding:8px 4px;
                border-right:1px solid #eee;
                background:${isHour ? "#f6fff0" : "#fff"};
                font-size:12px;
                font-weight:${isHour ? "700" : "500"};
                text-align:center;
                white-space:nowrap;
              ">
                ${minToTimeStr(minutes)}
              </div>
            `;
          })
          .join("")}
      </div>
    `;
  }

  function syncDriverSpacerHeight() {
    const firstHeaderCell = timelineHeaderEl.querySelector("div > div");
    if (!firstHeaderCell || !driversTopSpacerEl) return;

    const headerHeight = firstHeaderCell.offsetHeight || 33;
    driversTopSpacerEl.style.height = `${headerHeight}px`;
    driversTopSpacerEl.style.minHeight = `${headerHeight}px`;
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
                  .map((span) => {
                    const breaks = Array.isArray(span.breaks) ? span.breaks : [];

                    const fatigueColor =
                      span.fatigueStatus === "BREACH"
                        ? "#dc2626"
                        : span.fatigueStatus === "WARNING"
                        ? "#f59e0b"
                        : "#16a34a";

                    return `
                      <div style="padding:8px; border:1px solid #e5e5e5; border-radius:8px; background:#fff; position:relative;">
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

                        <div style="font-weight:700; font-size:13px; padding-right:92px;">
                          ${minToTimeStr(span.startMin)} - ${minToTimeStr(span.endMin)}
                        </div>

                        <div class="muted" style="font-size:12px; margin-top:3px;">
                          ${escapeHtml(span.startLocation || "")} → ${escapeHtml(span.endLocation || "")}
                        </div>

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
          ${
            assignedBlocks.length
              ? assignedBlocks
                  .map((block) => {
                    const startMin = Number(block.startMin ?? block.startMinutes ?? 0);
                    const endMin = Number(block.endMin ?? block.endMinutes ?? 0);

                    const fromText = String(
                      block.fromName || block.from || block.pickup || block.startLocation || ""
                    ).trim();

                    const toText = String(
                      block.toName || block.to || block.dropoff || block.endLocation || ""
                    ).trim();

                    return `
                      <div style="padding:8px; border:1px solid #bfdbfe; border-radius:8px; background:#fff; position:relative;">
                        <div style="position:absolute; top:8px; right:8px; display:flex; gap:6px;">
                          <button
                            type="button"
                            data-edit-assigned-block="${block.id}"
                            style="font-size:10px; padding:2px 6px;"
                          >
                            Edit
                          </button>

                          <button
                            type="button"
                            data-unassign-block="${block.id}"
                            style="font-size:10px; padding:2px 6px;"
                          >
                            Unassign
                          </button>
                        </div>

                        <div style="font-weight:700; font-size:13px; padding-right:92px;">
                          ${minToTimeStr(startMin)} - ${minToTimeStr(endMin)}
                        </div>

                        <div class="muted" style="font-size:12px; margin-top:3px;">
                          ${escapeHtml(fromText)} → ${escapeHtml(toText)}
                        </div>
                      </div>
                    `;
                  })
                  .join("")
              : `<div class="muted" style="font-size:13px;">No assigned jobs.</div>`
          }
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
            Use 24+ time for overnight (e.g. 25:30 = 01:30 next day)
          </div>

          <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
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
    btn.onclick = async (e) => {
      e.preventDefault();
      e.stopPropagation();

      const blockId = String(btn.getAttribute("data-edit-assigned-block") || "");

      const block = (blocksCache || []).find(
        (b) => String(b.id) === String(blockId)
      );

      if (!block) {
        alert("Block not found");
        return;
      }

      const newStart = prompt("Start time (HH:MM)", minToTimeStr(block.startMin));
      if (!newStart) return;

      const newEnd = prompt("End time (HH:MM)", minToTimeStr(block.endMin));
      if (!newEnd) return;

      const newFrom = prompt("From location", block.from || block.fromName || "");
      if (newFrom === null) return;

      const newTo = prompt("To location", block.to || block.toName || "");
      if (newTo === null) return;

      function timeToMin(str) {
        const [h, m] = String(str || "").split(":").map(Number);
        return (h * 60) + (m || 0);
      }

      const startMin = timeToMin(newStart);
      const endMin = timeToMin(newEnd);

      const driverEmpNo = String(selectedDriverEmpNo || "");

      if (driverHasAssignedBlockOverlap(driverEmpNo, startMin, endMin, blockId)) {
        alert("This change would overlap another assigned job.");
        return;
      }

      if (!driverHasDutySpanCoverage(driverEmpNo, startMin, endMin)) {
        alert("This change is outside the duty span.");
        return;
      }

      try {
        await updateBlock(blockId, {
          startMin,
          endMin,
          from: newFrom,
          to: newTo
        });

        console.log("BLOCK UPDATED", { blockId });
      } catch (err) {
        console.error(err);
        alert("Failed to update block");
      }
    };
  });

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

      const ok = confirm("Unassign this job?");
      if (!ok) return;

      try {
        await unassignBlockFromDriver(blockId);
        console.log("UNASSIGNED OK", { blockId });
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
      const startLocation = document.getElementById(`dutyStartLocation_${empNo}`)?.value || "";
      const endLocation = document.getElementById(`dutyEndLocation_${empNo}`)?.value || "";
      const assignedBus = document.getElementById(`dutyAssignedBus_${empNo}`)?.value || "";

      const startMin = timeStrToMin(dutyStart);
      const endMin = timeStrToMin(dutyEnd);

      if (Number.isNaN(startMin) || Number.isNaN(endMin)) {
        showError("Duty start and end are required. Use HH:MM format, including 24+ time like 27:00.");
        return;
      }

      if (startMin >= endMin) {
        showError("Duty end must be later than duty start.");
        return;
      }

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

        const bs = timeStrToMin(startValue);
        const be = timeStrToMin(endValue);

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

      try {
        const payload = {
          serviceDate: getSelectedDate(),
          driverEmployeeNumber: empNo,
          driverName: String(driver.displayName || driver.firstName || "").trim(),
          startMin,
          endMin,
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
          await addDutySpan(payload);
        }

        formWrap.style.display = "none";
        formWrap.dataset.editingSpanId = "";
      } catch (e) {
        showError(e?.message || "Failed to save duty span.");
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

      const ok = confirm("Delete this duty span?");
      if (!ok) return;

      try {
        await deleteDutySpan(spanId);
      } catch (e) {
        showError(e?.message || "Failed to delete duty span.");
      }
    };
  });
}

const unassignButtons = detailPanelEl.querySelectorAll("[data-unassign-block]");

unassignButtons.forEach((btn) => {
  btn.onclick = async (e) => {
    e.preventDefault();
    e.stopPropagation();

    const blockId = String(btn.getAttribute("data-unassign-block") || "");
    console.log("UNASSIGN CLICK", { blockId });

    if (!blockId) return;

    const ok = confirm("Unassign this job?");
    if (!ok) return;

    try {
      await unassignBlockFromDriver(blockId);
      console.log("UNASSIGNED OK", { blockId });
    } catch (e) {
      console.error("UNASSIGN ERROR", e);
      showError(e?.message || "Failed to unassign job.");
    }
  };
});
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
    .map((span) => {
      const startMin = Number(span.startMin || 0);
      const endMin = Number(span.endMin || 0);
      const left = (startMin / SLOT_MINUTES) * slotWidth;
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
            ${minToTimeStr(startMin)}-${minToTimeStr(endMin)}
          </div>
        </div>
      `;
    })
    .join("");
}

function renderAssignedBlocksForDriver(empNo) {
  const assignedBlocks = getAssignedBlocksForDriver(empNo);

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
    .map((block) => {
      const startMin = Number(block.startMin ?? block.startMinutes ?? 0);
      const endMin = Number(block.endMin ?? block.endMinutes ?? 0);

      const left = (startMin / SLOT_MINUTES) * slotWidth;
      const width = ((endMin - startMin) / SLOT_MINUTES) * slotWidth;

      const groupId = block.jobGroupId || getGroupName(block) || "default";
      const colors = getGroupColors(groupId);
      const groupName = getGroupName(block);

      const blockWidth = Math.max(120, width);

      const label = groupName;

      return `
        <div
          title="${escapeHtml(groupName)} · ${minToTimeStr(startMin)} - ${minToTimeStr(endMin)}"
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
            padding:0 5px;
            color:#ffffff;
            font-size:10px;
            font-weight:700;
          "
        >
          ${escapeHtml(label)}
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

  const slotIndex = Math.floor(nowMin / SLOT_MINUTES);
  const minuteOffsetInSlot = nowMin % SLOT_MINUTES;

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
                  width:68px;
                  min-width:68px;
                  max-width:68px;
                  font-size:8px;
                  line-height:1;
                  border-radius:999px;
                  padding:0 16px 0 6px;
                  border:1px solid #d1d5db;
                  background:${hasSpan ? "#fff" : "#f3f4f6"};
                  color:${hasSpan ? "#111" : "#9ca3af"};
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
  attachDispatchStatusEvents();
  renderNowLine();
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

      try {
        await Promise.all(
          spans.map((span) => updateDutySpanDispatchStatus(span.id, nextStatus))
        );
      } catch (err) {
        console.error("Dispatch status update error:", err);
        showError(err?.message || "Failed to update dispatch status.");
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

      if (!draggedBlockId) return;

      const block = (blocksCache || []).find(
        (b) => String(b.id) === String(draggedBlockId)
      );
      if (!block) return;

      const driverEmpNo = cell.getAttribute("data-driver-empno") || "";

      const blockStart = Number(block.startMin ?? block.startMinutes ?? 0);
      const blockEnd = Number(block.endMin ?? block.endMinutes ?? 0);

      if (driverHasAssignedBlockOverlap(driverEmpNo, blockStart, blockEnd, draggedBlockId)) {
        setTimelineRowDropState(driverEmpNo, "overlap");
      } else {
        setTimelineRowDropState(driverEmpNo, "");
      }
    };

    cell.ondrop = async (e) => {
      e.preventDefault();

      const blockId = e.dataTransfer.getData("blockId");
      if (!blockId) return;

      const start = Number(e.dataTransfer.getData("start"));
      const end = Number(e.dataTransfer.getData("end"));

      const driverEmpNo = cell.getAttribute("data-driver-empno") || "";
      const driverName = cell.getAttribute("data-driver-name") || "";
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
        alert("Block not found");
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

      alert(
        `This job overlaps an existing assigned job (${minToTimeStr(existingStart)}-${minToTimeStr(existingEnd)}) for this driver.`
      );
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
      alert(
        "This job is outside the driver's duty span. Please extend or edit the duty span first."
      );
      draggedBlockId = "";
      clearAllTimelineRowDropStates();
      return;
    }

    if (matchingDutySpans.length > 1) {
      alert(
        "This job matches more than one duty span for this driver. Please fix the duty spans before assigning."
      );
      draggedBlockId = "";
      clearAllTimelineRowDropStates();
      return;
    }

    const matchedDutySpan = matchingDutySpans[0];

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
      } catch (err) {
        console.error("Failed to assign block:", err);
        alert("Failed to assign block");
      }
    };
  });
}

function getBusLabel(block) {
  const match = String(block.notes || "").match(/Bus\s+(\d+)/i);
  return match ? `Bus ${match[1]}` : "";
}

function renderUnassignedJobs(blocks, selectedDate) {
  if (!unassignedJobsPanelBodyEl) return;

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
          title="${escapeHtml(groupName)} ${escapeHtml(timeText)}"
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

function applyZoom(newSlotWidth) {
  const oldScrollLeft = timelineOuterEl.scrollLeft;
  const oldSlotWidth = slotWidth;
  const oldCenterRatio =
    oldSlotWidth > 0
      ? oldScrollLeft / (TOTAL_SLOTS * oldSlotWidth)
      : 0;

  slotWidth = Math.max(8, Math.min(120, newSlotWidth));

  buildTimelineHeader();
  syncDriverSpacerHeight();
  renderDrivers();

  const newScrollLeft = oldCenterRatio * (TOTAL_SLOTS * slotWidth);
  timelineOuterEl.scrollLeft = newScrollLeft;

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
  } else {
    const isSelected = String(selectedDriverEmpNo) === String(empNo);
    row.style.background = isSelected ? "#eef6ff" : "#fff";
  }
}

function setupTimelineWheelZoom() {
  if (!timelineOuterEl) return;

  timelineOuterEl.addEventListener(
    "wheel",
    (e) => {
      if (!e.ctrlKey) return;

      e.preventDefault();

      if (e.deltaY < 0) {
        applyZoom(slotWidth + 8);
      } else {
        applyZoom(slotWidth - 8);
      }
    },
    { passive: false }
  );
}

function driverHasDutySpanCoverage(empNo, startMin, endMin) {
  const spans = getDriverDutySpans(empNo);

  return spans.some((span) => {
    const spanStart = Number(span.startMin || 0);
    const spanEnd = Number(span.endMin || 0);

    return startMin >= spanStart && endMin <= spanEnd;
  });
}

function setupSyncedScroll() {
  if (!driversScrollEl || !timelineOuterEl) return;

  timelineOuterEl.addEventListener("scroll", () => {
    driversScrollEl.scrollTop = timelineOuterEl.scrollTop;
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

  if (unassignedJobsPanelEl) {
    unassignedJobsPanelEl.style.display = openPanel ? "flex" : "none";
  }

  loadUnassignedJobsForDate(selectedDate);
  startDutySpanListener(selectedDate);
}

loadBtn.onclick = () => {
  loadDispatchForDate(dispatchDateEl.value, { openPanel: true });
};

dispatchDateEl.onchange = () => {
  loadDispatchForDate(dispatchDateEl.value, { openPanel: false });
};

if (closeUnassignedJobsPanelBtn) {
  closeUnassignedJobsPanelBtn.onclick = () => {
    if (unassignedJobsPanelEl) {
      unassignedJobsPanelEl.style.display = "none";
    }
  };
}

zoomOutBtn.onclick = () => applyZoom(Math.max(2, slotWidth - 8));
zoomResetBtn.onclick = () => applyZoom(52);
zoomInBtn.onclick = () => applyZoom(slotWidth + 8);

driverSortByEl.onchange = () => {
  renderDrivers();
};

workingDriversOnlyEl.onchange = () => {
  renderDrivers();
};

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
setupTimelineWheelZoom();

if (nowLineTimer) {
  clearInterval(nowLineTimer);
}

nowLineTimer = setInterval(() => {
  renderNowLine();
}, 60000);

console.log("BOTTOM OF DISPATCH FILE REACHED");
loadDispatchForDate(today, { openPanel: false });

}