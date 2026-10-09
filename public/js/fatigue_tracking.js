import { listenDutySpansByDateRange, listenEmployees } from "./db.js";
import { state } from "./state.js";
import { els } from "./ui.js";
import { escapeHtml } from "./utils.js";
import { validDutyRecord, plannedCountingPeriods, scheduledWorkRisks, calculateTurnarounds, mergeIntervals, workIntervals, minutesWithin, shortWindowWork, shortWindowAssessment, shiftServiceDate, calculatePlannedRestChecks, serviceMinute } from "./fatigue_schedule.js";
export { calculateTurnarounds } from "./fatigue_schedule.js";

const COMPANY_MIN_REST_MINUTES = 8 * 60;
const STYLE_ID = "fatigueTrackingStyles";

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const link = document.createElement("link");
  link.id = STYLE_ID;
  link.rel = "stylesheet";
  link.href = "./styles/fatigue_tracking.css?v=2";
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
  const base = Date.UTC(year, month - 1, day) / 60000;
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

export function calculateStandardHoursAlerts(duties, range, employees = null, coverage = null) {
  const byDriver = new Map();
  for (const duty of duties || []) {
    if (duty.deleted === true || ["cancelled", "canceled"].includes(dutyStatus(duty.dispatchStatus))) continue;
    const employeeNumber = String(duty.driverEmployeeNumber || "").trim();
    if (!employeeNumber) continue;
    if (!byDriver.has(employeeNumber)) byDriver.set(employeeNumber, []);
    byDriver.get(employeeNumber).push(duty);
  }
  // Include rostered employee drivers with no duties in the selected range.
  for(const employee of employees || []) {
    if(String(employee.role || employee.employeeType || "").toLowerCase() !== "driver" || String(employee.status || "").toLowerCase() !== "active" || employee.deleted)continue;
    const key=String(employee.employeeNumber || employee.id || "").trim();
    if(key && !byDriver.has(key))byDriver.set(key,[]);
  }
  const alerts = [];
  for (const [employeeNumber, driverDuties] of byDriver) {
    const inRange = driverDuties.filter(d => d.serviceDate >= range.start && d.serviceDate <= range.end);
    if (!inRange.length && !coverage) continue;
    const employeeName=(employees || []).find(e=>String(e.employeeNumber || e.id).trim()===employeeNumber)?.displayName;
    const driverName = String(driverDuties[0]?.driverName || employeeName || employeeNumber).trim();
    const add = (date, rule, detail, result = "REVIEW", observedMinutes = 0, assessment = {}) => alerts.push({employeeNumber, driverName, date, rule, detail, result, observedMinutes, assessment});
    for(const duty of driverDuties)if(!validDutyRecord(duty))add(duty.serviceDate>=range.start && duty.serviceDate<=range.end ? duty.serviceDate : range.end,"Duty data verification","Duty or break times are invalid; correct the records before relying on planned work/rest results.","DATA REVIEW");
    const employee = employees && employees.find(e => String(e.employeeNumber || e.id).trim() === employeeNumber);
    const profile = employees ? employee?.fatigueCategory || "Unknown" : driverDuties[0]?.fatigueCategory || "Standard";
    if (profile.toLowerCase() !== "standard") {
      add(inRange.map(d=>d.serviceDate).sort().at(-1) || range.end, "Hours-option verification", `${profile}: Bus and Coach Standard Hours limits have not been applied. Verify this driver's applicable hours option and work/rest records.`, "DATA REVIEW");
      continue;
    }
    for(const risk of scheduledWorkRisks(driverDuties,coverage)) {
      const affected=inRange.filter(d=>absoluteMinute(d,"end")>risk.start && absoluteMinute(d,"start")<risk.end).sort((a,b)=>b.serviceDate.localeCompare(a.serviceDate))[0];
      if(affected)add(affected.serviceDate,risk.rule,risk.detail,"PLANNED SHORTFALL",risk.rule.startsWith("Planned rest:") ? risk.count : risk.minutes,risk);
    }
    const periods=plannedCountingPeriods(driverDuties,coverage);
    const reviewDates=[...new Set(inRange.map(d=>d.serviceDate))].sort();
    if(!reviewDates.length)reviewDates.push(range.end);
    const latest=reviewDates.at(-1);
    if(!coverage) {
      add(latest,"24-hour / 7-day / 28-day rest verification","Complete loaded schedule coverage is required to calculate planned rest. No active duty span will be treated as no scheduled work within that coverage.","DATA REVIEW");
    } else {
      for(const date of reviewDates) {
        for(const check of calculatePlannedRestChecks(driverDuties,date,coverage,periods)) {
          // Show every shortfall/date and the latest positive totals per driver.
          if(check.result!=="PLANNED PASS" || date===latest)add(date,check.rule,check.detail,check.result,check.count || 0,check);
        }
      }
    }
  }
  const unique = new Map();
  const priority={"PLANNED SHORTFALL":3,"DATA REVIEW":2,"REVIEW":2,"PLANNED PASS":1,"NO SCHEDULED WORK":1};
  for(const item of alerts) {
    const key=`${item.employeeNumber}|${item.rule}|${item.date}`,old=unique.get(key);
    const worseCount=item.rule.startsWith("Planned rest:") ? item.observedMinutes<old?.observedMinutes : item.observedMinutes>old?.observedMinutes;
    if(!old || priority[item.result]>priority[old.result] || (priority[item.result]===priority[old.result] && worseCount))unique.set(key,item);
  }
  return [...unique.values()].sort((a,b) => b.date.localeCompare(a.date));
}

