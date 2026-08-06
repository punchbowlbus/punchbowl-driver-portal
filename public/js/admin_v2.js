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

console.log("admin_v2.js loaded - unified trip form");

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
let blockActionMessageTimer = null;

function showBlockActionMessage(message, type = "info", sticky = false) {
  const messageEl = document.getElementById("blockActionMessage");
  if (!messageEl) return;

  if (blockActionMessageTimer) {
    clearTimeout(blockActionMessageTimer);
    blockActionMessageTimer = null;
  }

  messageEl.textContent = message || "";
  messageEl.className = `blocks-action-message ${type}`;
  messageEl.hidden = !message;

  if (message && !sticky) {
    blockActionMessageTimer = setTimeout(() => {
      messageEl.hidden = true;
      messageEl.textContent = "";
    }, 4200);
  }
}

// edit mode for job groups page
let editingJobGroupId = null;

/* =========================================================
   JOB GROUPS PAGE UI (Create/Edit/Delete + List)
========================================================= */
function renderJobGroupsManager() {
  return `
    <div id="jobGroupsPage" class="job-groups-page">
      <header class="job-groups-hero">
        <div class="job-groups-hero-title">
          <span><i data-lucide="layers-3"></i></span>
          <div>
            <div class="job-groups-eyebrow">Operations setup</div>
            <h2>Job Groups</h2>
            <p>Organise client and school work before creating blocks and trips.</p>
          </div>
        </div>
        <button id="addJobGroupBtn" type="button" class="job-groups-primary-btn"><i data-lucide="plus"></i> Add Job Group</button>
      </header>

      <div id="jobGroupPageMessage" class="job-groups-message" hidden></div>

      <section class="job-groups-selected">
        <div class="job-groups-selected-icon"><i data-lucide="check-circle-2"></i></div>
        <div><span>Currently selected</span><strong id="selectedJGLabel">No job group selected</strong><small>New blocks and trips will use this job group.</small></div>
      </section>

      <section id="jobGroupFormWrap" class="card job-groups-form-card" hidden>
        <div class="job-groups-form-heading">
          <div>
            <div id="jobGroupFormKicker" class="job-groups-form-kicker">New job group</div>
            <h3 id="jobGroupFormTitle">Add Job Group</h3>
            <p id="jobGroupFormSubtitle">Create a clear reusable group for blocks and trips.</p>
          </div>
          <button id="closeJobGroupFormBtn" type="button" class="job-groups-icon-btn" aria-label="Close job group form"><i data-lucide="x"></i></button>
        </div>

        <div id="jobGroupFormMessage" class="job-groups-form-message" hidden></div>

        <div class="job-groups-form-section">
          <div class="job-groups-section-heading"><span>1</span><div><h4>Group details</h4><p>Use a clear title that dispatchers can recognise quickly.</p></div></div>
          <div class="job-groups-form-grid">
            <label class="job-groups-field"><span>Job group title <b>*</b></span><input id="jgTitle" type="text" maxlength="150" placeholder="Example: MCCP 3 PM / Kent Road PS" /></label>
            <label class="job-groups-field"><span>Client / school</span><input id="jgClient" type="text" maxlength="150" placeholder="Client or school name" /></label>
            <label class="job-groups-field job-groups-full"><span>Notes</span><textarea id="jgNotes" maxlength="1500" placeholder="Bus quantity, passengers, contacts or special instructions"></textarea></label>
          </div>
        </div>

        <div class="job-groups-form-actions">
          <button id="createJG" type="button" class="job-groups-primary-btn">Create Job Group</button>
          <button id="cancelEditJG" type="button" class="btn">Cancel</button>
        </div>
      </section>

      <section class="card job-groups-directory">
        <div class="job-groups-directory-heading">
          <div><h3>Job Group Directory</h3><p id="jobGroupResultCount">Loading job groups…</p></div>
        </div>
        <label class="job-groups-search"><span>Search</span><div><i data-lucide="search"></i><input id="jgSearch" type="search" placeholder="Title, client, notes or reference" /></div></label>
        <div id="jgList" class="job-groups-list"><div class="job-groups-empty">Loading job groups…</div></div>
      </section>
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
  const addBtn = document.getElementById("addJobGroupBtn");
  const closeBtn = document.getElementById("closeJobGroupFormBtn");
  const formWrap = document.getElementById("jobGroupFormWrap");
  const formTitle = document.getElementById("jobGroupFormTitle");
  const formKicker = document.getElementById("jobGroupFormKicker");
  const formSubtitle = document.getElementById("jobGroupFormSubtitle");
  const formMessage = document.getElementById("jobGroupFormMessage");
  const pageMessage = document.getElementById("jobGroupPageMessage");
  const countEl = document.getElementById("jobGroupResultCount");

  if (!listEl || !searchEl || !titleEl || !clientEl || !notesEl || !createBtn || !cancelBtn || !addBtn || !closeBtn || !formWrap) return;

  editingJobGroupId = null;
  let formDirty = false;

  function showPageMessage(message, type = "success") {
    pageMessage.textContent = message;
    pageMessage.className = `job-groups-message ${type}`;
    pageMessage.hidden = !message;
  }

  function showFormMessage(message, type = "error") {
    formMessage.textContent = message;
    formMessage.className = `job-groups-form-message ${type}`;
    formMessage.hidden = !message;
    if (message) formMessage.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function clearForm() {
    editingJobGroupId = null;
    titleEl.value = "";
    clientEl.value = "";
    notesEl.value = "";
    createBtn.textContent = "Create Job Group";
    formDirty = false;
    showFormMessage("");
  }

  function openAddForm() {
    clearForm();
    formKicker.textContent = "New job group";
    formTitle.textContent = "Add Job Group";
    formSubtitle.textContent = "Create a clear reusable group for blocks and trips.";
    formWrap.hidden = false;
    formWrap.scrollIntoView({ behavior: "smooth", block: "start" });
    setTimeout(() => titleEl.focus(), 250);
  }

  function closeForm(force = false) {
    if (!force && formDirty && !confirm("Discard your unsaved job group changes?")) return;
    formWrap.hidden = true;
    clearForm();
  }

  addBtn.onclick = openAddForm;
  cancelBtn.onclick = () => closeForm();
  closeBtn.onclick = () => closeForm();
  [titleEl, clientEl, notesEl].forEach((element) => {
    element.addEventListener("input", () => { formDirty = true; });
  });

  if (jobGroupsUnsub) jobGroupsUnsub();
  jobGroupsUnsub = listenJobGroups(
    (list) => {
      if (!document.getElementById("jobGroupsPage")) {
        jobGroupsUnsub?.();
        jobGroupsUnsub = null;
        return;
      }
      jobGroupsCache = (list || []).filter((x) => !x.deleted);
      renderList();
      updateSelectedLabels();
    },
    (error) => showPageMessage(error?.message || "Failed to load job groups.", "error")
  );

  searchEl.oninput = renderList;

  createBtn.onclick = async () => {
    showFormMessage("");
    const title = titleEl.value.trim();
    const client = clientEl.value.trim();
    const notes = notesEl.value.trim();
    if (!title) return showFormMessage("Job group title is required.");

    try {
      if (!editingJobGroupId) {
        const duplicate = jobGroupsCache.find((group) =>
          jgTitle(group).trim().toLowerCase() === title.toLowerCase() &&
          jgClient(group).trim().toLowerCase() === client.toLowerCase()
        );
        if (duplicate) return showFormMessage("A job group with this title and client already exists. Edit the existing group instead.");
      }

      const wasEditing = Boolean(editingJobGroupId);
      createBtn.disabled = true;
      cancelBtn.disabled = true;
      createBtn.textContent = "Saving…";

      if (editingJobGroupId) {
        await updateJobGroup(editingJobGroupId, { title, clientName: client, notes });
      } else {
        const docRef = await addJobGroup({
          title, clientName: client, notes,
          deleted: false,
          createdBy: auth.currentUser?.email
        });
        state.selectedJobGroupId = docRef.id;
      }

      closeForm(true);
      showPageMessage(wasEditing ? `${title} was updated successfully.` : `${title} was created and selected.`, "success");
    } catch (error) {
      console.error("Failed to save job group", error);
      showFormMessage(error?.message || "Failed to save the job group.");
    } finally {
      createBtn.disabled = false;
      cancelBtn.disabled = false;
      if (!formWrap.hidden) createBtn.textContent = editingJobGroupId ? "Save Changes" : "Create Job Group";
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

    countEl.textContent = `${filtered.length} of ${jobGroupsCache.length} job groups`;

    if (!filtered.length) {
      listEl.innerHTML = `<div class="job-groups-empty">No job groups match this search.</div>`;
      return;
    }

    listEl.innerHTML = filtered
      .slice(0, 200)
      .map((jg) => {
        const active = state.selectedJobGroupId === jg.id;
        const title = escapeHtml(jgTitle(jg) || "(No title)");
        const client = escapeHtml(jgClient(jg) || "");
        const notes = escapeHtml(jgNotes(jg) || "");
        const id = escapeHtml(jg.id || "");

        return `
          <article data-jg="${id}" class="job-groups-item ${active ? "selected" : ""}">
            <div class="job-groups-item-main" data-jg-pick="${id}">
              <div class="job-groups-item-icon"><i data-lucide="layers-3"></i></div>
              <div class="job-groups-item-copy">
                <div class="job-groups-item-title">${title}${active ? `<span>Selected</span>` : ""}</div>
                ${client ? `<div class="job-groups-item-client">${client}</div>` : `<div class="job-groups-item-client">No client specified</div>`}
                ${notes ? `<div class="job-groups-item-notes">${notes}</div>` : ""}
                <div class="job-groups-item-meta">Reference: ${id}${jg.createdBy ? ` · Created by ${escapeHtml(jg.createdBy)}` : ""}</div>
              </div>
            </div>
            <div class="job-groups-item-actions">
              <button type="button" class="btn" data-edit="${id}"><i data-lucide="pencil"></i> Edit</button>
              <button type="button" class="job-groups-delete-btn" data-del="${id}"><i data-lucide="trash-2"></i> Delete</button>
            </div>
          </article>
        `;
      })
      .join("");

    window.lucide?.createIcons?.();

    [...listEl.querySelectorAll("[data-jg-pick]")].forEach((row) => {
      row.onclick = () => {
        state.selectedJobGroupId = row.getAttribute("data-jg-pick");
        showPageMessage(`${jgTitle(jobGroupsCache.find((group) => group.id === state.selectedJobGroupId)) || "Job group"} is now selected.`, "success");
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
        formKicker.textContent = "Edit job group";
        formTitle.textContent = `Edit ${jgTitle(jg) || "Job Group"}`;
        formSubtitle.textContent = "Update the client details or operational notes.";
        createBtn.textContent = "Save Changes";
        formDirty = false;
        formWrap.hidden = false;
        formWrap.scrollIntoView({ behavior: "smooth", block: "start" });
      };
    });

    [...listEl.querySelectorAll("[data-del]")].forEach((btn) => {
      btn.onclick = async () => {
        const id = btn.getAttribute("data-del");
        const jg = jobGroupsCache.find((x) => x.id === id);
        const label = jg ? `${jgTitle(jg)}` : id;

        if (!confirm(`Delete job group "${label}"? Existing blocks will keep their stored job group reference.`)) return;

        try {
          btn.disabled = true;
          btn.textContent = "Deleting…";
          await deleteJobGroup(id);
          if (state.selectedJobGroupId === id) {
            state.selectedJobGroupId = null;
            updateSelectedLabels();
          }
          if (editingJobGroupId === id) closeForm(true);
          showPageMessage(`${label} was deleted.`, "success");
        } catch (error) {
          console.error("Failed to delete job group", error);
          showPageMessage(error?.message || "Failed to delete the job group.", "error");
          btn.disabled = false;
          btn.innerHTML = `<i data-lucide="trash-2"></i> Delete`;
          window.lucide?.createIcons?.();
        }
      };
    });
  }

  function updateSelectedLabels() {
    const jg = jobGroupsCache.find((x) => x.id === state.selectedJobGroupId) || null;
    const label = jg ? `${jgTitle(jg)}${jgClient(jg) ? " — " + jgClient(jg) : ""}` : "No job group selected";

    const a = document.getElementById("selectedJGLabel");
    if (a) a.textContent = label;
  }
}

/* =========================================================
   Pages - Job Groups page
========================================================= */
export function renderAdminBookings() {
  showError("");
  els.contentArea.innerHTML = renderJobGroupsManager();
  wireJobGroupsManager();
  window.lucide?.createIcons?.();
}

/* =========================================================
   BLOCKS PAGE (dropdown only + Multi-leg entry)
========================================================= */
function renderJobGroupDropdownOnly() {
  return `
    <section class="card blocks-job-group-card">
      <div class="blocks-section-heading">
        <span>1</span>
        <div><h3>Select Job Group</h3><p>Choose where this block or trip will be saved.</p></div>
      </div>

      <label class="blocks-field blocks-full">
        <span>Job group <b>*</b></span>
        <select id="jgSelect">
          <option value="">-- Select Job Group --</option>
        </select>
      </label>

      <div class="blocks-selected-group">
        <i data-lucide="check-circle-2"></i>
        <div><span>Selected</span><strong id="selectedJGLabel">None</strong></div>
      </div>
      <div class="blocks-help">Create or edit reusable groups from the Job Groups page.</div>
    </section>
  `;
}

function wireJobGroupDropdownOnly() {
  const sel = document.getElementById("jgSelect");
  let lastAutoFilledStartLocation = "";
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

    const multiStartLocationEl = document.getElementById("multiStartLocation");
    const jobGroupTitle = jg ? jgTitle(jg) : "";

    if (multiStartLocationEl && jobGroupTitle) {
      const currentValue = multiStartLocationEl.value.trim();

      const shouldAutoFill =
        !currentValue ||
        currentValue === lastAutoFilledStartLocation;

      if (shouldAutoFill) {
        multiStartLocationEl.value = jobGroupTitle;
        lastAutoFilledStartLocation = jobGroupTitle;
        multiStartLocationEl.dispatchEvent(new Event("input", { bubbles: true }));
      }
    }
  }
}

function renderMultiLegRowsContainer() {
  return `
    <div id="loopWrap" class="blocks-route-builder">
      <div class="blocks-section-heading">
        <span>3</span>
        <div><h3>Route Builder</h3><p>Enter each stop in travel order. Each row's departure connects to the next row's arrival.</p></div>
      </div>

      <div class="blocks-trip-section">
        <div class="blocks-trip-title"><i data-lucide="route"></i><span>Forward Trip</span></div>

        <div class="blocks-route-table-wrap">
          <table class="blocks-route-table">
            <thead>
              <tr>
                <th>Stop Name</th>
                <th>Arrive time</th>
                <th>Depart time</th>
              </tr>
            </thead>

            <tbody id="multiStopRows">
              <tr data-multi-start-row>
                <td>
                  <input id="multiStartLocation" placeholder="Start location" />
                </td>
                <td>
                  <input type="time" disabled title="The trip starts at this location" />
                </td>
                <td>
                  <input id="multiStartTime" type="time" />
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="blocks-route-actions">
          <button id="addMultiStopBtn" type="button" class="blocks-add-stop-btn"><i data-lucide="plus"></i> Add Stop</button>
          <button id="clearMultiStopsBtn" type="button" class="blocks-clear-btn"><i data-lucide="eraser"></i> Clear Stops</button>
        </div>
      </div>

      <div class="blocks-return-section">
        <label class="blocks-field blocks-full"><span>Return option</span>
          <select id="multiReturnOption">
            <option value="NONE">No return</option>
            <option value="SAME_ROUTE">Return same route</option>
          </select>
        </label>

        <div id="multiReturnWrap" class="blocks-return-wrap" style="display:none;">
          <div class="blocks-help">
            Return stops are shown in reverse order. Edit the Arrive and Depart times as needed before saving.
          </div>
          <div class="blocks-trip-title"><i data-lucide="undo-2"></i><span>Return Trip</span></div>
          <button id="autoFillReturnTimesBtn" type="button" class="blocks-autofill-btn"><i data-lucide="wand-sparkles"></i> Auto-fill Return Times</button>

          <div class="blocks-route-table-wrap">
            <table class="blocks-route-table">
              <thead>
                <tr>
                  <th>Stop Name</th>
                  <th>Arrive time</th>
                  <th>Depart time</th>
                </tr>
              </thead>

              <tbody id="multiReturnStopRows"></tbody>
            </table>
          </div>
        </div>
      </div>

      <div class="blocks-preview-section">
        <div class="blocks-trip-title"><i data-lucide="eye"></i><span>Block Preview</span></div>
        <div id="multiLegPreview" class="muted">Add start location, stops, and times to preview the blocks.</div>
      </div>
    </div>
  `;
}

function multiStopRowTemplate(idx) {
  return `
    <tr data-multi-stop-row="${idx}">
      <td>
        <div class="blocks-stop-name-wrap">
          <input class="multiStopName" placeholder="Stop name / venue" />
          <button type="button" class="blocks-remove-btn" data-remove-multi-stop="${idx}">Remove</button>
        </div>
      </td>
      <td>
        <input class="multiStopArrival" type="time" />
      </td>
      <td>
        <input class="multiStopDeparture" type="time" />
      </td>
    </tr>
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
  const addStopBtn = document.getElementById("addMultiStopBtn");
  const clearStopsBtn = document.getElementById("clearMultiStopsBtn");
  const stopRowsEl = document.getElementById("multiStopRows");
  const returnOptionEl = document.getElementById("multiReturnOption");
  const multiReturnWrap = document.getElementById("multiReturnWrap");
  const returnRowsEl = document.getElementById("multiReturnStopRows");
  const autoFillReturnTimesBtn = document.getElementById("autoFillReturnTimesBtn");

  if (!stopRowsEl || !returnRowsEl) return;

  function reindexStopRows() {
    const rows = [...stopRowsEl.querySelectorAll("[data-multi-stop-row]")];

    rows.forEach((row, i) => {
      row.setAttribute("data-multi-stop-row", String(i));

      const removeBtn = row.querySelector("[data-remove-multi-stop]");
      if (removeBtn) {
        removeBtn.setAttribute("data-remove-multi-stop", String(i));
      }
    });
  }

  function syncReturnStopRows() {
    const oldTimes = [...returnRowsEl.querySelectorAll("[data-multi-return-row]")].map(
      (row) => ({
        arrivalTime: row.querySelector(".multiReturnArrival")?.value || "",
        departureTime: row.querySelector(".multiReturnDeparture")?.value || ""
      })
    );

    const forwardNames = [
      (document.getElementById("multiStartLocation")?.value || "").trim(),
      ...[...stopRowsEl.querySelectorAll("[data-multi-stop-row]")].map(
        (row) => (row.querySelector(".multiStopName")?.value || "").trim()
      )
    ];

    const returnNames = forwardNames.reverse();

    returnRowsEl.innerHTML = returnNames
      .map((name, index) => {
        const isFirst = index === 0;
        const isLast = index === returnNames.length - 1;
        const oldTime = oldTimes[index] || {};

        return `
          <tr data-multi-return-row="${index}" style="border-top:1px solid #e5e7eb;">
            <td style="padding:8px;">
              <div style="display:flex; gap:8px; align-items:center;">
                <input
                  class="multiReturnName"
                  value="${escapeHtml(name)}"
                  readonly
                />

                <button
                  type="button"
                  class="btn danger"
                  data-remove-multi-return="${index}"
                >
                  Remove
                </button>
              </div>
            </td>

            <td style="padding:8px;">
              <input
                class="multiReturnArrival"
                ${isLast ? 'id="multiReturnFinishTime"' : ""}
                type="time"
                value="${escapeHtml(oldTime.arrivalTime || "")}"
                ${isFirst ? "disabled" : ""}
              />
            </td>

            <td style="padding:8px;">
              <input
                class="multiReturnDeparture"
                ${isFirst ? 'id="multiReturnStartTime"' : ""}
                type="time"
                value="${escapeHtml(oldTime.departureTime || "")}"
                ${isLast ? "disabled" : ""}
              />
            </td>
          </tr>
        `;
      })
      .join("");

    [...returnRowsEl.querySelectorAll("[data-remove-multi-return]")].forEach(
      (btn) => {
        btn.onclick = () => {
          const removedName = (btn.closest("[data-multi-return-row]")?.querySelector(".multiReturnName")?.value || "Return stop").trim();
          const row = btn.closest("[data-multi-return-row]");
          if (row) row.remove();

          [
            ...returnRowsEl.querySelectorAll("[data-multi-return-row]")
          ].forEach((returnRow, i) => {
            returnRow.setAttribute("data-multi-return-row", String(i));

            const removeBtn = returnRow.querySelector(
              "[data-remove-multi-return]"
            );

            if (removeBtn) {
              removeBtn.setAttribute("data-remove-multi-return", String(i));
            }
          });

          wireReturnTimeEvents();
          renderMultiLegPreview();
          showBlockActionMessage(`${removedName || "Return stop"} was removed from the return trip.`, "warning");
        };
      }
    );

    wireReturnTimeEvents();
  }

  function autoFillReturnTimesFromFirstDepart() {
    const returnRows = [
      ...returnRowsEl.querySelectorAll("[data-multi-return-row]")
    ];

    const forwardRows = [
      {
        departureMin: minFromTimeStr(
          document.getElementById("multiStartTime")?.value || ""
        )
      },
      ...[...stopRowsEl.querySelectorAll("[data-multi-stop-row]")].map(
        (row) => ({
          arrivalMin: minFromTimeStr(
            row.querySelector(".multiStopArrival")?.value || ""
          ),
          departureMin: minFromTimeStr(
            row.querySelector(".multiStopDeparture")?.value || ""
          )
        })
      )
    ];

    if (returnRows.length < 2) {
      showError("Return trip must have at least 2 stops.");
      showBlockActionMessage("Return trip must have at least 2 stops before times can be auto-filled.", "error");
      return;
    }

    if (forwardRows.length !== returnRows.length) {
      showError("Forward and return stop count must match before auto-fill.");
      showBlockActionMessage("Forward and return stop counts must match before auto-fill.", "error");
      return;
    }

    const firstDepartEl = returnRows[0].querySelector(
      ".multiReturnDeparture"
    );

    let currentMin = minFromTimeStr(firstDepartEl?.value || "");

    if (currentMin == null) {
      showError("Enter the first Return Depart time first.");
      showBlockActionMessage("Enter the first return departure time, then try Auto-fill again.", "error");
      return;
    }

    const forwardLegMinutes = [];

    for (let i = 0; i < forwardRows.length - 1; i++) {
      const departMin = forwardRows[i].departureMin;
      const arriveMin = forwardRows[i + 1].arrivalMin;

      if (
        departMin == null ||
        arriveMin == null ||
        arriveMin <= departMin
      ) {
        showError(
          "Fill all Forward Arrive/Depart times before auto-fill."
        );
        showBlockActionMessage("Complete all forward arrival and departure times before using Auto-fill.", "error");
        return;
      }

      forwardLegMinutes.push(arriveMin - departMin);
    }

    const forwardWaitMinutes = [];

    for (let i = 1; i < forwardRows.length - 1; i++) {
      const arriveMin = forwardRows[i].arrivalMin;
      const departMin = forwardRows[i].departureMin;

      if (
        arriveMin == null ||
        departMin == null ||
        departMin < arriveMin
      ) {
        showError(
          "Fill all Forward stop waiting times before auto-fill."
        );
        showBlockActionMessage("Complete all forward stop waiting times before using Auto-fill.", "error");
        return;
      }

      forwardWaitMinutes.push(departMin - arriveMin);
    }

    const reverseLegMinutes = forwardLegMinutes.slice().reverse();
    const reverseWaitMinutes = forwardWaitMinutes.slice().reverse();

    for (let i = 0; i < returnRows.length - 1; i++) {
      const row = returnRows[i];
      const nextRow = returnRows[i + 1];

      const departEl = row.querySelector(".multiReturnDeparture");

      if (departEl && !departEl.disabled) {
        departEl.value = timeStrFromMin(currentMin);
      }

      const nextArrivalMin = currentMin + reverseLegMinutes[i];
      const nextArrivalEl = nextRow.querySelector(".multiReturnArrival");

      if (nextArrivalEl && !nextArrivalEl.disabled) {
        nextArrivalEl.value = timeStrFromMin(nextArrivalMin);
      }

      const nextDepartEl = nextRow.querySelector(".multiReturnDeparture");

      if (nextDepartEl && !nextDepartEl.disabled) {
        const waitMin = reverseWaitMinutes[i] || 0;
        const nextDepartMin = nextArrivalMin + waitMin;

        nextDepartEl.value = timeStrFromMin(nextDepartMin);
        currentMin = nextDepartMin;
      } else {
        currentMin = nextArrivalMin;
      }
    }

    renderMultiLegPreview();
    showError("");
    showBlockActionMessage("Return times were auto-filled successfully. Review them before saving.", "success");
  }

  function wireReturnTimeEvents() {
    [
      ...returnRowsEl.querySelectorAll("input[type='time']")
    ].forEach((input) => {
      const handler = () => {
        renderMultiLegPreview();
      };

      input.oninput = handler;
      input.onchange = handler;
      input.onblur = handler;
    });
  }

  function wireStopRowEvents() {
    [
      ...stopRowsEl.querySelectorAll("[data-remove-multi-stop]")
    ].forEach((btn) => {
      btn.onclick = () => {
        const idx = Number(
          btn.getAttribute("data-remove-multi-stop")
        );

        const row = stopRowsEl.querySelector(
          `[data-multi-stop-row="${idx}"]`
        );

        const removedName = (row?.querySelector(".multiStopName")?.value || `Stop ${idx + 1}`).trim();
        if (row) row.remove();

        reindexStopRows();
        ensureAtLeastOneStop();
        syncReturnStopRows();
        renderMultiLegPreview();
        showBlockActionMessage(`${removedName || `Stop ${idx + 1}`} was removed from the forward trip.`, "warning");
      };
    });

    [
      ...stopRowsEl.querySelectorAll(
        ".multiStopName, .multiStopArrival, .multiStopDeparture"
      )
    ].forEach((input) => {
      const handler = () => {
        if (input.classList.contains("multiStopName")) {
          syncReturnStopRows();
        }

        renderMultiLegPreview();
      };

      input.oninput = handler;
      input.onchange = handler;
    });
  }

  function addStopRow() {
    const idx = stopRowsEl.querySelectorAll(
      "[data-multi-stop-row]"
    ).length;

    stopRowsEl.insertAdjacentHTML(
      "beforeend",
      multiStopRowTemplate(idx)
    );

    wireStopRowEvents();
    syncReturnStopRows();
    renderMultiLegPreview();
  }

  function ensureAtLeastOneStop() {
    if (!stopRowsEl.querySelector("[data-multi-stop-row]")) {
      addStopRow();
    }
  }

  function getMultiStopDataForPreview() {
    const startLocation = (
      document.getElementById("multiStartLocation")?.value || ""
    ).trim();

    const startTime =
      document.getElementById("multiStartTime")?.value || "";

    const stops = [
      ...stopRowsEl.querySelectorAll("[data-multi-stop-row]")
    ].map((row) => ({
      name: (
        row.querySelector(".multiStopName")?.value || ""
      ).trim(),
      arrivalTime:
        row.querySelector(".multiStopArrival")?.value || "",
      departureTime:
        row.querySelector(".multiStopDeparture")?.value || "",
      note: ""
    }));

    const returnOption =
      document.getElementById("multiReturnOption")?.value || "NONE";

    const returnStops = [
      ...returnRowsEl.querySelectorAll("[data-multi-return-row]")
    ].map((row) => ({
      name: (
        row.querySelector(".multiReturnName")?.value || ""
      ).trim(),
      arrivalTime:
        row.querySelector(".multiReturnArrival")?.value || "",
      departureTime:
        row.querySelector(".multiReturnDeparture")?.value || ""
    }));

    return {
      startLocation,
      startTime,
      stops,
      returnOption,
      returnStops
    };
  }

  function buildBlockSummaries(data) {
    const summaries = [];
    const validStops = data.stops.filter((stop) => stop.name);

    if (!data.startLocation || !validStops.length) {
      return summaries;
    }

    const lastStop = validStops[validStops.length - 1];

    summaries.push({
      title: "Forward block",
      from: data.startLocation,
      to: lastStop.name,
      startTime: data.startTime,
      endTime: lastStop.arrivalTime
    });

    if (
      data.returnOption === "SAME_ROUTE" &&
      data.returnStops.length > 1
    ) {
      const firstReturnStop = data.returnStops[0];
      const lastReturnStop =
        data.returnStops[data.returnStops.length - 1];

      summaries.push({
        title: "Return block",
        from: firstReturnStop.name,
        to: lastReturnStop.name,
        startTime: firstReturnStop.departureTime,
        endTime: lastReturnStop.arrivalTime
      });
    }

    return summaries;
  }

  function renderMultiLegPreview() {
    const previewEl = document.getElementById("multiLegPreview");
    if (!previewEl) return;

    const data = getMultiStopDataForPreview();
    const summaries = buildBlockSummaries(data);

    if (!summaries.length) {
      previewEl.innerHTML =
        "Add start location, stops, and times to preview the blocks.";
      return;
    }

    previewEl.innerHTML = `
      <div style="display:grid; gap:6px;">
        ${summaries
          .map(
            (summary) => `
              <div style="
                padding:8px;
                border:1px solid #e5e7eb;
                border-radius:8px;
                background:#fff;
                color:#111;
              ">
                <div style="font-weight:800;">
                  ${escapeHtml(summary.title)}
                </div>

                <div class="muted" style="font-size:12px; margin-top:3px;">
                  ${escapeHtml(summary.from)} →
                  ${escapeHtml(summary.to)}
                  · ${escapeHtml(summary.startTime || "--:--")} -
                  ${escapeHtml(summary.endTime || "--:--")}
                </div>
              </div>
            `
          )
          .join("")}
      </div>
    `;
  }

  if (addStopBtn) {
    addStopBtn.onclick = (event) => {
      addStopRow();
      if (event?.isTrusted) {
        const stopCount = stopRowsEl.querySelectorAll("[data-multi-stop-row]").length;
        showBlockActionMessage(`Stop ${stopCount} was added. Enter its location and times.`, "success");
      }
    };
  }

  if (clearStopsBtn) {
    clearStopsBtn.onclick = () => {
      [
        ...stopRowsEl.querySelectorAll("[data-multi-stop-row]")
      ].forEach((row) => row.remove());

      ensureAtLeastOneStop();
      syncReturnStopRows();
      renderMultiLegPreview();
      showBlockActionMessage("Forward stops were cleared. One blank stop is ready for entry.", "warning");
    };
  }

  if (returnOptionEl && multiReturnWrap) {
    returnOptionEl.onchange = () => {
      const hasReturn = returnOptionEl.value === "SAME_ROUTE";

      multiReturnWrap.style.display = hasReturn ? "block" : "none";

      if (hasReturn) {
        syncReturnStopRows();
        showBlockActionMessage("Return trip enabled. Stops were copied in reverse order.", "success");
      } else {
        returnRowsEl.innerHTML = "";
        showBlockActionMessage("Return trip removed. Only the forward block will be saved.", "info");
      }

      renderMultiLegPreview();
    };
  }

  ["multiStartLocation", "multiStartTime"].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;

    const handler = () => {
      if (id === "multiStartLocation") {
        syncReturnStopRows();
      }

      renderMultiLegPreview();
    };

    el.oninput = handler;
    el.onchange = handler;
  });

  if (autoFillReturnTimesBtn) {
    autoFillReturnTimesBtn.onclick = () => {
      autoFillReturnTimesFromFirstDepart();
    };
  }

  ensureAtLeastOneStop();
  wireStopRowEvents();
  syncReturnStopRows();
  renderMultiLegPreview();
}

