import {
  collection,
  getDocs
} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";

import { db } from "./firebase.js";
import { els } from "./ui.js";
import { escapeHtml } from "./utils.js";

let jobGroupsPromise = null;

function formatMinutes(value) {
  const minutes = Number(value);
  if (!Number.isFinite(minutes)) return "—";
  const hours = Math.floor(minutes / 60);
  return `${String(hours).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function formatDuration(minutes) {
  const value = Math.max(0, Number(minutes || 0));
  const hours = Math.floor(value / 60);
  const remainder = value % 60;
  if (!hours) return `${remainder} min`;
  if (!remainder) return `${hours} hr${hours === 1 ? "" : "s"}`;
  return `${hours} hr ${remainder} min`;
}

function formatDate(value) {
  if (!value) return "Date not provided";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString("en-AU", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric"
  });
}

function blockStart(block) {
  return Number(block.startMin ?? block.startMinutes ?? 0);
}

function blockEnd(block) {
  return Number(block.endMin ?? block.endMinutes ?? 0);
}

function blockFrom(block) {
  return String(
    block.fromName || block.from || block.pickup || block.startLocation || block.origin || "Start"
  ).trim();
}

function blockTo(block) {
  return String(
    block.toName || block.to || block.dropoff || block.endLocation || block.destination || "Destination"
  ).trim();
}

function blockDirection(block) {
  return String(
    block.routeDirection || block.direction || block.tripDirection ||
    block.runDirection || block.blockType || "Service"
  ).trim();
}

function serviceType(group) {
  const blocks = group.blocks || [];
  const first = blocks[0] || {};
  const last = blocks[blocks.length - 1] || first;
  const directions = blocks.map((block) => blockDirection(block).toLowerCase());
  const hasForward = directions.some((direction) => direction.includes("forward"));
  const hasReturn = directions.some((direction) => direction.includes("return"));
  const legCount = blocks.reduce(
    (total, block) => total + (Array.isArray(block.generatedLegs) ? block.generatedLegs.length : 1),
    0
  );
  const startsWhereItFinishes = blockFrom(first).toLowerCase() === blockTo(last).toLowerCase();

  if (blocks.length > 1 && hasForward && hasReturn) return "Forward + Return";
  if (legCount > 1 && startsWhereItFinishes) return "Loop Service";
  if (legCount > 1) return "Multi-stop";

  const explicitType = String(first.jobType || first.type || first.category || "").trim();
  if (explicitType && explicitType.toLowerCase() !== "loop") return explicitType;
  if (hasReturn && !hasForward) return "Return";
  return "Service";
}

function assignedToDuty(block, dutySpan) {
  const blockDutySpanId = String(block.dutySpanId || "").trim();
  if (blockDutySpanId) return blockDutySpanId === String(dutySpan.id || "").trim();

  const sameDate = String(block.serviceDate || block.date || "").trim() ===
    String(dutySpan.serviceDate || dutySpan.date || "").trim();
  const assignedDriver = String(
    block.assignedDriverEmployeeNumber || block.assignedDriverId || block.driverId || ""
  ).trim();
  const sameDriver = assignedDriver === String(dutySpan.driverEmployeeNumber || "").trim();
  const insideDuty = blockStart(block) >= Number(dutySpan.startMin || 0) &&
    blockEnd(block) <= Number(dutySpan.endMin || 0);
  return sameDate && sameDriver && insideDuty;
}

async function loadJobGroups() {
  if (!jobGroupsPromise) {
    jobGroupsPromise = getDocs(collection(db, "jobGroups"))
      .then((snapshot) => snapshot.docs.map((item) => ({id: item.id, ...item.data()})))
      .catch((error) => {
        console.warn("Unable to load job group names for duty sheet", error);
        return [];
      });
  }
  return jobGroupsPromise;
}

function jobGroupName(block, jobGroups) {
  const directName = String(
    block.jobGroupName || block.groupName || block.schoolName || block.school ||
    block.title || block.name || block.jobName || block.group || ""
  ).trim();
  if (directName) return directName;

  const groupId = String(block.jobGroupId || "").trim();
  const group = jobGroups.find((item) => String(item.id || "") === groupId);
  return String(group?.title || group?.name || group?.clientName || "Assigned service").trim();
}

function groupAssignedBlocks(blocks) {
  const groups = [];
  const paired = new Map();

  blocks.slice().sort((a, b) => blockStart(a) - blockStart(b)).forEach((block) => {
    const pairKey = String(block.routePairId || block.pairId || "").trim();
    if (!pairKey) {
      groups.push({key: `block-${block.id || groups.length}`, blocks: [block]});
      return;
    }

    if (!paired.has(pairKey)) {
      const group = {key: `pair-${pairKey}`, blocks: []};
      paired.set(pairKey, group);
      groups.push(group);
    }
    paired.get(pairKey).blocks.push(block);
  });

  groups.forEach((group) => group.blocks.sort((a, b) => blockStart(a) - blockStart(b)));
  return groups.sort((a, b) => blockStart(a.blocks[0]) - blockStart(b.blocks[0]));
}

function routeStopsHtml(block) {
  const legs = Array.isArray(block.generatedLegs) ? block.generatedLegs : [];
  if (!legs.length) return "";

  const stopRows = [];
  legs.forEach((leg, index) => {
    const from = String(leg.from || "Start").trim();
    const to = String(leg.to || "Destination").trim();
    const startMin = Number.isFinite(Number(leg.startMin)) ? Number(leg.startMin) : null;
    const endMin = Number.isFinite(Number(leg.endMin)) ? Number(leg.endMin) : null;

    if (index === 0) {
      stopRows.push({kind: "depart", location: from, time: startMin});
    }
    stopRows.push({kind: "arrive", location: to, time: endMin});
    if (index < legs.length - 1) {
      const nextStart = Number(legs[index + 1]?.startMin);
      if (Number.isFinite(nextStart) && nextStart !== endMin) {
        stopRows.push({kind: "depart", location: to, time: nextStart});
      }
    }
  });

  return `
    <details class="driver-duty-stops">
      <summary>View ${stopRows.filter((row) => row.kind === "arrive").length} route stops</summary>
      <div class="driver-duty-stop-list">
        ${stopRows.map((row) => `
          <div class="driver-duty-stop ${row.kind}">
            <span>${row.kind === "arrive" ? "Arrive" : "Depart"}</span>
            <strong>${escapeHtml(row.location)}</strong>
            <time>${formatMinutes(row.time)}</time>
          </div>
        `).join("")}
      </div>
    </details>
  `;
}

function jobCardHtml(group, index, total, jobGroups) {
  const first = group.blocks[0];
  const last = group.blocks[group.blocks.length - 1];
  const startMin = Math.min(...group.blocks.map(blockStart));
  const endMin = Math.max(...group.blocks.map(blockEnd));
  const type = serviceType(group);
  const name = jobGroupName(first, jobGroups);
  const overallFrom = blockFrom(first);
  const overallTo = blockTo(last);
  const outwardDestination = blockTo(first);
  const isRoundTrip = type === "Forward + Return";
  const isClosedLoop = type === "Loop Service";

  return `
    <article class="driver-duty-job-card ${type === "Loop Service" ? "loop" : ""}">
      <header class="driver-duty-job-head">
        <div>
          <span class="driver-duty-job-number">Job ${index + 1} of ${total}</span>
          <span class="driver-duty-job-type">${escapeHtml(type)}</span>
        </div>
        <strong>${formatMinutes(startMin)}–${formatMinutes(endMin)}</strong>
      </header>

      <h3>${escapeHtml(name)}</h3>
      ${isRoundTrip ? `
        <div class="driver-duty-route-note">
          <i data-lucide="repeat-2"></i>
          <span>Round trip via <strong>${escapeHtml(outwardDestination)}</strong></span>
        </div>
      ` : isClosedLoop ? `
        <div class="driver-duty-route-note">
          <i data-lucide="rotate-cw"></i>
          <span>Loop returns to the starting location</span>
        </div>
      ` : `
        <div class="driver-duty-route-summary">
          <span><i data-lucide="map-pin"></i>${escapeHtml(overallFrom)}</span>
          <i data-lucide="arrow-right"></i>
          <span><i data-lucide="flag"></i>${escapeHtml(overallTo)}</span>
        </div>
      `}

      ${group.blocks.map((block, blockIndex) => {
        const direction = blockDirection(block);
        const showSection = group.blocks.length > 1 || Array.isArray(block.generatedLegs);
        return `
          <section class="driver-duty-job-section">
            ${showSection ? `
              <div class="driver-duty-direction">
                <span>${escapeHtml(direction || `Part ${blockIndex + 1}`)}</span>
                <time>${formatMinutes(blockStart(block))}–${formatMinutes(blockEnd(block))}</time>
              </div>
            ` : ""}
            <div class="driver-duty-simple-route">
              <div><small>Depart</small><strong>${escapeHtml(blockFrom(block))}</strong><time>${formatMinutes(blockStart(block))}</time></div>
              <div><small>Arrive</small><strong>${escapeHtml(blockTo(block))}</strong><time>${formatMinutes(blockEnd(block))}</time></div>
            </div>
            ${routeStopsHtml(block)}
          </section>
        `;
      }).join("")}
    </article>
  `;
}

function breakCardHtml(breakItem) {
  const type = String(breakItem.type || "").trim().toLowerCase();
  const label = type === "crib" ? "Crib break" : "Meal break";
  const payment = type === "crib" ? "Paid" : "Unpaid";
  return `
    <div class="driver-duty-break-card">
      <span><i data-lucide="coffee"></i></span>
      <div><strong>${label}</strong><small>${escapeHtml(breakItem.location || payment)} · ${payment}</small></div>
      <time>${formatMinutes(breakItem.startMin)}–${formatMinutes(breakItem.endMin)}</time>
    </div>
  `;
}

export async function renderDriverDutySheet({dutySpan, blocks, isAdmin, onYes, onNo, onBack}) {
  const jobGroups = await loadJobGroups();
  const assignedBlocks = (blocks || []).filter((block) => assignedToDuty(block, dutySpan));
  const groupedJobs = groupAssignedBlocks(assignedBlocks);
  const breaks = Array.isArray(dutySpan.breaks)
    ? dutySpan.breaks.slice().sort((a, b) => Number(a.startMin) - Number(b.startMin))
    : [];
  const rawDutyNumber = String(dutySpan.dutyNumber || "").trim();
  const dutyType = String(dutySpan.dutyType || "Charter").trim();
  const isRailReplacement = dutyType === "Rail Replacement";
  const dutyNumber = rawDutyNumber && rawDutyNumber.toLowerCase() !== dutyType.toLowerCase()
    ? rawDutyNumber
    : "Not provided";
  const cancelled = String(dutySpan.dispatchStatus || "") === "Cancelled";

  els.contentArea.innerHTML = `
    <div class="driver-duty-page">
      <header class="driver-duty-hero ${cancelled ? "cancelled" : ""}">
        <button id="driverDutyBack" type="button" class="driver-duty-back"><i data-lucide="arrow-left"></i> Back</button>
        <div class="driver-duty-hero-copy">
          <div class="driver-duty-eyebrow">Your complete shift</div>
          <h2>${escapeHtml(formatDate(dutySpan.serviceDate || dutySpan.date))}</h2>
          <p>${escapeHtml(dutySpan.driverName || dutySpan.driverEmployeeNumber || "Driver")}</p>
        </div>
        <span class="driver-duty-status ${cancelled ? "cancelled" : "confirmed"}">
          ${cancelled ? "Cancelled" : "Confirmed"}
        </span>
      </header>

      <section class="driver-duty-summary card">
        <div><span>Sign on</span><strong>${formatMinutes(dutySpan.startMin)}</strong></div>
        <div><span>Estimated finish</span><strong>${formatMinutes(dutySpan.endMin)}</strong></div>
        <div><span>Duty number</span><strong>${escapeHtml(dutyNumber)}</strong></div>
        <div><span>Duty type</span><strong>${escapeHtml(dutyType)}</strong></div>
        <div><span>Assigned bus</span><strong>${escapeHtml(dutySpan.assignedBus || "Unassigned")}</strong></div>
      </section>

      ${isRailReplacement ? `
        <section class="driver-duty-rail card">
          <div class="driver-duty-rail-details">
            <div><span>Rail Replacement route</span><strong>${escapeHtml(dutySpan.routeNumber || "Route not provided")}</strong></div>
            <div><span>Start station</span><strong>${escapeHtml(dutySpan.startLocation || "Not provided")}</strong></div>
            <div><span>End station</span><strong>${escapeHtml(dutySpan.endLocation || "Not provided")}</strong></div>
          </div>
          ${dutySpan.routePdfUrl ? `<a href="${escapeHtml(dutySpan.routePdfUrl)}" target="_blank" rel="noopener"><i data-lucide="file-text"></i> Open Route Description</a>` : ""}
        </section>
      ` : ""}

      <section class="driver-duty-confirm card">
        <div>
          <h3>Shift confirmation</h3>
          <p>${isRailReplacement && !groupedJobs.length
            ? "Your Yes or No response applies to this complete Rail Replacement duty. Follow the supplied printed shift or route description."
            : `Your Yes or No response applies to this complete duty span and all ${groupedJobs.length} assigned job${groupedJobs.length === 1 ? "" : "s"}.`}</p>
        </div>
        <div class="driver-duty-confirm-actions">
          <button id="yesBtn" type="button" class="driver-duty-yes ${dutySpan.driverAcknowledgment === "Yes" ? "selected" : ""}" ${cancelled ? "disabled" : ""}>Yes</button>
          <button id="noBtn" type="button" class="driver-duty-no ${dutySpan.driverAcknowledgment === "No" ? "selected" : ""}" ${cancelled ? "disabled" : ""}>No</button>
        </div>
      </section>

      ${isRailReplacement && !groupedJobs.length ? "" : `
      <section class="driver-duty-jobs-heading">
        <div>
          <div class="driver-duty-eyebrow">Shift work</div>
          <h2>${groupedJobs.length} assigned job${groupedJobs.length === 1 ? "" : "s"}</h2>
          <p>Complete the jobs in the order shown below.</p>
        </div>
        <span>${formatDuration(Number(dutySpan.endMin || 0) - Number(dutySpan.startMin || 0))} shift</span>
      </section>

      <div class="driver-duty-job-list">
        ${groupedJobs.length
          ? groupedJobs.map((group, index) => {
              const next = groupedJobs[index + 1];
              const gap = next ? blockStart(next.blocks[0]) - Math.max(...group.blocks.map(blockEnd)) : 0;
              return `${jobCardHtml(group, index, groupedJobs.length, jobGroups)}
                ${gap > 0 ? `<div class="driver-duty-gap"><i data-lucide="clock-3"></i><span>${formatDuration(gap)} between Job ${index + 1} and Job ${index + 2}</span></div>` : ""}`;
            }).join("")
          : `<div class="driver-duty-empty card"><i data-lucide="calendar-x"></i><h3>No assigned jobs</h3><p>Your duty span is confirmed, but no jobs are currently assigned.</p></div>`}
      </div>
      `}

      ${breaks.length ? `
        <section class="driver-duty-breaks">
          <div class="driver-duty-eyebrow">Scheduled rest</div>
          <h2>Breaks</h2>
          <div>${breaks.map(breakCardHtml).join("")}</div>
        </section>
      ` : ""}

      <footer class="driver-duty-finish card">
        <div><span><i data-lucide="log-out"></i></span><div><small>Estimated duty finish</small><strong>${formatMinutes(dutySpan.endMin)}</strong></div></div>
        <p>Duty times may change. Follow any updated instructions from Operations.</p>
      </footer>
    </div>
  `;

  window.lucide?.createIcons?.();
  document.getElementById("yesBtn")?.addEventListener("click", onYes);
  document.getElementById("noBtn")?.addEventListener("click", onNo);
  document.getElementById("driverDutyBack")?.addEventListener("click", () => onBack(isAdmin));
}
