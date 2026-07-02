import {
  addJobGroup,
  updateJobGroup,
  deleteJobGroup,
  addBlock,
  updateBlock,
  deleteBlock,
  listenBlocksByDate,
  listenBlocksAll,
  listenJobGroups,
  addRecurringTemplate,
  updateRecurringTemplate,
  deleteRecurringTemplate,
  markRecurringTemplateGenerated,
  listenRecurringTemplates,
  listenTemplateLegs,
  addTemplateLeg,
  updateTemplateLeg,
  deleteTemplateLeg
} from "./db.js";

console.log("admin_v2.js loaded - MULTISTOP TEST 123");

import { els, showError } from "./ui.js";
import { auth } from "./firebase.js";
import { state } from "./state.js";
import { renderAdminPermanentRunsPage } from "./permanent_runs.js";

export { renderEmployeesPage } from "./employees.js";
export { renderBusesPage } from "./buses.js";

/* =========================================================
   Helpers
========================================================= */
function minFromTimeStr(t) {
  if (!t) return null;
  const [h, m] = t.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}
function pad2(n) {
  return String(n).padStart(2, "0");
}
function timeStrFromMin(min) {
  if (min == null) return "";
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${pad2(h)}:${pad2(m)}`;
}
function escapeHtml(s) {
  return (s ?? "")
    .toString()
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function uid() {
  try {
    if (crypto?.randomUUID) return crypto.randomUUID();
  } catch {}
  return `p_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

// ✅ supports old + new schema fields
function jgTitle(jg) {
  return (jg?.title || jg?.name || "").toString();
}
function jgClient(jg) {
  return (jg?.clientName || jg?.client || jg?.school || "").toString();
}
function jgNotes(jg) {
  return (jg?.notes || "").toString();
}

/* =========================================================
   Module cache + listeners
========================================================= */
let jobGroupsCache = [];
let recurringCache = [];

let blocksUnsub = null;
let blocksAllUnsub = null;
let jobGroupsUnsub = null;
let recurringUnsub = null;

// edit mode for job groups page
let editingJobGroupId = null;

/* =========================================================
   JOB GROUPS PAGE UI (Create/Edit/Delete + List)
========================================================= */
function renderJobGroupsManager() {
  return `
    <div class="card">
      <h3 style="margin-top:0">Job Groups</h3>

      <div class="muted" style="margin-bottom:8px">
        Selected Job Group:
        <b id="selectedJGLabel">None</b>
      </div>

      <hr style="margin:14px 0; border:none; border-top:1px solid #eee" />

      <h4 style="margin:0 0 10px">Create / Edit Job Group</h4>
      <input id="jgTitle" placeholder="Job Title (e.g. MCCP 3 PM / Kent Road PS)" />
      <input id="jgClient" placeholder="Client / School" />
      <textarea id="jgNotes" placeholder="Notes (bus qty, pax, contact, special instructions)"></textarea>

      <div style="display:flex; gap:10px; margin-top:10px; align-items:center">
        <button id="createJG">Create Job Group</button>
        <button id="cancelEditJG" style="display:none" class="btn">Cancel</button>
      </div>

      <hr style="margin:16px 0; border:none; border-top:1px solid #eee" />

      <h4 style="margin:0 0 10px">All Job Groups</h4>
      <input id="jgSearch" placeholder="Search Job Groups (type MCCP / school name)" />

      <div id="jgList" style="
        margin-top:10px;
        max-height:320px;
        overflow:auto;
        border:1px solid #eee;
        border-radius:12px;
      "></div>
    </div>
  `;
}

function wireJobGroupsManager() {
  const listEl = document.getElementById("jgList");
  const searchEl = document.getElementById("jgSearch");

  const titleEl = document.getElementById("jgTitle");
  const clientEl = document.getElementById("jgClient");
  const notesEl = document.getElementById("jgNotes");

  const createBtn = document.getElementById("createJG");
  const cancelBtn = document.getElementById("cancelEditJG");

  if (!listEl || !searchEl || !titleEl || !clientEl || !notesEl || !createBtn || !cancelBtn) return;

  editingJobGroupId = null;
  createBtn.textContent = "Create Job Group";
  cancelBtn.style.display = "none";

  cancelBtn.onclick = () => {
    editingJobGroupId = null;
    titleEl.value = "";
    clientEl.value = "";
    notesEl.value = "";
    createBtn.textContent = "Create Job Group";
    cancelBtn.style.display = "none";
  };

  if (jobGroupsUnsub) jobGroupsUnsub();
  jobGroupsUnsub = listenJobGroups(
    (list) => {
      jobGroupsCache = (list || []).filter((x) => !x.deleted);
      renderList();
      updateSelectedLabels();
    },
    (e) => showError(e?.message || "Failed to load job groups")
  );

  searchEl.oninput = () => renderList();

  createBtn.onclick = async () => {
    showError("");
    try {
      const title = titleEl.value.trim();
      const client = clientEl.value.trim();
      const notes = notesEl.value.trim();

      if (!title) return showError("Job Group Title is required.");

      if (editingJobGroupId) {
        await updateJobGroup(editingJobGroupId, {
          title,
          clientName: client,
          notes
        });

        alert("Job Group updated ✅");
        editingJobGroupId = null;
        createBtn.textContent = "Create Job Group";
        cancelBtn.style.display = "none";
      } else {
        const docRef = await addJobGroup({
          title,
          clientName: client,
          notes,
          deleted: false,
          createdBy: auth.currentUser?.email
        });

        state.selectedJobGroupId = docRef.id;
        alert("Job Group created and selected ✅");
      }

      titleEl.value = "";
      clientEl.value = "";
      notesEl.value = "";
    } catch (e) {
      showError(e?.message || "Failed to save job group");
    }
  };

  function renderList() {
    const q = (searchEl.value || "").trim().toLowerCase();

    const filtered = !q
      ? jobGroupsCache
      : jobGroupsCache.filter((jg) => {
          const t = `${jgTitle(jg)} ${jgClient(jg)} ${jgNotes(jg)} ${jg.id || ""}`.toLowerCase();
          return t.includes(q);
        });

    if (!filtered.length) {
      listEl.innerHTML = `<div class="muted" style="padding:10px">No job groups found.</div>`;
      return;
    }

    listEl.innerHTML = filtered
      .slice(0, 200)
      .map((jg) => {
        const active = state.selectedJobGroupId === jg.id;

        const createdBy = jg.createdBy ? `Created by: ${escapeHtml(jg.createdBy)}` : "";
        const title = escapeHtml(jgTitle(jg) || "(No title)");
        const client = escapeHtml(jgClient(jg) || "");
        const notes = escapeHtml(jgNotes(jg) || "");

        return `
          <div data-jg="${jg.id}" style="
            padding:10px 12px;
            border-bottom:1px solid #eee;
            background:${active ? "#fdecec" : "#fff"};
          ">
            <div style="display:flex; justify-content:space-between; gap:10px; align-items:flex-start">
              <div style="flex:1; cursor:pointer" data-jg-pick="${jg.id}">
                <div style="font-weight:900">${title}</div>
                ${client ? `<div class="muted" style="font-size:13px">${client}</div>` : ""}
                ${notes ? `<div class="muted" style="font-size:13px; margin-top:4px">${notes}</div>` : ""}
                ${createdBy ? `<div class="muted" style="font-size:12px; margin-top:6px">${createdBy}</div>` : ""}
                <div class="muted" style="font-size:12px; margin-top:6px">${escapeHtml(jg.id)}</div>
              </div>

              <div style="display:flex; gap:8px; flex-shrink:0">
                <button class="btn" data-edit="${jg.id}">Edit</button>
                <button class="btn danger" data-del="${jg.id}">Delete</button>
              </div>
            </div>
          </div>
        `;
      })
      .join("");

    [...listEl.querySelectorAll("[data-jg-pick]")].forEach((row) => {
      row.onclick = () => {
        state.selectedJobGroupId = row.getAttribute("data-jg-pick");
        updateSelectedLabels();
        renderList();
      };
    });

    [...listEl.querySelectorAll("[data-edit]")].forEach((btn) => {
      btn.onclick = () => {
        const id = btn.getAttribute("data-edit");
        const jg = jobGroupsCache.find((x) => x.id === id);
        if (!jg) return;

        editingJobGroupId = id;
        titleEl.value = jgTitle(jg);
        clientEl.value = jgClient(jg);
        notesEl.value = jgNotes(jg);

        createBtn.textContent = "Save Changes";
        cancelBtn.style.display = "inline-block";
      };
    });

    [...listEl.querySelectorAll("[data-del]")].forEach((btn) => {
      btn.onclick = async () => {
        const id = btn.getAttribute("data-del");
        const jg = jobGroupsCache.find((x) => x.id === id);
        const label = jg ? `${jgTitle(jg)}` : id;

        if (!confirm(`Delete Job Group: ${label} ?`)) return;

        try {
          await deleteJobGroup(id);

          if (state.selectedJobGroupId === id) {
            state.selectedJobGroupId = null;
            updateSelectedLabels();
          }
        } catch (e) {
          showError(e?.message || "Failed to delete job group");
        }
      };
    });
  }

  function updateSelectedLabels() {
    const jg = jobGroupsCache.find((x) => x.id === state.selectedJobGroupId) || null;
    const label = jg ? `${jgTitle(jg)}${jgClient(jg) ? " — " + jgClient(jg) : ""}` : "None";

    const a = document.getElementById("selectedJGLabel");
    if (a) a.textContent = label;
  }
}

/* =========================================================
   Pages - Job Groups page
========================================================= */
export function renderAdminBookings() {
  showError("");
  els.contentArea.innerHTML = `
    <h2 style="margin-top:0">Job Groups</h2>
    ${renderJobGroupsManager()}
  `;
  wireJobGroupsManager();
}

/* =========================================================
   BLOCKS PAGE (dropdown only + Multi-leg entry)
========================================================= */
function renderJobGroupDropdownOnly() {
  return `
    <div class="card">
      <h3 style="margin-top:0">Select Job Group</h3>

      <div class="muted" style="margin-bottom:6px">
        Selected:
        <b id="selectedJGLabel">None</b>
      </div>

      <select id="jgSelect" style="width:100%">
        <option value="">-- Select Job Group --</option>
      </select>

      <div class="muted" style="margin-top:8px; font-size:12px">
        Tip: Create/edit job groups in the “Job Groups” page.
      </div>
    </div>
  `;
}

function wireJobGroupDropdownOnly() {
  const sel = document.getElementById("jgSelect");
  if (!sel) return;

  if (jobGroupsUnsub) jobGroupsUnsub();
  jobGroupsUnsub = listenJobGroups(
    (list) => {
      jobGroupsCache = (list || []).filter((x) => !x.deleted);
      rebuildOptions();
      updateLabel();
    },
    (e) => showError(e?.message || "Failed to load job groups")
  );

  sel.onchange = () => {
    state.selectedJobGroupId = sel.value || null;
    updateLabel();
  };

  function rebuildOptions() {
    const old = state.selectedJobGroupId || "";
    const opts = [`<option value="">-- Select Job Group --</option>`]
      .concat(
        jobGroupsCache
          .slice()
          .sort((a, b) => (jgTitle(a) || "").localeCompare(jgTitle(b) || ""))
          .map((jg) => {
            const label = `${jgTitle(jg) || "(No title)"}${jgClient(jg) ? " — " + jgClient(jg) : ""}`;
            return `<option value="${escapeHtml(jg.id)}">${escapeHtml(label)}</option>`;
          })
      )
      .join("");

    sel.innerHTML = opts;
    const stillExists = jobGroupsCache.some((jg) => jg.id === old);
    sel.value = stillExists ? old : "";
    if (!stillExists) state.selectedJobGroupId = null;
  }

  function updateLabel() {
    const jg = jobGroupsCache.find((x) => x.id === state.selectedJobGroupId) || null;
    const label = jg ? `${jgTitle(jg)}${jgClient(jg) ? " — " + jgClient(jg) : ""}` : "None";

    const a = document.getElementById("selectedJGLabel");
    if (a) a.textContent = label;

    const b = document.getElementById("blockJGLabel");
    if (b) b.textContent = label || "No Job Group selected";
  }
}

function renderMultiLegRowsContainer() {
  return `
    <div id="loopWrap" style="display:none; margin-top:14px; padding:12px; border:1px solid #e5e7eb; border-radius:12px; background:#fafafa;">
      <div style="font-weight:900; margin-bottom:6px;">Loop / Multi-stop Builder</div>

      <div class="muted" style="font-size:12px; margin-bottom:12px;">
        Enter the start location once, then add stops in order. The system will generate the legs automatically and save as one draggable block.
      </div>

      <div style="display:grid; grid-template-columns:1fr 160px; gap:10px;">
        <div>
          <div class="muted" style="margin-bottom:4px;">Start Location</div>
          <input id="multiStartLocation" placeholder="e.g. Wiley Park Girls High School" />
        </div>

        <div>
          <div class="muted" style="margin-bottom:4px;">Start Time</div>
          <input id="multiStartTime" type="time" />
        </div>
      </div>

      <div style="margin-top:14px;">
        <div style="font-weight:800; margin-bottom:8px;">Stops</div>
        <div id="multiStopRows"></div>

        <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:10px;">
          <button id="addMultiStopBtn" type="button" class="btn">+ Add Stop</button>
          <button id="clearMultiStopsBtn" type="button" class="btn danger">Clear Stops</button>
        </div>
      </div>

      <div style="margin-top:14px; padding-top:12px; border-top:1px solid #e5e7eb;">
        <div class="muted" style="margin-bottom:4px;">Return Option</div>
        <select id="multiReturnOption">
          <option value="NONE">No return</option>
          <option value="SAME_ROUTE">Return same route</option>
        </select>

        <div id="multiReturnWrap" style="display:none; margin-top:10px;">
          <div class="muted" style="font-size:12px; margin-bottom:8px;">
            First version: return same route is saved as one return summary leg. Later we can expand it into full reverse stop times.
          </div>

          <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
            <div>
              <div class="muted" style="margin-bottom:4px;">Return Start Time</div>
              <input id="multiReturnStartTime" type="time" />
            </div>

            <div>
              <div class="muted" style="margin-bottom:4px;">Return Finish Time</div>
              <input id="multiReturnFinishTime" type="time" />
            </div>
          </div>
        </div>
      </div>

      <div style="margin-top:14px; padding-top:12px; border-top:1px solid #e5e7eb;">
        <div style="font-weight:800; margin-bottom:8px;">Generated Legs Preview</div>
        <div id="multiLegPreview" class="muted">Add start location, stops, and times to preview legs.</div>
      </div>
    </div>
  `;
}
function multiStopRowTemplate(idx) {
  return `
    <div
      data-multi-stop-row="${idx}"
      style="
        margin-top:8px;
        padding:10px;
        border:1px solid #e5e7eb;
        border-radius:10px;
        background:#fff;
      "
    >
      <div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
        <div style="font-weight:800;">Stop ${idx + 1}</div>
        <button type="button" class="btn danger" data-remove-multi-stop="${idx}">Remove</button>
      </div>

      <div style="display:grid; grid-template-columns:1fr 150px 150px; gap:10px; margin-top:8px;">
        <div>
          <div class="muted" style="margin-bottom:4px;">Stop Name</div>
          <input class="multiStopName" placeholder="Stop name / venue" />
        </div>

        <div>
          <div class="muted" style="margin-bottom:4px;">Arrival</div>
          <input class="multiStopArrival" type="time" />
        </div>

        <div>
          <div class="muted" style="margin-bottom:4px;">Departure</div>
          <input class="multiStopDeparture" type="time" />
        </div>
      </div>

      <div style="margin-top:8px;">
        <div class="muted" style="margin-bottom:4px;">Stop Note</div>
        <input class="multiStopNote" placeholder="Optional note, pickup point, gate, side street, etc." />
      </div>
    </div>
  `;
}
function loopRowTemplate(idx) {
  return `
    <div class="card" style="margin-top:10px; padding:12px" data-loop-row="${idx}">
      <div style="display:flex; justify-content:space-between; align-items:center; gap:10px">
        <div style="font-weight:900">Leg ${idx + 1}</div>
        <button class="btn danger" data-remove-row="${idx}">Remove</button>
      </div>

      <input class="lrFrom" placeholder="From" />
      <input class="lrTo" placeholder="To" />

      <div style="display:flex; gap:10px">
        <div style="flex:1">
          <div class="muted" style="margin:6px 0 4px">Start Time</div>
          <input class="lrStart" type="time" />
        </div>
        <div style="flex:1">
          <div class="muted" style="margin:6px 0 4px">End Time</div>
          <input class="lrEnd" type="time" />
        </div>
      </div>

      <div class="muted" style="margin:10px 0 4px">Leg Type</div>
      <select class="lrType">
        <option value="Loop">Loop</option>
        <option value="Forward">Forward</option>
        <option value="Return">Return</option>
        <option value="Extra">Extra</option>
      </select>
    </div>
  `;
}

function wireBlockEntryAdvanced() {
const patternEl = document.getElementById("tripPattern");
const returnWrap = document.getElementById("returnWrap");
const loopWrap = document.getElementById("loopWrap");
const oneWayWrap = document.getElementById("oneWayWrap");

  const addStopBtn = document.getElementById("addMultiStopBtn");
  const clearStopsBtn = document.getElementById("clearMultiStopsBtn");
  const stopRowsEl = document.getElementById("multiStopRows");
  const returnOptionEl = document.getElementById("multiReturnOption");
  const multiReturnWrap = document.getElementById("multiReturnWrap");

  if (!patternEl || !returnWrap || !loopWrap) return;

  function reindexStopRows() {
    const rows = [...(stopRowsEl?.querySelectorAll("[data-multi-stop-row]") || [])];

    rows.forEach((row, i) => {
      row.setAttribute("data-multi-stop-row", String(i));

      const title = row.querySelector("div[style*='font-weight:800']");
      if (title) title.textContent = `Stop ${i + 1}`;

      const removeBtn = row.querySelector("[data-remove-multi-stop]");
      if (removeBtn) removeBtn.setAttribute("data-remove-multi-stop", String(i));
    });
  }

  function wireStopRowEvents() {
    [...(stopRowsEl?.querySelectorAll("[data-remove-multi-stop]") || [])].forEach((btn) => {
      btn.onclick = () => {
        const idx = Number(btn.getAttribute("data-remove-multi-stop"));
        const row = stopRowsEl.querySelector(`[data-multi-stop-row="${idx}"]`);
        if (row) row.remove();
        reindexStopRows();
        renderMultiLegPreview();
      };
    });

    [...(stopRowsEl?.querySelectorAll("input") || [])].forEach((input) => {
      input.oninput = renderMultiLegPreview;
      input.onchange = renderMultiLegPreview;
    });
  }

  function addStopRow() {
    if (!stopRowsEl) return;

    const idx = stopRowsEl.children.length;
    stopRowsEl.insertAdjacentHTML("beforeend", multiStopRowTemplate(idx));
    wireStopRowEvents();
    renderMultiLegPreview();
  }

  function ensureAtLeastOneStop() {
    if (!stopRowsEl) return;
    if (stopRowsEl.children.length === 0) addStopRow();
  }

  function getMultiStopDataForPreview() {
    const startLocation = (document.getElementById("multiStartLocation")?.value || "").trim();
    const startTime = document.getElementById("multiStartTime")?.value || "";

    const stops = [...(stopRowsEl?.querySelectorAll("[data-multi-stop-row]") || [])].map((row) => ({
      name: (row.querySelector(".multiStopName")?.value || "").trim(),
      arrivalTime: row.querySelector(".multiStopArrival")?.value || "",
      departureTime: row.querySelector(".multiStopDeparture")?.value || "",
      note: (row.querySelector(".multiStopNote")?.value || "").trim()
    }));

    const returnOption = document.getElementById("multiReturnOption")?.value || "NONE";
    const returnStartTime = document.getElementById("multiReturnStartTime")?.value || "";
    const returnFinishTime = document.getElementById("multiReturnFinishTime")?.value || "";

    return {
      startLocation,
      startTime,
      stops,
      returnOption,
      returnStartTime,
      returnFinishTime
    };
  }

  function buildPreviewLegs(data) {
    const legs = [];

    if (!data.startLocation || !data.startTime || !data.stops.length) return legs;

    const validStops = data.stops.filter((s) => s.name);
    if (!validStops.length) return legs;

    legs.push({
      legNo: 1,
      legType: "Forward",
      from: data.startLocation,
      to: validStops[0].name,
      startTime: data.startTime,
      endTime: validStops[0].arrivalTime || ""
    });

    for (let i = 1; i < validStops.length; i++) {
      legs.push({
        legNo: legs.length + 1,
        legType: "Forward",
        from: validStops[i - 1].name,
        to: validStops[i].name,
        startTime: validStops[i - 1].departureTime || "",
        endTime: validStops[i].arrivalTime || ""
      });
    }

    const lastStop = validStops[validStops.length - 1];

    if (data.returnOption === "SAME_ROUTE" && data.returnStartTime && data.returnFinishTime) {
      legs.push({
        legNo: legs.length + 1,
        legType: "Return",
        from: lastStop.name,
        to: data.startLocation,
        startTime: data.returnStartTime,
        endTime: data.returnFinishTime,
        note: "Return same route summary"
      });
    }

    return legs;
  }

  function renderMultiLegPreview() {
    const previewEl = document.getElementById("multiLegPreview");
    if (!previewEl) return;

    const data = getMultiStopDataForPreview();
    const legs = buildPreviewLegs(data);

    if (!legs.length) {
      previewEl.innerHTML = `Add start location, stops, and times to preview legs.`;
      return;
    }

    previewEl.innerHTML = `
      <div style="display:grid; gap:6px;">
        ${legs
          .map((leg) => `
            <div style="
              padding:8px;
              border:1px solid #e5e7eb;
              border-radius:8px;
              background:#fff;
              color:#111;
            ">
              <div style="font-weight:800;">
                Leg ${leg.legNo}: ${escapeHtml(leg.from)} → ${escapeHtml(leg.to)}
              </div>
              <div class="muted" style="font-size:12px; margin-top:3px;">
                ${escapeHtml(leg.legType)} · ${escapeHtml(leg.startTime || "--:--")} - ${escapeHtml(leg.endTime || "--:--")}
                ${leg.note ? ` · ${escapeHtml(leg.note)}` : ""}
              </div>
            </div>
          `)
          .join("")}
      </div>
    `;
  }

  function updateTripPatternUI() {
    const v = patternEl.value;

    if (oneWayWrap) {
      oneWayWrap.hidden = v === "LOOP";
      oneWayWrap.style.display = v === "LOOP" ? "none" : "block";
    }

    returnWrap.hidden = v !== "FR";
    returnWrap.style.display = v === "FR" ? "block" : "none";

    loopWrap.hidden = v !== "LOOP";
    loopWrap.style.display = v === "LOOP" ? "block" : "none";

    if (v === "LOOP") ensureAtLeastOneStop();

    console.log("Trip pattern UI updated:", v, {
      oneWayHidden: oneWayWrap?.hidden,
      loopHidden: loopWrap?.hidden
    });
  }

  patternEl.onchange = updateTripPatternUI;
  if (addStopBtn) addStopBtn.onclick = () => addStopRow();

  if (clearStopsBtn) {
    clearStopsBtn.onclick = () => {
      if (!stopRowsEl) return;
      stopRowsEl.innerHTML = "";
      ensureAtLeastOneStop();
      renderMultiLegPreview();
    };
  }


  if (returnOptionEl && multiReturnWrap) {
    returnOptionEl.onchange = () => {
      multiReturnWrap.style.display = returnOptionEl.value === "SAME_ROUTE" ? "block" : "none";
      renderMultiLegPreview();
    };
  }

[
  "multiStartLocation",
  "multiStartTime",
  "multiReturnStartTime",
  "multiReturnFinishTime"
].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.oninput = renderMultiLegPreview;
    el.onchange = renderMultiLegPreview;
  });

