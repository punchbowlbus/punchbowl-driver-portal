import { collection, doc, getDocs, serverTimestamp, setDoc } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";
import { auth, db } from "./firebase.js";

const STATUSES = ["New", "Acknowledged", "Workshop Assigned", "Completed"];
let reports = [];
let activeTab = "overview";
let loaded = false;
const esc = (v) => String(v ?? "").replace(/[&<>'\"]/g, (m) => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'\"':"&quot;"}[m]));
const isDone = (r) => ["completed", "closed"].includes(String(r?.status || "").toLowerCase());

function fmtDate(v) {
  const d = v?.toDate?.() || (v ? new Date(v) : null);
  if (!d || Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-AU", { day:"2-digit", month:"short", year:"numeric", hour:"2-digit", minute:"2-digit" }).format(d);
}

function busLabel(r) {
  return [r.fleetNumber || r.busNumber, r.rego, r.depot].map((v) => String(v || "").trim()).filter(Boolean).join(" · ") || "—";
}

async function loadReports() {
  const snap = await getDocs(collection(db, "defectReports"));
  reports = snap.docs.map((d) => ({ id:d.id, ...d.data() }))
    .filter((r) => r.deleted !== true)
    .sort((a,b) => (b.createdAt?.toMillis?.() || Date.parse(b.reportedAtIso || "") || 0) - (a.createdAt?.toMillis?.() || Date.parse(a.reportedAtIso || "") || 0));
}

function summary() {
  const el = document.getElementById("workshopDefectSummary");
  if (!el) return;
  const open = reports.filter((r) => !isDone(r)).length;
  const unsafe = reports.filter((r) => !isDone(r) && r.safeToDrive === "No").length;
  const done = reports.filter(isDone).length;
  el.innerHTML = `<article><span>Total reports</span><strong>${reports.length}</strong></article><article><span>Open</span><strong>${open}</strong></article><article class="danger"><span>Unsafe vehicles</span><strong>${unsafe}</strong></article><article class="success"><span>Completed</span><strong>${done}</strong></article>`;
}

function categories() {
  const el = document.getElementById("workshopDefectCategory");
  if (!el) return;
  const old = el.value;
  const values = [...new Set(reports.map((r) => r.category).filter(Boolean))].sort();
  el.innerHTML = `<option value="">All categories</option>${values.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join("")}`;
  if (values.includes(old)) el.value = old;
}

function filtered() {
  const q = String(document.getElementById("workshopDefectSearch")?.value || "").trim().toLowerCase();
  const date = document.getElementById("workshopDefectDate")?.value || "";
  const category = document.getElementById("workshopDefectCategory")?.value || "";
  const safety = document.getElementById("workshopDefectSafety")?.value || "";
  return reports.filter((r) => {
    if (activeTab === "open" && isDone(r)) return false;
    if (activeTab === "completed" && !isDone(r)) return false;
    if (date && String(r.defectDate || "") !== date) return false;
    if (category && r.category !== category) return false;
    if (safety && r.safeToDrive !== safety) return false;
    if (q && ![r.reportNumber,r.fleetNumber,r.rego,r.reportedByName,r.reportedByEmployeeNumber,r.category,r.description,r.status].filter(Boolean).join(" ").toLowerCase().includes(q)) return false;
    return true;
  });
}

function renderList() {
  const el = document.getElementById("workshopDefectList");
  if (!el) return;
  const list = filtered();
  if (!list.length) { el.innerHTML = `<div class="defect-empty">No defect reports match these filters.</div>`; return; }
  el.innerHTML = list.map((r) => {
    const unsafe = r.safeToDrive === "No";
    const photos = Array.isArray(r.photos) ? r.photos : [];
    const status = r.status || "New";
    return `<article class="defect-card ${unsafe ? "unsafe" : ""}"><div class="defect-head"><div><div class="defect-number">${esc(r.reportNumber || r.id)}</div><div class="defect-sub">${esc(r.defectDate || "Date not recorded")} · ${esc(fmtDate(r.createdAt || r.reportedAtIso))}</div></div><div class="defect-badges"><span class="defect-badge ${unsafe ? "unsafe" : "safe"}">${unsafe ? "Unsafe to drive" : "Safe to drive"}</span><span class="defect-badge">${esc(status)}</span></div></div><div class="defect-grid"><div><span>Bus</span><strong>${esc(busLabel(r))}</strong></div><div><span>Category</span><strong>${esc(r.category || "Other")}</strong></div><div><span>Driver</span><strong>${esc(r.reportedByName || "Unknown")}</strong><small>${esc(r.reportedByEmployeeNumber || "")}</small></div></div><div class="defect-desc">${esc(r.description || "")}</div>${photos.length ? `<div class="defect-photos">${photos.map((p) => `<a href="${esc(p.url || "")}" target="_blank" rel="noopener"><img src="${esc(p.url || "")}" alt="Defect photo"></a>`).join("")}</div>` : ""}<div class="defect-actions"><label>Status<select data-defect-status="${esc(r.id)}">${STATUSES.map((s) => `<option value="${s}" ${s === status ? "selected" : ""}>${s}</option>`).join("")}</select></label><label>Operations / workshop notes<input data-defect-notes="${esc(r.id)}" value="${esc(r.adminNotes || "")}" placeholder="Add an internal note"></label><button class="button primary" type="button" data-defect-save="${esc(r.id)}">Save update</button></div><div class="defect-save-msg" data-defect-msg="${esc(r.id)}"></div></article>`;
  }).join("");

  el.querySelectorAll("[data-defect-save]").forEach((btn) => btn.addEventListener("click", async () => {
    const id = btn.dataset.defectSave;
    const status = el.querySelector(`[data-defect-status="${CSS.escape(id)}"]`)?.value || "New";
    const notes = el.querySelector(`[data-defect-notes="${CSS.escape(id)}"]`)?.value.trim() || "";
    const msg = el.querySelector(`[data-defect-msg="${CSS.escape(id)}"]`);
    btn.disabled = true; btn.textContent = "Saving...";
    try {
      await setDoc(doc(db, "defectReports", id), { status, adminNotes:notes, updatedAt:serverTimestamp(), updatedByUid:auth.currentUser?.uid || "", updatedByEmail:auth.currentUser?.email || "" }, { merge:true });
      const report = reports.find((x) => x.id === id); if (report) { report.status = status; report.adminNotes = notes; }
      summary(); if (msg) msg.textContent = "Update saved.";
    } catch (e) { if (msg) msg.textContent = e?.message || "Update failed."; }
    finally { btn.disabled = false; btn.textContent = "Save update"; }
  }));
}

async function refresh() {
  const el = document.getElementById("workshopDefectList");
  if (el) el.innerHTML = `<div class="defect-empty">Loading defect reports...</div>`;
  try { await loadReports(); categories(); summary(); renderList(); }
  catch { if (el) el.innerHTML = `<div class="defect-empty">Unable to load defect reports.</div>`; }
}

function wire() {
  document.querySelectorAll("[data-defect-tab]").forEach((btn) => btn.addEventListener("click", () => { activeTab = btn.dataset.defectTab || "overview"; document.querySelectorAll("[data-defect-tab]").forEach((b) => b.classList.toggle("active", b === btn)); renderList(); }));
  ["workshopDefectSearch","workshopDefectDate","workshopDefectCategory","workshopDefectSafety"].forEach((id) => { const el = document.getElementById(id); if (el) el.addEventListener(id === "workshopDefectSearch" ? "input" : "change", renderList); });
  document.getElementById("refreshWorkshopDefects")?.addEventListener("click", refresh);
  document.querySelector('[data-view="defects"]')?.addEventListener("click", () => { if (!loaded) { loaded = true; refresh(); } });
}

wire();
