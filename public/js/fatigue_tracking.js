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
  link.href = "./styles/fatigue_tracking.css?v=3";
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
  const labels={"PLANNED PASS":"Planned check met","PLANNED SHORTFALL":"Outside planned limit","DATA REVIEW":"Needs more information","NO SCHEDULED WORK":"No scheduled work","REVIEW":"Review required"};
  const tone=["PLANNED PASS","NO SCHEDULED WORK"].includes(item.result) ? "compliant" : item.result==="PLANNED SHORTFALL" ? "breach" : "review";
  return {label,planned,required,period,result:labels[item.result] || item.result || "Review required",tone};
}

export function buildFatigueDriverReviews(alerts, turnarounds, range) {
  const groups = new Map();
  const get = (employeeNumber, driverName) => {
    const key = String(employeeNumber || "").trim();
    if (!groups.has(key)) groups.set(key, {employeeNumber:key, driverName:driverName || key, checks:[], turnarounds:[]});
    return groups.get(key);
  };
  for (const item of alerts) get(item.employeeNumber,item.driverName).checks.push(item);
  for (const item of turnarounds) {
    if (item.next.serviceDate>=range.start && item.next.serviceDate<=range.end) get(item.employeeNumber,item.driverName).turnarounds.push(item);
  }
  return [...groups.values()].map(driver => {
    const checkAlert = driver.checks.some(item=>item.result==="PLANNED SHORTFALL");
    const gapAlert = driver.turnarounds.some(item=>item.status!=="compliant");
    const needsReview = !driver.checks.length || driver.checks.some(item=>["DATA REVIEW","REVIEW"].includes(item.result));
    const off = driver.checks.length>0 && driver.checks.every(item=>item.result==="NO SCHEDULED WORK") && !driver.turnarounds.length;
    driver.tone = checkAlert || gapAlert ? "breach" : needsReview ? "review" : "compliant";
    driver.result = checkAlert || gapAlert ? "Planned alert" : needsReview ? "Review information" : off ? "No scheduled work" : "Planned checks met";
    const workChecks=driver.checks.filter(item=>item.assessment?.window===1440 && Number.isFinite(item.assessment.minutes));
    driver.work24=workChecks.length ? workChecks.reduce((worst,item)=>item.assessment.minutes>worst.assessment.minutes ? item : worst) : null;
    driver.gap=driver.turnarounds.length ? driver.turnarounds.reduce((worst,item)=>item.restMinutes<worst.restMinutes ? item : worst) : null;
    const longRest=driver.checks.filter(item=>[10080,40320].includes(item.assessment?.window));
    driver.history = longRest.some(item=>item.result==="PLANNED SHORTFALL") ? "Rest shortfall" : longRest.some(item=>item.result==="DATA REVIEW") ? "History needed" : longRest.length && longRest.every(item=>item.result==="NO SCHEDULED WORK") ? "No work scheduled" : new Set(longRest.map(item=>item.assessment.window)).size===2 && longRest.every(item=>item.result==="PLANNED PASS") ? "Rest targets met" : "Not available";
    return driver;
  }).sort((a,b)=>a.driverName.localeCompare(b.driverName) || a.employeeNumber.localeCompare(b.employeeNumber));
}

