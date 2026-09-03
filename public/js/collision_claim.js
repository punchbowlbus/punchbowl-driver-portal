import { doc, serverTimestamp, updateDoc } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";
import { auth, db } from "./firebase.js";
import { escapeHtml } from "./utils.js";

const CLAIM_STATUSES = ["Not started", "Driver draft", "Submitted for review", "Awaiting information", "Admin reviewed", "Ready to print"];

const yesNo = (value = "") => `<option value="">Select Yes or No</option><option ${value === "Yes" ? "selected" : ""}>Yes</option><option ${value === "No" ? "selected" : ""}>No</option>`;
const input = (field, label, value = "", type = "text", required = false) => `<label><span>${label}${required ? " <b>*</b>" : ""}</span><input data-claim-field="${field}" type="${type}" value="${escapeHtml(value || "")}" ${required ? "required" : ""}></label>`;
const area = (field, label, value = "", placeholder = "") => `<label class="incident-full"><span>${label}</span><textarea data-claim-field="${field}" placeholder="${escapeHtml(placeholder)}">${escapeHtml(value || "")}</textarea></label>`;

function section(number, title, help, body) {
  return `<section class="incident-section collision-section"><div class="incident-section-heading"><span>${number}</span><div><h3>${title}</h3><p>${help}</p></div></div><div class="incident-grid">${body}</div></section>`;
}

function claimForm(report) {
  const c = report.collisionClaim || {};
  return `
    <div class="collision-claim-head"><div><div class="incident-eyebrow">Motor vehicle claim</div><h2>Complete collision details</h2><p>Linked to ${escapeHtml(report.reportNumber || report.id)}. Save a draft and return at any time.</p></div><button type="button" data-close-claim class="btn"><i data-lucide="x"></i> Close</button></div>
    <div id="collisionClaimMessage" class="incident-message" hidden></div>
    <div class="collision-progress"><span>Immediate report complete</span><b></b><span>Motor claim ${escapeHtml(report.collisionClaimStatus || "Not started")}</span></div>
    ${section(1, "Vehicle and driver", "Confirm the bus and licence details.",
      input("claimReference", "Company claim reference", c.claimReference || report.reportNumber) +
      input("depot", "Depot", c.depot || report.depot) +
      input("vehicleRegistration", "Registration", c.vehicleRegistration || report.rego, "text", true) +
      input("vehicleFleetNumber", "Fleet number", c.vehicleFleetNumber || report.fleetNumber) +
      input("vehicleMakeModel", "Make and model", c.vehicleMakeModel) +
      input("vehicleYear", "Year", c.vehicleYear, "number") +
      input("vehicleVin", "VIN / chassis number", c.vehicleVin) +
      input("driverName", "Driver full name", c.driverName || report.reportedByName, "text", true) +
      input("driverAddress", "Driver address", c.driverAddress) +
      input("driverPhone", "Driver phone", c.driverPhone, "tel") +
      input("licenceNumber", "Licence number", c.licenceNumber, "text", true) +
      input("licenceExpiry", "Licence expiry", c.licenceExpiry, "date") +
      input("licenceClass", "Licence class", c.licenceClass) +
      input("dateOfBirth", "Date of birth", c.dateOfBirth, "date")
    )}
    ${section(2, "Collision circumstances", "Record the conditions and exact sequence of events.",
      input("accidentDate", "Date", c.accidentDate || report.incidentDate, "date", true) +
      input("accidentTime", "Time", c.accidentTime || report.incidentTime, "time", true) +
      input("accidentLocation", "Location", c.accidentLocation || report.location, "text", true) +
      input("postcode", "Postcode", c.postcode) +
      input("weather", "Weather", c.weather) +
      input("roadSurface", "Road surface", c.roadSurface) +
      input("roadGradient", "Road gradient", c.roadGradient) +
      input("speed", "Bus speed (km/h)", c.speed, "number") +
      `<label><span>Traffic controls operating?</span><select data-claim-field="trafficControls">${yesNo(c.trafficControls)}</select></label>` +
      `<label><span>CCTV available?</span><select data-claim-field="cctvAvailable">${yesNo(c.cctvAvailable)}</select></label>` +
      area("fullDescription", "Full description", c.fullDescription || report.description, "Include direction of travel, lanes, signals and sequence of impact") +
      area("sceneSketch", "Scene sketch notes", c.sceneSketch, "Describe the diagram: road names, vehicle positions, arrows and impact point")
    )}
    ${section(3, "Damage and towing", "Record where the bus is and the visible damage.",
      `<label><span>Is the company claiming own damage?</span><select data-claim-field="claimingOwnDamage">${yesNo(c.claimingOwnDamage)}</select></label>` +
      `<label><span>Was the bus towed?</span><select data-claim-field="vehicleTowed">${yesNo(c.vehicleTowed)}</select></label>` +
      input("towingCompany", "Towing company", c.towingCompany) +
      input("currentVehicleLocation", "Current bus location", c.currentVehicleLocation) +
      input("preferredRepairer", "Preferred repairer", c.preferredRepairer) +
      input("repairEstimate", "Repair estimate", c.repairEstimate) +
      area("insuredVehicleDamage", "Damage to company bus", c.insuredVehicleDamage, "List panels, glass, wheels and mechanical damage")
    )}
    ${section(4, "Other vehicle and driver", "Capture information from the other party where safe.",
      input("otherRegistration", "Other registration", c.otherRegistration) +
      input("otherMakeModel", "Other make and model", c.otherMakeModel) +
      input("otherOwnerName", "Owner name", c.otherOwnerName) +
      input("otherOwnerAddress", "Owner address", c.otherOwnerAddress) +
      input("otherDriverName", "Driver name", c.otherDriverName) +
      input("otherDriverPhone", "Driver phone", c.otherDriverPhone, "tel") +
      input("otherLicenceNumber", "Driver licence number", c.otherLicenceNumber) +
      input("otherInsurer", "Insurer", c.otherInsurer) +
      input("otherPolicyNumber", "Policy number", c.otherPolicyNumber) +
      area("otherVehicleDamage", "Damage to other vehicle/property", c.otherVehicleDamage)
    )}
    ${section(5, "Police and witnesses", "Add official and independent contact details.",
      `<label><span>Police attended?</span><select data-claim-field="policeAttended">${yesNo(c.policeAttended || report.policeContacted)}</select></label>` +
      input("policeEventNumber", "Police event number", c.policeEventNumber || report.policeReference) +
      input("policeStation", "Police station", c.policeStation) +
      input("policeOfficer", "Officer name / number", c.policeOfficer) +
      input("witness1Name", "Witness 1 name", c.witness1Name) + input("witness1Phone", "Witness 1 phone", c.witness1Phone, "tel") +
      input("witness2Name", "Witness 2 name", c.witness2Name) + input("witness2Phone", "Witness 2 phone", c.witness2Phone, "tel") +
      area("witnessStatements", "Witness statements", c.witnessStatements || report.witnessDetails)
    )}
    <section class="incident-declaration"><label><input id="collisionDeclaration" type="checkbox" ${c.declarationAccepted ? "checked" : ""}><span>I confirm these collision claim details are true and complete to the best of my knowledge. <b>*</b></span></label></section>
    <div class="collision-actions"><button type="button" id="saveCollisionDraft" class="btn"><i data-lucide="save"></i> Save draft</button><button type="button" id="submitCollisionClaim" class="btn danger"><i data-lucide="send"></i> Submit to Admin</button></div>`;
}

