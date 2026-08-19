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
            ${actions.onConfirmShift ? `<button data-confirm-yes="${shift.id}">Yes</button>` : ""}
            ${actions.onConfirmShift ? `<button data-confirm-no="${shift.id}">No</button>` : ""}
          </div>
      </div>
    `;
  }).join("");

  // Attach button events
  shifts.forEach(shift => {
    const yesBtn = document.querySelector(`[data-confirm-yes="${shift.id}"]`);
    if (yesBtn && actions.onConfirmShift) {
      yesBtn.onclick = () => actions.onConfirmShift(shift.id, "Yes");
    }

    const noBtn = document.querySelector(`[data-confirm-no="${shift.id}"]`);
    if (noBtn && actions.onConfirmShift) {
      noBtn.onclick = () => actions.onConfirmShift(shift.id, "No");
    }
  });
}