export function renderDriverReview(driver, duties) {
  if (!driver) return `<div class="ft-empty"><strong>Select a driver to review</strong></div>`;
  const checks=driver.checks.slice();
  // Display the work total already attached to the reported rest assessment.
  // This does not introduce a new counting period or an availability estimate.
  for (const window of [1440,40320]) {
    const rest=checks.filter(item=>item.rule.startsWith("Planned rest:") && item.assessment?.window===window && Number.isFinite(item.assessment.minutes));
    for (const item of rest) {
      if(checks.some(existing=>existing.rule===item.assessment.workRule && existing.date===item.date))continue;
      checks.push({...item,rule:item.assessment.workRule,result:item.assessment.minutes>item.assessment.maximum ? "PLANNED SHORTFALL" : "PLANNED PASS",detail:`${durationLabel(item.assessment.minutes)} planned work in ${item.assessment.bounds}; maximum ${durationLabel(item.assessment.maximum)}. This total belongs to the displayed counting period and is not an estimate of how much additional work the driver can accept.`});
    }
  }
  checks.sort((a,b)=>b.date.localeCompare(a.date) || a.rule.localeCompare(b.rule));
  const records=duties.filter(d=>String(d.driverEmployeeNumber || "").trim()===driver.employeeNumber && !d.deleted && !["cancelled","canceled"].includes(dutyStatus(d.dispatchStatus))).sort((a,b)=>a.serviceDate.localeCompare(b.serviceDate) || Number(a.startMin)-Number(b.startMin));
  const workCheckRows=checks.map(item=>{
    const cells=checkTableCells(item),a=item.assessment || {};
    let margin="";
    if(item.rule.startsWith("Planned work:") && Number.isFinite(a.minutes) && Number.isFinite(a.maximum))margin=a.minutes<=a.maximum ? `${durationLabel(a.maximum-a.minutes)} below this period's limit` : `${durationLabel(a.minutes-a.maximum)} over this period's limit`;
    else if(item.rule.startsWith("Planned rest:") && Number.isFinite(a.count))margin=a.window===1440 ? `${durationLabel(Math.abs(a.count-a.required))} ${a.count>=a.required ? "above" : "below"} minimum` : `${Math.abs(a.count-a.required)} rest block${Math.abs(a.count-a.required)===1 ? "" : "s"} ${a.count>=a.required ? "above" : "below"} minimum`;
    return `<tr><td><strong>${escapeHtml(cells.label)}</strong><small>${dateLabel(item.date)}</small></td><td class="ft-period">${cells.period}</td><td class="ft-value"><strong>${escapeHtml(cells.planned)}</strong></td><td>${escapeHtml(cells.required)}</td><td><span class="ft-status ${cells.tone}">${escapeHtml(cells.result)}</span>${margin ? `<small>${escapeHtml(margin)}</small>` : ""}</td><td><details class="ft-check-details"><summary>View calculation</summary><p>${escapeHtml(item.detail)}</p></details></td></tr>`;
  }).join("");
  const gapRows=driver.turnarounds.map(item=>`<tr><td><strong>Company turnaround</strong><small>${dateLabel(item.next.serviceDate)}</small></td><td class="ft-period"><span>${escapeHtml(item.previous.serviceDate)} ${timeLabel(item.previous.endMin)}</span><span>to ${escapeHtml(item.next.serviceDate)} ${timeLabel(item.next.startMin)}</span></td><td><strong>${item.restMinutes<0 ? "Duty overlap" : durationLabel(item.restMinutes)}</strong></td><td>At least 8h</td><td><span class="ft-status ${item.status==="compliant" ? "compliant" : "breach"}">${item.status==="compliant" ? "Company gap met" : item.status==="overlap" ? "Duty conflict" : `${durationLabel(item.shortfallMinutes)} short`}</span></td><td>Final duty to next working-day start</td></tr>`).join("");
  return `<div class="ft-driver-head"><div><h2>${escapeHtml(driver.driverName)}</h2><span>Employee ${escapeHtml(driver.employeeNumber)} · Selected schedule range</span></div><span class="ft-status ${driver.tone}">${escapeHtml(driver.result)}</span></div>
    <div class="ft-table-wrap"><table class="ft-driver-check-table"><thead><tr><th>Check / review date</th><th>Counting period</th><th>Planned amount</th><th>Requirement</th><th>Result / margin</th><th>Details</th></tr></thead><tbody>${workCheckRows}${gapRows || `<tr><td>Company turnaround</td><td colspan="5">No next working-day pair in this range; the 8-hour company gap has not been assessed.</td></tr>`}</tbody></table></div>
    <details class="ft-duty-records"><summary>Duty spans and break records (${records.length})</summary><div class="ft-table-wrap"><table><thead><tr><th>Date</th><th>Duty</th><th>Start → finish</th><th>Meal / crib breaks</th><th>Schedule status</th></tr></thead><tbody>${records.length ? records.map(d=>`<tr><td>${dateLabel(d.serviceDate)}</td><td>${escapeHtml(d.dutyNumber || "Duty")}</td><td>${validDutyRecord(d) ? `${timeLabel(d.startMin)} → ${timeLabel(d.endMin)}` : "Invalid duty/break record"}</td><td>${Array.isArray(d.breaks) && d.breaks.length ? d.breaks.map(b=>`${escapeHtml(b.type || "Break")} ${b.startMin!=null ? timeLabel(b.startMin) : "?"}–${b.endMin!=null ? timeLabel(b.endMin) : "?"}`).join("<br>") : "No recorded breaks"}</td><td>${escapeHtml(d.dispatchStatus || "Pending")}</td></tr>`).join("") : `<tr><td colspan="5">No active duty spans in the loaded review history.</td></tr>`}</tbody></table></div></details>`;
}