updateTripPatternUI();
}

export function renderAdminBlocks() {
  showError("");
  els.contentArea.innerHTML = `
    <h2 style="margin-top:0">Blocks</h2>

    ${renderJobGroupDropdownOnly()}

        <div class="card" style="margin-top:18px">
          <h3 style="margin-top:0">Add Block / Trip</h3>

          <div class="muted" style="margin-bottom:8px">
            Saving under: <b id="blockJGLabel">No Job Group selected</b>
          </div>

          <input id="blockDate" type="date" />

          <div class="muted" style="margin:10px 0 4px">Trip Pattern</div>

          <select id="tripPattern">
            <option value="ONE">One Way (1 leg)</option>
            <option value="FR">Forward + Return (2 legs)</option>
            <option value="LOOP">Loop / Multi-leg (many legs)</option>
          </select>

          <!-- ✅ CORRECT placement -->
          <div style="margin-top:10px">
            <div class="muted" style="margin-bottom:4px">How many buses?</div>
            <input id="busCount" type="number" min="1" value="1" style="width:120px" />
            <div style="font-size:12px; color:#666; margin-top:4px;">
              Creates multiple identical blocks
            </div>
          </div>

          <div id="oneWayWrap" style="margin-top:12px">
            <div class="muted" style="margin-bottom:6px">Forward / One Way</div>

            <input id="blockFrom" placeholder="From" />
            <input id="blockTo" placeholder="To" />

            <div style="display:flex; gap:10px">
              <div style="flex:1">
                <div class="muted" style="margin:6px 0 4px">Start Time</div>
                <input id="blockStart" type="time" />
              </div>
              <div style="flex:1">
                <div class="muted" style="margin:6px 0 4px">End Time</div>
                <input id="blockEnd" type="time" />
              </div>
            </div>

            <div class="muted" style="margin:10px 0 4px">Block Type</div>
            <select id="blockType">
              <option value="Forward">Forward</option>
              <option value="Return">Return</option>
              <option value="Loop">Loop</option>
              <option value="Extra">Extra</option>
            </select>

            <div id="returnWrap" style="display:none; margin-top:12px; padding-top:10px; border-top:1px solid #eee">
              <div class="muted" style="margin-bottom:6px">
                Return (times only — From/To will be auto swapped)
              </div>

              <div style="display:flex; gap:10px">
                <div style="flex:1">
                  <div class="muted" style="margin:6px 0 4px">Return Start Time</div>
                  <input id="returnStart" type="time" />
                </div>
                <div style="flex:1">
                  <div class="muted" style="margin:6px 0 4px">Return End Time</div>
                  <input id="returnEnd" type="time" />
                </div>
              </div>
            </div>

          </div>

          ${renderMultiLegRowsContainer()}

          <textarea id="blockNotes" placeholder="Notes (bus 1/bus 2, pax, changes, school time change etc.)"></textarea>

          <button id="createBlock">Save</button>

          <div class="muted" style="margin-top:8px">
            Tip: For 2 buses, use “How many buses?” above.
          </div>
        </div>
  `;

  wireJobGroupDropdownOnly();
  wireBlockEntryAdvanced();

  setTimeout(() => {
    document.getElementById("tripPattern")?.dispatchEvent(new Event("change"));
  }, 0);

  wireCreateBlockAdvanced();
}