export function renderAdminBlocks() {
  showError("");

  els.contentArea.innerHTML = `
    <div id="blocksEntryPage" class="blocks-entry-page">
      <header class="blocks-hero">
        <div class="blocks-hero-title">
          <span><i data-lucide="blocks"></i></span>
          <div>
            <div class="blocks-eyebrow">Trip planning</div>
            <h2>Blocks</h2>
            <p>Create one-way, multi-stop and return work from one unified form.</p>
          </div>
        </div>
      </header>

      <div id="blockActionMessage" class="blocks-action-message info" role="status" aria-live="polite" hidden></div>

      ${renderJobGroupDropdownOnly()}

      <section class="card blocks-form-card">
        <div class="blocks-form-heading">
          <div>
            <div class="blocks-form-kicker">New operational work</div>
            <h3>Add Block / Trip</h3>
            <p>Set the service details, build the route and review it before saving.</p>
          </div>
          <div class="blocks-saving-under"><span>Saving under</span><strong id="blockJGLabel">No Job Group selected</strong></div>
        </div>

        <div class="blocks-service-section">
          <div class="blocks-section-heading">
            <span>2</span>
            <div><h3>Service Details</h3><p>Choose the operating date and number of identical vehicles required.</p></div>
          </div>
          <div class="blocks-service-grid">
            <label class="blocks-field"><span>Service date <b>*</b></span><input id="blockDate" type="date" /></label>
            <label class="blocks-field"><span>How many buses? <b>*</b></span><input id="busCount" type="number" min="1" value="1" /><small>Creates multiple identical blocks.</small></label>
          </div>
        </div>

        ${renderMultiLegRowsContainer()}

        <div class="blocks-notes-section">
          <div class="blocks-section-heading">
            <span>4</span>
            <div><h3>Final Details</h3><p>Add any information the dispatcher or driver needs to know.</p></div>
          </div>
          <label class="blocks-field blocks-full"><span>Notes</span>
            <textarea id="blockNotes" placeholder="Bus number, passengers, changes, school time changes or special instructions"></textarea>
          </label>
        </div>

        <div class="blocks-save-area">
          <button id="createBlock" class="blocks-save-btn"><i data-lucide="save"></i> Save Block / Trip</button>
          <div class="blocks-save-tip">For multiple buses, use “How many buses?” above.</div>
        </div>

        <div id="blockSaveSuccess" class="form-success blocks-success" style="display:none"></div>
      </section>
    </div>
  `;

  wireJobGroupDropdownOnly();
  wireBlockEntryAdvanced();
  wireCreateBlockAdvanced();
  window.lucide?.createIcons?.();
}

