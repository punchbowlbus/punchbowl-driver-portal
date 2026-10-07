import { calculateFatigue, refreshLegacyRestBreach, qualifyingRestBlocks, recordedRestBlocks } from "./dispatch_fatigue.js";
const COMPANY_MIN_REST_MINUTES = 480;
export function shiftServiceDate(value, days) {return new Date(Date.parse(value + "T12:00:00Z") + days * 86400000).toISOString().slice(0,10);}
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

export function scheduledWorkRisks(duties) {
  const active = duties.filter(d => !d.deleted && !["cancelled","canceled"].includes(dutyStatus(d.dispatchStatus)));
  const work = mergeIntervals(active.flatMap(workIntervals));
  const risks = [];
  const coverageEnd=Math.max(0,...active.map(d=>absoluteMinute(d,"end")));
  for (const [window, maximum, rule] of [[330,315,"15-minute rest within 5½ hours"],[480,450,"30-minute rest within 8 hours"],[660,600,"60-minute rest within 11 hours"],[1440,720,"Scheduled work risk: 24-hour window"]]) {
    const starts = window < 1440 ? work.map(x=>x.start) : [...new Set(work.flatMap(x=>[x.start,x.end-window]))];
    for (const start of starts) {
      const end = start + window;
      const check = window < 1440 ? shortWindowAssessment(work,start,end,coverageEnd) : null;
      const minutes = check ? check.work : minutesWithin(work,start,end);
      if (minutes <= maximum && !(check?.complete && check.rest < window-maximum)) continue;
      const affected = active.filter(d=>absoluteMinute(d,"end")>start && absoluteMinute(d,"start")<end);
      risks.push({rule,minutes,dutyIds:affected.map(d=>d.id),detail:`Scheduled roster risk: ${durationLabel(minutes)} work in a ${window/60}-hour base-clock window (${durationLabel(maximum)} maximum under Bus and Coach Standard Hours)${check ? `; ${check.rest} qualifying scheduled rest minutes (${window-maximum} required when the full window is reached)` : ""}. Verify actual work/rest and the statutory counting period.`});
    }
  }
  return risks;
}

export function refreshRosterFatigue(duties, employees = null) {
  const employeeMap = employees && new Map(employees.map(e=>[String(e.employeeNumber || e.id).trim(),e]));
  const rows = duties.map(d => {
    if (d.deleted || ["cancelled","canceled"].includes(dutyStatus(d.dispatchStatus))) return {...d,fatigueStatus:"OK",fatigueWarning:""};
    const profile = employeeMap ? employeeMap.get(String(d.driverEmployeeNumber).trim())?.fatigueCategory || "Unknown" : d.fatigueCategory ?? "Standard";
    const cleaned = String(d.fatigueWarning || "")
      .replace(/Company 8-hour turnaround breach\. Scheduled base-clock gap [\s\S]*?This is the company rule, not a legal fatigue determination\./g, "")
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
      const risks=scheduledWorkRisks(driverRows);
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

export function calculatePlannedRestChecks(duties, reviewDate, coverage) {
  const end=serviceMinute(shiftServiceDate(reviewDate,1),480);
  const definitions=[
    {window:1440,rule:"Planned rest: 7 continuous hours in 24 hours",required:420,unit:"minutes"},
    {window:10080,rule:"Planned rest: 6 night rests in 7 days",required:6,unit:"blocks"},
    {window:40320,rule:"Planned rest: 4 × 24-hour rests in 28 days",required:4,unit:"blocks"}
  ];
  const active=duties.filter(d=>!d.deleted && !["cancelled","canceled"].includes(dutyStatus(d.dispatchStatus)));
  const invalid=active.some(d=>d.startMin==null || d.endMin==null || String(d.startMin).trim()==="" || String(d.endMin).trim()==="" || !Number.isFinite(absoluteMinute(d,"start")) || !Number.isFinite(absoluteMinute(d,"end")) || Number(d.startMin)<0 || Number(d.endMin)>2939 || Number(d.endMin)<=Number(d.startMin));
  return definitions.map(definition=>{
    const start=end-definition.window;
    const bounds=`${new Date(start*60000).toISOString().slice(0,16).replace("T"," ")}–${new Date(end*60000).toISOString().slice(0,16).replace("T"," ")} base clock`;
    if(invalid || !coverage || !Number.isFinite(coverage.start) || !Number.isFinite(coverage.end) || coverage.start>start || coverage.end<end) {
      return {...definition,date:reviewDate,start,end,count:null,result:"DATA REVIEW",detail:invalid ? "Invalid duty times prevent a reliable planned-rest calculation. Correct the duty records." : `Complete schedule coverage is unavailable for ${bounds}; no rest pass or shortfall has been inferred.`};
    }
    const rest=plannedRestIntervals(active,start,end);
    const count=definition.window===1440 ? Math.max(0,...rest.map(gap=>gap.end-gap.start)) : definition.window===10080 ? countPlannedNightRests(rest,start,end) : rest.reduce((sum,gap)=>sum+Math.floor((gap.end-gap.start)/1440),0);
    const description=definition.window===1440 ? `${durationLabel(count)} longest continuous planned rest; 7h required` : definition.window===10080 ? `${count} non-overlapping planned night-rest/24-hour alternatives; 6 required` : `${count} non-overlapping 24-hour planned rest blocks; 4 required`;
    return {...definition,date:reviewDate,start,end,count,result:count>=definition.required ? "PLANNED PASS" : "PLANNED SHORTFALL",detail:`${description}. Rolling planning window: ${bounds}. No active duty span is treated as planned rest; recorded breaks are non-work rest. This is a schedule assessment, not confirmation of actual stationary rest or a statutory counting period.`};
  });
}
