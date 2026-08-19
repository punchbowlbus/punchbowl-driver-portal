// public/js/permanent_runs.js
export function renderAdminPermanentRunsPage({
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
}) {
  let jobGroupsCache = [];
  let recurringCache = [];
  let jobGroupsUnsub = null;
  let recurringUnsub = null;
  let editingTemplateId = null;

  let openTemplateId = null;
  let openTemplateLegs = [];
  let openTemplateLegsUnsub = null;
  let openTemplateLegsLoading = false;
  let addingLegForTemplateId = null;
  let editingLegId = null;
  let actionMessageTimer = null;
  let templateSaveInProgress = false;
  let legSaveInProgress = false;
  let generateInProgress = false;

  function escapeHtml(s) {
    return (s ?? "")
      .toString()
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function jgTitle(jg) {
    return (jg?.title || jg?.name || "").toString();
  }

  function jgClient(jg) {
    return (jg?.clientName || jg?.client || jg?.school || "").toString();
  }

  function minFromTimeStr(t) {
    if (!t) return null;
    const [h, m] = t.split(":").map(Number);
    if (Number.isNaN(h) || Number.isNaN(m)) return null;
    return h * 60 + m;
  }

  function countsAsWorkFromLegType(legType) {
    return legType !== "Meal Break";
  }

  function isActiveTemplate(t) {
    const today = new Date().toISOString().slice(0, 10);
    const startOk = !t.startDate || t.startDate <= today;
    const endOk = !t.endDate || t.endDate >= today;
    return startOk && endOk;
  }

  function isEndedTemplate(t) {
    const today = new Date().toISOString().slice(0, 10);
    return !!t.endDate && t.endDate < today;
  }

  function legTypeOptions(selected = "Service") {
    const types = [
      "Service",
      "Return",
      "Dead Run",
      "Standby",
      "Layover",
      "Crib Break",
      "Meal Break",
      "Other"
    ];

    return types
      .map((type) => `<option value="${escapeHtml(type)}" ${type === selected ? "selected" : ""}>${escapeHtml(type)}</option>`)
      .join("");
  }

  function parseYmd(dateStr) {
    const [y, m, d] = (dateStr || "").split("-").map(Number);
    if (!y || !m || !d) return null;
    return new Date(y, m - 1, d);
  }

  function toYmd(dateObj) {
    const y = dateObj.getFullYear();
    const m = String(dateObj.getMonth() + 1).padStart(2, "0");
    const d = String(dateObj.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  function weekdayName(dateObj) {
    return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][dateObj.getDay()];
  }

  function getMatchingDatesForTemplate(t) {
    const start = parseYmd(t.startDate);
    if (!start) return [];

    const end = t.endDate ? parseYmd(t.endDate) : parseYmd(t.startDate);
    if (!end) return [];

    const result = [];
    const patternType = t.patternType || "WEEKLY";

    if (patternType === "DAILY") {
      const cur = new Date(start);
      while (cur <= end) {
        result.push(toYmd(cur));
        cur.setDate(cur.getDate() + 1);
      }
      return result;
    }

    if (patternType === "CUSTOM") {
      const every = Number(t.intervalDays || 0);
      if (!every || every < 1) return [];
      const cur = new Date(start);
      while (cur <= end) {
        result.push(toYmd(cur));
        cur.setDate(cur.getDate() + every);
      }
      return result;
    }

    const allowedDays = new Set((t.daysOfWeek || []).map((x) => String(x)));
    const cur = new Date(start);
    while (cur <= end) {
      if (allowedDays.has(weekdayName(cur))) {
        result.push(toYmd(cur));
      }
      cur.setDate(cur.getDate() + 1);
    }
    return result;
  }

  function showActionMessage(message, type = "info", sticky = false) {
    const messageEl = document.getElementById("permanentRunsActionMessage");
    if (!messageEl) return;
    if (actionMessageTimer) clearTimeout(actionMessageTimer);
    messageEl.textContent = message || "";
    messageEl.className = `permanent-runs-message ${type}`;
    messageEl.hidden = !message;
    if (message && !sticky) {
      actionMessageTimer = setTimeout(() => {
        messageEl.hidden = true;
        messageEl.textContent = "";
      }, 4500);
    }
  }

  function showActionError(message) {
    showError(message);
    showActionMessage(message, "error", true);
  }

  showError("");
  els.contentArea.innerHTML = `
    <div id="permanentRunsPage" class="permanent-runs-page">
      <header class="permanent-runs-hero">
        <div class="permanent-runs-hero-title">
          <span><i data-lucide="repeat-2"></i></span>
          <div><div class="permanent-runs-eyebrow">Recurring operations</div><h2>Permanent Runs</h2><p>Create reusable schedules and generate blocks for regular services.</p></div>
        </div>
      </header>

      <div id="permanentRunsActionMessage" class="permanent-runs-message info" role="status" aria-live="polite" hidden></div>

    <div class="card permanent-runs-form-card">
      <div class="permanent-runs-card-heading"><span>1</span><div><h3>Recurring Template</h3><p>Create repeating templates for school runs and regular services.</p></div></div>
      <div class="muted" style="margin-bottom:12px">
        Complete the linked job group, date range and recurring pattern.
      </div>

      <div class="permanent-runs-form-grid" style="display:grid; grid-template-columns: 1.2fr 1fr; gap:14px;">
        <div>
          <div class="muted" style="margin-bottom:6px">Linked Job Group</div>
          <select id="rtJobGroup">
            <option value="">-- Select Job Group --</option>
          </select>

          <div class="muted" style="margin:10px 0 6px">Template Title</div>
          <input id="rtTitle" placeholder="e.g. School Runs - Term 2" />

          <div class="muted" style="margin:10px 0 6px">Notes</div>
          <textarea id="rtNotes" placeholder="Notes"></textarea>
        </div>

        <div>
          <div style="display:flex; gap:10px;">
            <div style="flex:1">
              <div class="muted" style="margin-bottom:6px">Start Date</div>
              <input id="rtStart" type="date" />
            </div>
            <div style="flex:1">
              <div class="muted" style="margin-bottom:6px">End Date (optional)</div>
              <input id="rtEnd" type="date" />
            </div>
          </div>

          <div class="muted" style="margin:12px 0 6px">Recurring Type</div>
          <select id="rtType">
            <option value="WEEKLY">Weekly</option>
            <option value="DAILY">Daily</option>
            <option value="CUSTOM">Every X Days</option>
          </select>

          <div id="weeklyDaysWrap" style="margin-top:12px">
            <div class="muted" style="margin-bottom:8px">Weekly days</div>
            <div style="display:flex; gap:8px; flex-wrap:wrap;">
              <label><input type="checkbox" class="dow" value="Mon"> Mon</label>
              <label><input type="checkbox" class="dow" value="Tue"> Tue</label>
              <label><input type="checkbox" class="dow" value="Wed"> Wed</label>
              <label><input type="checkbox" class="dow" value="Thu"> Thu</label>
              <label><input type="checkbox" class="dow" value="Fri"> Fri</label>
              <label><input type="checkbox" class="dow" value="Sat"> Sat</label>
              <label><input type="checkbox" class="dow" value="Sun"> Sun</label>
            </div>
          </div>

          <div id="customEveryWrap" style="display:none; margin-top:12px">
            <div class="muted" style="margin-bottom:6px">Every X days</div>
            <input id="rtIntervalDays" type="number" min="1" placeholder="e.g. 14" />
          </div>
        </div>
      </div>

      <div class="permanent-runs-form-actions" style="display:flex; gap:10px; margin-top:14px; align-items:center;">
        <button id="createRT" class="permanent-runs-primary-btn">Create Template</button>
        <button id="cancelRTEdit" class="btn" style="display:none;">Cancel</button>
      </div>
    </div>

    <div class="card permanent-runs-directory" style="margin-top:16px">
      <div class="permanent-runs-card-heading"><span>2</span><div><h3>Template Directory</h3><p>Open a template to manage its legs or generate scheduled blocks.</p></div></div>
      <div class="permanent-runs-filters" style="display:flex; gap:10px; flex-wrap:wrap; align-items:end;">
        <div style="flex:2; min-width:260px;">
          <div class="muted" style="margin-bottom:6px">Search</div>
          <input id="rtSearch" placeholder="Search templates by name or notes" />
        </div>

        <div style="flex:1; min-width:180px;">
          <div class="muted" style="margin-bottom:6px">Status</div>
          <select id="rtStatusFilter">
            <option value="ALL">All</option>
            <option value="ACTIVE">Active</option>
            <option value="ENDED">Ended</option>
          </select>
        </div>

        <div style="flex:1; min-width:180px;">
          <div class="muted" style="margin-bottom:6px">Sort</div>
          <select id="rtSort">
            <option value="NEWEST">Newest</option>
            <option value="OLDEST">Oldest</option>
            <option value="AZ">Name A–Z</option>
          </select>
        </div>
      </div>

      <div id="rtList" style="margin-top:14px"></div>
    </div>
    </div>
  `;

  window.lucide?.createIcons?.();

  const typeEl = document.getElementById("rtType");
  const weeklyWrap = document.getElementById("weeklyDaysWrap");
  const customWrap = document.getElementById("customEveryWrap");
  const listEl = document.getElementById("rtList");

  const searchEl = document.getElementById("rtSearch");
  const statusEl = document.getElementById("rtStatusFilter");
  const sortEl = document.getElementById("rtSort");

  const createBtn = document.getElementById("createRT");
  const cancelBtn = document.getElementById("cancelRTEdit");
  const rtJobGroupEl = document.getElementById("rtJobGroup");

  function resetForm() {
    document.getElementById("rtJobGroup").value = "";
    document.getElementById("rtTitle").value = "";
    document.getElementById("rtNotes").value = "";
    document.getElementById("rtStart").value = "";
    document.getElementById("rtEnd").value = "";
    document.getElementById("rtType").value = "WEEKLY";
    document.getElementById("rtIntervalDays").value = "";
    [...document.querySelectorAll("input.dow")].forEach((x) => (x.checked = false));

    editingTemplateId = null;
    createBtn.textContent = "Create Template";
    cancelBtn.style.display = "none";
    weeklyWrap.style.display = "block";
    customWrap.style.display = "none";
  }

  function closeOpenTemplate() {
    openTemplateId = null;
    openTemplateLegs = [];
    openTemplateLegsLoading = false;
    addingLegForTemplateId = null;
    editingLegId = null;

    if (openTemplateLegsUnsub) {
      openTemplateLegsUnsub();
      openTemplateLegsUnsub = null;
    }
  }

  function openTemplate(templateId) {
    if (openTemplateId === templateId) {
      closeOpenTemplate();
      renderRTList();
      showActionMessage("Template details closed.", "info");
      return;
    }

    closeOpenTemplate();
    openTemplateId = templateId;
    openTemplateLegs = [];
    openTemplateLegsLoading = true;
    addingLegForTemplateId = null;
    editingLegId = null;
    renderRTList();
    showActionMessage("Loading template legs…", "info", true);

    openTemplateLegsUnsub = listenTemplateLegs(
      templateId,
      (legs) => {
        if (!document.getElementById("permanentRunsPage")) {
          closeOpenTemplate();
          return;
        }
        openTemplateLegs = (legs || []).slice().sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
        openTemplateLegsLoading = false;
        renderRTList();
        showActionMessage(`Template opened with ${openTemplateLegs.length} leg${openTemplateLegs.length === 1 ? "" : "s"}.`, "success");
      },
      (e) => {
        openTemplateLegsLoading = false;
        showActionError(e?.message || "Failed to load template legs.");
        renderRTList();
      }
    );
  }

  function renderLegForm(templateId, leg = null) {
    const isEdit = !!leg;
    return `
      <div style="
        margin-top:14px;
        padding:14px;
        border:1px solid #eee;
        border-radius:12px;
        background:#fafafa;
      ">
        <div style="font-weight:900; font-size:16px; margin-bottom:12px;">
          ${isEdit ? "Edit Leg" : "Add New Leg"}
        </div>

        <div class="muted" style="margin-bottom:6px">Leg Name</div>
        <input id="tplLegName_${templateId}" value="${escapeHtml(leg?.name || "")}" placeholder="e.g. AM Run" />

        <div style="display:flex; gap:10px; margin-top:10px;">
          <div style="flex:1">
            <div class="muted" style="margin-bottom:6px">Start Time</div>
            <input id="tplLegStart_${templateId}" type="time" value="${escapeHtml(leg?.startTime || "")}" />
          </div>
          <div style="flex:1">
            <div class="muted" style="margin-bottom:6px">End Time</div>
            <input id="tplLegEnd_${templateId}" type="time" value="${escapeHtml(leg?.endTime || "")}" />
          </div>
        </div>

        <div style="display:flex; gap:10px; margin-top:10px;">
          <div style="flex:1">
            <div class="muted" style="margin-bottom:6px">From</div>
            <input id="tplLegFrom_${templateId}" value="${escapeHtml(leg?.from || "")}" placeholder="e.g. Punchbowl Depot" />
          </div>
          <div style="flex:1">
            <div class="muted" style="margin-bottom:6px">To</div>
            <input id="tplLegTo_${templateId}" value="${escapeHtml(leg?.to || "")}" placeholder="e.g. Bankstown School" />
          </div>
        </div>

        <div style="display:flex; gap:10px; margin-top:10px; align-items:end;">
          <div style="flex:1">
            <div class="muted" style="margin-bottom:6px">Leg Type</div>
            <select id="tplLegType_${templateId}">
              ${legTypeOptions(leg?.legType || "Service")}
            </select>
          </div>

          <div style="flex:1">
            <div class="muted" style="margin-bottom:6px">Counts in working time</div>
            <input id="tplLegCounts_${templateId}" value="${countsAsWorkFromLegType(leg?.legType || "Service") ? "Yes" : "No"}" disabled />
          </div>
        </div>

        <div style="display:flex; gap:10px; margin-top:14px;">
          <button class="btn" data-leg-save="${templateId}" data-leg-edit-id="${leg?.id || ""}">
            ${isEdit ? "Save Changes" : "Save Leg"}
          </button>
          <button class="btn" data-leg-cancel="${templateId}">Cancel</button>
        </div>
      </div>
    `;
  }

  function renderExpandedTemplate(t) {
    const templateId = t.id;
    const legs = openTemplateId === templateId ? openTemplateLegs : [];
    const isAdding = addingLegForTemplateId === templateId && !editingLegId;
    const editingLeg = editingLegId ? legs.find((x) => x.id === editingLegId) : null;

    return `
      <div style="
        margin-top:14px;
        padding-top:14px;
        border-top:1px solid #eee;
      ">
        <div style="font-weight:900; font-size:18px; margin-bottom:10px;">Template Legs</div>

        ${
          openTemplateLegsLoading
            ? `<div class="muted" style="margin-bottom:12px;">Loading legs...</div>`
            : !legs.length
            ? `<div class="muted" style="margin-bottom:12px;">No legs added yet.</div>`
            : legs
                .map((leg, i) => {
                  const countsLabel = leg.countsAsWork ? "Yes" : "No";
                  return `
                    <div style="
                      border:1px solid #eee;
                      border-radius:12px;
                      padding:12px;
                      margin-bottom:10px;
                      background:#fff;
                    ">
                      <div style="display:flex; justify-content:space-between; gap:12px; align-items:flex-start;">
                        <div style="flex:1;">
                          <div style="font-weight:900; font-size:16px;">
                            ${i + 1}. ${escapeHtml(leg.name || "Unnamed Leg")}
                          </div>

                          <div style="margin-top:6px; font-size:15px;">
                            <b>${escapeHtml(leg.startTime || "-")}</b> → <b>${escapeHtml(leg.endTime || "-")}</b>
                          </div>

                          <div style="margin-top:4px;">
                            ${escapeHtml(leg.from || "-")} → ${escapeHtml(leg.to || "-")}
                          </div>

                          <div class="muted" style="margin-top:6px;">
                            Type: ${escapeHtml(leg.legType || "-")} &nbsp; | &nbsp; Working Time: <b>${escapeHtml(countsLabel)}</b>
                          </div>
                        </div>

                        <div style="display:flex; gap:8px; flex-shrink:0;">
                          <button class="btn" data-leg-edit="${leg.id}">Edit</button>
                          <button class="btn danger" data-leg-del="${leg.id}">Delete</button>
                        </div>
                      </div>
                    </div>
                  `;
                })
                .join("")
        }

        <div style="margin-top:10px;">
          <button class="btn" data-add-leg="${templateId}" ${openTemplateLegsLoading ? "disabled" : ""}>+ Add Leg</button>
        </div>

        ${isAdding ? renderLegForm(templateId) : ""}
        ${editingLeg ? renderLegForm(templateId, editingLeg) : ""}
      </div>
    `;
  }

  function renderRTList() {
    const q = (searchEl?.value || "").trim().toLowerCase();
    const status = statusEl?.value || "ALL";
    const sort = sortEl?.value || "NEWEST";

    let list = recurringCache.filter((t) => t.generated !== true);

    if (q) {
      list = list.filter((t) => {
        const hay = [
          t.title || t.name || "",
          t.notes || "",
          t.patternType || "",
          (t.daysOfWeek || []).join(" ")
        ]
          .join(" ")
          .toLowerCase();
        return hay.includes(q);
      });
    }

    if (status === "ACTIVE") {
      list = list.filter((t) => isActiveTemplate(t));
    } else if (status === "ENDED") {
      list = list.filter((t) => isEndedTemplate(t));
    }

    if (sort === "AZ") {
      list.sort((a, b) => (a.title || a.name || "").localeCompare(b.title || b.name || ""));
    } else if (sort === "OLDEST") {
      list.sort((a, b) => (a.startDate || "").localeCompare(b.startDate || ""));
    } else {
      list.sort((a, b) => (b.startDate || "").localeCompare(a.startDate || ""));
    }

    if (!list.length) {
      listEl.innerHTML = `<div class="muted">No templates found.</div>`;
      return;
    }

    listEl.innerHTML = list
      .map((t) => {
        const title = escapeHtml((t.title || t.name || "(No title)") + "");
        const pattern =
          t.patternType === "WEEKLY"
            ? `Weekly — ${(t.daysOfWeek || []).join(", ") || "-"}`
            : t.patternType === "CUSTOM"
            ? `Every ${t.intervalDays || "?"} days`
            : "Daily";

        const dateRange = `From ${escapeHtml(t.startDate || "-")}${t.endDate ? " to " + escapeHtml(t.endDate) : ""}`;
        const notes = t.notes ? `<div class="muted" style="margin-top:8px">${escapeHtml(t.notes)}</div>` : "";
        const isOpen = openTemplateId === t.id;
        const isLoadingThisTemplate = isOpen && openTemplateLegsLoading;

        return `
          <div style="
            border:1px solid #eee;
            border-radius:12px;
            padding:14px;
            margin-bottom:10px;
            background:#fff;
          ">
            <div style="display:flex; justify-content:space-between; gap:12px; align-items:flex-start;">
              <div style="flex:1;">
                <div style="font-weight:900; font-size:20px;">
                  ${title}
                </div>

                <div class="muted" style="margin-top:6px">
                  ${escapeHtml(pattern)}
                </div>

                <div class="muted" style="font-size:13px; margin-top:4px">
                  ${dateRange}
                </div>

                ${notes}
              </div>

              <div style="display:flex; gap:8px; flex-shrink:0; flex-wrap:wrap; justify-content:flex-end;">
                <button class="btn" data-rt-open="${t.id}">${isOpen ? "Close" : "Open"}</button>
                <button class="btn" data-rt-edit="${t.id}">Edit</button>
                <button class="btn danger" data-rt-del="${t.id}">Delete</button>
                <button class="btn" data-rt-generate="${t.id}" ${isLoadingThisTemplate ? "disabled" : ""}>
                  ${isLoadingThisTemplate ? "Loading legs..." : "Generate Blocks"}
                </button>
              </div>
            </div>

            ${isOpen ? renderExpandedTemplate(t) : ""}
          </div>
        `;
      })
      .join("");

    [...listEl.querySelectorAll("[data-rt-open]")].forEach((btn) => {
      btn.onclick = () => {
        const id = btn.getAttribute("data-rt-open");
        openTemplate(id);
      };
    });

    [...listEl.querySelectorAll("[data-rt-edit]")].forEach((btn) => {
      btn.onclick = () => {
        const id = btn.getAttribute("data-rt-edit");
        const t = recurringCache.find((x) => x.id === id);
        if (!t) return;

        editingTemplateId = id;

        document.getElementById("rtTitle").value = t.title || t.name || "";
        document.getElementById("rtNotes").value = t.notes || "";
        document.getElementById("rtJobGroup").value = t.jobGroupId || "";
        document.getElementById("rtType").value = t.patternType || "WEEKLY";
        document.getElementById("rtStart").value = t.startDate || "";
        document.getElementById("rtEnd").value = t.endDate || "";
        document.getElementById("rtIntervalDays").value = t.intervalDays || "";

        [...document.querySelectorAll("input.dow")].forEach((x) => {
          x.checked = (t.daysOfWeek || []).includes(x.value);
        });

        typeEl.onchange();
        createBtn.textContent = "Save Changes";
        cancelBtn.style.display = "inline-block";
        showActionMessage(`Editing ${t.title || t.name || "recurring template"}.`, "info");
        window.scrollTo({ top: 0, behavior: "smooth" });
      };
    });

    [...listEl.querySelectorAll("[data-rt-del]")].forEach((btn) => {
      btn.onclick = async () => {
        const id = btn.getAttribute("data-rt-del");
        const t = recurringCache.find((x) => x.id === id);
        const label = t ? (t.title || t.name || id) : id;

        if (!confirm(`Delete template: ${label} ?`)) return;

        try {
          btn.disabled = true;
          btn.textContent = "Deleting…";
          await deleteRecurringTemplate(id);

          if (editingTemplateId === id) {
            editingTemplateId = null;
            resetForm();
          }

          if (openTemplateId === id) {
            closeOpenTemplate();
          }
          showActionMessage(`${label} was deleted.`, "success");
        } catch (e) {
          btn.disabled = false;
          btn.textContent = "Delete";
          showActionError(e?.message || "Failed to delete template.");
        }
      };
    });

    [...listEl.querySelectorAll("[data-rt-generate]")].forEach((btn) => {
      btn.onclick = async () => {
        if (generateInProgress) return;
        const id = btn.getAttribute("data-rt-generate");
        const t = recurringCache.find((x) => x.id === id);
        if (!t) return;

        if (openTemplateId !== id) {
          return showActionError("Please open the template first.");
        }

        if (openTemplateLegsLoading) {
          return showActionError("Legs are still loading. Please wait a moment.");
        }

        const legsToUse = openTemplateLegs;

        if (!legsToUse.length) {
          return showActionError("No template legs found. Please add legs before generating.");
        }

        try {
          const dates = getMatchingDatesForTemplate(t);

          if (!dates.length) {
            return showActionError("No matching dates found for this template.");
          }

          generateInProgress = true;
          btn.disabled = true;
          btn.textContent = "Generating…";
          showActionMessage(`Generating blocks for ${dates.length} service date${dates.length === 1 ? "" : "s"}… Do not click again.`, "info", true);
          let createdCount = 0;

          for (const serviceDate of dates) {
            for (const leg of legsToUse) {
              await addBlock({
                jobGroupId: t.jobGroupId || null,
                recurringTemplateId: t.id,
                templateLegId: leg.id,
                serviceDate,
                from: leg.from || "",
                to: leg.to || "",
                startMin: leg.startMin,
                endMin: leg.endMin,
                blockType: leg.legType || "Service",
                notes: t.notes || "",
                createdBy: auth.currentUser?.email,
                generatedFromTemplate: true,
                countsAsWork: !!leg.countsAsWork
              });
              createdCount += 1;
            }
          }

          if (createdCount < 1) {
            return showActionError("No blocks were created. Template will stay visible.");
          }

          await markRecurringTemplateGenerated(id, {
            generatedBlockCount: createdCount
          });

          if (openTemplateId === id) {
            closeOpenTemplate();
          }

          showError("");
          showActionMessage(`Generated ${createdCount} blocks successfully.`, "success", true);
        } catch (e) {
          showActionError(e?.message || "Failed to generate blocks. The template remains available for review.");
        } finally {
          generateInProgress = false;
          if (document.contains(btn)) {
            btn.disabled = false;
            btn.textContent = "Generate Blocks";
          }
        }
      };
    });

    [...listEl.querySelectorAll("[data-add-leg]")].forEach((btn) => {
      btn.onclick = () => {
        addingLegForTemplateId = btn.getAttribute("data-add-leg");
        editingLegId = null;
        renderRTList();
        wireLegFormEvents();
        showActionMessage("New leg form opened.", "info");
      };
    });

    [...listEl.querySelectorAll("[data-leg-edit]")].forEach((btn) => {
      btn.onclick = () => {
        editingLegId = btn.getAttribute("data-leg-edit");
        addingLegForTemplateId = null;
        renderRTList();
        wireLegFormEvents();
        showActionMessage("Leg opened for editing.", "info");
      };
    });

    [...listEl.querySelectorAll("[data-leg-del]")].forEach((btn) => {
      btn.onclick = async () => {
        const legId = btn.getAttribute("data-leg-del");
        const leg = openTemplateLegs.find((x) => x.id === legId);
        const label = leg?.name || "this leg";

        if (!confirm(`Delete leg: ${label} ?`)) return;

        try {
          btn.disabled = true;
          btn.textContent = "Deleting…";
          await deleteTemplateLeg(legId);
          if (editingLegId === legId) editingLegId = null;
          showActionMessage(`${label} was deleted.`, "success");
        } catch (e) {
          btn.disabled = false;
          btn.textContent = "Delete";
          showActionError(e?.message || "Failed to delete leg.");
        }
      };
    });

    wireLegFormEvents();
  }

  function wireLegFormEvents() {
    if (!openTemplateId) return;

    const typeField = document.getElementById(`tplLegType_${openTemplateId}`);
    const countsField = document.getElementById(`tplLegCounts_${openTemplateId}`);
    const saveBtn = document.querySelector(`[data-leg-save="${openTemplateId}"]`);
    const formCancelBtn = document.querySelector(`[data-leg-cancel="${openTemplateId}"]`);

    if (typeField && countsField) {
      typeField.onchange = () => {
        countsField.value = countsAsWorkFromLegType(typeField.value) ? "Yes" : "No";
      };
    }

    if (formCancelBtn) {
      formCancelBtn.onclick = () => {
        addingLegForTemplateId = null;
        editingLegId = null;
        renderRTList();
        showActionMessage("Leg changes cancelled.", "warning");
      };
    }

    if (saveBtn) {
      saveBtn.onclick = async () => {
        if (legSaveInProgress) return;
        showError("");
        try {
          const templateId = openTemplateId;
          const legId = saveBtn.getAttribute("data-leg-edit-id") || "";

          const name = (document.getElementById(`tplLegName_${templateId}`)?.value || "").trim();
          const startTime = document.getElementById(`tplLegStart_${templateId}`)?.value || "";
          const endTime = document.getElementById(`tplLegEnd_${templateId}`)?.value || "";
          const from = (document.getElementById(`tplLegFrom_${templateId}`)?.value || "").trim();
          const to = (document.getElementById(`tplLegTo_${templateId}`)?.value || "").trim();
          const legType = document.getElementById(`tplLegType_${templateId}`)?.value || "Service";

          if (!name) return showActionError("Leg name is required.");
          if (!startTime) return showActionError("Start time is required.");
          if (!endTime) return showActionError("End time is required.");
          if (!from) return showActionError("From is required.");
          if (!to) return showActionError("To is required.");

          const startMin = minFromTimeStr(startTime);
          const endMin = minFromTimeStr(endTime);

          if (startMin == null || endMin == null) return showActionError("Invalid leg times.");
          if (endMin <= startMin) return showActionError("End time must be after start time.");

          const countsAsWork = countsAsWorkFromLegType(legType);
          legSaveInProgress = true;
          saveBtn.disabled = true;
          if (formCancelBtn) formCancelBtn.disabled = true;
          saveBtn.textContent = "Saving…";
          showActionMessage(`${legId ? "Updating" : "Saving"} ${name}… Do not click again.`, "info", true);

          if (legId) {
            await updateTemplateLeg(legId, {
              name,
              startTime,
              endTime,
              startMin,
              endMin,
              from,
              to,
              legType,
              countsAsWork
            });

            editingLegId = null;
            showActionMessage(`${name} was updated successfully.`, "success");
            return;
          }

          await addTemplateLeg({
            templateId,
            name,
            startTime,
            endTime,
            startMin,
            endMin,
            from,
            to,
            legType,
            countsAsWork,
            sortOrder: openTemplateLegs.length + 1,
            createdBy: auth.currentUser?.email
          });

          addingLegForTemplateId = null;
          showActionMessage(`${name} was added successfully.`, "success");
        } catch (e) {
          showActionError(e?.message || "Failed to save leg.");
        } finally {
          legSaveInProgress = false;
          if (document.contains(saveBtn)) {
            saveBtn.disabled = false;
            saveBtn.textContent = saveBtn.getAttribute("data-leg-edit-id") ? "Save Changes" : "Save Leg";
          }
          if (formCancelBtn && document.contains(formCancelBtn)) formCancelBtn.disabled = false;
        }
      };
    }
  }

  if (typeEl) {
    typeEl.onchange = () => {
      const v = typeEl.value;
      weeklyWrap.style.display = v === "WEEKLY" ? "block" : "none";
      customWrap.style.display = v === "CUSTOM" ? "block" : "none";
    };
  }

  if (searchEl) searchEl.oninput = () => renderRTList();
  if (statusEl) statusEl.onchange = () => renderRTList();
  if (sortEl) sortEl.onchange = () => renderRTList();

  if (cancelBtn) {
    cancelBtn.onclick = () => {
      editingTemplateId = null;
      resetForm();
      showActionMessage("Template changes cancelled.", "warning");
    };
  }

  if (rtJobGroupEl) {
    if (jobGroupsUnsub) jobGroupsUnsub();

    jobGroupsUnsub = listenJobGroups(
      (list) => {
        if (!document.getElementById("permanentRunsPage")) {
          jobGroupsUnsub?.();
          jobGroupsUnsub = null;
          return;
        }
        jobGroupsCache = (list || []).filter((jg) => !jg.deleted);

        const old = rtJobGroupEl.value || "";
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

        rtJobGroupEl.innerHTML = opts;

        const stillExists = jobGroupsCache.some((jg) => jg.id === old);
        rtJobGroupEl.value = stillExists ? old : "";
      },
      (e) => showError(e?.message || "Failed to load job groups")
    );
  }

  if (recurringUnsub) recurringUnsub();
  recurringUnsub = listenRecurringTemplates(
    (list) => {
      if (!document.getElementById("permanentRunsPage")) {
        recurringUnsub?.();
        recurringUnsub = null;
        closeOpenTemplate();
        return;
      }
      recurringCache = (list || []).filter((t) => !t.deleted);
      renderRTList();
    },
    (e) => showError(e?.message || "Failed to load recurring templates")
  );

  createBtn.onclick = async () => {
    if (templateSaveInProgress) return;
    showError("");

    try {
      const title = document.getElementById("rtTitle").value.trim();
      const notes = document.getElementById("rtNotes").value.trim();
      const jobGroupId = document.getElementById("rtJobGroup").value;
      const patternType = document.getElementById("rtType").value;
      const startDate = document.getElementById("rtStart").value;
      const endDate = document.getElementById("rtEnd").value || null;

      if (!title) return showActionError("Template title is required.");
      if (!jobGroupId) return showActionError("Please select a linked Job Group.");
      if (!startDate) return showActionError("Start date is required.");
      if (endDate && endDate < startDate) return showActionError("End date cannot be before the start date.");

      let daysOfWeek = [];
      let intervalDays = null;

      if (patternType === "WEEKLY") {
        daysOfWeek = [...document.querySelectorAll("input.dow:checked")].map((x) => x.value);
        if (!daysOfWeek.length) return showActionError("Select at least one weekly day (Mon–Sun).");
      }

      if (patternType === "CUSTOM") {
        intervalDays = Number(document.getElementById("rtIntervalDays").value || "");
        if (!intervalDays || intervalDays < 1) {
          return showActionError("Enter a valid recurring interval, such as 14 days.");
        }
      }

      const wasEditing = Boolean(editingTemplateId);
      templateSaveInProgress = true;
      createBtn.disabled = true;
      cancelBtn.disabled = true;
      createBtn.textContent = "Saving…";
      showActionMessage(`${wasEditing ? "Updating" : "Saving"} ${title}… Do not click again.`, "info", true);

      if (editingTemplateId) {
        await updateRecurringTemplate(editingTemplateId, {
          jobGroupId,
          title,
          notes,
          patternType,
          daysOfWeek,
          intervalDays,
          startDate,
          endDate
        });

        resetForm();
        showActionMessage(`${title} was updated successfully.`, "success");
        return;
      }

      await addRecurringTemplate({
        jobGroupId,
        title,
        notes,
        patternType,
        daysOfWeek,
        intervalDays,
        startDate,
        endDate,
        createdBy: auth.currentUser?.email
      });

      resetForm();
      showActionMessage(`${title} was created successfully. Open it to add route legs.`, "success", true);
    } catch (e) {
      showActionError(e?.message || "Failed to save the recurring template.");
    } finally {
      templateSaveInProgress = false;
      createBtn.disabled = false;
      cancelBtn.disabled = false;
      if (editingTemplateId) createBtn.textContent = "Save Changes";
      else createBtn.textContent = "Create Template";
    }
  };

  resetForm();
}
