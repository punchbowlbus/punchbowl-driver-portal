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

  const restBreaks = normalizedBreaks;

  const LIMIT_5H15 = 5 * 60 + 15; // 315
  const LIMIT_8H = 8 * 60;        // 480
  const LIMIT_11H = 11 * 60;      // 660
  const LIMIT_12H = 12 * 60;      // 720

  const WARNING_FROM_5H15 = 5 * 60; // 300 min

  function restMinutesWithinMinutes(windowMinutes) {
    const windowEnd = start + windowMinutes;

    return restBreaks.reduce((sum, b) => {
      const overlapStart = Math.max(start, b.startMin);
      const overlapEnd = Math.min(windowEnd, b.endMin);
      return sum + Math.max(0, overlapEnd - overlapStart);
    }, 0);
  }

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

  // Rule results
  const has15MinWithin5h15m = hasContinuousRestWithinMinutes(LIMIT_5H15, 15);
  const has30MinWithin8h = restMinutesWithinMinutes(LIMIT_8H) >= 30;
  const has60MinWithin11h = restMinutesWithinMinutes(LIMIT_11H) >= 60;

  // Threshold flags
  const reaches5h15 = totalSpanMinutes >= LIMIT_5H15;
  const reaches8h = totalSpanMinutes >= LIMIT_8H;
  const reaches11h = totalSpanMinutes >= LIMIT_11H;
  const reaches12h = totalSpanMinutes >= LIMIT_12H;

  // 24h planner assumptions
  const restIn24hMinutes = Math.max(0, 24 * 60 - totalSpanMinutes);
  const has12hRestIn24h = restIn24hMinutes >= 12 * 60;
  const has7hContinuousStationaryRest = restIn24hMinutes >= 7 * 60;

  // Company rule
  const firstBreakOffset = firstBreakStartOffset();
  const hasBreakBy5h15 =
    firstBreakOffset !== null && firstBreakOffset <= LIMIT_5H15;

  const requires1HourBreakFor12hShift = reaches12h;
  const has1HourBreakFor12hShift =
    !requires1HourBreakFor12hShift || totalRestMinutes >= 60;

  let fatigueStatus = "OK";
  const warnings = [];

  // LEGAL: 15 min within first 5h 15m
  if (reaches5h15 && !has15MinWithin5h15m) {
    fatigueStatus = "BREACH";
    warnings.push("Need at least 15 min rest within first 5h 15m.");
  }

  // LEGAL: 30 min total within first 8h
  if (reaches8h && !has30MinWithin8h) {
    fatigueStatus = "BREACH";
    warnings.push("Need at least 30 min total rest within first 8 hours.");
  }

  // LEGAL: 60 min total within first 11h
  if (reaches11h && !has60MinWithin11h) {
    fatigueStatus = "BREACH";
    warnings.push("Need at least 60 min total rest within first 11 hours.");
  }

  // These are only meaningful once duty becomes long enough to matter operationally.
  if (reaches12h && !has12hRestIn24h) {
    fatigueStatus = "BREACH";
    warnings.push("Need at least 12 hours rest in 24 hours.");
  }

  if (reaches12h && !has7hContinuousStationaryRest) {
    fatigueStatus = "BREACH";
    warnings.push("Need at least 7 continuous hours rest in 24 hours.");
  }

  // PRE-WARNING: close to 5h 15m, not yet a breach
  if (
    !reaches5h15 &&
    totalSpanMinutes >= WARNING_FROM_5H15 &&
    !has15MinWithin5h15m
  ) {
    if (fatigueStatus === "OK") {
      fatigueStatus = "WARNING";
    }
    warnings.push(
      "Close to 5h 15m fatigue limit without a 15 min break. If delayed, driver may enter fatigue breach."
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
    warnings.push("Company rule: break required by 5h 15m.");
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