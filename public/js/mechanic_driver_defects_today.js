import { collection, onSnapshot } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";
import { db } from "./firebase.js";

const esc = (v) => String(v ?? "").replace(/[&<>'\"]/g, (m) => ({
  "&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'\"':"&quot;"
}[m]));

function localDateString(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function reportDate(r) {
  if (r.defectDate) return String(r.defectDate).slice(0, 10);
  const d = r.createdAt?.toDate?.() || (r.reportedAtIso ? new Date(r.reportedAtIso) : null);
  return d && !Number.isNaN(d.getTime()) ? localDateString(d) : "";
}

function busLabel(r) {
  return [r.fleetNumber || r.busNumber, r.rego].map((v) => String(v || "").trim()).filter(Boolean).join(" · ") || "—";
}

function isDone(r) {
  return ["completed", "closed"].includes(String(r.status || "").toLowerCase());
}

function render(reports) {
  const wrap = document.getElementById("mechanicTodayDefects");
  const count = document.getElementById("mechanicTodayDefectCount");
  if (!wrap) return;

  const today = localDateString();
  const list = reports
    .filter((r) => r.deleted !== true && reportDate(r) === today)
    .sort((a,b) => (b.createdAt?.toMillis?.() || Date.parse(b.reportedAtIso || "") || 0) - (a.createdAt?.toMillis?.() || Date.parse(a.reportedAtIso || "") || 0));

  if (count) count.textContent = String(list.length);

  if (!list.length) {
    wrap.innerHTML = `<div class="empty">No driver defect reports submitted today.</div>`;
    return;
  }

  wrap.innerHTML = list.map((r) => {
    const unsafe = r.safeToDrive === "No";
    const done = isDone(r);
    return `<article class="mechanic-defect-card ${unsafe ? "unsafe" : ""}">
      <div class="mechanic-defect-head">
        <div>
          <strong>${esc(r.reportNumber || r.id)}</strong>
          <span>${esc(busLabel(r))}</span>
        </div>
        <div class="mechanic-defect-badges">
          <span class="badge ${unsafe ? "bad" : "good"}">${unsafe ? "Unsafe to drive" : "Safe to drive"}</span>
          <span class="badge ${done ? "good" : "info"}">${esc(r.status || "New")}</span>
        </div>
      </div>
      <div class="mechanic-defect-meta">
        <div><span>Category</span><strong>${esc(r.category || "Other")}</strong></div>
        <div><span>Driver</span><strong>${esc(r.reportedByName || "Unknown")}</strong></div>
      </div>
      <div class="mechanic-defect-description">${esc(r.description || "No description provided")}</div>
    </article>`;
  }).join("");
}

onSnapshot(collection(db, "defectReports"), (snap) => {
  render(snap.docs.map((d) => ({ id:d.id, ...d.data() })));
}, (error) => {
  console.error("Unable to load today's driver defects", error);
  const wrap = document.getElementById("mechanicTodayDefects");
  if (wrap) wrap.innerHTML = `<div class="empty">Unable to load today's driver defect reports.</div>`;
});
