import { listenDutySpansByDateRange } from "./db.js";
import { state } from "./state.js";
import { els } from "./ui.js";
import { escapeHtml } from "./utils.js";

const COMPANY_MIN_REST_MINUTES = 8 * 60;
const STYLE_ID = "fatigueTrackingStyles";

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const link = document.createElement("link");
  link.id = STYLE_ID;
  link.rel = "stylesheet";
  link.href = "./styles/fatigue_tracking.css?v=1";
  document.head.appendChild(link);
}

function localDate(offsetDays = 0) {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + offsetDays);
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

function shiftDate(value, days) {
  const [year, month, day] = String(value).split("-").map(Number);
  const date = new Date(year, month - 1, day, 12);
  date.setDate(date.getDate() + days);
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

function absoluteMinute(duty, which) {
  const [year, month, day] = String(duty.serviceDate || "").split("-").map(Number);
  const base = new Date(year, month - 1, day, 0, 0, 0, 0).getTime() / 60000;
  const minute = which === "end" ? duty.endMin : duty.startMin;
  return base + Number(minute ?? 0);
}

function timeLabel(value) {
  const minute = Number(value || 0);
  const day = Math.floor(minute / 1440);
  const clockMinute = ((minute % 1440) + 1440) % 1440;
  const hour = Math.floor(clockMinute / 60);
  const min = clockMinute % 60;
  return `${String(hour).padStart(2, "0")}:${String(min).padStart(2, "0")}${day > 0 ? ` +${day}` : ""}`;
}

function dateLabel(value) {
  if (!value) return "—";
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("en-AU", { weekday: "short", day: "2-digit", month: "short" })
    .format(new Date(year, month - 1, day));
}

function durationLabel(minutes) {
  if (!Number.isFinite(minutes)) return "—";
  const safe = Math.max(0, Math.round(minutes));
  return `${Math.floor(safe / 60)}h ${String(safe % 60).padStart(2, "0")}m`;
}

function dutyStatus(value) {
  return String(value || "Pending").trim().toLowerCase();
}

function scheduledWorkMinutes(duty) {
  const span = Math.max(0, Number(duty.endMin || 0) - Number(duty.startMin || 0));
  const rest = (Array.isArray(duty.breaks) ? duty.breaks : []).reduce((sum, item) =>
    sum + Math.max(0, Number(item.endMin || 0) - Number(item.startMin || 0)), 0);
  return Math.max(0, span - rest);
}

function dateDistance(first, second) {
  const [fy, fm, fd] = String(first).split("-").map(Number);
  const [sy, sm, sd] = String(second).split("-").map(Number);
  return Math.round((Date.UTC(sy, sm - 1, sd) - Date.UTC(fy, fm - 1, fd)) / 86400000);
}

export function calculateStandardHoursAlerts(duties, range) {
  const active = (duties || []).filter((duty) => duty.deleted !== true && !["cancelled", "canceled"].includes(dutyStatus(duty.dispatchStatus)));
  const byDriver = new Map();
  active.forEach((duty) => {
    const employeeNumber = String(duty.driverEmployeeNumber || "").trim();
    if (!employeeNumber) return;
    if (!byDriver.has(employeeNumber)) byDriver.set(employeeNumber, []);
    byDriver.get(employeeNumber).push(duty);
  });
  const alerts = [];
  byDriver.forEach((driverDuties, employeeNumber) => {
    const name = String(driverDuties[0]?.driverName || employeeNumber).trim();
    const days = [...new Set(driverDuties.map((duty) => String(duty.serviceDate || "")))].sort();
    const workByDate = new Map();
    driverDuties.forEach((duty) => workByDate.set(duty.serviceDate, (workByDate.get(duty.serviceDate) || 0) + scheduledWorkMinutes(duty)));
    let runStart = 0;
    for (let index = 1; index <= days.length; index += 1) {
      if (index < days.length && dateDistance(days[index - 1], days[index]) === 1) continue;
      const run = days.slice(runStart, index);
      const reviewDate = run[run.length - 1];
      const dailyEdges = run.map((date) => {
        const dayDuties = driverDuties.filter((duty) => duty.serviceDate === date);
        return {
          first: Math.min(...dayDuties.map((duty) => absoluteMinute(duty, "start"))),
          last: Math.max(...dayDuties.map((duty) => absoluteMinute(duty, "end")))
        };
      });
      const has24HourRest = dailyEdges.some((day, edgeIndex) => edgeIndex > 0 && day.first - dailyEdges[edgeIndex - 1].last >= 24 * 60);
      if (run.length >= 7 && !has24HourRest && reviewDate >= range.start && reviewDate <= range.end) alerts.push({ employeeNumber, driverName: name, date: reviewDate, rule: "24-hour rest in 7 days", detail: `${run.length} consecutive scheduled working days with no 24-hour continuous rest between duties.` });
      runStart = index;
    }
    days.filter((date) => date >= range.start && date <= range.end).forEach((date) => {
      const work7 = days.filter((item) => dateDistance(item, date) >= 0 && dateDistance(item, date) < 7).reduce((sum, item) => sum + (workByDate.get(item) || 0), 0);
      const work14 = days.filter((item) => dateDistance(item, date) >= 0 && dateDistance(item, date) < 14).reduce((sum, item) => sum + (workByDate.get(item) || 0), 0);
      if (work7 > 72 * 60) alerts.push({ employeeNumber, driverName: name, date, rule: "72-hour limit in 7 days", detail: `${durationLabel(work7)} scheduled work in the preceding 7 days.` });
      if (work14 > 144 * 60) alerts.push({ employeeNumber, driverName: name, date, rule: "144-hour limit in 14 days", detail: `${durationLabel(work14)} scheduled work in the preceding 14 days.` });
    });
  });
  const unique = new Map();
  alerts.forEach((item) => unique.set(`${item.employeeNumber}|${item.rule}`, item));
  return [...unique.values()].sort((a, b) => b.date.localeCompare(a.date));
}

export function calculateTurnarounds(duties) {
  const active = (duties || []).filter((duty) =>
    duty.deleted !== true && !["cancelled", "canceled"].includes(dutyStatus(duty.dispatchStatus))
  );
  const byDriver = new Map();

  active.forEach((duty) => {
    const employeeNumber = String(duty.driverEmployeeNumber || "").trim();
    if (!employeeNumber) return;
    if (!byDriver.has(employeeNumber)) byDriver.set(employeeNumber, []);
    byDriver.get(employeeNumber).push(duty);
  });

  const results = [];
  byDriver.forEach((driverDuties, employeeNumber) => {
    driverDuties.sort((a, b) => absoluteMinute(a, "start") - absoluteMinute(b, "start"));

    const dutiesByDay = new Map();
    driverDuties.forEach((duty) => {
      const serviceDate = String(duty.serviceDate || "");
      if (!dutiesByDay.has(serviceDate)) dutiesByDay.set(serviceDate, []);
      dutiesByDay.get(serviceDate).push(duty);
    });

    const workDays = [...dutiesByDay.entries()]
      .sort(([dateA], [dateB]) => dateA.localeCompare(dateB))
      .map(([serviceDate, dayDuties]) => {
        dayDuties.sort((a, b) => absoluteMinute(a, "start") - absoluteMinute(b, "start"));

        for (let index = 1; index < dayDuties.length; index += 1) {
          const previous = dayDuties[index - 1];
          const next = dayDuties[index];
          const overlapMinutes = absoluteMinute(previous, "end") - absoluteMinute(next, "start");
          if (overlapMinutes > 0) {
            results.push({
              employeeNumber,
              driverName: String(next.driverName || previous.driverName || employeeNumber).trim(),
              previous,
              next,
              restMinutes: -overlapMinutes,
              status: "overlap",
              shortfallMinutes: COMPANY_MIN_REST_MINUTES + overlapMinutes
            });
          }
        }

        const firstDuty = dayDuties.reduce((first, duty) =>
          absoluteMinute(duty, "start") < absoluteMinute(first, "start") ? duty : first
        );
        const lastDuty = dayDuties.reduce((last, duty) =>
          absoluteMinute(duty, "end") > absoluteMinute(last, "end") ? duty : last
        );
        return { serviceDate, firstDuty, lastDuty };
      });

    for (let index = 1; index < workDays.length; index += 1) {
      const previous = workDays[index - 1].lastDuty;
      const next = workDays[index].firstDuty;
      const restMinutes = absoluteMinute(next, "start") - absoluteMinute(previous, "end");
      const status = restMinutes < 0 ? "overlap" : restMinutes < COMPANY_MIN_REST_MINUTES ? "breach" : "compliant";
      results.push({
        employeeNumber,
        driverName: String(next.driverName || previous.driverName || employeeNumber).trim(),
        previous,
        next,
        restMinutes,
        status,
        shortfallMinutes: Math.max(0, COMPANY_MIN_REST_MINUTES - restMinutes)
      });
    }
  });
  return results.sort((a, b) => absoluteMinute(a.next, "start") - absoluteMinute(b.next, "start"));
}

function renderPage(results, standardAlerts, range, search = "", filter = "all") {
  const normalizedSearch = search.trim().toLowerCase();
  const visible = results.filter((item) => {
    if (item.next.serviceDate < range.start || item.next.serviceDate > range.end) return false;
    if (filter !== "all" && item.status !== filter) return false;
    if (!normalizedSearch) return true;
    return [item.driverName, item.employeeNumber, item.previous.dutyNumber, item.next.dutyNumber]
      .join(" ").toLowerCase().includes(normalizedSearch);
  });
  const inRange = results.filter((item) => item.next.serviceDate >= range.start && item.next.serviceDate <= range.end);
  const counts = {
    drivers: new Set(inRange.map((item) => item.employeeNumber)).size,
    checks: inRange.length,
    compliant: inRange.filter((item) => item.status === "compliant").length,
    breach: inRange.filter((item) => item.status === "breach").length,
    overlap: inRange.filter((item) => item.status === "overlap").length
  };

  const metrics = document.getElementById("ftMetrics");
  if (metrics) metrics.innerHTML = `
    <article><span>Drivers reviewed</span><strong>${counts.drivers}</strong></article>
    <article><span>Turnarounds checked</span><strong>${counts.checks}</strong></article>
    <article class="good"><span>8 hours or more</span><strong>${counts.compliant}</strong></article>
    <article class="bad"><span>Under 8 hours</span><strong>${counts.breach}</strong></article>
    <article class="bad"><span>Duty overlaps</span><strong>${counts.overlap}</strong></article>`;

  const body = document.getElementById("ftRows");
  if (!body) return;
  if (!visible.length) {
    body.innerHTML = `<tr><td colspan="8"><div class="ft-empty"><strong>No matching turnaround records</strong><span>Turnaround checks appear when a driver has work on consecutive working days.</span></div></td></tr>`;
    return;
  }

  body.innerHTML = visible.map((item) => {
    const message = item.status === "compliant"
      ? "Company minimum met"
      : item.status === "overlap"
        ? `Duties overlap by ${durationLabel(Math.abs(item.restMinutes))}`
        : `${durationLabel(item.shortfallMinutes)} below company minimum`;
    return `<tr class="ft-row ft-${item.status}">
      <td><strong>${escapeHtml(item.driverName)}</strong><small>${escapeHtml(item.employeeNumber)}</small></td>
      <td><strong>${escapeHtml(item.previous.dutyNumber || "Duty")}</strong><small>${dateLabel(item.previous.serviceDate)} · ${timeLabel(item.previous.startMin)}–${timeLabel(item.previous.endMin)}</small></td>
      <td><strong>${dateLabel(item.previous.serviceDate)}</strong><small>${timeLabel(item.previous.endMin)}</small></td>
      <td class="ft-rest"><strong>${durationLabel(item.restMinutes)}</strong><small>Continuous planned rest</small></td>
      <td><strong>${dateLabel(item.next.serviceDate)}</strong><small>${timeLabel(item.next.startMin)}</small></td>
      <td><strong>${escapeHtml(item.next.dutyNumber || "Duty")}</strong><small>${timeLabel(item.next.startMin)}–${timeLabel(item.next.endMin)}</small></td>
      <td><span class="ft-status ${item.status}">${item.status === "compliant" ? "COMPLIANT" : item.status === "overlap" ? "CONFLICT" : "BREACH"}</span></td>
      <td><strong>${escapeHtml(message)}</strong><small>Company rule: minimum 8h</small></td>
    </tr>`;
  }).join("");

  const standardBody = document.getElementById("ftStandardRows");
  if (standardBody) {
    const matching = standardAlerts.filter((item) => !normalizedSearch || [item.driverName, item.employeeNumber, item.rule].join(" ").toLowerCase().includes(normalizedSearch));
    standardBody.innerHTML = matching.length ? matching.map((item) => `<tr><td><strong>${escapeHtml(item.driverName)}</strong><small>${escapeHtml(item.employeeNumber)}</small></td><td><strong>${escapeHtml(item.rule)}</strong><small>General Standard Hours</small></td><td>${dateLabel(item.date)}</td><td><span class="ft-status breach">REVIEW</span></td><td><strong>${escapeHtml(item.detail)}</strong></td></tr>`).join("") : `<tr><td colspan="5"><div class="ft-empty ft-empty-small"><strong>No General Standard Hours alerts</strong></div></td></tr>`;
  }
}

export function renderFatigueTrackingPage() {
  ensureStyles();
  const root = els.contentArea;
  const range = { start: localDate(0), end: localDate(14) };
  let results = [];
  let standardAlerts = [];

  root.innerHTML = `<section class="ft-page">
    <header class="ft-head"><div><span>SAFETY & COMPLIANCE</span><h1>Fatigue Tracking</h1><p>Review planned work, consecutive-duty rest and company turnaround compliance.</p></div><div class="ft-rule"><small>COMPANY TURNAROUND</small><strong>Minimum 8 hours</strong></div></header>
    <section class="ft-controls">
      <label><span>From</span><input id="ftStart" type="date" value="${range.start}"></label>
      <label><span>To</span><input id="ftEnd" type="date" value="${range.end}"></label>
      <label class="ft-search"><span>Search driver or duty</span><input id="ftSearch" type="search" placeholder="Name, employee number or duty"></label>
      <label><span>Status</span><select id="ftFilter"><option value="all">All statuses</option><option value="breach">Under 8 hours</option><option value="overlap">Duty conflicts</option><option value="compliant">Compliant</option></select></label>
      <button id="ftRefresh" type="button">Refresh</button>
    </section>
    <section id="ftMetrics" class="ft-metrics"></section>
    <div class="ft-note"><strong>Rule profile:</strong> General Standard Hours — Solo Driver, plus the company 8-hour turnaround rule. This planning view uses scheduled duties and does not replace a work diary.</div>
    <section class="ft-table-card ft-standard-card"><div class="ft-table-head"><div><h2>General Standard Hours alerts</h2><span>Consecutive workdays and rolling 7-day and 14-day scheduled work.</span></div></div><div class="ft-table-wrap"><table><thead><tr><th>Driver</th><th>Rule</th><th>Review date</th><th>Result</th><th>Explanation</th></tr></thead><tbody id="ftStandardRows"><tr><td colspan="5"><div class="ft-empty ft-empty-small">Loading checks…</div></td></tr></tbody></table></div></section>
    <section class="ft-table-card"><div class="ft-table-head"><div><h2>Turnaround review</h2><span>Compares each working day's final finish with the driver's next working-day start. Same-day overlaps appear as conflicts.</span></div><span class="ft-live"><i></i> Live schedule data</span></div>
      <div class="ft-table-wrap"><table><thead><tr><th>Driver</th><th>Previous duty</th><th>Finished</th><th>Rest available</th><th>Next start</th><th>Next duty</th><th>Result</th><th>Explanation</th></tr></thead><tbody id="ftRows"><tr><td colspan="8"><div class="ft-empty">Loading fatigue records…</div></td></tr></tbody></table></div>
    </section>
  </section>`;

  const startInput = document.getElementById("ftStart");
  const endInput = document.getElementById("ftEnd");
  const searchInput = document.getElementById("ftSearch");
  const filterInput = document.getElementById("ftFilter");

  const redraw = () => renderPage(results, standardAlerts, range, searchInput.value, filterInput.value);
  const subscribe = () => {
    if (state.unsubscribeFatigueTracking) state.unsubscribeFatigueTracking();
    range.start = startInput.value;
    range.end = endInput.value;
    if (!range.start || !range.end || range.end < range.start) {
      document.getElementById("ftRows").innerHTML = `<tr><td colspan="8"><div class="ft-empty"><strong>Select a valid date range</strong></div></td></tr>`;
      return;
    }
    state.unsubscribeFatigueTracking = listenDutySpansByDateRange(
      shiftDate(range.start, -14), range.end,
      (duties) => { results = calculateTurnarounds(duties); standardAlerts = calculateStandardHoursAlerts(duties, range); redraw(); },
      (error) => { document.getElementById("ftRows").innerHTML = `<tr><td colspan="8"><div class="ft-empty"><strong>Unable to load fatigue data</strong><span>${escapeHtml(error?.message || "Please try again.")}</span></div></td></tr>`; }
    );
  };

  startInput.onchange = subscribe;
  endInput.onchange = subscribe;
  searchInput.oninput = redraw;
  filterInput.onchange = redraw;
  document.getElementById("ftRefresh").onclick = subscribe;
  subscribe();
}
