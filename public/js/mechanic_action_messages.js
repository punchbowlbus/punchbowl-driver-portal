// Professional confirmation + acknowledgement messages for mechanic tablet actions.
// Runs after mechanic_work_queue.js and does not change the job-card data model.

const actionConfig = {
  startJobBtn: {
    title: "Start Workshop Job?",
    message: "This will mark the job as In Progress and record that workshop work has started.",
    confirm: "Start Job"
  },
  waitingPartsBtn: {
    title: "Mark as Waiting Parts?",
    message: "This will pause the job in Waiting Parts until the required parts are available.",
    confirm: "Waiting Parts"
  },
  saveProgressBtn: {
    title: "Save Job Card Progress?",
    message: "Your current job-card entries, checklist, parts, labour and notes will be saved.",
    confirm: "Save Progress"
  },
  completeJobBtn: {
    title: "Complete Job Card?",
    message: "This will submit the completed job card to the Fleet Manager for review and approval. The mechanic will no longer be able to edit it while it is waiting for approval.",
    confirm: "Complete & Send for Approval",
    danger: true
  }
};

function ensureActionUi() {
  if (!document.getElementById("mechanicActionUiStyles")) {
    const style = document.createElement("style");
    style.id = "mechanicActionUiStyles";
    style.textContent = `
      .mech-confirm-dialog{width:min(520px,calc(100vw - 28px));border:0;border-radius:16px;padding:0;box-shadow:0 24px 80px rgba(15,23,42,.32)}
      .mech-confirm-dialog::backdrop{background:rgba(15,23,42,.58)}
      .mech-confirm-body{padding:22px}
      .mech-confirm-icon{width:44px;height:44px;border-radius:50%;display:grid;place-items:center;background:#fff1f0;color:#c62828;font-size:22px;font-weight:900;margin-bottom:12px}
      .mech-confirm-body h2{margin:0 0 8px;font-size:22px}
      .mech-confirm-body p{margin:0;color:#667085;line-height:1.5}
      .mech-confirm-job{margin-top:14px;padding:11px 12px;border-radius:10px;background:#f8fafc;border:1px solid #e4e7ec;font-size:13px;font-weight:800}
      .mech-confirm-actions{display:flex;justify-content:flex-end;gap:10px;margin-top:20px;padding-top:16px;border-top:1px solid #e5e7eb}
      .mech-confirm-actions button{min-height:42px;border-radius:10px;padding:0 16px;font-weight:800;border:1px solid #d0d5dd;background:#fff;cursor:pointer}
      .mech-confirm-actions .confirm{background:#c62828;border-color:#c62828;color:#fff}
      .mech-confirm-actions .confirm.danger{background:#b42318;border-color:#b42318}
      .mech-action-toast{position:fixed;right:22px;bottom:22px;z-index:99999;min-width:320px;max-width:520px;background:#fff;border:1px solid #abefc6;border-left:5px solid #12b76a;border-radius:12px;box-shadow:0 16px 40px rgba(15,23,42,.18);padding:14px 16px;display:flex;gap:12px;align-items:flex-start;transform:translateY(18px);opacity:0;pointer-events:none;transition:.18s ease}
      .mech-action-toast.show{transform:translateY(0);opacity:1}
      .mech-action-toast.error{border-color:#fecdca;border-left-color:#d92d20}
      .mech-action-toast .icon{font-size:20px;font-weight:900;color:#039855;line-height:1}
      .mech-action-toast.error .icon{color:#d92d20}
      .mech-action-toast strong{display:block;margin-bottom:3px;color:#101828}
      .mech-action-toast span{display:block;color:#475467;font-size:13px;line-height:1.4}
      @media(max-width:600px){.mech-action-toast{left:12px;right:12px;bottom:12px;min-width:0}}
    `;
    document.head.appendChild(style);
  }

  if (!document.getElementById("mechanicConfirmDialog")) {
    const dialog = document.createElement("dialog");
    dialog.id = "mechanicConfirmDialog";
    dialog.className = "mech-confirm-dialog";
    dialog.innerHTML = `
      <div class="mech-confirm-body">
        <div class="mech-confirm-icon">!</div>
        <h2 id="mechanicConfirmTitle">Confirm action</h2>
        <p id="mechanicConfirmMessage"></p>
        <div id="mechanicConfirmJob" class="mech-confirm-job"></div>
        <div class="mech-confirm-actions">
          <button id="mechanicConfirmCancel" type="button">Cancel</button>
          <button id="mechanicConfirmOk" class="confirm" type="button">Confirm</button>
        </div>
      </div>`;
    document.body.appendChild(dialog);
  }

  if (!document.getElementById("mechanicActionToast")) {
    const toast = document.createElement("div");
    toast.id = "mechanicActionToast";
    toast.className = "mech-action-toast";
    toast.innerHTML = `<div class="icon">✓</div><div><strong>Action completed</strong><span></span></div>`;
    document.body.appendChild(toast);
  }
}

