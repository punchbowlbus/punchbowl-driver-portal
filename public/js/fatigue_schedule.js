import { calculateFatigue, refreshLegacyRestBreach, qualifyingRestBlocks, recordedRestBlocks } from "./dispatch_fatigue.js";
const COMPANY_MIN_REST_MINUTES = 480;
export function shiftServiceDate(value, days) {return new Date(Date.parse(value + "T12:00:00Z") + days * 86400000).toISOString().slice(0,10);}
export function scheduleCoverage(firstDate, lastDate = firstDate) {
  return {start:serviceMinute(shiftServiceDate(firstDate,-28)),end:serviceMinute(shiftServiceDate(lastDate,3))};
}
function dutyStatus(value) {return String(value || "Pending").trim().toLowerCase();}
function absoluteMinute(duty, which) {return Date.parse(duty.serviceDate + "T00:00:00Z") / 60000 + Number(which === "end" ? duty.endMin : duty.startMin);}
function durationLabel(minutes) {return `${Math.floor(Math.max(0,minutes)/60)}h ${String(Math.max(0,minutes)%60).padStart(2,"0")}m`;}
export function mergeIntervals(items) {
  const merged = [];
  for (const item of items.filter(x => Number.isFinite(x.start) && Number.isFinite(x.end) && x.end > x.start).sort((a,b) => a.start - b.start)) {
    const last = merged[merged.length - 1];
    if (last && item.start <= last.end) last.end = Math.max(last.end, item.end);
    else merged.push({...item});
  }
  return merged;
}

export function workIntervals(duty) {
  const base = absoluteMinute({...duty, startMin: 0}, "start");
  let cursor = absoluteMinute(duty, "start");
  const end = absoluteMinute(duty, "end");
  const work = [];
  for (const rest of recordedRestBlocks(duty)) {
    if (base + rest.startMin > cursor) work.push({start: cursor, end: base + rest.startMin});
    cursor = base + rest.endMin;
  }
  if (end > cursor) work.push({start: cursor, end});
  return work;
}

export function minutesWithin(intervals, start, end) {
  return intervals.reduce((sum, x) => sum + Math.max(0, Math.min(end, x.end) - Math.max(start, x.start)), 0);
}

export function shortWindowAssessment(intervals,start,end,coverageEnd) {
  const countedEnd=Math.min(end,coverageEnd);
  const work=minutesWithin(intervals,start,countedEnd);
  let cursor=start,rest=0;
  for(const interval of intervals.filter(x=>x.end>start && x.start<countedEnd)) {
    const gap=Math.max(0,Math.min(countedEnd,interval.start)-cursor);
    if(gap>=15)rest+=gap;
    cursor=Math.max(cursor,Math.min(countedEnd,interval.end));
  }
  const tail=countedEnd-cursor;if(tail>=15)rest+=tail;
  return {work,rest,complete:countedEnd>=end};
}
export function shortWindowWork(intervals,start,end) {return minutesWithin(intervals,start,end);}

