// Workshop action confirmations + fleet detail action routing.
// Keeps existing workshop modules as the source of truth while providing
// professional acknowledgement messages on desktop, tablet and phone.

const $ = (id) => document.getElementById(id);

function ensureUi() {
  if (!$("workshopActionStyles")) {
    const style = document.createElement("style");
    style.id = "workshopActionStyles";
    style.textContent = `
      .wk-confirm{width:min(520px,calc(100vw - 28px));border:0;border-radius:16px;padding:0;box-shadow:0 24px 80px rgba(15,23,42,.32)}
      .wk-confirm::backdrop{background:rgba(15,23,42,.58)}
      .wk-confirm-body{padding:22px}.wk-confirm-icon{width:44px;height:44px;border-radius:50%;display:grid;place-items:center;background:#fff1f0;color:#c62828;font-size:22px;font-weight:900;margin-bottom:12px}
      .wk-confirm h2{margin:0 0 8px;font-size:22px}.wk-confirm p{margin:0;color:#667085;line-height:1.5}.wk-confirm-context{margin-top:14px;padding:11px 12px;border-radius:10px;background:#f8fafc;border:1px solid #e4e7ec;font-size:13px;font-weight:800}
      .wk-confirm-actions{display:flex;justify-content:flex-end;gap:10px;margin-top:20px;padding-top:16px;border-top:1px solid #e5e7eb}.wk-confirm-actions button{min-height:44px;border-radius:10px;padding:0 16px;font-weight:800;border:1px solid #d0d5dd;background:#fff;cursor:pointer}.wk-confirm-actions .primary{background:#c62828;border-color:#c62828;color:#fff}
      .wk-toast{position:fixed;right:22px;bottom:22px;z-index:99999;min-width:320px;max-width:520px;background:#fff;border:1px solid #abefc6;border-left:5px solid #12b76a;border-radius:12px;box-shadow:0 16px 40px rgba(15,23,42,.18);padding:14px 16px;display:flex;gap:12px;align-items:flex-start;transform:translateY(18px);opacity:0;pointer-events:none;transition:.18s ease}.wk-toast.show{transform:translateY(0);opacity:1}.wk-toast.error{border-color:#fecdca;border-left-color:#d92d20}.wk-toast .icon{font-size:20px;font-weight:900;color:#039855;line-height:1}.wk-toast.error .icon{color:#d92d20}.wk-toast strong{display:block;margin-bottom:3px;color:#101828}.wk-toast span{display:block;color:#475467;font-size:13px;line-height:1.4}
      @media(max-width:600px){.wk-toast{left:12px;right:12px;bottom:12px;min-width:0}.wk-confirm{width:calc(100vw - 20px)}.wk-confirm-body{padding:18px}.wk-confirm-actions{flex-direction:column-reverse}.wk-confirm-actions button{width:100%}.wf-actions{position:sticky;bottom:0;background:#fff;padding:12px 0 4px;z-index:3}.wf-actions .button{flex:1 1 46%;min-height:46px}.wf-dialog{width:calc(100vw - 12px);max-height:96vh}.wf-shell{padding:14px;max-height:96vh}.wf-head{gap:8px}.wf-title{font-size:24px}.wf-kv{grid-template-columns:110px minmax(0,1fr);font-size:12px}}
    `;
    document.head.appendChild(style);
  }

  if (!$("workshopConfirmDialog")) {
    const dialog = document.createElement("dialog");
    dialog.id = "workshopConfirmDialog";
    dialog.className = "wk-confirm";
    dialog.innerHTML = `<div class="wk-confirm-body"><div class="wk-confirm-icon">!</div><h2 id="wkConfirmTitle">Confirm action</h2><p id="wkConfirmMessage"></p><div id="wkConfirmContext" class="wk-confirm-context"></div><div class="wk-confirm-actions"><button id="wkConfirmCancel" type="button">Cancel</button><button id="wkConfirmOk" class="primary" type="button">Confirm</button></div></div>`;
    document.body.appendChild(dialog);
  }

  if (!$("workshopActionToast")) {
    const toast = document.createElement("div");
    toast.id = "workshopActionToast";
    toast.className = "wk-toast";
    toast.innerHTML = `<div class="icon">✓</div><div><strong>Action completed</strong><span></span></div>`;
    document.body.appendChild(toast);
  }
}

function currentVehicleLabel() {
  const title = document.querySelector("#wfBusDialog .wf-title")?.textContent?.trim();
  const sub = document.querySelector("#wfBusDialog .wf-sub")?.textContent?.trim();
  return [title, sub].filter(Boolean).join(" · ") || "Current vehicle";
}

