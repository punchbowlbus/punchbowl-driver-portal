// Prevent unnecessary DOM replacement flicker on always-on Workshop displays.
// Firestore listeners can re-deliver the same snapshot after reconnects or
// metadata changes. The main Workshop renderer uses innerHTML, so replacing
// identical dashboard markup can produce a visible flash on large screens.

const stableIds = [
  "fleetTableBody",
  "jobsTableBody",
  "jobQueue",
  "odometerBus",
  "jobBus",
  "mechanicTodayDefects",
  "workshopDefectList",
  "workshopDefectSummary",
  "workshopDefectCategory",
  "maintenanceDueList",
  "dashboardJobsList",
  "historyList",
  "odometerHistory"
];

export function installStableInnerHtml(id) {
  const el = document.getElementById(id);
  if (!el || el.dataset.stableHtml === "1") return;

  const proto = Object.getPrototypeOf(el);
  let descriptor = null;
  let cursor = proto;
  while (cursor && !descriptor) {
    descriptor = Object.getOwnPropertyDescriptor(cursor, "innerHTML") || null;
    cursor = Object.getPrototypeOf(cursor);
  }
  if (!descriptor?.get || !descriptor?.set) return;

  let lastRequested;
  Object.defineProperty(el, "innerHTML", {
    configurable: true,
    enumerable: descriptor.enumerable,
    get() {
      return descriptor.get.call(this);
    },
    set(value) {
      const next = String(value ?? "");
      // Row decorators add buttons and columns after the source render.
      // Compare source markup so identical snapshots preserve those additions.
      if (lastRequested === next) return;
      lastRequested = next;
      if (descriptor.get.call(this) === next) return;
      descriptor.set.call(this, next);
    }
  });

  el.dataset.stableHtml = "1";
}

stableIds.forEach(installStableInnerHtml);

// Also avoid repainting metric text when the value did not change.
[
  "metricFleet",
  "metricWorkshop",
  "metricOut",
  "metricOpenJobs",
  "metricDueSoon",
  "metricOverdue",
  "metricAssigned",
  "metricProgress",
  "metricUrgent",
  "metricApproval"
].forEach((id) => {
  const el = document.getElementById(id);
  if (!el) return;
  const proto = Object.getPrototypeOf(el);
  let descriptor = null;
  let cursor = proto;
  while (cursor && !descriptor) {
    descriptor = Object.getOwnPropertyDescriptor(cursor, "textContent") || null;
    cursor = Object.getPrototypeOf(cursor);
  }
  if (!descriptor?.get || !descriptor?.set) return;
  Object.defineProperty(el, "textContent", {
    configurable: true,
    enumerable: descriptor.enumerable,
    get() { return descriptor.get.call(this); },
    set(value) {
      const next = String(value ?? "");
      if (descriptor.get.call(this) === next) return;
      descriptor.set.call(this, next);
    }
  });
});

// For individual cells, compare both requested and rendered HTML: an external
// replacement must still be repaired, while browser HTML normalisation is safe.
const htmlValues = new WeakMap();
export function setHtmlIfChanged(el, value) {
  if (!el) return false;
  const next = String(value ?? "");
  const previous = htmlValues.get(el);
  if (previous?.input === next && previous.output === el.innerHTML) return false;
  if (el.innerHTML !== next) el.innerHTML = next;
  htmlValues.set(el, {input:next, output:el.innerHTML});
  return true;
}
export function setTextIfChanged(el, value) {
  if (el && el.textContent !== String(value ?? "")) el.textContent = String(value ?? "");
}
