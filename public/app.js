import { initializeApp } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-auth.js";

import {
  getFirestore,
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
  addDoc,
  updateDoc,
  doc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";

/** ✅ YOUR FIREBASE CONFIG **/
const firebaseConfig = {
  apiKey: "AIzaSyC-uze0wbaYlG1LBZKaC3MBXcMgsCfGEAc",
  authDomain: "punchbowl-driver-portal.firebaseapp.com",
  projectId: "punchbowl-driver-portal",
  storageBucket: "punchbowl-driver-portal.firebasestorage.app",
  messagingSenderId: "352420537161",
  appId: "1:352420537161:web:4ec51dcb476934a9373098"
};

/** ✅ SET YOUR ADMIN EMAIL(S) HERE **/
const ADMIN_EMAILS = [
  "info@punchbowlbus.com",
  "nalin.rajapaksha82@gmail.com"
];

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();
const db = getFirestore(app);

const authArea = document.getElementById("authArea");
const tabsArea = document.getElementById("tabsArea");
const contentArea = document.getElementById("contentArea");
const errorArea = document.getElementById("errorArea");

let currentUser = null;
let isAdmin = false;
let currentTab = "driver"; // driver | admin

function showError(msg) {
  if (!msg) {
    errorArea.style.display = "none";
    errorArea.innerHTML = "";
    return;
  }
  errorArea.style.display = "block";
  errorArea.innerHTML = `<b>Error:</b> ${escapeHtml(msg)}`;
}

function escapeHtml(s) {
  return String(s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalizeEmail(v) {
  return (v || "").trim().toLowerCase();
}

/** ✅ Who is doing the action (for audit fields) **/
function getActor() {
  const u = auth.currentUser;
  return {
    uid: u?.uid || null,
    email: normalizeEmail(u?.email || "")
  };
}

function fmtDate(iso) {
  if (!iso) return "-";

  // Expecting format YYYY-MM-DD
  const parts = iso.split("-");
  if (parts.length !== 3) return iso;

  const [year, month, day] = parts;

  return `${day.padStart(2, "0")}-${month.padStart(2, "0")}-${year}`;
}

/** Simple CSV parser (clean CSV) **/
function parseCSV(text) {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map(h => h.trim());
  return lines.slice(1).map(line => {
    const cols = line.split(",").map(c => c.trim());
    const row = {};
    headers.forEach((h, i) => (row[h] = cols[i] ?? ""));
    return row;
  });
}

function renderAuth() {
  if (!currentUser) {
    authArea.innerHTML = `<button id="loginBtn">Sign in with Google</button>`;
    document.getElementById("loginBtn").onclick = async () => {
      showError("");
      try { await signInWithPopup(auth, provider); }
      catch (e) { showError(e?.message || "Login failed"); }
    };
  } else {
    authArea.innerHTML = `
      <div class="muted">
        Signed in as <b>${escapeHtml(currentUser.email)}</b> ${isAdmin ? '<span class="pill">Admin</span>' : ''}
      </div>
      <button id="logoutBtn">Sign out</button>
    `;
    document.getElementById("logoutBtn").onclick = async () => {
      showError("");
      try { await signOut(auth); }
      catch (e) { showError(e?.message || "Logout failed"); }
    };
  }
}

function renderTabs() {
  if (!currentUser || !isAdmin) {
    tabsArea.style.display = "none";
    return;
  }
  tabsArea.style.display = "block";
  tabsArea.innerHTML = `
    <div class="row">
      <div>
        <button id="driverTab" ${currentTab === "driver" ? "style='font-weight:900'" : ""}>Driver View</button>
        <button id="adminTab" ${currentTab === "admin" ? "style='font-weight:900'" : ""}>Admin Panel</button>
      </div>
      <div class="muted">Admin can add jobs & bulk import CSV</div>
    </div>
  `;
  document.getElementById("driverTab").onclick = () => { currentTab = "driver"; loadJobs(); };
  document.getElementById("adminTab").onclick = () => { currentTab = "admin"; renderAdminPanel(); };
}

let unsubscribeJobs = null;

function loadJobs() {
  showError("");
  contentArea.style.display = "block";

  if (unsubscribeJobs) unsubscribeJobs();
  unsubscribeJobs = null;

  if (!currentUser) {
    contentArea.innerHTML = `Please sign in to view jobs.`;
    return;
  }

  // Admin: all jobs. Driver: only their jobs
  // NOTE: We are NOT filtering deleted yet (safe for existing old docs).
  const q = isAdmin
    ? query(collection(db, "jobs"), orderBy("date", "asc"))
    : query(
        collection(db, "jobs"),
        where("driverEmail", "==", normalizeEmail(currentUser.email)),
        orderBy("date", "asc")
      );

  contentArea.innerHTML = `<div class="muted">Loading jobs…</div>`;

  unsubscribeJobs = onSnapshot(q, (snap) => {
    const jobs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderJobs(jobs);
  }, (e) => showError(e?.message || "Failed to load jobs"));
}

async function setConfirmation(jobDocId, value) {
  showError("");
  try {
    const a = getActor();
    await updateDoc(doc(db, "jobs", jobDocId), {
      confirmation: value,
      confirmationAt: serverTimestamp(),

      // ✅ audit
      updatedAt: serverTimestamp(),
      updatedByUid: a.uid,
      updatedByEmail: a.email
    });
  } catch (e) {
    showError(e?.message || "Update failed");
  }
}

/** ✅ Soft delete (not used in UI yet, but ready) **/
async function softDeleteJob(jobDocId) {
  showError("");
  try {
    const a = getActor();
    await updateDoc(doc(db, "jobs", jobDocId), {
      deleted: true,
      deletedAt: serverTimestamp(),
      deletedByUid: a.uid,
      deletedByEmail: a.email,

      // audit
      updatedAt: serverTimestamp(),
      updatedByUid: a.uid,
      updatedByEmail: a.email
    });
  } catch (e) {
    showError(e?.message || "Delete failed");
  }
}
function openEditModal(job) {
  if (!job) return;

  // remove old modal if already open
  const old = document.getElementById("editModal");
  if (old) old.remove();

  const modalHtml = `
    <div id="editModal" style="
      position:fixed; inset:0;
      background:rgba(0,0,0,0.5);
      display:flex; align-items:center; justify-content:center;
      z-index:9999;
    ">
      <div style="background:#fff;padding:20px;border-radius:12px;max-width:520px;width:calc(100% - 24px)">
        <div class="row" style="margin-bottom:10px">
          <h3 style="margin:0">Edit Job</h3>
          <div class="muted">${escapeHtml(job.jobId || job.id)}</div>
        </div>

        <div class="muted">Date (YYYY-MM-DD)</div>
        <input id="editDate" value="${escapeHtml(job.date || "")}" />

        <div class="muted" style="margin-top:8px">Driver Email</div>
        <input id="editDriverEmail" value="${escapeHtml(job.driverEmail || "")}" />

        <div class="muted" style="margin-top:8px">Driver Name</div>
        <input id="editDriverName" value="${escapeHtml(job.driverName || "")}" />

        <div class="muted" style="margin-top:8px">Depot Start Time</div>
        <input id="editDepotStartTime" value="${escapeHtml(job.depotStartTime || "")}" />

        <div class="muted" style="margin-top:8px">Job Description</div>
        <input id="editJobDescription" value="${escapeHtml(job.jobDescription || "")}" />

        <div class="muted" style="margin-top:8px">PDF Link</div>
        <input id="editPdfLink" value="${escapeHtml(job.pdfLink || "")}" />

        <div style="margin-top:14px;display:flex;gap:10px;justify-content:flex-end">
          <button id="cancelEditBtn">Cancel</button>
          <button id="saveEditBtn">Save</button>
        </div>
      </div>
    </div>
  `;

  document.body.insertAdjacentHTML("beforeend", modalHtml);

  document.getElementById("cancelEditBtn").onclick = () => {
    document.getElementById("editModal").remove();
  };

  document.getElementById("saveEditBtn").onclick = async () => {
    showError("");
    try {
      const a = getActor();

      const updates = {
        date: document.getElementById("editDate").value.trim(),
        driverEmail: normalizeEmail(document.getElementById("editDriverEmail").value),
        driverName: document.getElementById("editDriverName").value.trim(),
        depotStartTime: document.getElementById("editDepotStartTime").value.trim(),
        jobDescription: document.getElementById("editJobDescription").value.trim(),
        pdfLink: document.getElementById("editPdfLink").value.trim(),

        // audit
        updatedAt: serverTimestamp(),
        updatedByUid: a.uid,
        updatedByEmail: a.email
      };

      // basic validation
      if (!updates.date) return showError("Date is required (YYYY-MM-DD).");
      if (!updates.driverEmail) return showError("Driver Email is required.");
      if (!updates.jobDescription) return showError("Job Description is required.");

      await updateDoc(doc(db, "jobs", job.id), updates);
      document.getElementById("editModal").remove();
    } catch (e) {
      showError(e?.message || "Failed to save changes");
    }
  };
}
function renderJobs(jobs) {
  if (!jobs.length) {
    contentArea.innerHTML = `<div>No jobs found.</div>`;
    return;
  }

  const rows = jobs.map(j => `
    <div class="card" style="margin-top:10px">
      <div class="row">
        <div style="min-width:260px">
          <div class="muted">${escapeHtml(j.jobId || j.id)}</div>
          <div style="font-size:18px;font-weight:900">${escapeHtml(fmtDate(j.date))}</div>
          <div style="margin-top:8px">${escapeHtml(j.jobDescription || "-")}</div>
          <div style="margin-top:8px;font-size:13px"><b>Depot Start:</b> ${escapeHtml(j.depotStartTime || "-")}</div>

          ${isAdmin ? `
            <div class="muted" style="margin-top:8px">
              <b>Driver:</b> ${escapeHtml(j.driverEmail || "-")}
              ${j.driverName ? `(${escapeHtml(j.driverName)})` : ""}
            </div>
          ` : ""}

          ${j.pdfLink ? `
            <div style="margin-top:10px">
              <a href="${escapeHtml(j.pdfLink)}" target="_blank" rel="noreferrer">Open PDF / Run Sheet</a>
            </div>
          ` : ""}
        </div>

            ${isAdmin ? `
          <div style="min-width:260px;font-size:13px;color:#444">
            <div><b>Confirmation:</b> ${escapeHtml(j.confirmation || "PENDING")}</div>
            <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">
              <button data-edit="${j.id}">Edit</button>
              <button data-del="${j.id}">Delete</button>
            </div>
          </div>
        ` : `
          <div style="min-width:230px">
            <div style="font-size:13px;margin-bottom:8px"><b>Status:</b> ${escapeHtml(j.confirmation || "PENDING")}</div>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              <button data-c="${j.id}" data-v="CONFIRMED">Confirm</button>
              <button data-c="${j.id}" data-v="CANT_DO">Can’t do</button>
            </div>
            <div class="muted" style="margin-top:10px">Your confirmation updates automatically.</div>
          </div>
        `}
      </div>
    </div>
  `).join("");

  contentArea.innerHTML = `<h3 style="margin:0 0 10px">${isAdmin ? "All Jobs (Admin view)" : "Your Jobs"}</h3>${rows}`;

  // Driver buttons
  if (!isAdmin) {
    [...contentArea.querySelectorAll("button[data-c]")].forEach(btn => {
      btn.onclick = () => setConfirmation(btn.getAttribute("data-c"), btn.getAttribute("data-v"));
    });
  }

  // Admin buttons
  if (isAdmin) {
    [...contentArea.querySelectorAll("button[data-edit]")].forEach(btn => {
      btn.onclick = () => {
        const job = jobs.find(x => x.id === btn.getAttribute("data-edit"));
        openEditModal(job);
      };
    });

    [...contentArea.querySelectorAll("button[data-del]")].forEach(btn => {
      btn.onclick = () => {
        if (confirm("Are you sure you want to delete this job?")) {
          softDeleteJob(btn.getAttribute("data-del"));
        }
      };
    });
  }
}

// Hook buttons

// Driver buttons
if (!isAdmin) {
  [...contentArea.querySelectorAll("button[data-c]")].forEach(btn => {
    btn.onclick = () =>
      setConfirmation(
        btn.getAttribute("data-c"),
        btn.getAttribute("data-v")
      );
  });
}

// Admin buttons
if (isAdmin) {
  [...contentArea.querySelectorAll("button[data-edit]")].forEach(btn => {
    btn.onclick = () => {
      const job = jobs.find(x => x.id === btn.getAttribute("data-edit"));
      openEditModal(job);
    };
  });

  [...contentArea.querySelectorAll("button[data-del]")].forEach(btn => {
    btn.onclick = () => {
      if (confirm("Are you sure you want to delete this job?")) {
        softDeleteJob(btn.getAttribute("data-del"));
      }
    };
  });
}

function renderAdminPanel() {
  if (!isAdmin) { loadJobs(); return; }

  contentArea.style.display = "block";
  contentArea.innerHTML = `
    <h3 style="margin-top:0">Admin Panel</h3>

    <div class="grid">
      <div>
        <div class="muted">Job ID (optional)</div>
        <input id="jobId" placeholder="JOB-1001" />
      </div>
      <div>
        <div class="muted">Date (YYYY-MM-DD) *</div>
        <input id="date" placeholder="2026-02-20" />
      </div>
      <div>
        <div class="muted">Driver Email *</div>
        <input id="driverEmail" placeholder="driver@gmail.com" />
      </div>
      <div>
        <div class="muted">Driver Name (optional)</div>
        <input id="driverName" placeholder="Tony" />
      </div>
      <div>
        <div class="muted">Depot Start Time</div>
        <input id="depotStartTime" placeholder="06:20" />
      </div>
      <div style="grid-column:1/-1">
        <div class="muted">Job Description *</div>
        <input id="jobDescription" placeholder="Route 1A Special Event - Pickup..." />
      </div>
      <div style="grid-column:1/-1">
        <div class="muted">PDF Link (Google Drive)</div>
        <input id="pdfLink" placeholder="https://drive.google.com/file/d/.../view" />
      </div>
    </div>

    <div style="margin-top:10px">
      <button id="addJobBtn">Add Job</button>
    </div>

    <hr style="margin:16px 0" />

    <h4 style="margin:0 0 8px">Bulk Import (CSV)</h4>
    <div class="muted">Headers: <b>jobId,date,driverEmail,driverName,depotStartTime,jobDescription,pdfLink</b></div>

    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:8px">
      <button id="pasteTemplateBtn">Paste CSV Template</button>
      <button id="importBtn">Import CSV</button>
    </div>

    <textarea id="csvBox" rows="10" style="margin-top:10px;font-family:monospace" placeholder="Paste CSV here…"></textarea>
    <pre id="importLog" class="card" style="display:none;background:#f6f6f6"></pre>
  `;

  const template = `jobId,date,driverEmail,driverName,depotStartTime,jobDescription,pdfLink
JOB-1001,2026-02-20,driver1@gmail.com,Tony,06:20,Route 1A Special Event - Pickup ...,https://drive.google.com/file/d/XXXX/view
JOB-1002,2026-02-20,driver2@gmail.com,Sam,07:10,School charter - Concord HS...,https://drive.google.com/file/d/YYYY/view`;

  document.getElementById("pasteTemplateBtn").onclick = () => {
    document.getElementById("csvBox").value = template;
  };

  document.getElementById("addJobBtn").onclick = async () => {
    showError("");
    const a = getActor();

    const payload = {
      jobId: document.getElementById("jobId").value.trim(),
      date: document.getElementById("date").value.trim(),
      driverEmail: normalizeEmail(document.getElementById("driverEmail").value),
      driverName: document.getElementById("driverName").value.trim(),
      depotStartTime: document.getElementById("depotStartTime").value.trim(),
      jobDescription: document.getElementById("jobDescription").value.trim(),
      pdfLink: document.getElementById("pdfLink").value.trim(),

      confirmation: "PENDING",
      confirmationAt: null,

      // ✅ audit
      createdAt: serverTimestamp(),
      createdByUid: a.uid,
      createdByEmail: a.email,

      updatedAt: serverTimestamp(),
      updatedByUid: a.uid,
      updatedByEmail: a.email,

      // ✅ soft delete fields (for later)
      deleted: false,
      deletedAt: null,
      deletedByUid: null,
      deletedByEmail: null
    };

    if (!payload.date) return showError("Date is required (YYYY-MM-DD).");
    if (!payload.driverEmail) return showError("Driver Email is required.");
    if (!payload.jobDescription) return showError("Job Description is required.");

    try {
      await addDoc(collection(db, "jobs"), payload);
      alert("Job added ✅");
    } catch (e) {
      showError(e?.message || "Failed to add job");
    }
  };

  document.getElementById("importBtn").onclick = async () => {
    showError("");
    const logEl = document.getElementById("importLog");
    logEl.style.display = "none";
    logEl.textContent = "";

    const rows = parseCSV(document.getElementById("csvBox").value || "");
    if (!rows.length) return showError("CSV is empty or invalid.");

    let ok = 0, fail = 0;
    const msgs = [];

    for (const r of rows) {
      const a = getActor();

      const payload = {
        jobId: (r.jobId || "").trim(),
        date: (r.date || "").trim(),
        driverEmail: normalizeEmail(r.driverEmail),
        driverName: (r.driverName || "").trim(),
        depotStartTime: (r.depotStartTime || "").trim(),
        jobDescription: (r.jobDescription || "").trim(),
        pdfLink: (r.pdfLink || "").trim(),

        confirmation: "PENDING",
        confirmationAt: null,

        // ✅ audit
        createdAt: serverTimestamp(),
        createdByUid: a.uid,
        createdByEmail: a.email,

        updatedAt: serverTimestamp(),
        updatedByUid: a.uid,
        updatedByEmail: a.email,

        // ✅ soft delete fields (for later)
        deleted: false,
        deletedAt: null,
        deletedByUid: null,
        deletedByEmail: null
      };

      if (!payload.date || !payload.driverEmail || !payload.jobDescription) {
        fail++;
        msgs.push(`❌ Missing required fields for jobId=${payload.jobId || "(blank)"}`);
        continue;
      }

      try {
        await addDoc(collection(db, "jobs"), payload);
        ok++;
      } catch (e) {
        fail++;
        msgs.push(`❌ Failed jobId=${payload.jobId || "(blank)"}: ${e?.message || "error"}`);
      }
    }

    logEl.style.display = "block";
    logEl.textContent = `Imported: ${ok} ✅   Failed: ${fail} ❌\n` + msgs.join("\n");
  };
}

onAuthStateChanged(auth, (u) => {
  currentUser = u;
  isAdmin = !!u && ADMIN_EMAILS.includes(normalizeEmail(u.email));

  renderAuth();
  renderTabs();

  contentArea.style.display = u ? "block" : "none";
  tabsArea.style.display = (u && isAdmin) ? "block" : "none";

  showError("");

  if (!u) return;

  // Default view
  if (isAdmin) {
    currentTab = "admin";
    renderTabs();
    renderAdminPanel();
  } else {
    loadJobs();
  }
});