function ask({ title, message, confirm = "Confirm", context = "" }) {
  ensureUi();
  const dialog = $("workshopConfirmDialog");
  $("wkConfirmTitle").textContent = title;
  $("wkConfirmMessage").textContent = message;
  $("wkConfirmContext").textContent = context || currentVehicleLabel();
  $("wkConfirmOk").textContent = confirm;
  return new Promise((resolve) => {
    const finish = (value) => {
      $("wkConfirmCancel").onclick = null;
      $("wkConfirmOk").onclick = null;
      if (dialog.open) dialog.close();
      resolve(value);
    };
    $("wkConfirmCancel").onclick = () => finish(false);
    $("wkConfirmOk").onclick = () => finish(true);
    dialog.oncancel = (e) => { e.preventDefault(); finish(false); };
    dialog.showModal();
  });
}

let toastTimer;
function toast(message, error = false) {
  ensureUi();
  const el = $("workshopActionToast");
  el.classList.toggle("error", error);
  el.querySelector(".icon").textContent = error ? "!" : "✓";
  el.querySelector("strong").textContent = error ? "Action not completed" : "Action completed";
  el.querySelector("span").textContent = message;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 4500);
}

function cleanFleetCell(cell) {
  if (!cell) return "";
  const clone = cell.cloneNode(true);
  clone.querySelectorAll(".wf-row-open-hint").forEach((el) => el.remove());
  return clone.textContent.trim();
}

function findFleetRow(fleetNumber) {
  const target = String(fleetNumber || "").trim().toLowerCase();
  return [...document.querySelectorAll("#fleetTableBody tr")].find((row) => cleanFleetCell(row.cells?.[0]).toLowerCase() === target) || null;
}

function runHiddenFleetAction(label) {
  const fleetNumber = document.querySelector("#wfBusDialog .wf-title")?.textContent?.trim();
  const row = findFleetRow(fleetNumber);
  const button = row ? [...row.querySelectorAll("button")].find((b) => b.textContent.trim() === label) : null;
  if (!button) {
    toast(`${label} is not available for ${fleetNumber || "this vehicle"}.`, true);
    return false;
  }
  const dialog = $("wfBusDialog");
  if (dialog?.open) dialog.close();
  button.click();
  return true;
}

const vehicleActions = {
  wfEditBus: { title:"Edit Vehicle Record?", message:"Open the full fleet record for editing. Changes will only be saved after you confirm Save Vehicle.", confirm:"Edit Vehicle" },
  wfUpdateKm: { title:"Update Odometer?", message:"Open the odometer entry for this vehicle. The previous reading remains in history.", confirm:"Update km", route:"Update km" },
  wfServiceSetup: { title:"Open Service Setup?", message:"Review or update the maintenance interval and next service settings for this vehicle.", confirm:"Service Setup", route:"Service setup" },
  wfHistory: { title:"View Vehicle History?", message:"Open the permanent workshop and maintenance history for this vehicle.", confirm:"View History", route:"View history" }
};

document.addEventListener("click", async (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  const config = vehicleActions[button.id];
  if (!config) return;
  if (button.dataset.wkConfirmed === "1") {
    delete button.dataset.wkConfirmed;
    return;
  }
  event.preventDefault();
  event.stopImmediatePropagation();
  const ok = await ask(config);
  if (!ok) return;
  if (config.route) {
    runHiddenFleetAction(config.route);
  } else {
    button.dataset.wkConfirmed = "1";
    button.click();
  }
}, true);

// Confirmation for saving a full vehicle edit/create record.
document.addEventListener("submit", async (event) => {
  const form = event.target;
  if (form?.id !== "wfEditForm") return;
  if (form.dataset.wkConfirmed === "1") {
    delete form.dataset.wkConfirmed;
    return;
  }
  event.preventDefault();
  event.stopImmediatePropagation();
  const fleet = $("wfFleetNumber")?.value?.trim() || "vehicle";
  const ok = await ask({ title:"Save Vehicle Record?", message:"Confirm these fleet record changes. The update will be available to Operations and Workshop.", confirm:"Save Vehicle", context:fleet });
  if (ok) {
    form.dataset.wkConfirmed = "1";
    form.requestSubmit();
  }
}, true);

// Convert existing Workshop status messages into consistent visible acknowledgements.
const status = $("status");
if (status) {
  const observer = new MutationObserver(() => {
    const message = status.textContent.trim();
    if (!message) return;
    toast(message, status.classList.contains("error"));
  });
  observer.observe(status, { childList:true, subtree:true, characterData:true, attributes:true, attributeFilter:["class"] });
}

ensureUi();

// Load the popup-free Job Card print handler after the existing Workshop modules.
import("./workshop_print_fix.js?v=20260828-print1").catch((err) => console.error("Workshop print handler failed to load", err));