function wireCreateBlockAdvanced() {
  const btn = document.getElementById("createBlock");
  if (!btn) return;

  btn.onclick = async () => {
    showError("");
        const busCount = Number(document.getElementById("busCount")?.value || 1);
        console.log("busCount:", busCount);
    try {
      if (!state.selectedJobGroupId) return showError("Please select a Job Group first.");

      const serviceDate = document.getElementById("blockDate").value;
      if (!serviceDate) return showError("Please select a date.");

      const pattern = document.getElementById("tripPattern").value;
      const notes = document.getElementById("blockNotes").value.trim();
      const createdBy = auth.currentUser?.email;

      const from = (document.getElementById("blockFrom").value || "").trim();
      const to = (document.getElementById("blockTo").value || "").trim();
      const start = document.getElementById("blockStart").value;
      const end = document.getElementById("blockEnd").value;
      const baseType = document.getElementById("blockType").value;

      function validateLegBasics(_from, _to, _start, _end) {
        if (!_from) return "Please enter From.";
        if (!_to) return "Please enter To.";
        if (!_start || !_end) return "Please enter Start Time and End Time.";
        const s = minFromTimeStr(_start);
        const e = minFromTimeStr(_end);
        if (s == null || e == null) return "Invalid times.";
        if (e <= s) return "End time must be after start time.";
        return null;
      }

      // LOOP / MULTI-STOP
      if (pattern === "LOOP") {
        const startLocation = (document.getElementById("multiStartLocation")?.value || "").trim();
        const startTime = document.getElementById("multiStartTime")?.value || "";

        const returnOption = document.getElementById("multiReturnOption")?.value || "NONE";
        const returnStartTime = document.getElementById("multiReturnStartTime")?.value || "";
        const returnFinishTime = document.getElementById("multiReturnFinishTime")?.value || "";

        if (!startLocation) return showError("Please enter Start Location.");
        if (!startTime) return showError("Please enter Start Time.");

        const startMin = minFromTimeStr(startTime);
        if (startMin == null) return showError("Invalid Start Time.");

        const stopRows = [...(document.querySelectorAll("[data-multi-stop-row]") || [])];

        if (!stopRows.length) return showError("Please add at least one stop.");

        const routeStops = [];

        for (let i = 0; i < stopRows.length; i++) {
          const row = stopRows[i];

          const stopName = (row.querySelector(".multiStopName")?.value || "").trim();
          const arrivalTime = row.querySelector(".multiStopArrival")?.value || "";
          const departureTime = row.querySelector(".multiStopDeparture")?.value || "";
          const stopNote = (row.querySelector(".multiStopNote")?.value || "").trim();

          if (!stopName) return showError(`Stop ${i + 1}: Please enter Stop Name.`);
          if (!arrivalTime) return showError(`Stop ${i + 1}: Please enter Arrival Time.`);
          if (!departureTime) return showError(`Stop ${i + 1}: Please enter Departure Time.`);

          const arrivalMin = minFromTimeStr(arrivalTime);
          const departureMin = minFromTimeStr(departureTime);

          if (arrivalMin == null || departureMin == null) {
            return showError(`Stop ${i + 1}: Invalid arrival or departure time.`);
          }

          if (departureMin < arrivalMin) {
            return showError(`Stop ${i + 1}: Departure cannot be before arrival.`);
          }

          routeStops.push({
            stopNo: i + 1,
            name: stopName,
            arrivalTime,
            departureTime,
            arrivalMin,
            departureMin,
            note: stopNote
          });
        }

        const generatedLegs = [];

        generatedLegs.push({
          legNo: 1,
          legType: "Forward",
          from: startLocation,
          to: routeStops[0].name,
          startTime,
          endTime: routeStops[0].arrivalTime,
          startMin,
          endMin: routeStops[0].arrivalMin
        });

        for (let i = 1; i < routeStops.length; i++) {
          generatedLegs.push({
            legNo: generatedLegs.length + 1,
            legType: "Forward",
            from: routeStops[i - 1].name,
            to: routeStops[i].name,
            startTime: routeStops[i - 1].departureTime,
            endTime: routeStops[i].arrivalTime,
            startMin: routeStops[i - 1].departureMin,
            endMin: routeStops[i].arrivalMin
          });
        }

        const lastStop = routeStops[routeStops.length - 1];

        let overallEndMin = lastStop.arrivalMin;
        let overallTo = lastStop.name;

        if (returnOption === "SAME_ROUTE") {
          if (!returnStartTime || !returnFinishTime) {
            return showError("Please enter Return Start Time and Return Finish Time.");
          }

          const returnStartMin = minFromTimeStr(returnStartTime);
          const returnFinishMin = minFromTimeStr(returnFinishTime);

          if (returnStartMin == null || returnFinishMin == null) {
            return showError("Invalid return times.");
          }

          if (returnFinishMin <= returnStartMin) {
            return showError("Return finish time must be after return start time.");
          }

          if (returnStartMin < lastStop.departureMin) {
            return showError("Return start time cannot be before the last stop departure time.");
          }

          generatedLegs.push({
            legNo: generatedLegs.length + 1,
            legType: "Return",
            from: lastStop.name,
            to: startLocation,
            startTime: returnStartTime,
            endTime: returnFinishTime,
            startMin: returnStartMin,
            endMin: returnFinishMin,
            note: "Return same route summary"
          });

          overallEndMin = returnFinishMin;
          overallTo = startLocation;
        }

        for (let i = 0; i < busCount; i++) {
          const routeId = uid();

          const busNote =
            busCount > 1
              ? `${notes || ""} | Bus ${i + 1}`
              : notes;

          await addBlock({
            jobGroupId: state.selectedJobGroupId,
            serviceDate,

            from: startLocation,
            to: overallTo,
            startMin,
            endMin: overallEndMin,

            blockType: "Loop",
            notes: busNote,
            createdBy,

            tripPattern: "LOOP",
            blockKind: "parent",
            routeMode: "multiStop",
            routeId,

            startLocation,
            returnOption,

            legCount: generatedLegs.length,
            stopCount: routeStops.length,
            routeStops,
            generatedLegs,

            dispatchStatus: "Pending"
          });
        }

        alert(`Saved ${busCount > 1 ? busCount + " multi-stop blocks" : "1 multi-stop block"} ✅`);

        document.getElementById("multiStartLocation").value = "";
        document.getElementById("multiStartTime").value = "";
        document.getElementById("multiReturnStartTime").value = "";
        document.getElementById("multiReturnFinishTime").value = "";
        document.getElementById("multiReturnOption").value = "NONE";
        document.getElementById("multiReturnWrap").style.display = "none";
        document.getElementById("multiStopRows").innerHTML = "";
        document.getElementById("multiLegPreview").innerHTML = "Add start location, stops, and times to preview legs.";
        document.getElementById("blockNotes").value = "";

        return;
      }
            // One Way / Forward + Return save code goes here
                  // ONE WAY / FORWARD + RETURN
      const validationError = validateLegBasics(from, to, start, end);
      if (validationError) return showError(validationError);

      const startMin = minFromTimeStr(start);
      const endMin = minFromTimeStr(end);

      if (pattern === "ONE") {
        for (let i = 0; i < busCount; i++) {
          const busNote =
            busCount > 1
              ? `${notes || ""} | Bus ${i + 1}`
              : notes;

          await addBlock({
            jobGroupId: state.selectedJobGroupId,
            serviceDate,

            from,
            to,
            startMin,
            endMin,

            blockType: baseType || "Forward",
            notes: busNote,
            createdBy,

            tripPattern: "ONE",
            dispatchStatus: "Pending"
          });
        }

        alert(`Saved ${busCount > 1 ? busCount + " one-way blocks" : "1 one-way block"} ✅`);

        document.getElementById("blockFrom").value = "";
        document.getElementById("blockTo").value = "";
        document.getElementById("blockStart").value = "";
        document.getElementById("blockEnd").value = "";
        document.getElementById("blockNotes").value = "";

        return;
      }

      if (pattern === "FR") {
        const returnStart = document.getElementById("returnStart")?.value || "";
        const returnEnd = document.getElementById("returnEnd")?.value || "";

        if (!returnStart || !returnEnd) {
          return showError("Please enter Return Start Time and Return End Time.");
        }

        const returnStartMin = minFromTimeStr(returnStart);
        const returnEndMin = minFromTimeStr(returnEnd);

        if (returnStartMin == null || returnEndMin == null) {
          return showError("Invalid return times.");
        }

        if (returnEndMin <= returnStartMin) {
          return showError("Return end time must be after return start time.");
        }

        for (let i = 0; i < busCount; i++) {
          const pairId = uid();

          const busNote =
            busCount > 1
              ? `${notes || ""} | Bus ${i + 1}`
              : notes;

          await addBlock({
            jobGroupId: state.selectedJobGroupId,
            serviceDate,

            from,
            to,
            startMin,
            endMin,

            blockType: "Forward",
            notes: busNote,
            createdBy,

            tripPattern: "FR",
            pairId,
            dispatchStatus: "Pending"
          });

          await addBlock({
            jobGroupId: state.selectedJobGroupId,
            serviceDate,

            from: to,
            to: from,
            startMin: returnStartMin,
            endMin: returnEndMin,

            blockType: "Return",
            notes: busNote,
            createdBy,

            tripPattern: "FR",
            pairId,
            dispatchStatus: "Pending"
          });
        }

        alert(`Saved ${busCount > 1 ? busCount + " forward + return sets" : "1 forward + return set"} ✅`);

        document.getElementById("blockFrom").value = "";
        document.getElementById("blockTo").value = "";
        document.getElementById("blockStart").value = "";
        document.getElementById("blockEnd").value = "";
        document.getElementById("returnStart").value = "";
        document.getElementById("returnEnd").value = "";
        document.getElementById("blockNotes").value = "";

        return;
      }
    } catch (e) {
      showError(e?.message || "Failed to save");
    }
  };
}