// Scheduled risk indicators are not statutory counting periods. The database
// does not contain verified stationary rest, outside work, base timezone or the
// end of the longest major rest used to anchor NHVR 24h/7d/28d periods.
export function calculateTurnarounds(duties) {
  const active = (duties || []).filter((duty) =>
    duty.deleted !== true && !["cancelled", "canceled"].includes(dutyStatus(duty.dispatchStatus)) && duty.startMin != null && duty.endMin != null && String(duty.startMin).trim() !== "" && String(duty.endMin).trim() !== "" && Number.isFinite(absoluteMinute(duty,"start")) && Number.isFinite(absoluteMinute(duty,"end")) && absoluteMinute(duty,"end") > absoluteMinute(duty,"start")
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
          const previous = dayDuties.slice(0, index).reduce((last, duty) => absoluteMinute(duty, "end") > absoluteMinute(last, "end") ? duty : last);
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
      const previous = workDays.slice(0,index).map(day=>day.lastDuty).reduce((latest,duty)=>absoluteMinute(duty,"end")>absoluteMinute(latest,"end")?duty:latest);
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

// One planned counting engine for all entry paths and reports. Coordinates are
// service-date base-clock minutes, not UTC instants or verified diary records.
export function validDutyTimes(duty) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(duty.serviceDate || "")) &&
    Number.isFinite(absoluteMinute(duty,"start")) && Number.isFinite(absoluteMinute(duty,"end")) && new Date(Date.parse(duty.serviceDate+"T00:00:00Z")).toISOString().slice(0,10)===duty.serviceDate &&
    duty.startMin != null && duty.endMin != null && String(duty.startMin).trim() !== "" && String(duty.endMin).trim() !== "" &&
    Number.isInteger(Number(duty.startMin)) && Number.isInteger(Number(duty.endMin)) && Number(duty.startMin)>=0 && Number(duty.endMin)<=2940 && Number(duty.endMin)>Number(duty.startMin);
}
export function validDutyRecord(duty) {
  return validDutyTimes(duty) && (!duty.breaks || Array.isArray(duty.breaks)) && (duty.breaks || []).every(b=>
    b.startMin!=null && b.endMin!=null && String(b.startMin).trim()!=="" && String(b.endMin).trim()!=="" &&
    Number.isInteger(Number(b.startMin)) && Number.isInteger(Number(b.endMin)) && Number(b.startMin)>=Number(duty.startMin) &&
    Number(b.endMin)<=Number(duty.endMin) && Number(b.endMin)>Number(b.startMin) && (!b.type || ["meal","crib"].includes(String(b.type).toLowerCase())));
}
function boundsLabel(start,end) {
  return `${new Date(start*60000).toISOString().slice(0,16).replace("T"," ")}–${new Date(end*60000).toISOString().slice(0,16).replace("T"," ")} base clock`;
}
function nightRestInGap(gap) {
  if(gap.end-gap.start>=1440)return true;
  for(let day=Math.floor(gap.start/1440)-1;day<=Math.floor(gap.end/1440);day++)
    if(Math.min(gap.end,(day+1)*1440+480)-Math.max(gap.start,day*1440+1320)>=420)return true;
  return false;
}
export function plannedCountingPeriods(duties, coverage) {
  const active=duties.filter(d=>!d.deleted && !["cancelled","canceled"].includes(dutyStatus(d.dispatchStatus)));
  if(active.some(d=>!validDutyRecord(d)) || !coverage || !Number.isFinite(coverage.start) || !Number.isFinite(coverage.end) || coverage.end<=coverage.start)return [];
  const work=mergeIntervals(active.flatMap(workIntervals));
  const rest=plannedRestIntervals(active,coverage.start,coverage.end);
  const definitions=[
    {window:1440,maximum:720,required:420,rule:"Planned rest: 7 continuous hours in 24 hours",workRule:"Planned work: 24-hour counting period"},
    {window:10080,required:6,rule:"Planned rest: 6 night rests in 7 days"},
    {window:40320,maximum:17280,required:4,rule:"Planned rest: 4 × 24-hour rests in 28 days",workRule:"Planned work: 28-day counting period"}
  ];
  const periods=[];
  for(const definition of definitions) {
    const qualifies=gap=>definition.window===1440 ? gap.end-gap.start>=420 : definition.window===10080 ? nightRestInGap(gap) : gap.end-gap.start>=1440;
    // Keep every anchor: taking another major rest does not erase a period
    // already running. Never use a shifted work endpoint as a long-period anchor.
    const majorEnds=rest.filter(qualifies).map(gap=>gap.end).filter(end=>end<coverage.end);
    const starts=new Set(majorEnds);
    for(const gap of rest) {
      if(gap.end>=coverage.end)continue;
      // Required major rest absent: count from any observed rest resumption.
      // Only do so with a complete preceding window; otherwise history is unknown.
      if(gap.end-coverage.start>=definition.window && !majorEnds.some(end=>end<=gap.end && end>gap.end-definition.window))starts.add(gap.end);
    }
    for(const start of starts) {
      const end=start+definition.window, countedEnd=Math.min(end,coverage.end);
      const gaps=plannedRestIntervals(active,start,countedEnd);
      const count=definition.window===1440 ? Math.max(0,...gaps.map(gap=>gap.end-gap.start)) : definition.window===10080 ? countPlannedNightRests(gaps,start,countedEnd) : gaps.reduce((sum,gap)=>sum+Math.floor((gap.end-gap.start)/1440),0);
      const minutes=minutesWithin(work,start,countedEnd),complete=end<=coverage.end;
      periods.push({...definition,start,end,minutes,count,complete,bounds:boundsLabel(start,end),dutyIds:active.filter(d=>absoluteMinute(d,"end")>start && absoluteMinute(d,"start")<countedEnd).map(d=>d.id)});
    }
  }
  return periods;
}
export function scheduledWorkRisks(duties, coverage = null) {
  const active=duties.filter(d=>!d.deleted && !["cancelled","canceled"].includes(dutyStatus(d.dispatchStatus)) && validDutyTimes(d));
  const work=mergeIntervals(active.flatMap(workIntervals)),risks=[];
  const coverageEnd=coverage?.end ?? Math.max(0,...active.map(d=>absoluteMinute(d,"end")));
  for(const [window,maximum,rule] of [[330,315,"15-minute rest within 5½ hours"],[480,450,"30-minute rest within 8 hours"],[660,600,"60-minute rest within 11 hours"]]) {
    for(const start of work.map(x=>x.start)) {
      const end=start+window,check=shortWindowAssessment(work,start,end,coverageEnd);
      if(check.work<=maximum && !(check.complete && check.rest<window-maximum))continue;
      risks.push({rule,minutes:check.work,restMinutes:check.rest,maximum,required:window-maximum,window,start,end,dutyIds:active.filter(d=>absoluteMinute(d,"end")>start && absoluteMinute(d,"start")<end).map(d=>d.id),detail:`Scheduled roster risk: ${durationLabel(check.work)} work; ${check.rest} qualifying rest minutes in ${boundsLabel(start,end)} (${durationLabel(maximum)} maximum work; ${window-maximum} minutes rest required). Verify actual work/rest and the statutory counting period.`});
    }
  }
  for(const period of plannedCountingPeriods(duties,coverage)) {
    if(period.maximum!=null && period.minutes>period.maximum)risks.push({...period,rule:period.workRule,detail:`Scheduled roster risk: ${durationLabel(period.minutes)} work in planned rest-anchored period ${period.bounds} (${durationLabel(period.maximum)} maximum). Verify actual work/rest and the statutory counting period.`});
    if(period.complete && period.count<period.required)risks.push({...period,rule:period.rule,detail:`Scheduled roster risk: ${period.window===1440 ? durationLabel(period.count) : period.count} planned rest; ${period.window===1440 ? "7h continuous" : period.required+" rest blocks"} required in planned rest-anchored period ${period.bounds}. Verify actual work/rest and the statutory counting period.`});
  }
  return risks;
}

