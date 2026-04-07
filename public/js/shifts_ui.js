// public/js/shifts_ui.js

import { els } from "./ui.js";

export function renderShifts(shifts, legsByShiftId, options = {}, actions = {}) {
  if (!els.contentArea) return;

  if (!shifts.length) {
    els.contentArea.innerHTML = `<div class="muted">No shifts found.</div>`;
    return;
  }

  els.contentArea.innerHTML = shifts.map(shift => {
    const legs = legsByShiftId[shift.id] || [];

    return `
      <div class="card" style="margin-bottom:14px;">
        <h3>${shift.title || "Shift"}</h3>
        <div class="muted">${shift.date || ""}</div>

        <div style="margin-top:10px;">
          ${legs.map(l => `
            <div style="padding:6px 0; border-bottom:1px solid #eee;">
              ${l.from || ""} → ${l.to || ""}
            </div>
          `).join("")}
        </div>

        <div style="margin-top:10px;">
          ${actions.onAddLeg ? `<button data-add="${shift.id}">Add Leg</button>` : ""}
          ${actions.onConfirmShift ? `<button data-confirm="${shift.id}">Confirm</button>` : ""}
        </div>
      </div>
    `;
  }).join("");

  // Attach button events
  shifts.forEach(shift => {
    const addBtn = document.querySelector(`[data-add="${shift.id}"]`);
    if (addBtn && actions.onAddLeg) {
      addBtn.onclick = () => actions.onAddLeg(shift.id);
    }

    const confirmBtn = document.querySelector(`[data-confirm="${shift.id}"]`);
    if (confirmBtn && actions.onConfirmShift) {
      confirmBtn.onclick = () => actions.onConfirmShift(shift.id, "confirmed");
    }
  });
}