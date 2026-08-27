// Prevent unnecessary DOM replacement flicker on always-on Workshop displays.
// Firestore listeners can re-deliver the same snapshot after reconnects or
// metadata changes. The main Workshop renderer uses innerHTML, so replacing
// identical dashboard markup can produce a visible flash on large screens.

const stableIds = [
  "maintenanceDueList",
  "dashboardJobsList",
  "historyList",
  "odometerHistory"
];

function installStableInnerHtml(id) {
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

  Object.defineProperty(el, "innerHTML", {
    configurable: true,
    enumerable: descriptor.enumerable,
    get() {
      return descriptor.get.call(this);
    },
    set(value) {
      const next = String(value ?? "");
      const current = descriptor.get.call(this);
      if (current === next) return;
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
  "metricOverdue"
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