export function refreshRosterFatigue(duties, employees = null, coverage = null) {
  const employeeMap = employees && new Map(employees.map(e=>[String(e.employeeNumber || e.id).trim(),e]));
  const rows = duties.map(d => {
    if (d.deleted || ["cancelled","canceled"].includes(dutyStatus(d.dispatchStatus))) return {...d,fatigueStatus:"OK",fatigueWarning:""};
    const profile = employeeMap ? employeeMap.get(String(d.driverEmployeeNumber).trim())?.fatigueCategory || "Unknown" : d.fatigueCategory ?? "Standard";
    const cleaned = String(d.fatigueWarning || "")
      .replace(/Planned history review: [\s\S]*?no full work\/rest pass is established\./g, "").replace(/Company 8-hour turnaround breach\. Scheduled base-clock gap [\s\S]*?This is the company rule, not a legal fatigue determination\./g, "")
      .replace(/Company 8-hour turnaround breach\. Previous duty [\s\S]*?Shortfall: [^.]+\./g, "")
      .replace(/Company 8-hour turnaround breach: previous duty [\s\S]*?shortfall [^.]+\./g, "")
      .replace(/Company 8-hour turnaround breach\.(?: Rest available: [^.]+\.)?/g, "").replace(/Scheduled roster risk:[\s\S]*?Verify actual work\/rest and the statutory counting period\./g, "").replace(/Scheduled roster conflict: duties overlap by [^.]+\./g,"").trim();
    const current = refreshLegacyRestBreach({...d, fatigueCategory:profile, fatigueWarning:cleaned, fatigueStatus: cleaned ? d.fatigueStatus : "OK"});
    // Never carry a confirmed rest/pass field over from an older calculator.
    return {...current, has7hContinuousStationaryRest:null, restIn24hMinutes:null};
  });
  const active = rows.filter(d=>!d.deleted && !["cancelled","canceled"].includes(dutyStatus(d.dispatchStatus)));
  const byDriver = new Map();
  for (const row of active) {const key=String(row.driverEmployeeNumber || "");if(!key)continue;if(!byDriver.has(key))byDriver.set(key,[]);byDriver.get(key).push(row);}
  const add = (row,message) => {row.fatigueStatus="BREACH";if(!row.fatigueWarning.includes(message))row.fatigueWarning=[row.fatigueWarning,message].filter(Boolean).join(" ");};
  for (const driverRows of byDriver.values()) {
    if (driverRows[0].fatigueCategory.toLowerCase() === "standard") {
      const risks=scheduledWorkRisks(driverRows,coverage);
      for(const row of driverRows) {
        row.plannedFatigueCoverage = coverage && driverRows.every(validDutyRecord) ? "LOADED" : "UNKNOWN";
        const dateStart=serviceMinute(row.serviceDate);
        if(driverRows.some(d=>!validDutyRecord(d)) || !coverage || coverage.start>dateStart-40320 || coverage.end<dateStart+1440) {
          if(row.fatigueStatus==="OK")row.fatigueStatus="WARNING";
          row.fatigueWarning=[row.fatigueWarning,"Planned history review: complete 28-day schedule coverage is unavailable or duty/break records are invalid; no full work/rest pass is established."].filter(Boolean).join(" ");
        }
      }
      for (const row of driverRows) {
        const worst=new Map();
        for(const risk of risks.filter(r=>r.dutyIds.includes(row.id)))if(!worst.has(risk.rule) || risk.minutes>worst.get(risk.rule).minutes)worst.set(risk.rule,risk);
        for(const risk of worst.values())add(row,risk.detail);
      }
    }
  }
  for (const result of calculateTurnarounds(active)) {
    if(result.status === "compliant")continue;
    const row=rows.find(d=>d.id===result.next.id);
    if(row)add(row,result.status === "overlap" ? `Scheduled roster conflict: duties overlap by ${durationLabel(Math.abs(result.restMinutes))}.` : `Company 8-hour turnaround breach. Scheduled base-clock gap ${durationLabel(result.restMinutes)} before ${result.next.dutyNumber || "duty"}; shortfall ${durationLabel(result.shortfallMinutes)}. This is the company rule, not a legal fatigue determination.`);
  }
  return rows;
}

