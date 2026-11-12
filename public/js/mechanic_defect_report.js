import { collection, doc, getDocs, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-auth.js";
import { ref, uploadBytes, getDownloadURL, deleteObject } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-storage.js";
import { auth, db, storage } from "./firebase.js";

const categories = ["Accessibility Equipment", "Air Conditioning", "Body / Glass / Mirrors", "Brakes", "CCTV / Communications", "Doors", "Electrical", "Engine / Transmission", "Interior / Seats", "Lights / Indicators", "Other", "Steering", "Tyres / Wheels"];
const byId = (id) => document.getElementById(id);
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; };
let fleet = [];
let busy = false;
let dialogActor = null;

function currentMechanic() {
  const actor = window.currentWorkshopMechanic;
  const user = auth.currentUser;
  return actor && user && actor.uid === user.uid && actor.email.toLowerCase() === String(user.email || "").toLowerCase() ? actor : null;
}
function requireActor(actor) {
  const current = currentMechanic();
  if (!actor || !current || current.uid !== actor.uid || current.email !== actor.email) throw new Error("Your workshop session changed. Sign in and reopen Report Defect.");
}
function message(text, error = false) {
  const el = byId("mechanicReportMessage");
  el.className = error ? "status error" : "status";
  el.textContent = text;
}
function setBusy(value) {
  busy = value;
  byId("mechanicReportForm").querySelectorAll("button, input, select, textarea").forEach(el => { el.disabled = value; });
}
function syncAccess() {
  byId("reportDefectBtn").hidden = !currentMechanic();
  if (!currentMechanic() && byId("mechanicReportDialog")?.open && !busy) byId("mechanicReportDialog").close();
}
function ensureDialog() {
  if (byId("mechanicReportDialog")) return;
  const dialog = document.createElement("dialog");
  dialog.id = "mechanicReportDialog";
  dialog.className = "dialog";
  dialog.innerHTML = `<form id="mechanicReportForm">
    <div class="dialog-head"><div><h2>Report Defect</h2><p>Report a workshop fault and optionally create a job card for yourself.</p></div><button id="mechanicReportClose" type="button" class="icon-button" aria-label="Close report">×</button></div>
    <p id="mechanicReportActor" class="hint"></p>
    <div class="form-grid">
      <label>Defect date<input id="mechanicReportDate" type="date" required></label>
      <label>Bus<select id="mechanicReportBus" required><option value="">Select bus</option></select></label>
      <label>Category<select id="mechanicReportCategory" required><option value="">Select category</option>${categories.map(c=>`<option>${c}</option>`).join("")}</select></label>
      <label>Is the bus safe to drive?<select id="mechanicReportSafe" required><option value="">Select Yes or No</option><option>Yes</option><option value="No">No — stop using the vehicle</option></select></label>
      <p id="mechanicReportWarning" class="status error full" hidden>Unsafe to drive: stop using the vehicle and notify OCC. This report will be marked Critical.</p>
      <label class="full">Describe the defect<textarea id="mechanicReportDescription" maxlength="2000" required></textarea></label>
      <label class="full">Photos (optional)<input id="mechanicReportPhotos" type="file" accept="image/*" multiple><span class="hint">Up to 3 photos, maximum 8 MB each.</span></label>
    </div>
    <div id="mechanicReportMessage" class="status" role="status" aria-live="polite"></div>
    <div class="dialog-actions"><button id="mechanicReportCancel" type="button" class="button secondary">Cancel</button><button type="submit" class="button secondary" value="save">Save Defect</button><button type="submit" class="button primary" value="job">Save &amp; Create Job Card</button></div>
  </form>`;
  document.body.appendChild(dialog);
  byId("mechanicReportClose").onclick = byId("mechanicReportCancel").onclick = () => { if (!busy) dialog.close(); };
  dialog.addEventListener("cancel", event => { if (busy) event.preventDefault(); });
  byId("mechanicReportSafe").onchange = () => { byId("mechanicReportWarning").hidden = byId("mechanicReportSafe").value !== "No"; };
  byId("mechanicReportForm").addEventListener("submit", submitReport);
}
async function openReport() {
  const actor = currentMechanic();
  if (!actor || busy) return;
  ensureDialog();
  dialogActor = { ...actor };
  byId("mechanicReportForm").reset();
  byId("mechanicReportDate").value = byId("mechanicReportDate").max = today();
  byId("mechanicReportWarning").hidden = true;
  byId("mechanicReportActor").textContent = `Reported by: ${actor.name} · ${actor.email}`;
  byId("mechanicReportBus").replaceChildren(new Option("Loading fleet…", ""));
  byId("mechanicReportDialog").showModal();
  message("Loading fleet…");
  setBusy(true);
  try {
    const snap = await getDocs(collection(db, "buses"));
    requireActor(actor);
    fleet = snap.docs.map(d => ({ ...d.data(), id: d.id })).filter(b => String(b.status || "").trim().toLowerCase() !== "inactive");
    fleet.sort((a,b) => String(a.fleetNumber || a.id).localeCompare(String(b.fleetNumber || b.id), undefined, {numeric:true}));
    byId("mechanicReportBus").replaceChildren(new Option("Select bus", ""), ...fleet.map(b => new Option([b.fleetNumber || b.id, b.rego, b.depot].filter(Boolean).join(" · "), b.id)));
    message(fleet.length ? "" : "No active buses found. Contact your Fleet Manager.");
  } catch (error) { fleet = []; message(error.message || "Unable to load fleet. Close and try again.", true); }
  finally { setBusy(false); syncAccess(); }
}

