import { els, showError } from "./ui.js";
import { go } from "./main.js";

export function renderDispatchWorkspacePage() {
  showError("");

  const dispatchDate = sessionStorage.getItem("dispatchDate") || "";

  els.contentArea.innerHTML = `
    <h2 style="margin-top:0">Dispatch Workspace</h2>

    <!-- MAIN BOARD -->
    <div class="card" style="display:flex; flex-direction:column; height:calc(100vh - 120px); overflow:hidden;">

      <!-- HEADER -->
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
        <div>
          <div style="font-size:18px; font-weight:700;">
            Dispatch Date: ${dispatchDate || "Not selected"}
          </div>
          <div class="muted" style="margin-top:4px;">
            This is the main dispatch work area.
          </div>
        </div>

        <div style="display:flex; gap:8px;">
          <button id="backToDispatchBoardBtn">Back</button>
          <button id="openUnassignedJobsBtn">Unassigned Jobs</button>
        </div>
      </div>

      <!-- GRID -->
      <div style="flex:1; display:grid; grid-template-columns:220px 1fr 300px; gap:12px; overflow:hidden;">

        <!-- LEFT -->
        <div style="border:1px solid #ddd; border-radius:12px; background:#fff; display:flex; flex-direction:column; overflow:hidden;">
          <div style="padding:10px 12px; font-weight:700; border-bottom:1px solid #eee; background:#f8f8f8;">
            Drivers
          </div>

          <div style="flex:1; display:flex; align-items:center; justify-content:center; color:#777; padding:12px; text-align:center;">
            Driver list comes next
          </div>
        </div>

        <!-- MIDDLE -->
        <div style="border:1px solid #ddd; border-radius:12px; background:#fff; display:flex; flex-direction:column; overflow:hidden;">
          <div style="padding:10px 12px; font-weight:700; border-bottom:1px solid #eee; background:#f8f8f8;">
            Timeline
          </div>

          <div style="flex:1; display:flex; align-items:center; justify-content:center; color:#777; padding:12px; text-align:center;">
            Main dispatch timeline comes next
          </div>
        </div>

        <!-- RIGHT -->
        <div style="border:1px solid #ddd; border-radius:12px; background:#fff; display:flex; flex-direction:column; overflow:hidden;">
          <div style="padding:10px 12px; font-weight:700; border-bottom:1px solid #eee; background:#f8f8f8;">
            Driver / Duty Details
          </div>

          <div style="flex:1; display:flex; align-items:center; justify-content:center; color:#777; padding:12px; text-align:center;">
            Duty details panel comes next
          </div>
        </div>

      </div>
    </div>

    <!-- SIDE PANEL -->
    <div
      id="unassignedJobsPanel"
      style="
        position:fixed;
        top:80px;
        right:0;
        width:320px;
        height:calc(100vh - 80px);
        background:#fff;
        border-left:1px solid #ddd;
        box-shadow:-6px 0 16px rgba(0,0,0,0.1);
        display:flex;
        flex-direction:column;
        z-index:9999;
      "
    >
      <!-- HEADER -->
      <div style="padding:12px; border-bottom:1px solid #eee; display:flex; justify-content:space-between; align-items:center;">
        <div>
          <div style="font-weight:700;">Unassigned Jobs</div>
          <div class="muted" style="font-size:12px;">
            ${dispatchDate || ""}
          </div>
        </div>
        <button id="closeUnassignedJobsBtn">✕</button>
      </div>

      <!-- BODY -->
      <div style="padding:12px; flex:1; overflow:auto;">
        <div class="muted">Unassigned jobs list comes next.</div>
      </div>
    </div>
  `;

  const backBtn = document.getElementById("backToDispatchBoardBtn");
  const openBtn = document.getElementById("openUnassignedJobsBtn");
  const closeBtn = document.getElementById("closeUnassignedJobsBtn");
  const panel = document.getElementById("unassignedJobsPanel");

  backBtn.onclick = () => {
    go("adminDispatchBoard");
  };

  openBtn.onclick = () => {
    panel.style.display = "flex";
  };

  closeBtn.onclick = () => {
    panel.style.display = "none";
  };
}