export function serviceMinute(date, minutes = 0) {
  return Date.parse(`${date}T00:00:00Z`) / 60000 + minutes;
}

// The operator's roster policy: no active duty span means no scheduled work.
// Infer rest only inside the explicitly loaded, complete schedule coverage.
export function plannedRestIntervals(duties, start, end) {
  const work = mergeIntervals(duties.filter(d=>!d.deleted && !["cancelled","canceled"].includes(dutyStatus(d.dispatchStatus))).flatMap(workIntervals));
  const rest=[];let cursor=start;
  for(const interval of work.filter(x=>x.end>start && x.start<end)) {
    const workStart=Math.max(start,interval.start);
    if(workStart>cursor)rest.push({start:cursor,end:workStart});
    cursor=Math.max(cursor,Math.min(end,interval.end));
  }
  if(cursor<end)rest.push({start:cursor,end});
  return rest;
}

// Choose non-overlapping night-rest or 24-hour alternatives. Recompute the
// earliest possible finish after every choice so one rest block is not credited
// twice and a 24-hour alternative can start after an earlier night-rest block.
export function countPlannedNightRests(rest, start, end) {
  let cursor=start,count=0;const usedNights=new Set();
  const firstDay=Math.floor(start/1440)-1,lastDay=Math.floor(end/1440);
  while(cursor<end) {
    let best=null;
    const consider=(candidate)=>{if(!best || candidate.end<best.end)best=candidate;};
    for(const gap of rest) {
      const gapStart=Math.max(cursor,start,gap.start),gapEnd=Math.min(end,gap.end);
      if(gapStart+1440<=gapEnd)consider({start:gapStart,end:gapStart+1440,kind:"day"});
      for(let day=firstDay;day<=lastDay;day++) {
        if(usedNights.has(day))continue;
        const nightStart=day*1440+1320,nightEnd=(day+1)*1440+480;
        const blockStart=Math.max(gapStart,nightStart);
        if(blockStart+420<=Math.min(gapEnd,nightEnd))consider({start:blockStart,end:blockStart+420,kind:"night",day});
      }
    }
    if(!best)break;
    cursor=best.end;count++;
    if(best.kind==="night")usedNights.add(best.day);
  }
  return count;
}