function collectClaim(host) {
  return Object.fromEntries([...host.querySelectorAll("[data-claim-field]")].map((el) => [el.dataset.claimField, el.value.trim()]));
}

export function openDriverCollisionClaim(report, {onSaved} = {}) {
  document.getElementById("collisionClaimOverlay")?.remove();
  const overlay = document.createElement("div");
  overlay.id = "collisionClaimOverlay";
  overlay.className = "collision-overlay";
  overlay.innerHTML = `<div class="collision-dialog">${claimForm(report)}</div>`;
  document.body.appendChild(overlay);
  window.lucide?.createIcons?.();
  const message = overlay.querySelector("#collisionClaimMessage");
  const show = (text, type = "error") => { message.textContent = text; message.className = `incident-message ${type}`; message.hidden = !text; };
  overlay.querySelector("[data-close-claim]").onclick = () => overlay.remove();
  overlay.addEventListener("click", (event) => { if (event.target === overlay) overlay.remove(); });

  async function save(submit) {
    show("");
    const claim = collectClaim(overlay);
    const declarationAccepted = overlay.querySelector("#collisionDeclaration").checked;
    if (submit && (!claim.vehicleRegistration || !claim.driverName || !claim.licenceNumber || !claim.accidentDate || !claim.accidentTime || !claim.accidentLocation)) return show("Complete all required fields before submitting to Admin.");
    if (submit && !declarationAccepted) return show("Accept the declaration before submitting to Admin.");
    const button = overlay.querySelector(submit ? "#submitCollisionClaim" : "#saveCollisionDraft");
    button.disabled = true;
    try {
      const status = submit ? "Submitted for review" : "Driver draft";
      await updateDoc(doc(db, "incidentReports", report.id), {
        collisionClaim: {...claim, declarationAccepted, declarationAcceptedAtIso: declarationAccepted ? new Date().toISOString() : ""},
        collisionClaimStatus: status, collisionClaimUpdatedAt: serverTimestamp(), updatedAt: serverTimestamp()
      });
      report.collisionClaim = {...claim, declarationAccepted}; report.collisionClaimStatus = status;
      show(submit ? "Motor claim sent to Admin for review." : "Draft saved. You can return later.", "success");
      onSaved?.(report);
      if (submit) setTimeout(() => overlay.remove(), 900);
    } catch (error) { console.error("Unable to save collision claim", error); show(error?.message || "Unable to save the collision claim."); }
    finally { button.disabled = false; }
  }
  overlay.querySelector("#saveCollisionDraft").onclick = () => save(false);
  overlay.querySelector("#submitCollisionClaim").onclick = () => save(true);
}