function checkTableCells(item) {
  const a=item.assessment || {},rest=item.rule.startsWith("Planned rest:"),work=item.rule.startsWith("Planned work:");
  let label=item.rule,planned="—",required="—";
  if(rest) {
    label=a.window===1440 ? "Continuous rest · 24 hours" : a.window===10080 ? "Night rest · 7 days" : "Full-day rest · 28 days";
    if(Number.isFinite(a.count))planned=a.window===1440 ? durationLabel(a.count) : `${a.count} ${a.window===10080 ? "night rests" : "full-day rests"}`;
    required=a.window===1440 ? "At least 7h continuous" : a.window===10080 ? "At least 6 night rests" : "At least 4 × 24h rests";
  } else if(work) {
    label=a.window===1440 ? "Work · 24 hours" : "Work · 28 days";
    if(Number.isFinite(a.minutes))planned=durationLabel(a.minutes);
    if(Number.isFinite(a.maximum))required=`At most ${durationLabel(a.maximum)}`;
  } else if(Number.isFinite(a.minutes)) {
    label=`Work / breaks · ${a.window===330 ? "5½" : a.window/60} hours`;
    planned=`${durationLabel(a.minutes)} work / ${durationLabel(a.restMinutes)} rest`;
    required=`Max ${durationLabel(a.maximum)} work / min ${durationLabel(a.required)} rest`;
  }
  let period=item.result==="NO SCHEDULED WORK" ? "No work period" : "Not available";
  if(Number.isFinite(a.start) && Number.isFinite(a.end)) {
    const format=minute=>new Date(minute*60000).toISOString().slice(0,16).replace("T"," ");
    period=`<span>${escapeHtml(format(a.start))}</span><span>to ${escapeHtml(format(a.end))}</span>`;
  }
  if(item.result==="NO SCHEDULED WORK")planned="No work scheduled";
  const labels={"PLANNED PASS":"Meets planned minimum","PLANNED SHORTFALL":"Outside planned limit","DATA REVIEW":"Needs more information","NO SCHEDULED WORK":"No scheduled work","REVIEW":"Review required"};
  const tone=["PLANNED PASS","NO SCHEDULED WORK"].includes(item.result) ? "compliant" : item.result==="PLANNED SHORTFALL" ? "breach" : "review";
  return {label,planned,required,period,result:labels[item.result] || item.result || "Review required",tone};
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
  } else {

  body.innerHTML = visible.map((item) => {
    const message = item.status === "compliant"
      ? "Scheduled company gap met"
      : item.status === "overlap"
        ? `Duties overlap by ${durationLabel(Math.abs(item.restMinutes))}`
        : `${durationLabel(item.shortfallMinutes)} below company minimum`;
    return `<tr class="ft-row ft-${item.status}">
      <td><strong>${escapeHtml(item.driverName)}</strong><small>${escapeHtml(item.employeeNumber)}</small></td>
      <td><strong>${escapeHtml(item.previous.dutyNumber || "Duty")}</strong><small>${dateLabel(item.previous.serviceDate)} · ${timeLabel(item.previous.startMin)}–${timeLabel(item.previous.endMin)}</small></td>
      <td><strong>${dateLabel(item.previous.serviceDate)}</strong><small>${timeLabel(item.previous.endMin)}</small></td>
      <td class="ft-rest"><strong>${durationLabel(item.restMinutes)}</strong><small>Planned rest between duty spans</small></td>
      <td><strong>${dateLabel(item.next.serviceDate)}</strong><small>${timeLabel(item.next.startMin)}</small></td>
      <td><strong>${escapeHtml(item.next.dutyNumber || "Duty")}</strong><small>${timeLabel(item.next.startMin)}–${timeLabel(item.next.endMin)}</small></td>
      <td><span class="ft-status ${item.status}">${item.status === "compliant" ? "COMPANY GAP MET" : item.status === "overlap" ? "CONFLICT" : "UNDER COMPANY MINIMUM"}</span></td>
      <td><strong>${escapeHtml(message)}</strong><small>Company rule: minimum 8h</small></td>
    </tr>`;
  }).join("");
  }

  const standardBody = document.getElementById("ftStandardRows");
  if (standardBody) {
    const matching = standardAlerts.filter((item) => !normalizedSearch || [item.driverName, item.employeeNumber, item.rule].join(" ").toLowerCase().includes(normalizedSearch));
    matching.sort((a,b)=>a.driverName.localeCompare(b.driverName) || a.employeeNumber.localeCompare(b.employeeNumber) || b.date.localeCompare(a.date));
    standardBody.innerHTML = matching.length ? matching.map(item=>{
      const cells=checkTableCells(item);
      return `<tr><td class="ft-driver-cell"><strong>${escapeHtml(item.driverName)}</strong><small>Employee ${escapeHtml(item.employeeNumber)}</small></td><td><strong>${escapeHtml(cells.label)}</strong></td><td class="ft-review-date">${dateLabel(item.date)}</td><td class="ft-period">${cells.period}</td><td class="ft-value"><strong>${escapeHtml(cells.planned)}</strong></td><td><span>${escapeHtml(cells.required)}</span></td><td><span class="ft-status ${cells.tone}">${escapeHtml(cells.result)}</span></td><td><details class="ft-check-details"><summary>View calculation</summary><p>${escapeHtml(item.detail)}</p></details></td></tr>`;
    }).join("") : `<tr><td colspan="8"><div class="ft-empty ft-empty-small"><strong>No matching work and rest checks</strong></div></td></tr>`;
  }
}

