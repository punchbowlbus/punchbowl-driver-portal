// Pure review data; bulk selections are deliberately never persisted.
export function buildBulkStatusPlan(drivers, spans, selected, date, status) {
  if (!["Pending", "Assigned", "Cancelled"].includes(status)) throw new Error("Choose a valid dispatch status.");
  const names = new Map(drivers.map(d => [String(d.employeeNumber || ""), String(d.displayName || d.firstName || d.employeeNumber || "Driver")]));
  const entries = spans.filter(s => !s.deleted && s.id && s.serviceDate === date && selected.has(String(s.driverEmployeeNumber || "")) && names.has(String(s.driverEmployeeNumber || ""))).map(s => ({
    id: String(s.id), employeeNumber: String(s.driverEmployeeNumber), name: names.get(String(s.driverEmployeeNumber)),
    serviceDate: date, previousStatus: String(s.dispatchStatus || "Pending"), startMin: s.startMin ?? null, endMin: s.endMin ?? null
  }));
  const changes = entries.filter(s => s.previousStatus !== status).sort((a,b) => a.id.localeCompare(b.id));
  return {date, status, entries, changes, skipped: entries.length - changes.length};
}
export function bulkStatusFingerprint(plan) {
  return JSON.stringify([plan.date, plan.status, [...plan.entries].sort((a,b)=>a.id.localeCompare(b.id))]);
}