function printableClaim(report) {
  const c = report.collisionClaim || {};
  const rows = Object.entries(c).filter(([, value]) => value && typeof value !== "object").map(([key, value]) => `<tr><th>${escapeHtml(key.replace(/([A-Z])/g, " $1").replace(/^./, (x) => x.toUpperCase()))}</th><td>${escapeHtml(String(value))}</td></tr>`).join("");
  return `<!doctype html><html><head><title>${escapeHtml(report.reportNumber || "Collision claim")}</title><style>body{font:14px Arial;margin:28px;color:#14213d}h1{color:#c9232d}table{width:100%;border-collapse:collapse}th,td{border:1px solid #ccd3df;padding:8px;text-align:left;vertical-align:top}th{width:34%;background:#f3f5f8}@media print{button{display:none}}</style></head><body><button onclick="print()">Print / Save as PDF</button><h1>Motor Vehicle Collision Claim</h1><p><b>Incident:</b> ${escapeHtml(report.reportNumber || report.id)} · <b>Status:</b> ${escapeHtml(report.collisionClaimStatus || "Not started")}</p><table>${rows}</table><p>Generated from the Punchbowl Driver Portal. Admin must verify all details before insurer submission.</p></body></html>`;
}

export function collisionAdminSection(report) {
  if (report.category !== "Collision") return "";
  const c = report.collisionClaim || {};
  const completed = Object.values(c).filter(Boolean).length;
  return `<section class="incident-admin-section collision-admin-section"><div class="collision-admin-title"><div><h4>Motor vehicle claim</h4><p>${completed ? `${completed} fields recorded` : "Driver has not started the detailed claim."}</p></div><span>${escapeHtml(report.collisionClaimStatus || "Not started")}</span></div>${completed ? `<div class="incident-admin-facts"><div><span>Other vehicle</span><strong>${escapeHtml(c.otherRegistration || "Not recorded")}</strong><small>${escapeHtml(c.otherMakeModel || "")}</small></div><div><span>Insurer</span><strong>${escapeHtml(c.otherInsurer || "Not recorded")}</strong><small>${escapeHtml(c.otherPolicyNumber || "")}</small></div><div><span>Towing</span><strong>${escapeHtml(c.vehicleTowed || "Not recorded")}</strong><small>${escapeHtml(c.currentVehicleLocation || "")}</small></div><div><span>Police event</span><strong>${escapeHtml(c.policeEventNumber || "Not recorded")}</strong></div></div><div class="incident-admin-statement"><span>Collision account</span><p>${escapeHtml(c.fullDescription || report.description || "Not supplied")}</p></div>` : ""}<div class="collision-admin-actions"><button type="button" class="btn" data-collision-print ${completed ? "" : "disabled"}><i data-lucide="printer"></i> Print / Save PDF</button><button type="button" class="btn" data-collision-request><i data-lucide="message-square-warning"></i> Request information</button><button type="button" class="btn danger" data-collision-ready ${completed ? "" : "disabled"}><i data-lucide="file-check-2"></i> Mark ready to print</button></div><small class="collision-pdf-note">This creates the internal claim PDF. Mapping into the official BusInsure form will be added after local field verification.</small></section>`;
}

export function bindCollisionAdmin(report, {message, changed} = {}) {
  if (report.category !== "Collision") return;
  document.querySelector("[data-collision-print]")?.addEventListener("click", () => {
    const win = window.open("", "_blank");
    if (!win) return message?.("Allow pop-ups to open the printable claim.");
    win.opener = null;
    win.document.write(printableClaim(report)); win.document.close();
  });
  document.querySelector("[data-collision-request]")?.addEventListener("click", async () => {
    await updateDoc(doc(db, "incidentReports", report.id), {collisionClaimStatus: "Awaiting information", status: "Awaiting Information", updatedAt: serverTimestamp(), collisionClaimUpdatedBy: auth.currentUser?.email || ""});
    report.collisionClaimStatus = "Awaiting information"; report.status = "Awaiting Information"; message?.("Information request status saved.", "success"); changed?.();
  });
  document.querySelector("[data-collision-ready]")?.addEventListener("click", async () => {
    await updateDoc(doc(db, "incidentReports", report.id), {collisionClaimStatus: "Ready to print", updatedAt: serverTimestamp(), collisionClaimUpdatedBy: auth.currentUser?.email || ""});
    report.collisionClaimStatus = "Ready to print"; message?.("Claim marked ready to print.", "success"); changed?.();
  });
}

export { CLAIM_STATUSES };