export function renderFatigueTrackingPage() {
  ensureStyles();
  const root = els.contentArea;
  const range = { start: localDate(0), end: localDate(14) };
  let results = [];
  let standardAlerts = [];
  let employeeRecords = [];
  let loadedDuties = [];
  let scheduleReady = false;

  root.innerHTML = `<section class="ft-page">
    <header class="ft-head"><div><span>SAFETY & COMPLIANCE</span><h1>Fatigue Tracking</h1><p>Review planned work, consecutive-duty rest and company turnaround compliance.</p></div><div class="ft-rule"><small>COMPANY TURNAROUND</small><strong>Minimum 8 hours</strong></div></header>
    <section class="ft-controls">
      <label><span>From</span><input id="ftStart" type="date" value="${range.start}"></label>
      <label><span>To</span><input id="ftEnd" type="date" value="${range.end}"></label>
      <label class="ft-search"><span>Search driver or duty</span><input id="ftSearch" type="search" placeholder="Name, employee number or duty"></label>
      <label><span>Status</span><select id="ftFilter"><option value="all">All statuses</option><option value="breach">Under 8 hours</option><option value="overlap">Duty conflicts</option><option value="compliant">Company gap met</option></select></label>
      <button id="ftRefresh" type="button">Refresh</button>
    </section>
    <section id="ftMetrics" class="ft-metrics"></section>
    <div class="ft-note"><strong>Rule profile:</strong> Standard Hours — Solo Driver in the Bus and Coach Sector, plus the company 8-hour turnaround rule. A passed duty check does not establish fitness to drive or full legal compliance. No active duty span means no scheduled work and is counted as planned rest. Meal/crib entries are non-work rest. Long periods start at the end of qualifying planned rest. Earlier overlapping periods remain active. Incomplete periods cannot produce a rest pass or shortfall. Any other work or changed duty times must be recorded. Scheduled times use the service-date base clock. Confirm the driver’s hours option before applying these limits. Actual elapsed time across daylight-saving changes and actual stationary rest require work-diary verification. Minute-precision schedule checks do not apply written-work-diary rounding or constitute an approved electronic work diary.</div>
    <section class="ft-table-card ft-standard-card"><div class="ft-table-head"><div><h2>Duty-span work and rest checks</h2><span>Work and rest calculated from daily duty spans. No active duty span means planned rest. Periods follow qualifying planned rest; results are planning checks.</span></div></div><div class="ft-table-wrap"><table class="ft-check-table"><thead><tr><th>Driver / employee</th><th>Check</th><th>Review date</th><th>Counting period</th><th>Planned amount</th><th>Requirement</th><th>Result</th><th>Details</th></tr></thead><tbody id="ftStandardRows"><tr><td colspan="8"><div class="ft-empty ft-empty-small">Loading checks…</div></td></tr></tbody></table></div></section>
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
    loadedDuties=[]; scheduleReady=false;
    range.start = startInput.value;
    range.end = endInput.value;
    if (!range.start || !range.end || range.end < range.start) {
      results = []; standardAlerts = []; redraw();
      document.getElementById("ftRows").innerHTML = `<tr><td colspan="8"><div class="ft-empty"><strong>Select a valid date range</strong></div></td></tr>`;
      return;
    }
    results=[]; standardAlerts=[];
    redraw();
    document.getElementById("ftRows").innerHTML=`<tr><td colspan="8">Loading schedule checks…</td></tr>`;
    document.getElementById("ftStandardRows").innerHTML=`<tr><td colspan="8">Loading work and planned rest…</td></tr>`;
    const apply = () => {
      if(!scheduleReady)return;
      const coverage={start:serviceMinute(shiftDate(range.start,-28)),end:serviceMinute(shiftDate(range.end,2))};
      results = calculateTurnarounds(loadedDuties); standardAlerts = calculateStandardHoursAlerts(loadedDuties, range, employeeRecords,coverage); redraw();
    };
    const stopEmployees = listenEmployees(items => {employeeRecords = items || []; apply();}, () => {employeeRecords = []; apply();});
    const stopDuties = listenDutySpansByDateRange(
      shiftDate(range.start, -31), shiftDate(range.end, 1),
      (duties) => { loadedDuties = duties; scheduleReady=true; apply(); },
      (error) => { scheduleReady=false; loadedDuties=[]; results = []; standardAlerts = []; redraw(); document.getElementById("ftStandardRows").innerHTML = `<tr><td colspan="8">Unable to load fatigue data</td></tr>`; document.getElementById("ftRows").innerHTML = `<tr><td colspan="8"><div class="ft-empty"><strong>Unable to load fatigue data</strong><span>${escapeHtml(error?.message || "Please try again.")}</span></div></td></tr>`; }
    );
    state.unsubscribeFatigueTracking = () => {stopEmployees?.(); stopDuties?.();};
  };

  startInput.onchange = subscribe;
  endInput.onchange = subscribe;
  searchInput.oninput = redraw;
  filterInput.onchange = redraw;
  document.getElementById("ftRefresh").onclick = subscribe;
  subscribe();
}
