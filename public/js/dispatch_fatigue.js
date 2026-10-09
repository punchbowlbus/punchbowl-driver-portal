// One rest definition for Dispatch, bulk entry and the tracking report.
export function recordedRestBlocks(duty) {
  const start = Number(duty.startMin), end = Number(duty.endMin);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];
  const blocks = (Array.isArray(duty.breaks) ? duty.breaks : [])
    .map(b => ({startMin: Math.max(start, Number(b.startMin)), endMin: Math.min(end, Number(b.endMin))}))
    .filter(b => Number.isFinite(b.startMin) && Number.isFinite(b.endMin) && b.endMin > b.startMin)
    .sort((a, b) => a.startMin - b.startMin);
  const merged = [];
  for (const b of blocks) {
    const last = merged[merged.length - 1];
    if (last && b.startMin <= last.endMin) last.endMin = Math.max(last.endMin, b.endMin);
    else merged.push({...b});
  }
  return merged;
}

export function qualifyingRestBlocks(duty) {
  return recordedRestBlocks(duty).filter(b=>b.endMin-b.startMin >= 15);
}

export function calculateFatigue(dutySpan) {
  const start = Number(dutySpan.startMin);
  const end = Number(dutySpan.endMin);

  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || dutySpan.startMin == null || dutySpan.endMin == null || String(dutySpan.startMin).trim() === "" || String(dutySpan.endMin).trim() === "") {
    return {totalSpanMinutes: 0, paidMinutes: 0, unpaidMinutes: 0, workMinutes: 0, qualifyingRestMinutes: 0,
      fatigueStatus: "WARNING", fatigueWarning: "Data review: duty start/end times are missing or invalid.",
      has7hContinuousStationaryRest: null, restIn24hMinutes: null};
  }
  const totalSpanMinutes = end - start;
  const breaks = Array.isArray(dutySpan.breaks) ? dutySpan.breaks : [];

  const unpaidMinutes = recordedRestBlocks({...dutySpan, breaks: breaks.filter(b=>String(b.type || "").toLowerCase()==="meal")}).reduce((sum,b)=>sum+b.endMin-b.startMin,0);

  const paidMinutes = Math.max(0, totalSpanMinutes - unpaidMinutes);

  const recordedRest = recordedRestBlocks(dutySpan);
  const restBreaks = qualifyingRestBlocks(dutySpan);

  const LIMIT_5H30 = 5 * 60 + 30; // 330
  const LIMIT_8H = 8 * 60;        // 480
  const LIMIT_11H = 11 * 60;      // 660
  const LIMIT_12H = 12 * 60;      // 720

  const WARNING_FROM_5H15 = 5 * 60 + 15; // 315 min

  function hasContinuousRestWithinMinutes(windowMinutes, neededMinutes) {
    const windowEnd = start + windowMinutes;

    return restBreaks.some((b) => {
      const overlapStart = Math.max(start, b.startMin);
      const overlapEnd = Math.min(windowEnd, b.endMin);
      return Math.max(0, overlapEnd - overlapStart) >= neededMinutes;
    });
  }

  function firstBreakStartOffset() {
    if (!restBreaks.length) return null;
    return Math.max(0, restBreaks[0].startMin - start);
  }

  const totalRestMinutes = restBreaks.reduce(
    (sum, b) => sum + Math.max(0, b.endMin - b.startMin),
    0
  );

  // Check every work resumption, not just the first window of the duty.
  function staysWithinWorkLimit(windowMinutes, maximumWork) {
    const starts = [start, ...recordedRest.map(b => b.endMin)].filter(x => x < end);
    return starts.every(windowStart => {
      const windowEnd = Math.min(end, windowStart + windowMinutes);
      const rest = restBreaks.reduce((sum,b) => {
        const overlap = Math.max(0, Math.min(windowEnd,b.endMin) - Math.max(windowStart,b.startMin));
        return sum + (overlap >= 15 ? overlap : 0);
      },0);
      const actualRest=recordedRest.reduce((sum,b)=>sum+Math.max(0,Math.min(windowEnd,b.endMin)-Math.max(windowStart,b.startMin)),0);
      const actualWork=windowEnd-windowStart-actualRest;
      return actualWork <= maximumWork && (windowEnd-windowStart < windowMinutes || rest >= windowMinutes-maximumWork);
    });
  }
  const has15MinWithin5h15m = staysWithinWorkLimit(LIMIT_5H30, 315);
  const has30MinWithin8h = staysWithinWorkLimit(LIMIT_8H, 450);
  const has60MinWithin11h = staysWithinWorkLimit(LIMIT_11H, 600);

  // Threshold flags
  const reaches5h15 = totalSpanMinutes >= LIMIT_5H30;
  const reaches8h = totalSpanMinutes >= LIMIT_8H;
  const reaches11h = totalSpanMinutes >= LIMIT_11H;
  const reaches12h = totalSpanMinutes >= LIMIT_12H;

  // Fatigue work time is separate from payroll and elapsed duty span.
  // Credit only recorded rest blocks of at least 15 minutes, within this duty.
  // Merge overlapping rest so malformed legacy data cannot double-count it.
  const mergedRest = restBreaks;
  const qualifyingRestMinutes = mergedRest.reduce((sum, b) => sum + b.endMin - b.startMin, 0);
  const recordedRestMinutes=recordedRest.reduce((sum,b)=>sum+b.endMin-b.startMin,0);
  const workMinutes = Math.max(0, totalSpanMinutes - recordedRestMinutes);
  const restIn24hMinutes = null; // A single duty cannot establish actual 24-hour rest.
  const workBlocks = [];
  let cursor = start;
  for (const rest of recordedRest) {
    if(rest.startMin > cursor)workBlocks.push({start:cursor,end:rest.startMin});
    cursor=rest.endMin;
  }
  if(cursor < end)workBlocks.push({start:cursor,end});
  const windowStarts=[...new Set(workBlocks.flatMap(b=>[b.start,b.end-1440]))];
  const maximumWorkIn24hMinutes=Math.max(0,...windowStarts.map(windowStart=>workBlocks.reduce((sum,b)=>sum+Math.max(0,Math.min(windowStart+1440,b.end)-Math.max(windowStart,b.start)),0)));
  const hasScheduled12hWorkLimit = maximumWorkIn24hMinutes <= LIMIT_12H;
  // Keep continuous off-duty rest separate: meal breaks cannot be added to it.
  // This remains a single-duty planning assumption, not verified roster rest.
  const has7hContinuousStationaryRest = null;

  // Legacy display fields; these do not add rules to the supplied policy.
  const firstBreakOffset = firstBreakStartOffset();
  const hasBreakBy5h15 =
    firstBreakOffset !== null && firstBreakOffset <= LIMIT_5H30;

  const requires1HourBreakFor12hShift = reaches12h;
  const has1HourBreakFor12hShift =
    !requires1HourBreakFor12hShift || totalRestMinutes >= 60;

  let fatigueStatus = "OK";
  const warnings = [];

  // Bus and coach Standard Hours: 15 continuous minutes within 5.5 hours.
  if (!has15MinWithin5h15m) {
    fatigueStatus = "BREACH";
    warnings.push("Need at least 15 continuous minutes rest within 5½ hours.");
  }

  // Scheduled 8-hour work/rest check
  if (!has30MinWithin8h) {
    fatigueStatus = "BREACH";
    warnings.push("Need at least 30 min total rest within an 8-hour counting window.");
  }

  // Scheduled 11-hour work/rest check
  if (!has60MinWithin11h) {
    fatigueStatus = "BREACH";
    warnings.push("Need at least 60 min total rest within an 11-hour counting window.");
  }

  // These are only meaningful once duty becomes long enough to matter operationally.
  // A single duty has no preceding rest anchor. Long-period alerts are
  // calculated from the complete driver roster by fatigue_schedule.js.

  if (!hasScheduled12hWorkLimit) {
    if(fatigueStatus==="OK")fatigueStatus="WARNING";
    warnings.push("Planned history review: this duty has more than 12 hours work in a rolling window; the roster rest anchor is required to assess the counting period.");
  }

  // PRE-WARNING at 5h 15m, before the 5½-hour legal window closes.
  if (
    fatigueStatus === "OK" && !reaches5h15 &&
    totalSpanMinutes >= WARNING_FROM_5H15 &&
    !hasContinuousRestWithinMinutes(LIMIT_5H30, 15)
  ) {
    if (fatigueStatus === "OK") {
      fatigueStatus = "WARNING";
    }
    warnings.push(
      "Approaching 5½ hours without a 15-minute continuous rest break."
    );
  }

  const profile = String(dutySpan.fatigueCategory ?? "Standard").trim();
  if (profile.toLowerCase() !== "standard") {
    fatigueStatus = "WARNING";
    warnings.length = 0;
    warnings.push(`Hours-option review: ${profile || "Unknown"} is not assessed by the Bus and Coach Standard Hours calculator. Verify the applicable work/rest limits.`);
  }
  const fatigueWarning = warnings.join(" ");

  return {
    totalSpanMinutes,
    workMinutes,
    maximumWorkIn24hMinutes,
    qualifyingRestMinutes,
    unpaidMinutes,
    paidMinutes,
    fatigueStatus,
    fatigueWarning,

    has15MinWithin5h15m: profile.toLowerCase() === "standard" ? has15MinWithin5h15m : null,
    has30MinWithin8h: profile.toLowerCase() === "standard" ? has30MinWithin8h : null,
    has60MinWithin11h: profile.toLowerCase() === "standard" ? has60MinWithin11h : null,
    has12hRestIn24h: null,
    hasScheduled12hWorkLimit: profile.toLowerCase() === "standard" ? hasScheduled12hWorkLimit : null,
    has7hContinuousStationaryRest,

    reaches5h15,
    reaches8h,
    reaches11h,
    reaches12h,

    hasBreakBy5h15,
    has1HourBreakFor12hShift,
    totalRestMinutes,
    restIn24hMinutes
  };
}

