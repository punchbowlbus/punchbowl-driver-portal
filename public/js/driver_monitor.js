import { listenDutySpansByDate, listenBlocksByDate } from "./db.js";
import { state } from "./state.js";
import { escapeHtml } from "./utils.js";

const STYLE_ID = "driverMonitorStyles";

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const link = document.createElement("link");
  link.id = STYLE_ID;
  link.rel = "stylesheet";
  link.href = "./styles/driver_monitor.css?v=1";
  document.head.appendChild(link);
}

function todayLocal() {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

function currentMinute() {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}

function asMinute(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function timeLabel(value) {
  const min = asMinute(value);
  const hours = Math.floor(min / 60) % 24;
  const minutes = min % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function clean(value, fallback = "—") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function acknowledgment(value) {
  const text = String(value || "").trim().toLowerCase();
  if (["yes", "y", "accepted"].includes(text)) return "Yes";
  if (["no", "n", "declined"].includes(text)) return "No";
  return "Pending";
}

function dispatchStatus(value) {
  const text = String(value || "").trim().toLowerCase();
  if (text === "assigned") return "Assigned";
  if (["cancelled", "canceled"].includes(text)) return "Cancelled";
  return "Pending";
}

function dutyState(duty, selectedDate) {
  const dispatch = dispatchStatus(duty.dispatchStatus);
  const ack = acknowledgment(duty.driverAcknowledgment);
  const nowMin = currentMinute();
  const start = asMinute(duty.startMin);
  const end = asMinute(duty.endMin);

  if (dispatch === "Cancelled") return { key: "cancelled", label: "Cancelled", tone: "grey" };
  if (ack === "No") return { key: "attention", label: "Declined", tone: "red" };
  if (dispatch !== "Assigned") return { key: "attention", label: "Not dispatched", tone: "amber" };
  if (ack === "Pending") return { key: "attention", label: "Awaiting reply", tone: "amber" };
  if (selectedDate < todayLocal()) return { key: "finished", label: "Finished", tone: "grey" };
  if (selectedDate > todayLocal()) return { key: "upcoming", label: "Upcoming", tone: "blue" };
  if (nowMin < start) {
    const until = start - nowMin;
    return {
      key: until <= 60 ? "starting" : "upcoming",
      label: until <= 60 ? `Starts in ${until} min` : "Upcoming",
      tone: until <= 60 ? "blue" : "navy"
    };
  }
  if (nowMin > end) return { key: "finished", label: "Finished", tone: "grey" };
  return { key: "working", label: "On duty", tone: "green" };
}

function blockTimes(block) {
  return {
    start: asMinute(block.startMin ?? block.startMinutes),
    end: asMinute(block.endMin ?? block.endMinutes)
  };
}

function blockTitle(block) {
  return clean(
    block.jobGroupName || block.groupName || block.schoolName || block.title || block.jobName,
    "Assigned job"
  );
}

function relatedBlocks(duty, blocks) {
  const dutyId = String(duty.id || "");
  return blocks
    .filter((block) => !block.deleted && String(block.dutySpanId || "") === dutyId)
    .sort((a, b) => blockTimes(a).start - blockTimes(b).start);
}

function activeBlock(duty, blocks, selectedDate) {
  const related = relatedBlocks(duty, blocks);
  if (!related.length) return null;
  if (selectedDate !== todayLocal()) return related[0];
  const nowMin = currentMinute();
  return related.find((block) => {
    const times = blockTimes(block);
    return nowMin >= times.start && nowMin <= times.end;
  }) || related.find((block) => blockTimes(block).start > nowMin) || related[related.length - 1];
}

function fatigueIsWarning(duty) {
  const status = String(duty.fatigueStatus || "OK").trim().toUpperCase();
  return status !== "OK" && status !== "PASS" && status !== "COMPLIANT";
}

function hasBus(duty) {
  return Boolean(String(duty.assignedBus || duty.busNumber || "").trim());
}

function buildAlerts(duties, selectedDate) {
  const nowMin = currentMinute();
  const alerts = [];

  duties.forEach((duty) => {
    const name = clean(duty.driverName, `Driver ${clean(duty.driverEmployeeNumber)}`);
    const ack = acknowledgment(duty.driverAcknowledgment);
    const dispatch = dispatchStatus(duty.dispatchStatus);
    const startsSoon = selectedDate === todayLocal() && asMinute(duty.startMin) >= nowMin && asMinute(duty.startMin) - nowMin <= 60;

    if (ack === "No") alerts.push({ tone: "red", title: `${name} declined duty ${clean(duty.dutyNumber)}`, action: "Open" , id: duty.id });
    else if (dispatch === "Assigned" && ack === "Pending") alerts.push({ tone: "amber", title: `${name} has not acknowledged`, action: "Open", id: duty.id });
    if (dispatch !== "Cancelled" && startsSoon && !hasBus(duty)) alerts.push({ tone: "red", title: `${name} starts soon with no bus`, action: "Open", id: duty.id });
    if (fatigueIsWarning(duty)) alerts.push({ tone: "amber", title: `${name}: ${clean(duty.fatigueWarning || duty.fatigueStatus, "Fatigue warning")}`, action: "Review", id: duty.id });
  });

  return alerts;
}

function summary(duties, selectedDate) {
  const states = duties.map((duty) => dutyState(duty, selectedDate));
  return {
    total: duties.length,
    working: states.filter((item) => item.key === "working").length,
    starting: states.filter((item) => item.key === "starting").length,
    finished: states.filter((item) => item.key === "finished").length,
    attention: states.filter((item) => item.key === "attention").length,
    noBus: duties.filter((duty) => dispatchStatus(duty.dispatchStatus) !== "Cancelled" && !hasBus(duty)).length
  };
}

function renderShell(root, selectedDate) {
  root.innerHTML = `
    <section class="dm-page" aria-labelledby="dmTitle">
      <header class="dm-header">
        <div>
          <div class="dm-eyebrow">OPERATIONS CONTROL</div>
          <h1 id="dmTitle">Driver Monitor</h1>
          <p>Live duty status, acknowledgments and operational attention.</p>
        </div>
        <div class="dm-date-wrap">
          <label for="dmDate">Operating date</label>
          <input id="dmDate" type="date" value="${escapeHtml(selectedDate)}">
        </div>
      </header>

      <div id="dmSummary" class="dm-summary" aria-live="polite"></div>

      <div class="dm-toolbar">
        <div class="dm-search-wrap">
          <span aria-hidden="true">⌕</span>
          <input id="dmSearch" type="search" placeholder="Search driver, employee, duty or bus">
        </div>
        <div id="dmFilters" class="dm-filters" aria-label="Driver status filters"></div>
      </div>

      <div class="dm-layout">
        <main class="dm-table-card">
          <div class="dm-section-head">
            <div>
              <h2>Driver duties</h2>
              <span id="dmResultCount">Loading…</span>
            </div>
            <span class="dm-live"><i></i> Live</span>
          </div>
          <div id="dmTableWrap" class="dm-table-wrap">
            <div class="dm-loading">Loading driver duties…</div>
          </div>
        </main>

        <aside class="dm-alert-card">
          <div class="dm-section-head">
            <div>
              <h2>Attention</h2>
              <span>Items requiring dispatcher review</span>
            </div>
          </div>
          <div id="dmAlerts"></div>
        </aside>
      </div>
    </section>
    <div id="dmDrawerBackdrop" class="dm-drawer-backdrop" hidden></div>
    <aside id="dmDrawer" class="dm-drawer" aria-label="Driver duty details" aria-hidden="true"></aside>
  `;
}

function renderSummary(root, values) {
  const cards = [
    ["total", "Drivers rostered", values.total, "navy"],
    ["working", "Working now", values.working, "green"],
    ["starting", "Starting soon", values.starting, "blue"],
    ["attention", "Needs attention", values.attention, "red"],
    ["noBus", "No bus", values.noBus, "amber"],
    ["finished", "Finished", values.finished, "grey"]
  ];
  root.innerHTML = cards.map(([key, label, value, tone]) => `
    <button class="dm-kpi dm-kpi-${tone}" data-summary-filter="${key}" type="button">
      <span>${escapeHtml(label)}</span><strong>${value}</strong>
    </button>
  `).join("");
}

function renderFilters(root, active) {
  const options = [
    ["all", "All"], ["working", "Working now"], ["starting", "Starting soon"],
    ["attention", "Needs attention"], ["noBus", "No bus"], ["finished", "Finished"]
  ];
  root.innerHTML = options.map(([key, label]) => `
    <button type="button" class="dm-filter ${active === key ? "is-active" : ""}" data-filter="${key}">${label}</button>
  `).join("");
}

function dutyMatchesFilter(duty, filter, selectedDate) {
  if (filter === "all" || filter === "total") return true;
  if (filter === "noBus") return dispatchStatus(duty.dispatchStatus) !== "Cancelled" && !hasBus(duty);
  return dutyState(duty, selectedDate).key === filter;
}

function renderTable(root, duties, blocks, selectedDate) {
  if (!duties.length) {
    root.innerHTML = `<div class="dm-empty"><strong>No matching duties</strong><span>Try another filter or operating date.</span></div>`;
    return;
  }

  root.innerHTML = `
    <table class="dm-table">
      <thead><tr><th>Driver</th><th>Duty</th><th>Bus</th><th>Shift</th><th>Current / next job</th><th>Status</th><th></th></tr></thead>
      <tbody>${duties.map((duty) => {
        const status = dutyState(duty, selectedDate);
        const block = activeBlock(duty, blocks, selectedDate);
        const employee = clean(duty.driverEmployeeNumber);
        return `<tr data-duty-id="${escapeHtml(duty.id)}">
          <td><div class="dm-driver"><span class="dm-avatar">${escapeHtml(clean(duty.driverName, "?").charAt(0).toUpperCase())}</span><div><strong>${escapeHtml(clean(duty.driverName, "Unassigned driver"))}</strong><small>Employee ${escapeHtml(employee)}</small></div></div></td>
          <td><strong>${escapeHtml(clean(duty.dutyNumber))}</strong><small>${escapeHtml(clean(duty.dutyType))}</small></td>
          <td><span class="dm-bus ${hasBus(duty) ? "" : "is-missing"}">${escapeHtml(clean(duty.assignedBus || duty.busNumber, "No bus"))}</span></td>
          <td><strong>${timeLabel(duty.startMin)}–${timeLabel(duty.endMin)}</strong><small>${escapeHtml(clean(duty.startLocation))} → ${escapeHtml(clean(duty.endLocation))}</small></td>
          <td>${block ? `<strong>${escapeHtml(blockTitle(block))}</strong><small>${timeLabel(blockTimes(block).start)}–${timeLabel(blockTimes(block).end)}</small>` : `<span class="dm-muted">No assigned blocks</span>`}</td>
          <td><span class="dm-status dm-status-${status.tone}"><i></i>${escapeHtml(status.label)}</span></td>
          <td><button type="button" class="dm-view" data-view-duty="${escapeHtml(duty.id)}" aria-label="View ${escapeHtml(clean(duty.driverName, "driver"))}">View</button></td>
        </tr>`;
      }).join("")}</tbody>
    </table>`;
}

function renderAlerts(root, alerts) {
  if (!alerts.length) {
    root.innerHTML = `<div class="dm-alert-empty"><span>✓</span><strong>No urgent items</strong><small>Everything looks clear for this date.</small></div>`;
    return;
  }
  root.innerHTML = alerts.slice(0, 10).map((alert) => `
    <button type="button" class="dm-alert dm-alert-${alert.tone}" data-alert-duty="${escapeHtml(alert.id)}">
      <span class="dm-alert-mark">!</span><span><strong>${escapeHtml(alert.title)}</strong><small>${escapeHtml(alert.action)}</small></span>
    </button>
  `).join("");
}

function openDrawer(root, backdrop, duty, blocks, selectedDate) {
  const status = dutyState(duty, selectedDate);
  const related = relatedBlocks(duty, blocks);
  root.innerHTML = `
    <div class="dm-drawer-head"><div><span>DRIVER DUTY</span><h2>${escapeHtml(clean(duty.driverName, "Unassigned driver"))}</h2></div><button id="dmDrawerClose" type="button" aria-label="Close">×</button></div>
    <div class="dm-drawer-status"><span class="dm-status dm-status-${status.tone}"><i></i>${escapeHtml(status.label)}</span><span>Acknowledgment: <strong>${escapeHtml(acknowledgment(duty.driverAcknowledgment))}</strong></span></div>
    <dl class="dm-detail-grid">
      <div><dt>Employee</dt><dd>${escapeHtml(clean(duty.driverEmployeeNumber))}</dd></div>
      <div><dt>Duty</dt><dd>${escapeHtml(clean(duty.dutyNumber))}</dd></div>
      <div><dt>Bus</dt><dd>${escapeHtml(clean(duty.assignedBus || duty.busNumber, "Not allocated"))}</dd></div>
      <div><dt>Duty type</dt><dd>${escapeHtml(clean(duty.dutyType))}</dd></div>
      <div><dt>Start</dt><dd>${timeLabel(duty.startMin)} · ${escapeHtml(clean(duty.startLocation))}</dd></div>
      <div><dt>Finish</dt><dd>${timeLabel(duty.endMin)} · ${escapeHtml(clean(duty.endLocation))}</dd></div>
    </dl>
    <div class="dm-drawer-section"><h3>Job timeline</h3>${related.length ? related.map((block) => {
      const times = blockTimes(block);
      return `<div class="dm-timeline-item"><span>${timeLabel(times.start)}</span><i></i><div><strong>${escapeHtml(blockTitle(block))}</strong><small>${escapeHtml(clean(block.fromName || block.from || block.startLocation))} → ${escapeHtml(clean(block.toName || block.to || block.endLocation))} · finishes ${timeLabel(times.end)}</small></div></div>`;
    }).join("") : `<div class="dm-empty-small">No assigned jobs for this duty.</div>`}</div>
    ${fatigueIsWarning(duty) ? `<div class="dm-drawer-warning"><strong>Fatigue review</strong><span>${escapeHtml(clean(duty.fatigueWarning || duty.fatigueStatus))}</span></div>` : ""}
  `;
  root.classList.add("is-open");
  root.setAttribute("aria-hidden", "false");
  backdrop.hidden = false;

  const close = () => {
    root.classList.remove("is-open");
    root.setAttribute("aria-hidden", "true");
    backdrop.hidden = true;
  };
  root.querySelector("#dmDrawerClose")?.addEventListener("click", close);
  backdrop.onclick = close;
}

export function renderDriverMonitorPage() {
  ensureStyles();
  const content = document.getElementById("contentArea");
  if (!content) return;

  const model = {
    selectedDate: state.driverMonitorDate || todayLocal(),
    duties: [],
    blocks: [],
    search: "",
    filter: "all",
    dutiesReady: false,
    blocksReady: false
  };

  renderShell(content, model.selectedDate);
  const summaryEl = content.querySelector("#dmSummary");
  const filtersEl = content.querySelector("#dmFilters");
  const tableEl = content.querySelector("#dmTableWrap");
  const alertsEl = content.querySelector("#dmAlerts");
  const countEl = content.querySelector("#dmResultCount");
  const searchEl = content.querySelector("#dmSearch");
  const dateEl = content.querySelector("#dmDate");
  const drawer = document.getElementById("dmDrawer");
  const backdrop = document.getElementById("dmDrawerBackdrop");

  function visibleDuties() {
    const needle = model.search.trim().toLowerCase();
    return model.duties.filter((duty) => {
      const haystack = [duty.driverName, duty.driverEmployeeNumber, duty.dutyNumber, duty.dutyType, duty.assignedBus, duty.busNumber].join(" ").toLowerCase();
      return (!needle || haystack.includes(needle)) && dutyMatchesFilter(duty, model.filter, model.selectedDate);
    });
  }

  function paint() {
    if (!model.dutiesReady || !model.blocksReady) return;
    const visible = visibleDuties();
    renderSummary(summaryEl, summary(model.duties, model.selectedDate));
    renderFilters(filtersEl, model.filter);
    renderTable(tableEl, visible, model.blocks, model.selectedDate);
    renderAlerts(alertsEl, buildAlerts(model.duties, model.selectedDate));
    countEl.textContent = `${visible.length} of ${model.duties.length} duties`;

    content.querySelectorAll("[data-view-duty], [data-alert-duty]").forEach((button) => {
      button.addEventListener("click", () => {
        const id = button.dataset.viewDuty || button.dataset.alertDuty;
        const duty = model.duties.find((item) => String(item.id) === String(id));
        if (duty) openDrawer(drawer, backdrop, duty, model.blocks, model.selectedDate);
      });
    });
    content.querySelectorAll("[data-filter], [data-summary-filter]").forEach((button) => {
      button.addEventListener("click", () => {
        model.filter = button.dataset.filter || button.dataset.summaryFilter || "all";
        paint();
      });
    });
  }

  function subscribe(date) {
    if (state.unsubscribeDriverMonitor) state.unsubscribeDriverMonitor();
    model.duties = [];
    model.blocks = [];
    model.dutiesReady = false;
    model.blocksReady = false;
    tableEl.innerHTML = `<div class="dm-loading">Loading driver duties…</div>`;

    const stopDuties = listenDutySpansByDate(date, (items) => {
      model.duties = items || [];
      model.dutiesReady = true;
      paint();
    }, (error) => {
      model.dutiesReady = true;
      tableEl.innerHTML = `<div class="dm-empty"><strong>Could not load duties</strong><span>${escapeHtml(error?.message || "Please try again.")}</span></div>`;
    });
    const stopBlocks = listenBlocksByDate(date, (items) => {
      model.blocks = items || [];
      model.blocksReady = true;
      paint();
    }, (error) => {
      console.error("Driver Monitor blocks:", error);
      model.blocks = [];
      model.blocksReady = true;
      paint();
    });

    let stopped = false;
    state.unsubscribeDriverMonitor = () => {
      if (stopped) return;
      stopped = true;
      stopDuties?.();
      stopBlocks?.();
    };
  }

  searchEl.addEventListener("input", () => {
    model.search = searchEl.value;
    paint();
  });
  dateEl.addEventListener("change", () => {
    if (!dateEl.value) return;
    model.selectedDate = dateEl.value;
    state.driverMonitorDate = dateEl.value;
    model.filter = "all";
    subscribe(model.selectedDate);
  });

  subscribe(model.selectedDate);
}