function wireCreateBlockAdvanced() {
  const btn = document.getElementById("createBlock");
  if (!btn) return;

  function showSaveSuccess(message) {
    const successEl = document.getElementById("blockSaveSuccess");
    if (!successEl) return;
    successEl.textContent = message;
    successEl.style.display = "block";
  }

  function hideSaveSuccess() {
    const successEl = document.getElementById("blockSaveSuccess");
    if (!successEl) return;
    successEl.textContent = "";
    successEl.style.display = "none";
  }

  function clearInputValue(id) {
    const input = document.getElementById(id);
    if (input) input.value = "";
  }

  btn.onclick = async () => {
    showError("");
    hideSaveSuccess();

    try {
      if (!state.selectedJobGroupId) return showError("Please select a Job Group first.");

      const busCount = Number(document.getElementById("busCount")?.value || 1);

      if (!Number.isInteger(busCount) || busCount < 1) {
        return showError("How many buses must be at least 1.");
      }

      const serviceDate =
        document.getElementById("blockDate")?.value || "";

      if (!serviceDate) {
        return showError("Please select a date.");
      }

      const notes =
        document.getElementById("blockNotes")?.value.trim() || "";

      const createdBy = auth.currentUser?.email || "";

      // ONE FORM HANDLES ONE-WAY, RETURN, AND MULTI-STOP TRIPS
        const startLocation = (document.getElementById("multiStartLocation")?.value || "").trim();
        const startTime = document.getElementById("multiStartTime")?.value || "";
        const returnOption = document.getElementById("multiReturnOption")?.value || "NONE";

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
            note: ""
          });
        }

        const lastStop = routeStops[routeStops.length - 1];

        const forwardLegs = [];

        forwardLegs.push({
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
          forwardLegs.push({
            legNo: forwardLegs.length + 1,
            legType: "Forward",
            from: routeStops[i - 1].name,
            to: routeStops[i].name,
            startTime: routeStops[i - 1].departureTime,
            endTime: routeStops[i].arrivalTime,
            startMin: routeStops[i - 1].departureMin,
            endMin: routeStops[i].arrivalMin
          });
        }

        for (const leg of forwardLegs) {
          if (leg.endMin <= leg.startMin) {
            return showError(`Forward leg ${leg.legNo}: Arrive time must be after Depart time.`);
          }
        }

        let returnStartMin = null;
        let returnFinishMin = null;
        let returnLegs = [];

        if (returnOption === "SAME_ROUTE") {
          const returnRows = [...(document.querySelectorAll("[data-multi-return-row]") || [])].map((row) => {
            const arrivalTime = row.querySelector(".multiReturnArrival")?.value || "";
            const departureTime = row.querySelector(".multiReturnDeparture")?.value || "";

            return {
              name: (row.querySelector(".multiReturnName")?.value || "").trim(),
              arrivalTime,
              departureTime,
              arrivalMin: arrivalTime ? minFromTimeStr(arrivalTime) : null,
              departureMin: departureTime ? minFromTimeStr(departureTime) : null
            };
          });

              if (returnRows.length < 2) {
                return showError("Return trip must have at least 2 stops.");
              }

          for (let r = 0; r < returnRows.length; r++) {
            const row = returnRows[r];
            const isFirst = r === 0;
            const isLast = r === returnRows.length - 1;

            if (!row.name) return showError(`Return stop ${r + 1}: Stop name is missing.`);

            if (isFirst && row.departureMin == null) {
              return showError("Return first stop: Please enter Depart time.");
            }

            if (isLast && row.arrivalMin == null) {
              return showError("Return final stop: Please enter Arrive time.");
            }

            if (!isFirst && row.arrivalMin == null) {
              return showError(`Return stop ${r + 1}: Please enter Arrive time.`);
            }

            if (!isLast && row.departureMin == null) {
              return showError(`Return stop ${r + 1}: Please enter Depart time.`);
            }

            if (
              row.arrivalMin != null &&
              row.departureMin != null &&
              row.departureMin < row.arrivalMin
            ) {
              return showError(`Return stop ${r + 1}: Depart time cannot be before Arrive time.`);
            }
          }

          returnLegs = returnRows.slice(0, -1).map((row, index) => {
            const nextRow = returnRows[index + 1];

            return {
              legNo: index + 1,
              legType: "Return",
              from: row.name,
              to: nextRow.name,
              startTime: row.departureTime,
              endTime: nextRow.arrivalTime,
              startMin: row.departureMin,
              endMin: nextRow.arrivalMin,
              note: index === returnRows.length - 2
                ? "Return same route finish"
                : "Return same route"
            };
          });

          const invalidLeg = returnLegs.find((leg) => leg.endMin <= leg.startMin);
          if (invalidLeg) {
            return showError(
              `Return leg ${invalidLeg.legNo}: Arrive time must be after Depart time.`
            );
          }

          returnStartMin = returnLegs[0].startMin;
          returnFinishMin = returnLegs[returnLegs.length - 1].endMin;

          if (returnStartMin < lastStop.departureMin) {
            return showError("Return start time cannot be before the last stop departure time.");
          }
        }

        showBlockActionMessage(
          `Saving ${returnOption === "SAME_ROUTE" ? "forward and return" : "forward"} block${busCount > 1 ? `s for ${busCount} buses` : ""}…`,
          "info",
          true
        );

        for (let i = 0; i < busCount; i++) {
          const routePairId = uid();

          const busNote =
            busCount > 1
              ? `${notes ? `${notes} | ` : ""}Bus ${i + 1}`
              : notes;

          await addBlock({
            jobGroupId: state.selectedJobGroupId,
            serviceDate,

            from: startLocation,
            to: lastStop.name,
            startMin,
            endMin: lastStop.arrivalMin,

            blockType: "Forward",
            notes: busNote,
            createdBy,

            tripPattern: "LOOP",
            blockKind: "parent",
            routeMode: "multiStop",
            routeDirection: "Forward",
            routePairId,

            startLocation,
            returnOption,

            legCount: forwardLegs.length,
            stopCount: routeStops.length,
            routeStops,
            generatedLegs: forwardLegs,

            dispatchStatus: "Pending"
          });

          if (returnOption === "SAME_ROUTE") {
            await addBlock({
              jobGroupId: state.selectedJobGroupId,
              serviceDate,

              from: lastStop.name,
              to: startLocation,
              startMin: returnStartMin,
              endMin: returnFinishMin,

              blockType: "Return",
              notes: busNote,
              createdBy,

              tripPattern: "LOOP",
              blockKind: "parent",
              routeMode: "multiStop",
              routeDirection: "Return",
              routePairId,

              startLocation,
              returnOption,

              legCount: returnLegs.length,
              stopCount: routeStops.length,
              routeStops,
              generatedLegs: returnLegs,

              dispatchStatus: "Pending"
            });
          }
        }

        const savedCount = returnOption === "SAME_ROUTE" ? busCount * 2 : busCount;

        showSaveSuccess(
          `Saved ${savedCount} multi-stop block${savedCount === 1 ? "" : "s"} successfully.`
        );
        showBlockActionMessage(
          `Saved ${savedCount} block${savedCount === 1 ? "" : "s"} successfully. The form is ready for the next trip.`,
          "success",
          true
        );

        clearInputValue("multiStartTime");

        const returnOptionEl = document.getElementById("multiReturnOption");
        if (returnOptionEl) returnOptionEl.value = "NONE";

        const returnWrapEl = document.getElementById("multiReturnWrap");
        if (returnWrapEl) returnWrapEl.style.display = "none";

        [...document.querySelectorAll("[data-multi-stop-row]")].forEach((row) => row.remove());

        const returnRowsEl = document.getElementById("multiReturnStopRows");
        if (returnRowsEl) returnRowsEl.innerHTML = "";

        const previewEl = document.getElementById("multiLegPreview");
        if (previewEl) {
          previewEl.innerHTML = "Add start location, stops, and times to preview the blocks.";
        }

        clearInputValue("blockNotes");

        const selectedJobGroup = jobGroupsCache.find(
          (jobGroup) => jobGroup.id === state.selectedJobGroupId
        );
        const startLocationEl = document.getElementById("multiStartLocation");
        if (startLocationEl) {
          startLocationEl.value = selectedJobGroup ? jgTitle(selectedJobGroup) : "";
        }

        document.getElementById("addMultiStopBtn")?.click();

        return;
    } catch (e) {
      showError(e?.message || "Failed to save");
      showBlockActionMessage(e?.message || "The block could not be saved. Check the form and try again.", "error", true);
    }
  };
}