export function calculatePlannedRestChecks(duties, reviewDate, coverage, suppliedPeriods = null) {
  const dayStart=serviceMinute(reviewDate),dayEnd=dayStart+1440;
  const periods=suppliedPeriods || plannedCountingPeriods(duties,coverage);
  const definitions=[{window:1440,rule:"Planned rest: 7 continuous hours in 24 hours",required:420},{window:10080,rule:"Planned rest: 6 night rests in 7 days",required:6},{window:40320,rule:"Planned rest: 4 × 24-hour rests in 28 days",required:4}];
  return definitions.map(definition=>{
    const active=duties.filter(d=>!d.deleted && !["cancelled","canceled"].includes(dutyStatus(d.dispatchStatus)));
    const occupied=active.some(d=>absoluteMinute(d,"end")>dayStart-definition.window && absoluteMinute(d,"start")<dayEnd);
    if(coverage && coverage.start<=dayStart-definition.window && coverage.end>=dayEnd && active.every(validDutyRecord) && !occupied)return {...definition,date:reviewDate,count:null,result:"NO SCHEDULED WORK",detail:"No scheduled work in the fully loaded review history. No work counting period has started; this is planned time off, not verification of actual stationary rest."};
    const relevant=periods.filter(p=>p.window===definition.window && p.start<dayEnd && p.end>dayStart && p.complete);
    if(!coverage || coverage.start>dayStart-definition.window || coverage.end<dayEnd || !relevant.length)return {...definition,date:reviewDate,count:null,result:"DATA REVIEW",detail:"Insufficient complete schedule coverage or completed planned rest-anchored counting periods. No rest pass or shortfall has been inferred."};
    const worst=relevant.reduce((a,b)=>a.count<=b.count?a:b);
    return {...worst,date:reviewDate,result:worst.count>=worst.required ? "PLANNED PASS" : "PLANNED SHORTFALL",detail:`${definition.window===1440 ? durationLabel(worst.count)+" longest continuous planned rest" : worst.count+" non-overlapping planned rest blocks"}; ${definition.window===1440 ? "7h" : worst.required} required. Planned rest-anchored period: ${worst.bounds}. No active duty span means planned rest; meal/crib breaks are non-work rest. This does not confirm actual stationary rest.`};
  });
}