async function submitReport(event) {
  event.preventDefault();
  if (busy) return;
  const actor = dialogActor;
  const createJob = event.submitter?.value === "job";
  const uploaded = [];
  let saved = false;
  try {
    requireActor(actor);
    const bus = fleet.find(b => b.id === byId("mechanicReportBus").value);
    const date = byId("mechanicReportDate").value;
    const category = byId("mechanicReportCategory").value;
    const safeToDrive = byId("mechanicReportSafe").value;
    const description = byId("mechanicReportDescription").value.trim();
    const files = Array.from(byId("mechanicReportPhotos").files || []);
    if (!bus || !/^\d{4}-\d{2}-\d{2}$/.test(date) || date > today() || !categories.includes(category) || !["Yes","No"].includes(safeToDrive) || !description || description.length > 2000) throw new Error("Complete the bus, date, category, safety assessment and defect description. Future dates are not allowed.");
    if (files.length > 3 || files.some(f => !f.type.startsWith("image/") || f.size > 8*1024*1024)) throw new Error("Choose up to 3 image files, maximum 8 MB each.");
    setBusy(true);
    message("Saving defect…");
    const reportRef = doc(collection(db,"defectReports"));
    const photos = [];
    for (const [index,file] of files.entries()) {
      requireActor(actor);
      const storagePath = `defect-reports/${reportRef.id}/${Date.now()}-${index+1}-${file.name.replace(/[^a-zA-Z0-9._-]/g,"_")}`;
      const fileRef = ref(storage, storagePath);
      await uploadBytes(fileRef, file, {contentType:file.type,customMetadata:{reportId:reportRef.id,reportedByUid:actor.uid}});
      uploaded.push(fileRef);
      photos.push({url:await getDownloadURL(fileRef),storagePath,fileName:file.name,contentType:file.type,size:file.size});
    }
    requireActor(actor);
    const report = {
      reportNumber:`DR-${date.replaceAll("-", "")}-${reportRef.id.slice(0,6).toUpperCase()}`,
      status:"New", priority:safeToDrive === "No" ? "Critical" : "Medium", defectDate:date, category, safeToDrive, description,
      busId:bus.id, fleetNumber:String(bus.fleetNumber || bus.id), rego:String(bus.rego || ""), depot:String(bus.depot || ""),
      photos, photoCount:photos.length, source:"Mechanic", reportedByRole:"Workshop",
      reportedByUid:actor.uid, reportedByEmail:actor.email, reportedByName:actor.name, reportedByEmployeeNumber:actor.employeeNumber || "",
      reportedAtIso:new Date().toISOString(), adminNotes:"", deleted:false, createdAt:serverTimestamp(), updatedAt:serverTimestamp()
    };
    await setDoc(reportRef, report);
    saved = true;
    byId("mechanicReportDialog").close();
    const status = byId("status");
    status.className = "status success";
    status.textContent = `Defect ${report.reportNumber} saved. ${createJob ? "Confirm the job card details to assign it to yourself." : "You can create its job card from Open Defect Reports."}`;
    if (createJob && currentMechanic()?.uid === actor.uid) window.dispatchEvent(new CustomEvent("mechanic-create-job-from-defect", {detail:{...report,id:reportRef.id}}));
  } catch (error) {
    if (!saved) await Promise.allSettled(uploaded.map(fileRef => deleteObject(fileRef)));
    message(error.message || "Unable to save defect. Please try again.", true);
  } finally { setBusy(false); syncAccess(); }
}

byId("reportDefectBtn").addEventListener("click", openReport);
window.addEventListener("mechanic-portal-access-granted", syncAccess);
onAuthStateChanged(auth, syncAccess);
syncAccess();