/* =========================================================
   BLOCKS BY DATE (ALL blocks + filters)
========================================================= */
export function renderAdminBlocksByDate() {
  showError("");
  const now = new Date();
  const today = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
  els.contentArea.innerHTML = `
    <div id="blocksBrowserPage" class="blocks-browser-page">
      <header class="blocks-browser-hero">
        <div class="blocks-browser-hero-title"><span><i data-lucide="calendar-range"></i></span><div><div class="blocks-browser-eyebrow">Operations browser</div><h2>Blocks By Date</h2><p>Find, review and safely edit scheduled blocks.</p></div></div>
      </header>

      <div id="blocksBrowserMessage" class="blocks-browser-message info" role="status" aria-live="polite" hidden></div>

      <section class="card blocks-browser-workspace">
        <div class="blocks-browser-heading"><div><h3>Scheduled Blocks</h3><p id="blocksBrowserCount">Loading today’s blocks…</p></div></div>
        <div class="blocks-browser-filters">
          <label class="blocks-browser-field"><span>Date</span><input id="filterDate" type="date" value="${today}" /></label>
          <label class="blocks-browser-search"><span>Search</span><div><i data-lucide="search"></i><input id="blockSearch" type="search" placeholder="Venue, group, client, notes or type" /></div></label>
          <label class="blocks-browser-field"><span>Job Group</span><select id="jgFilter"><option value="">All Job Groups</option></select></label>
          <label class="blocks-browser-all-toggle"><input id="showAllDates" type="checkbox" /><span><strong>Show all dates</strong><small>May take longer for large records</small></span></label>
        </div>

        <div id="blockList" class="blocks-browser-list"><div class="blocks-browser-loading"><span></span><div><strong>Loading blocks…</strong><small>Retrieving the selected date.</small></div></div></div>
      </section>
    </div>
  `;

  window.lucide?.createIcons?.();
  wireBlocksBrowser();
}