function renderPage(results, standardAlerts, range, search = "", filter = "all", view = null) {
  const normalizedSearch = search.trim().toLowerCase();
  const visible = results.filter((item) => {
    if (item.next.serviceDate < range.start || item.next.serviceDate > range.end) return false;
    if (filter !== "all" && item.status !== filter) return false;
    if (!normalizedSearch) return true;
    return [item.driverName, item.employeeNumber, item.previous.dutyNumber, item.next.dutyNumber]
      .join(" ").toLowerCase().includes(normalizedSearch);
  });
  const driverReviews=buildFatigueDriverReviews(standardAlerts,results,range);


  const metrics = document.getElementById("ftMetrics");
  if (metrics) metrics.innerHTML = `<span><strong>${driverReviews.length}</strong> drivers reviewed</span><span><strong>${driverReviews.filter(d=>d.tone==="breach").length}</strong> planned alerts</span><span><strong>${driverReviews.filter(d=>d.tone==="review").length}</strong> need information</span>`;

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
    const reviews=driverReviews;
    const matching=reviews.filter(driver=>{
      const searchMatch=!normalizedSearch || [driver.driverName,driver.employeeNumber,...(view?.duties || []).filter(d=>String(d.driverEmployeeNumber || "").trim()===driver.employeeNumber).map(d=>d.dutyNumber),...driver.checks.map(item=>item.rule),...driver.turnarounds.flatMap(item=>[item.previous.dutyNumber,item.next.dutyNumber])].join(" ").toLowerCase().includes(normalizedSearch);
      const filterMatch=filter==="all" || filter==="breach" && driver.tone==="breach" || filter==="review" && driver.tone==="review" || filter==="overlap" && driver.turnarounds.some(item=>item.status==="overlap") || filter==="compliant" && driver.tone==="compliant";
      return searchMatch && filterMatch;
    });
    standardBody.innerHTML=matching.length ? matching.map(driver=>`<tr><td><strong>${escapeHtml(driver.driverName)}</strong><small>Employee ${escapeHtml(driver.employeeNumber)}</small></td><td><strong>${driver.work24 ? durationLabel(driver.work24.assessment.minutes) : "Not available"}</strong>${driver.work24 ? `<small>${dateLabel(driver.work24.date)}</small>` : ""}</td><td><strong>${driver.gap ? driver.gap.restMinutes<0 ? "Duty overlap" : durationLabel(driver.gap.restMinutes) : "Not assessed"}</strong>${driver.gap ? `<small>${dateLabel(driver.gap.next.serviceDate)}</small>` : ""}</td><td>${escapeHtml(driver.history)}</td><td><span class="ft-status ${driver.tone}">${escapeHtml(driver.result)}</span></td><td><button type="button" class="ft-review-driver" data-employee="${escapeHtml(driver.employeeNumber)}">Review</button></td></tr>`).join("") : `<tr><td colspan="6"><div class="ft-empty ft-empty-small"><strong>No matching drivers</strong></div></td></tr>`;
    if(view)standardBody.querySelectorAll(".ft-review-driver").forEach(button=>button.addEventListener("click",()=>{view.employeeNumber=button.dataset.employee;view.tab="details";view.redraw();}));
    const summaryCount=document.getElementById("ftDriverCounts");
    if(summaryCount)summaryCount.textContent="Planned results for the selected date range";
    const detail=document.getElementById("ftDriverDetail");
    if(detail) {
      const selected=reviews.find(d=>d.employeeNumber===view?.employeeNumber);
      const keepRecordsOpen=detail.dataset.employeeNumber===selected?.employeeNumber && detail.querySelector(".ft-duty-records")?.open;
      detail.innerHTML=renderDriverReview(selected,view?.duties || []);
      detail.dataset.employeeNumber=selected?.employeeNumber || "";
      const records=detail.querySelector(".ft-duty-records");
      if(records)records.open=Boolean(keepRecordsOpen);
    }
    const overview=document.getElementById("ftSummaryPanel"),detailPanel=document.getElementById("ftDetailPanel");
    if(overview && detailPanel) {
      overview.hidden=view?.tab==="details";detailPanel.hidden=!overview.hidden;
      document.getElementById("ftSummaryTab").setAttribute("aria-selected",String(!overview.hidden));
      document.getElementById("ftDetailTab").setAttribute("aria-selected",String(!detailPanel.hidden));
    }
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
  const view={employeeNumber:"",tab:"summary",duties:[],redraw:null};

  root.innerHTML = `<section class="ft-page">
    <header class="ft-head"><div><span>SAFETY & COMPLIANCE</span><h1>Fatigue Review</h1><p>Driver summary → Work and rest checks → Duty and break records</p></div><div class="ft-rule"><small>COMPANY TURNAROUND</small><strong>Minimum 8 hours</strong></div></header>
    <section class="ft-controls">
      <label><span>From</span><input id="ftStart" type="date" value="${range.start}"></label>
      <label><span>To</span><input id="ftEnd" type="date" value="${range.end}"></label>
      <label class="ft-search"><span>Search driver or duty</span><input id="ftSearch" type="search" placeholder="Name, employee number or duty"></label>
      <label><span>Review status</span><select id="ftFilter"><option value="all">All statuses</option><option value="breach">Planned alerts</option><option value="review">Needs information</option><option value="overlap">Duty conflicts</option><option value="compliant">Planned checks met / no work</option></select></label>
      <button id="ftRefresh" type="button">Refresh</button>
    </section>
    <section id="ftMetrics" class="ft-metrics"></section>
    <div class="ft-note"><strong>Planned schedule assessment.</strong> Meal/crib breaks and gaps between active duties count as planned rest. Actual work, stationary rest and fitness to drive still require verification. <details><summary>Calculation scope</summary><p>Bus and Coach Standard Hours plus the PBC 8-hour turnaround rule. Long periods start after qualifying planned rest; earlier overlapping periods remain active. Incomplete periods and missing history cannot produce a rest pass. All work must be recorded. Times use the service-date base clock; daylight-saving elapsed time, driver base time zone and diary rounding require separate verification. This is not an approved electronic work diary.</p></details></div>
    <div class="ft-review-tabs" role="tablist" aria-label="Fatigue review views"><button type="button" id="ftSummaryTab" role="tab" aria-controls="ftSummaryPanel" aria-selected="true">Driver summary</button><button type="button" id="ftDetailTab" role="tab" aria-controls="ftDetailPanel" aria-selected="false">Driver details</button></div>
    <section id="ftSummaryPanel" role="tabpanel" aria-labelledby="ftSummaryTab">
      <section class="ft-table-card ft-standard-card"><div class="ft-table-head"><div><h2>Driver work and rest</h2><span id="ftDriverCounts">Loading driver checks…</span></div><span>One row per driver</span></div><div class="ft-table-wrap"><table class="ft-driver-summary-table"><thead><tr><th>Driver / employee</th><th>Reported 24h work<small>Maximum 12h</small></th><th>Shortest turnaround<small>Minimum 8h</small></th><th>7 / 28-day rest</th><th>Review result</th><th>Action</th></tr></thead><tbody id="ftStandardRows"><tr><td colspan="6"><div class="ft-empty ft-empty-small">Loading checks…</div></td></tr></tbody></table></div><div class="ft-summary-note">Work shows the highest total attached to reported 24-hour checks in this range. Turnaround shows the shortest assessed gap. Select Review for each period and its records.</div></section>
    </section>
    <section id="ftDetailPanel" role="tabpanel" aria-labelledby="ftDetailTab" hidden><section class="ft-table-card"><div id="ftDriverDetail"><div class="ft-empty"><strong>Select a driver to review</strong></div></div></section></section>
    <details class="ft-all-turnarounds"><summary>All turnaround records</summary>
    <section class="ft-table-card"><div class="ft-table-head"><div><h2>Turnaround review</h2><span>Compares each working day's final finish with the driver's next working-day start. Same-day overlaps appear as conflicts.</span></div><span class="ft-live"><i></i> Live schedule data</span></div>
      <div class="ft-table-wrap"><table><thead><tr><th>Driver</th><th>Previous duty</th><th>Finished</th><th>Rest available</th><th>Next start</th><th>Next duty</th><th>Result</th><th>Explanation</th></tr></thead><tbody id="ftRows"><tr><td colspan="8"><div class="ft-empty">Loading fatigue records…</div></td></tr></tbody></table></div>
    </section>
    </details>
  </section>`;

  const startInput = document.getElementById("ftStart");
  const endInput = document.getElementById("ftEnd");
  const searchInput = document.getElementById("ftSearch");
  const filterInput = document.getElementById("ftFilter");

  const redraw = () => {view.duties=loadedDuties;renderPage(results, standardAlerts, range, searchInput.value, filterInput.value,view);};
  view.redraw=redraw;
  document.getElementById("ftSummaryTab").onclick=()=>{view.tab="summary";redraw();};
  document.getElementById("ftDetailTab").onclick=()=>{view.tab="details";redraw();};
  const subscribe = () => {
    if (state.unsubscribeFatigueTracking) state.unsubscribeFatigueTracking();
    loadedDuties=[]; scheduleReady=false; view.employeeNumber=""; view.tab="summary";
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
    document.getElementById("ftStandardRows").innerHTML=`<tr><td colspan="6">Loading work and planned rest…</td></tr>`;
    const apply = () => {
      if(!scheduleReady)return;
      const coverage={start:serviceMinute(shiftDate(range.start,-28)),end:serviceMinute(shiftDate(range.end,2))};
      results = calculateTurnarounds(loadedDuties); standardAlerts = calculateStandardHoursAlerts(loadedDuties, range, employeeRecords,coverage); redraw();
    };
    const stopEmployees = listenEmployees(items => {employeeRecords = items || []; apply();}, () => {employeeRecords = []; apply();});
    const stopDuties = listenDutySpansByDateRange(
      shiftDate(range.start, -31), shiftDate(range.end, 1),
      (duties) => { loadedDuties = duties; scheduleReady=true; apply(); },
      (error) => { scheduleReady=false; loadedDuties=[]; results = []; standardAlerts = []; redraw(); document.getElementById("ftStandardRows").innerHTML = `<tr><td colspan="6">Unable to load fatigue data</td></tr>`; document.getElementById("ftRows").innerHTML = `<tr><td colspan="8"><div class="ft-empty"><strong>Unable to load fatigue data</strong><span>${escapeHtml(error?.message || "Please try again.")}</span></div></td></tr>`; }
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