/* =========================================================
   BLOCKS BY DATE (ALL blocks + filters)
========================================================= */
export function renderAdminBlocksByDate() {
  showError("");
  els.contentArea.innerHTML = `
    <h2 style="margin-top:0">Blocks By Date</h2>

    <div class="card">

      <div style="
        display:grid;
        grid-template-columns: 220px 1fr 220px;
        gap:14px;
        align-items:end;
      ">

        <div>
          <div class="muted" style="margin-bottom:6px">Date</div>

          <div style="display:flex; gap:10px; align-items:center">
            <input id="filterDate" type="date" />

            <label class="muted" style="display:flex; gap:6px; align-items:center; white-space:nowrap">
              <input id="showAllDates" type="checkbox" checked />
              Show all
            </label>
          </div>

        </div>

        <div>
          <div class="muted" style="margin-bottom:6px">Search</div>
          <input id="blockSearch" placeholder="Search by venue / group / client / notes / type..." />
        </div>

        <div>
          <div class="muted" style="margin-bottom:6px">Job Group</div>
          <select id="jgFilter">
            <option value="">All Job Groups</option>
          </select>
        </div>

      </div>

      <div id="blockList" style="margin-top:12px"></div>

    </div>
  `;

  wireBlocksBrowser();
}

function wireBlocksBrowser() {
  const filterEl = document.getElementById("filterDate");
  const showAllEl = document.getElementById("showAllDates");
  const searchEl = document.getElementById("blockSearch");
  const jgFilterEl = document.getElementById("jgFilter");
  const listEl = document.getElementById("blockList");

  let allBlocks = [];
  let dateBlocks = [];
  let editingBlockId = null;

  if (jobGroupsUnsub) jobGroupsUnsub();
  jobGroupsUnsub = listenJobGroups(
    (list) => {
      jobGroupsCache = (list || []).filter((x) => !x.deleted);
      rebuildJobGroupFilterOptions();
      render();
    },
    (e) => showError(e?.message || "Failed to load job groups")
  );

  function rebuildJobGroupFilterOptions() {
    if (!jgFilterEl) return;

    const old = jgFilterEl.value || "";
    const opts = [`<option value="">All Job Groups</option>`]
      .concat(
        (jobGroupsCache || [])
          .slice()
          .sort((a, b) => jgTitle(a).localeCompare(jgTitle(b)))
          .map((jg) => {
            const label = `${jgTitle(jg) || "(No title)"}${jgClient(jg) ? " — " + jgClient(jg) : ""}`;
            return `<option value="${escapeHtml(jg.id)}">${escapeHtml(label)}</option>`;
          })
      )
      .join("");

    jgFilterEl.innerHTML = opts;
    const stillExists = (jobGroupsCache || []).some((jg) => jg.id === old);
    jgFilterEl.value = stillExists ? old : "";
  }

  function startAllBlocksListener() {
    if (blocksUnsub) {
      blocksUnsub();
      blocksUnsub = null;
    }
    if (blocksAllUnsub) blocksAllUnsub();

    listEl.innerHTML = `<div class="muted">Loading…</div>`;
    blocksAllUnsub = listenBlocksAll(
      (blocks) => {
        allBlocks = (blocks || []).filter((b) => !b.deleted);
        render();
      },
      (e) => showError(e?.message || "Failed to load blocks")
    );
  }

  function startBlocksByDateListener(date) {
    if (blocksAllUnsub) {
      blocksAllUnsub();
      blocksAllUnsub = null;
    }
    if (blocksUnsub) blocksUnsub();

    listEl.innerHTML = `<div class="muted">Loading…</div>`;
    blocksUnsub = listenBlocksByDate(
      date,
      (blocks) => {
        dateBlocks = (blocks || []).filter((b) => !b.deleted);
        render();
      },
      (e) => showError(e?.message || "Failed to load blocks")
    );
  }

  if (searchEl) searchEl.oninput = () => render();
  if (jgFilterEl) jgFilterEl.onchange = () => render();

  if (showAllEl) {
    showAllEl.onchange = () => {
      editingBlockId = null;
      if (showAllEl.checked) {
        startAllBlocksListener();
      } else {
        const d = filterEl?.value || "";
        if (!d) {
          listEl.innerHTML = `<div class="muted">Pick a date first (or enable “Show all dates”).</div>`;
          return;
        }
        startBlocksByDateListener(d);
      }
    };
  }

  if (filterEl) {
    filterEl.onchange = () => {
      editingBlockId = null;
      if (showAllEl?.checked) {
        render();
      } else {
        const d = filterEl.value;
        if (!d) return;
        startBlocksByDateListener(d);
      }
    };
  }

  startAllBlocksListener();

  function render() {
    const q = (searchEl?.value || "").trim().toLowerCase();
    const selectedJG = (jgFilterEl?.value || "").trim();
    const date = (filterEl?.value || "").trim();
    const showAll = !!showAllEl?.checked;

    let list = showAll ? allBlocks : dateBlocks;

    if (showAll && date) list = list.filter((b) => (b.serviceDate || "") === date);
    if (selectedJG) list = list.filter((b) => b.jobGroupId === selectedJG);

    if (q) {
      list = list.filter((b) => {
        const jg = jobGroupsCache.find((x) => x.id === b.jobGroupId);
        const hay = [
          b.serviceDate,
          jgTitle(jg),
          jgClient(jg),
          b.jobGroupId,
          b.from,
          b.to,
          b.notes,
          b.blockType
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return hay.includes(q);
      });
    }

      list = list
        .slice()
        .sort((a, b) => {
          const da = a.serviceDate || "";
          const db = b.serviceDate || "";
          if (da !== db) return da.localeCompare(db);

          const aStart = Number(a.startMin ?? 0);
          const bStart = Number(b.startMin ?? 0);
          if (aStart !== bStart) return aStart - bStart;

          const getBusNo = (notes) => {
            const match = String(notes || "").match(/Bus\s+(\d+)/i);
            return match ? Number(match[1]) : 0;
          };

          return getBusNo(a.notes) - getBusNo(b.notes);
        });

    renderBlocks(list);
  }

  function renderEditForm(b) {
    return `
      <div style="
        margin-top:12px;
        padding:12px;
        border:1px solid #eee;
        border-radius:12px;
        background:#fafafa;
      ">
        <div style="font-weight:900; margin-bottom:10px;">Edit Block</div>

        <div style="display:flex; gap:10px; flex-wrap:wrap;">
          <div style="flex:1; min-width:180px;">
            <div class="muted" style="margin-bottom:6px">Date</div>
            <input id="editBlockDate_${b.id}" type="date" value="${escapeHtml(b.serviceDate || "")}" />
          </div>

          <div style="flex:1; min-width:180px;">
            <div class="muted" style="margin-bottom:6px">Start Time</div>
            <input id="editBlockStart_${b.id}" type="time" value="${escapeHtml(timeStrFromMin(b.startMin))}" />
          </div>

          <div style="flex:1; min-width:180px;">
            <div class="muted" style="margin-bottom:6px">End Time</div>
            <input id="editBlockEnd_${b.id}" type="time" value="${escapeHtml(timeStrFromMin(b.endMin))}" />
          </div>
        </div>

        <div style="display:flex; gap:10px; flex-wrap:wrap; margin-top:10px;">
          <div style="flex:1; min-width:240px;">
            <div class="muted" style="margin-bottom:6px">From</div>
            <input id="editBlockFrom_${b.id}" value="${escapeHtml(b.from || "")}" />
          </div>

          <div style="flex:1; min-width:240px;">
            <div class="muted" style="margin-bottom:6px">To</div>
            <input id="editBlockTo_${b.id}" value="${escapeHtml(b.to || "")}" />
          </div>
        </div>

        <div style="display:flex; gap:10px; flex-wrap:wrap; margin-top:10px;">
          <div style="flex:1; min-width:180px;">
            <div class="muted" style="margin-bottom:6px">Block Type</div>
            <select id="editBlockType_${b.id}">
              <option value="Forward" ${b.blockType === "Forward" ? "selected" : ""}>Forward</option>
              <option value="Return" ${b.blockType === "Return" ? "selected" : ""}>Return</option>
              <option value="Service" ${b.blockType === "Service" ? "selected" : ""}>Service</option>
              <option value="Dead Run" ${b.blockType === "Dead Run" ? "selected" : ""}>Dead Run</option>
              <option value="Standby" ${b.blockType === "Standby" ? "selected" : ""}>Standby</option>
              <option value="Layover" ${b.blockType === "Layover" ? "selected" : ""}>Layover</option>
              <option value="Crib Break" ${b.blockType === "Crib Break" ? "selected" : ""}>Crib Break</option>
              <option value="Meal Break" ${b.blockType === "Meal Break" ? "selected" : ""}>Meal Break</option>
              <option value="Extra" ${b.blockType === "Extra" ? "selected" : ""}>Extra</option>
              <option value="Other" ${b.blockType === "Other" ? "selected" : ""}>Other</option>
            </select>
          </div>

          <div style="flex:2; min-width:240px;">
            <div class="muted" style="margin-bottom:6px">Notes</div>
            <input id="editBlockNotes_${b.id}" value="${escapeHtml(b.notes || "")}" />
          </div>
        </div>

        <div style="display:flex; gap:10px; margin-top:12px;">
          <button class="btn" data-block-save="${b.id}">Save Changes</button>
          <button class="btn" data-block-cancel="${b.id}">Cancel</button>
        </div>
      </div>
    `;
  }

function renderBlocks(blocks) {
  if (!blocks?.length) {
    listEl.innerHTML = `<div class="muted">No blocks.</div>`;
    return;
  }

  listEl.innerHTML = blocks
    .map((b) => {
      const jg = jobGroupsCache.find((x) => x.id === b.jobGroupId);
      const title = jgTitle(jg) || "(Unknown Group)";
      const client = jgClient(jg) || "";
      const time = `${timeStrFromMin(b.startMin)}–${timeStrFromMin(b.endMin)}`;
      const isEditing = editingBlockId === b.id;

      return `
        <div style="
          border:1px solid #eee;
          border-radius:10px;
          padding:14px;
          margin-bottom:10px;
          background:#fff;
        ">

          <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:12px">

            <div style="flex:1">

              <div style="font-weight:900; font-size:16px">
                ${escapeHtml(title)}
                <span class="muted" style="font-weight:400">(${escapeHtml(b.blockType || "-")})</span>
              </div>

              ${client ? `<div class="muted" style="font-size:13px; margin-top:2px">${escapeHtml(client)}</div>` : ""}

              <div style="margin-top:8px">
                <b>${escapeHtml(b.from || "-")} → ${escapeHtml(b.to || "-")}</b>
              </div>

              ${
                Array.isArray(b.generatedLegs) && b.generatedLegs.length
                  ? `
                    <div style="margin-top:10px; display:grid; gap:6px;">
                      ${b.generatedLegs
                        .map((leg) => `
                          <div style="
                            padding:8px 10px;
                            border:1px solid #e5e7eb;
                            border-radius:8px;
                            background:#fafafa;
                          ">
                            <div style="font-weight:800;">
                              Leg ${escapeHtml(leg.legNo || "")}: ${escapeHtml(leg.from || "-")} → ${escapeHtml(leg.to || "-")}
                            </div>
                            <div class="muted" style="font-size:12px; margin-top:2px;">
                              ${escapeHtml(leg.legType || "Leg")} · ${escapeHtml(leg.startTime || timeStrFromMin(leg.startMin))} - ${escapeHtml(leg.endTime || timeStrFromMin(leg.endMin))}
                              ${leg.note ? ` · ${escapeHtml(leg.note)}` : ""}
                            </div>
                          </div>
                        `)
                        .join("")}
                    </div>
                  `
                  : ""
              }

              ${b.notes ? `<div class="muted" style="margin-top:6px">${escapeHtml(b.notes)}</div>` : ``}

            </div>

            <div style="text-align:right; min-width:120px">

              <div class="muted" style="font-size:13px">
                <b>${escapeHtml(b.serviceDate || "")}</b>
              </div>

              <div style="font-weight:700; margin-top:2px">
                ${escapeHtml(time)}
              </div>

              <div style="display:flex; gap:6px; justify-content:flex-end; margin-top:10px;">
                <button class="btn" data-block-edit="${b.id}">Edit</button>
                <button class="btn danger" data-block-del="${b.id}">Delete</button>
              </div>

            </div>

          </div>

          ${isEditing ? renderEditForm(b) : ""}

        </div>
      `;
    })
    .join("");

  [...listEl.querySelectorAll("[data-block-edit]")].forEach((btn) => {
    btn.onclick = () => {
      editingBlockId = btn.getAttribute("data-block-edit");
      render();
    };
  });

  [...listEl.querySelectorAll("[data-block-del]")].forEach((btn) => {
    btn.onclick = async () => {
      const id = btn.getAttribute("data-block-del");
      if (!confirm("Delete this block?")) return;

      try {
        await deleteBlock(id);
        if (editingBlockId === id) editingBlockId = null;
      } catch (e) {
        showError(e?.message || "Failed to delete block");
      }
    };
  });

  [...listEl.querySelectorAll("[data-block-cancel]")].forEach((btn) => {
    btn.onclick = () => {
      editingBlockId = null;
      render();
    };
  });

  [...listEl.querySelectorAll("[data-block-save]")].forEach((btn) => {
    btn.onclick = async () => {
      const id = btn.getAttribute("data-block-save");

      try {
        const serviceDate = document.getElementById(`editBlockDate_${id}`).value;
        const start = document.getElementById(`editBlockStart_${id}`).value;
        const end = document.getElementById(`editBlockEnd_${id}`).value;
        const from = document.getElementById(`editBlockFrom_${id}`).value.trim();
        const to = document.getElementById(`editBlockTo_${id}`).value.trim();
        const blockType = document.getElementById(`editBlockType_${id}`).value;
        const notes = document.getElementById(`editBlockNotes_${id}`).value.trim();

        if (!serviceDate) return showError("Date is required.");
        if (!start || !end) return showError("Start and end time are required.");
        if (!from) return showError("From is required.");
        if (!to) return showError("To is required.");

        const startMin = minFromTimeStr(start);
        const endMin = minFromTimeStr(end);

        if (startMin == null || endMin == null) return showError("Invalid time.");
        if (endMin <= startMin) return showError("End time must be after start time.");

        await updateBlock(id, {
          serviceDate,
          startMin,
          endMin,
          from,
          to,
          blockType,
          notes
        });

        editingBlockId = null;
      } catch (e) {
        showError(e?.message || "Failed to update block");
      }
    };
  });
} // end renderBlocks

} // end wireBlocksBrowser

/* =========================================================
   PERMANENT RUNS (Recurring templates)
========================================================= */
export function renderAdminPermanentRuns() {
  renderAdminPermanentRunsPage({
    els,
    showError,
    auth,
    listenJobGroups,
    addRecurringTemplate,
    updateRecurringTemplate,
    deleteRecurringTemplate,
    markRecurringTemplateGenerated,
    listenRecurringTemplates,
    listenTemplateLegs,
    addTemplateLeg,
    updateTemplateLeg,
    deleteTemplateLeg,
    addBlock
  });
} 

