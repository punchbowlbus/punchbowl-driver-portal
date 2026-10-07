// One rest definition for Dispatch, bulk entry and the tracking report.
export function qualifyingRestBlocks(duty) {
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
  return merged.filter(b => b.endMin - b.startMin >= 15);
}

export function calculateFatigue(dutySpan) {
  const start = Number(dutySpan.startMin ?? 0);
  const end = Number(dutySpan.endMin ?? 0);

  const totalSpanMinutes = Math.max(0, end - start);
  const breaks = Array.isArray(dutySpan.breaks) ? dutySpan.breaks : [];

  const normalizedBreaks = breaks
    .map((b) => ({
      type: String(b.type || "").toLowerCase(),
      startMin: Number(b.startMin || 0),
      endMin: Number(b.endMin || 0)
    }))
    .filter((b) => b.endMin > b.startMin)
    .sort((a, b) => a.startMin - b.startMin);

  const unpaidMinutes = normalizedBreaks
    .filter((b) => b.type === "meal")
    .reduce((sum, b) => sum + Math.max(0, b.endMin - b.startMin), 0);

  const paidMinutes = Math.max(0, totalSpanMinutes - unpaidMinutes);

  const restBreaks = qualifyingRestBlocks(dutySpan);

  const LIMIT_5H30 = 5 * 60 + 30; // 330
  const LIMIT_8H = 8 * 60;        // 480
  const LIMIT_11H = 11 * 60;      // 660
  const LIMIT_12H = 12 * 60;      // 720

  const WARNING_FROM_5H15 = 5 * 60; // 300 min

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
    const starts = [start, ...restBreaks.map(b => b.endMin)].filter(x => x < end);
    return starts.every(windowStart => {
      const windowEnd = Math.min(end, windowStart + windowMinutes);
      const rest = restBreaks.reduce((sum,b) => {
        const overlap = Math.max(0, Math.min(windowEnd,b.endMin) - Math.max(windowStart,b.startMin));
        return sum + (overlap >= 15 ? overlap : 0);
      },0);
      return windowEnd - windowStart - rest <= maximumWork;
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
  const workMinutes = Math.max(0, totalSpanMinutes - qualifyingRestMinutes);
  const restIn24hMinutes = Math.max(0, 24 * 60 - workMinutes);
  const has12hRestIn24h = workMinutes <= LIMIT_12H;
  // Keep continuous off-duty rest separate: meal breaks cannot be added to it.
  // This remains a single-duty planning assumption, not verified roster rest.
  const offDutyMinutes = Math.max(0, 24 * 60 - totalSpanMinutes);
  const has7hContinuousStationaryRest = offDutyMinutes >= 7 * 60;

  // Company rule
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
  if (reaches12h && !has12hRestIn24h) {
    fatigueStatus = "BREACH";
    warnings.push("Recorded fatigue work exceeds 12 hours in this duty (excluding qualifying rest).");
  }

  if (reaches12h && !has7hContinuousStationaryRest) {
    fatigueStatus = "BREACH";
    warnings.push("Need at least 7 continuous hours rest in 24 hours.");
  }

  // PRE-WARNING at 5h 15m, before the 5½-hour legal window closes.
  if (
    !reaches5h15 &&
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

  // COMPANY WARNING: only show once duty is getting close, not for a 2-hour job
  if (
    !reaches5h15 &&
    totalSpanMinutes >= WARNING_FROM_5H15 &&
    !hasBreakBy5h15
  ) {
    if (fatigueStatus === "OK") {
      fatigueStatus = "WARNING";
    }
    warnings.push("Plan a qualifying rest break before 5½ hours.");
  }

  // COMPANY WARNING: 12+ hour shift needs 60 min break
  if (reaches12h && !has1HourBreakFor12hShift) {
    if (fatigueStatus === "OK") {
      fatigueStatus = "WARNING";
    }
    warnings.push("Company rule: 12+ hour shift needs 60 min total break.");
  }

  const fatigueWarning = warnings.join(" ");

  return {
    totalSpanMinutes,
    workMinutes,
    qualifyingRestMinutes,
    unpaidMinutes,
    paidMinutes,
    fatigueStatus,
    fatigueWarning,

    has15MinWithin5h15m,
    has30MinWithin8h,
    has60MinWithin11h,
    has12hRestIn24h,
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
  const known = /Need at least 12 hours rest in 24 hours\.|Need at least 15 continuous minutes rest within 5½ hours\.|Need at least (?:30|60) min total rest within (?:first (?:8|11) hours|an (?:8|11)-hour counting window)\.|Recorded fatigue work exceeds 12 hours in this duty \(excluding qualifying rest\)\.|Need at least 7 continuous hours rest in 24 hours\.|Approaching 5½ hours without a 15-minute continuous rest break\.|Plan a qualifying rest break before 5½ hours\.|Company rule: 12\+ hour shift needs 60 min total break\./g;
  const remaining = savedWarning.replace(known, "").trim();
  // Refresh existing fatigue results and duties without any saved result.
  if (remaining === savedWarning && savedWarning) return span;
  const current = calculateFatigue(span);
  const warnings = [...new Set([current.fatigueWarning, remaining].filter(Boolean))];
  const severity = {OK: 0, WARNING: 1, BREACH: 2};
  const savedStatus = remaining ? String(span.fatigueStatus || "OK") : "OK";
  const fatigueStatus = (severity[savedStatus] || 0) > severity[current.fatigueStatus]
    ? savedStatus : current.fatigueStatus;
  return {...span, fatigueStatus, fatigueWarning: warnings.join(" ")};
}
