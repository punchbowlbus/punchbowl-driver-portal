// A copy is a new unallocated draft, never a clone of assignment/audit fields.
export function dutyCopyPayload(source, target, fatigue) {
  const startMin = Number(source.startMin), endMin = Number(source.endMin);
  if (source.startMin == null || source.endMin == null || String(source.startMin).trim() === "" || String(source.endMin).trim() === "" || !Number.isFinite(startMin) || !Number.isFinite(endMin) || endMin <= startMin) throw new Error("Source duty times are invalid.");
  return {
    serviceDate: source.serviceDate,
    driverEmployeeNumber: String(target.employeeNumber),
    driverName: String(target.displayName || target.firstName || target.employeeNumber),
    dutyType: source.dutyType || "Charter", dutyNumber: source.dutyNumber || "",
    routeNumber: source.routeNumber || "", routePdfUrl: source.routePdfUrl || "",
    startMin, endMin, startLocation: source.startLocation || "", endLocation: source.endLocation || "",
    breaks: (source.breaks || []).map(b => ({...b})),
    assignedBus: "", dispatchStatus: "Pending", driverAcknowledgment: "Pending",
    totalSpanMinutes: fatigue.totalSpanMinutes, unpaidMinutes: fatigue.unpaidMinutes, paidMinutes: fatigue.paidMinutes,
    fatigueStatus: fatigue.fatigueStatus, fatigueWarning: fatigue.fatigueWarning || ""
  };
}
export function dutyCopyRosterFingerprint(spans) {
  return JSON.stringify([...spans].filter(s => !s.deleted).map(s => [s.id,s.serviceDate,s.driverEmployeeNumber,s.startMin,s.endMin,s.breaks || [],s.dutyNumber || ""]).sort((a,b)=>String(a[0]).localeCompare(String(b[0]))));
}

export function dutyCopyOverlaps(source, spans) {
  const start = Date.parse(source.serviceDate + "T00:00:00Z") / 60000 + Number(source.startMin);
  const end = Date.parse(source.serviceDate + "T00:00:00Z") / 60000 + Number(source.endMin);
  return spans.some(s => {
    if (s.deleted) return false;
    const day = Date.parse(s.serviceDate + "T00:00:00Z") / 60000;
    return start < day + Number(s.endMin) && day + Number(s.startMin) < end;
  });
}