function currentJobLabel() {
  const title = document.getElementById("jobCardTitle")?.textContent?.trim();
  const vehicle = document.getElementById("jobCardVehicle")?.textContent?.trim();
  return [title, vehicle].filter(Boolean).join(" · ") || "Current workshop job";
}

function confirmAction(config) {
  ensureActionUi();
  const dialog = document.getElementById("mechanicConfirmDialog");
  const title = document.getElementById("mechanicConfirmTitle");
  const message = document.getElementById("mechanicConfirmMessage");
  const job = document.getElementById("mechanicConfirmJob");
  const cancel = document.getElementById("mechanicConfirmCancel");
  const ok = document.getElementById("mechanicConfirmOk");

  title.textContent = config.title;
  message.textContent = config.message;
  job.textContent = currentJobLabel();
  ok.textContent = config.confirm;
  ok.classList.toggle("danger", !!config.danger);

  return new Promise((resolve) => {
    const finish = (value) => {
      cancel.onclick = null;
      ok.onclick = null;
      if (dialog.open) dialog.close();
      resolve(value);
    };
    cancel.onclick = () => finish(false);
    ok.onclick = () => finish(true);
    dialog.oncancel = (event) => { event.preventDefault(); finish(false); };
    dialog.showModal();
  });
}

let toastTimer = null;
function showActionToast(message, isError = false) {
  ensureActionUi();
  const toast = document.getElementById("mechanicActionToast");
  toast.classList.toggle("error", isError);
  toast.querySelector(".icon").textContent = isError ? "!" : "✓";
  toast.querySelector("strong").textContent = isError ? "Action not completed" : "Action completed";
  toast.querySelector("span").textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 4500);
}

// Capture before the existing mechanic_work_queue.js handlers. After confirmation,
// the same button is clicked once more with a one-shot bypass flag so the existing
// save logic remains the single source of truth.
document.addEventListener("click", async (event) => {
  const button = event.target.closest("button");
  if (!button) return;

  const config = actionConfig[button.id];
  if (config) {
    if (button.dataset.confirmedAction === "1") {
      delete button.dataset.confirmedAction;
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    const approved = await confirmAction(config);
    if (approved) {
      button.dataset.confirmedAction = "1";
      button.click();
    }
    return;
  }

  if (button.classList.contains("remove-part")) {
    if (button.dataset.confirmedAction === "1") {
      delete button.dataset.confirmedAction;
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    const approved = await confirmAction({
      title: "Remove Part Entry?",
      message: "This part line will be removed from the current job card. The change is not permanent until progress is saved.",
      confirm: "Remove Part"
    });
    if (approved) {
      button.dataset.confirmedAction = "1";
      button.click();
    }
  }
}, true);

// Convert the existing status acknowledgement into a visible tablet-friendly popup.
const statusEl = document.getElementById("status");
if (statusEl) {
  const statusObserver = new MutationObserver(() => {
    const message = statusEl.textContent.trim();
    if (!message) return;
    const isError = statusEl.classList.contains("error");
    showActionToast(message, isError);
  });
  statusObserver.observe(statusEl, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ["class"] });
}

ensureActionUi();
