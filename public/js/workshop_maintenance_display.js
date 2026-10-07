// Each maintenance source owns its cards; refreshing one must preserve the others.
const rendered = new WeakMap();
export function renderBaseMaintenance(wrap, html) {
  if (!wrap) return;
  let base = wrap.querySelector("[data-maintenance-base]");
  if (!base) {
    base = document.createElement("div");
    base.dataset.maintenanceBase = "1";
    base.style.display = "contents";
    wrap.prepend(base);
  }
  if (rendered.get(base) !== html) {
    base.innerHTML = html;
    rendered.set(base, html);
  }
  syncMaintenanceEmpty(wrap);
}
export function syncMaintenanceEmpty(wrap) {
  if (!wrap) return;
  const empty = [...wrap.querySelectorAll(".empty")];
  if (wrap.querySelector(".list-item")) {
    empty.forEach(el => el.remove());
  } else if (!empty.length) {
    const el = document.createElement("div");
    el.className = "empty";
    el.textContent = "No maintenance or registration items currently due.";
    wrap.appendChild(el);
  }
}
