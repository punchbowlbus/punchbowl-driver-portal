export const DEFECT_STATUS = Object.freeze({
  NEW: "New",
  ACKNOWLEDGED: "Acknowledged",
  ASSIGNED: "Assigned",
  COMPLETED: "Completed"
});

export const DEFECT_STATUSES = Object.freeze(Object.values(DEFECT_STATUS));

export function normalizeDefectStatus(value) {
  const status = String(value || "").trim().toLowerCase();
  if (["completed", "closed"].includes(status)) return DEFECT_STATUS.COMPLETED;
  if (["assigned", "workshop assigned", "in progress", "waiting parts", "waiting approval"].includes(status)) return DEFECT_STATUS.ASSIGNED;
  if (status === "acknowledged") return DEFECT_STATUS.ACKNOWLEDGED;
  return DEFECT_STATUS.NEW;
}

export function isDefectCompleted(reportOrStatus) {
  const value = typeof reportOrStatus === "object" ? reportOrStatus?.status : reportOrStatus;
  return normalizeDefectStatus(value) === DEFECT_STATUS.COMPLETED;
}