function wireBlocksBrowser() {
  const filterEl = document.getElementById("filterDate");
  const showAllEl = document.getElementById("showAllDates");
  const searchEl = document.getElementById("blockSearch");
  const jgFilterEl = document.getElementById("jgFilter");
  const listEl = document.getElementById("blockList");
  const messageEl = document.getElementById("blocksBrowserMessage");
  const countEl = document.getElementById("blocksBrowserCount");

  let allBlocks = [];
  let dateBlocks = [];
  let editingBlockId = null;
  let blocksLoading = true;
  let messageTimer = null;

  function showBrowserMessage(message, type = "info", sticky = false) {
    if (!messageEl) return;
    if (messageTimer) clearTimeout(messageTimer);
    messageEl.textContent = message || "";
    messageEl.className = `blocks-browser-message ${type}`;
    messageEl.hidden = !message;
    if (message && !sticky) {
      messageTimer = setTimeout(() => {
        messageEl.hidden = true;
        messageEl.textContent = "";
      }, 4200);
    }
  }

  function showBrowserError(message) {
    showError(message);
    showBrowserMessage(message, "error", true);
  }

  function renderLoading(message) {
    listEl.innerHTML = `<div class="blocks-browser-loading"><span></span><div><strong>${escapeHtml(message)}</strong><small>Please wait while the records are retrieved.</small></div></div>`;
    if (countEl) countEl.textContent = message;
  }

  if (jobGroupsUnsub) jobGroupsUnsub();
  jobGroupsUnsub = listenJobGroups(
    (list) => {
      jobGroupsCache = (list || []).filter((x) => !x.deleted);
      rebuildJobGroupFilterOptions();
      render();
    },
    (e) => showBrowserError(e?.message || "Failed to load job groups.")
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

    blocksLoading = true;
    renderLoading("Loading all blocks…");
    showBrowserMessage("Loading all dates. Large block histories can take longer.", "warning", true);
    blocksAllUnsub = listenBlocksAll(
      (blocks) => {
        if (!document.getElementById("blocksBrowserPage")) {
          blocksAllUnsub?.();
          blocksAllUnsub = null;
          return;
        }
        blocksLoading = false;
        allBlocks = (blocks || []).filter((b) => !b.deleted);
        render();
        showBrowserMessage(`Loaded ${allBlocks.length} blocks across all dates.`, "success");
      },
      (e) => {
        blocksLoading = false;
        showBrowserError(e?.message || "Failed to load blocks.");
      }
    );
  }

  function startBlocksByDateListener(date) {
    if (blocksAllUnsub) {
      blocksAllUnsub();
      blocksAllUnsub = null;
    }
    if (blocksUnsub) blocksUnsub();

    blocksLoading = true;
    renderLoading(`Loading blocks for ${date}…`);
    showBrowserMessage(`Loading blocks for ${date}…`, "info", true);
    blocksUnsub = listenBlocksByDate(
      date,
      (blocks) => {
        if (!document.getElementById("blocksBrowserPage")) {
          blocksUnsub?.();
          blocksUnsub = null;
          return;
        }
        blocksLoading = false;
        dateBlocks = (blocks || []).filter((b) => !b.deleted);
        render();
        showBrowserMessage(`Loaded ${dateBlocks.length} block${dateBlocks.length === 1 ? "" : "s"} for ${date}.`, "success");
      },
      (e) => {
        blocksLoading = false;
        showBrowserError(e?.message || "Failed to load blocks.");
      }
    );
  }

  if (searchEl) searchEl.oninput = () => render();
  if (jgFilterEl) jgFilterEl.onchange = () => render();

  if (showAllEl) {
    showAllEl.onchange = () => {
      editingBlockId = null;
      if (showAllEl.checked) {
        if (filterEl) filterEl.value = "";
        startAllBlocksListener();
      } else {
        if (filterEl && !filterEl.value) {
          const now = new Date();
          filterEl.value = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
        }
        const d = filterEl?.value || "";
        if (!d) {
          listEl.innerHTML = `<div class="blocks-browser-empty">Pick a date first or enable Show all dates.</div>`;
          showBrowserMessage("Select a date to load a smaller, faster result set.", "warning");
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

  startBlocksByDateListener(filterEl?.value || "");

  function render() {
    if (blocksLoading) return;
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

    const renderLimit = 300;
    const visibleList = list.slice(0, renderLimit);
    if (countEl) {
      countEl.textContent = `${list.length > renderLimit ? `Showing first ${renderLimit} of ` : ""}${list.length} block${list.length === 1 ? "" : "s"}${showAll ? " across all dates" : date ? ` on ${date}` : ""}`;
    }
    renderBlocks(visibleList);
  }

  function renderEditForm(b) {
    return `
      <div class="blocks-browser-edit-form" style="
        margin-top:12px;
        padding:12px;
        border:1px solid #eee;
        border-radius:12px;
        background:#fafafa;
      ">
        <div style="font-weight:900; margin-bottom:10px;">
          ${Array.isArray(b.generatedLegs) && b.generatedLegs.length ? "Edit Multi-stop Block" : "Edit Block"}
        </div>

        ${
          Array.isArray(b.generatedLegs) && b.generatedLegs.length
            ? `
              <div class="blocks-browser-edit-warning" style="
                padding:10px;
                border:1px solid #fde68a;
                background:#fffbeb;
                border-radius:10px;
                margin-bottom:12px;
                color:#92400e;
              ">
                This is a multi-stop parent block. The fields below edit the dispatch summary only.
                The detailed generated legs are shown below for checking.
              </div>
            `
            : ""
        }

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

        ${
          Array.isArray(b.generatedLegs) && b.generatedLegs.length
            ? `
              <div style="margin-top:14px;">
                <div style="font-weight:900; margin-bottom:8px;">Generated Legs</div>

                <div style="display:grid; gap:10px;">
                  ${b.generatedLegs
                    .map((leg, idx) => `
                      <div style="
                        padding:10px;
                        border:1px solid #e5e7eb;
                        border-radius:10px;
                        background:#fff;
                      ">
                        <div style="font-weight:900; margin-bottom:8px;">
                          Leg ${escapeHtml(leg.legNo || idx + 1)}
                        </div>

                        <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
                          <div>
                            <div class="muted" style="margin-bottom:4px;">From</div>
                            <input
                              id="editLegFrom_${b.id}_${idx}"
                              value="${escapeHtml(leg.from || "")}"
                            />
                          </div>

                          <div>
                            <div class="muted" style="margin-bottom:4px;">To</div>
                            <input
                              id="editLegTo_${b.id}_${idx}"
                              value="${escapeHtml(leg.to || "")}"
                            />
                          </div>
                        </div>

                        <div style="display:grid; grid-template-columns:160px 160px 180px 1fr; gap:10px; margin-top:8px;">
                          <div>
                            <div class="muted" style="margin-bottom:4px;">Start Time</div>
                            <input
                              id="editLegStart_${b.id}_${idx}"
                              type="time"
                              value="${escapeHtml(leg.startTime || timeStrFromMin(leg.startMin))}"
                            />
                          </div>

                          <div>
                            <div class="muted" style="margin-bottom:4px;">End Time</div>
                            <input
                              id="editLegEnd_${b.id}_${idx}"
                              type="time"
                              value="${escapeHtml(leg.endTime || timeStrFromMin(leg.endMin))}"
                            />
                          </div>

                          <div>
                            <div class="muted" style="margin-bottom:4px;">Leg Type</div>
                            <select id="editLegType_${b.id}_${idx}">
                              <option value="Forward" ${leg.legType === "Forward" ? "selected" : ""}>Forward</option>
                              <option value="Return" ${leg.legType === "Return" ? "selected" : ""}>Return</option>
                              <option value="Loop" ${leg.legType === "Loop" ? "selected" : ""}>Loop</option>
                              <option value="Extra" ${leg.legType === "Extra" ? "selected" : ""}>Extra</option>
                            </select>
                          </div>

                          <div>
                            <div class="muted" style="margin-bottom:4px;">Note</div>
                            <input
                              id="editLegNote_${b.id}_${idx}"
                              value="${escapeHtml(leg.note || "")}"
                            />
                          </div>
                        </div>
                      </div>
                    `)
                    .join("")}
                </div>
              </div>
            `
            : ""
        }

        <div style="display:flex; gap:10px; margin-top:12px;">
          <button class="btn" data-block-save="${b.id}">Save Changes</button>
          <button class="btn" data-block-cancel="${b.id}">Cancel</button>
        </div>
      </div>
    `;
  }

function renderBlocks(blocks) {
  if (!blocks?.length) {
    listEl.innerHTML = `<div class="blocks-browser-empty">No blocks match the selected date and filters.</div>`;
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
        <div class="blocks-browser-card" style="
          border:1px solid #eee;
          border-radius:10px;
          padding:14px;
          margin-bottom:10px;
          background:#fff;
        ">

          <div class="blocks-browser-card-head" style="display:flex; justify-content:space-between; align-items:flex-start; gap:12px">

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
      showBrowserMessage("Block opened for editing.", "info");
    };
  });

  [...listEl.querySelectorAll("[data-block-del]")].forEach((btn) => {
    btn.onclick = async () => {
      const id = btn.getAttribute("data-block-del");
      if (!confirm("Delete this block?")) return;

      try {
        btn.disabled = true;
        btn.textContent = "Deleting…";
        showBrowserMessage("Deleting block… Do not click again.", "info", true);
        await deleteBlock(id);
        if (editingBlockId === id) editingBlockId = null;
        showBrowserMessage("Block deleted successfully.", "success");
      } catch (e) {
        btn.disabled = false;
        btn.textContent = "Delete";
        showBrowserError(e?.message || "Failed to delete block.");
      }
    };
  });

  [...listEl.querySelectorAll("[data-block-cancel]")].forEach((btn) => {
    btn.onclick = () => {
      editingBlockId = null;
      render();
      showBrowserMessage("Block changes cancelled.", "warning");
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

        if (!serviceDate) return showBrowserError("Date is required.");
        if (!start || !end) return showBrowserError("Start and end time are required.");
        if (!from) return showBrowserError("From is required.");
        if (!to) return showBrowserError("To is required.");

        const startMin = minFromTimeStr(start);
        const endMin = minFromTimeStr(end);

        if (startMin == null || endMin == null) return showBrowserError("Invalid time.");
        if (endMin <= startMin) return showBrowserError("End time must be after start time.");

        const originalBlock = [...allBlocks, ...dateBlocks].find((x) => x.id === id);
        const hasGeneratedLegs =
          Array.isArray(originalBlock?.generatedLegs) && originalBlock.generatedLegs.length;

        const updateData = {
          serviceDate,
          startMin,
          endMin,
          from,
          to,
          blockType,
          notes
        };

        if (hasGeneratedLegs) {
          const generatedLegs = originalBlock.generatedLegs.map((oldLeg, idx) => {
            const legFrom = document.getElementById(`editLegFrom_${id}_${idx}`)?.value.trim() || "";
            const legTo = document.getElementById(`editLegTo_${id}_${idx}`)?.value.trim() || "";
            const legStart = document.getElementById(`editLegStart_${id}_${idx}`)?.value || "";
            const legEnd = document.getElementById(`editLegEnd_${id}_${idx}`)?.value || "";
            const legType = document.getElementById(`editLegType_${id}_${idx}`)?.value || oldLeg.legType || "Forward";
            const legNote = document.getElementById(`editLegNote_${id}_${idx}`)?.value.trim() || "";

            const legStartMin = legStart ? minFromTimeStr(legStart) : null;
            const legEndMin = legEnd ? minFromTimeStr(legEnd) : null;

            return {
              ...oldLeg,
              legNo: idx + 1,
              from: legFrom,
              to: legTo,
              startTime: legStart,
              endTime: legEnd,
              startMin: legStartMin,
              endMin: legEndMin,
              legType,
              note: legNote
            };
          });

          for (const leg of generatedLegs) {
            if (!leg.from) return showBrowserError(`Leg ${leg.legNo}: From is required.`);
            if (!leg.to) return showBrowserError(`Leg ${leg.legNo}: To is required.`);

            if (leg.startTime && leg.startMin == null) {
              return showBrowserError(`Leg ${leg.legNo}: Invalid start time.`);
            }

            if (leg.endTime && leg.endMin == null) {
              return showBrowserError(`Leg ${leg.legNo}: Invalid end time.`);
            }

            if (
              leg.startMin != null &&
              leg.endMin != null &&
              leg.endMin <= leg.startMin
            ) {
              return showBrowserError(`Leg ${leg.legNo}: End time must be after start time.`);
            }
          }

          updateData.generatedLegs = generatedLegs;
          updateData.legCount = generatedLegs.length;
        }

        btn.disabled = true;
        btn.textContent = "Saving…";
        showBrowserMessage("Saving block changes… Do not click again.", "info", true);
        await updateBlock(id, updateData);

        editingBlockId = null;
        showError("");
        showBrowserMessage("Block changes saved successfully.", "success", true);
      } catch (e) {
        btn.disabled = false;
        btn.textContent = "Save Changes";
        showBrowserError(e?.message || "Failed to update block.");
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