// Recalculate recognised calculator messages without losing independent
// saved turnaround / operational warnings or mutating Firestore records.
export function refreshLegacyRestBreach(span) {
  const savedWarning = String(span.fatigueWarning || "");
  const known = /Need at least 12 hours rest in 24 hours\.|Need at least 15 continuous minutes rest within 5½ hours\.|Need at least (?:30|60) min total rest within (?:first (?:8|11) hours|an (?:8|11)-hour counting window)\.|Recorded fatigue work exceeds 12 hours in this duty \(excluding (?:qualifying rest|recorded non-work rest)\)\.|Scheduled work exceeds 12 hours in a rolling 24-hour base-clock window \(excluding (?:qualifying rest|recorded non-work rest)\)\. Confirm the statutory counting period\.|Need at least 7 continuous hours rest in 24 hours\.|Approaching 5½ hours without a 15-minute continuous rest break\.|Plan a qualifying rest break before 5½ hours\.|Company rule: 12\+ hour shift needs 60 min total break\.|Hours-option review: [\s\S]*?Verify the applicable work\/rest limits\.|Data review: duty start\/end times are missing or invalid\.|Planned history review: this duty has more than 12 hours work in a rolling window; the roster rest anchor is required to assess the counting period\./g;
  const remaining = savedWarning.replace(known, "").trim();
  // Refresh existing fatigue results and duties without any saved result.

  const current = calculateFatigue(span);
  const warnings = [...new Set([current.fatigueWarning, remaining].filter(Boolean))];
  const severity = {OK: 0, WARNING: 1, BREACH: 2};
  const savedStatus = remaining ? (String(span.fatigueStatus || "").toUpperCase() === "BREACH" ? "BREACH" : "WARNING") : "OK";
  const fatigueStatus = (severity[savedStatus] || 0) > severity[current.fatigueStatus]
    ? savedStatus : current.fatigueStatus;
  return {...span, fatigueStatus, fatigueWarning: warnings.join(" ")};
}

export function fatigueStatusLabel(status) {
  return String(status).toUpperCase() === "BREACH" ? "PLAN ALERT" : String(status).toUpperCase() === "WARNING" ? "REVIEW" : "NO DUTY ALERT";
}
