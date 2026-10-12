// Shared, read-only presentation and payload helpers for Workshop sign-off.
// Historical records are displayed as recorded; viewing never adds a signature.
export const WORKSHOP_SIGNOFF_VERSION = 1;
export const WORKSHOP_SIGNOFF_DECLARATION = "I have reviewed this job card and the mechanic's completion record. I approve the recorded manager decision and agree to sign this approval electronically.";
const clean = value => String(value || "").trim();
const norm = value => clean(value).toLowerCase();
const esc = value => String(value ?? "").replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

export function resolveWorkshopApprover(user, employee, superAdmin = false) {
  if(!user?.uid || !user.email)throw new Error("Sign in with your own authorised account before approving a job card.");
  const email=norm(user.email);
  if(superAdmin)return {uid:user.uid,email,name:clean(user.displayName) || email,role:"Super Administrator",employeeNumber:"",employeeRole:"Super Administrator",department:"",employeeDisplayName:""};
  if(!employee || norm(employee.email)!==email || norm(employee.status)!=="active" || employee.deleted===true)throw new Error("An active employee record linked to the signed-in account is required.");
  const department=norm(employee.department),role=norm(employee.role),access=norm(employee.accessLevel);
  const manager=department==="workshop" && ["manager","fleet manager"].includes(role);
  if(!manager && !["admin","super admin"].includes(access))throw new Error("This account is not authorised to approve Workshop job cards.");
  const name=clean(employee.legalName) || (clean(employee.firstName) && clean(employee.lastName) ? clean(`${employee.firstName} ${employee.lastName}`) : clean(employee.displayName) || clean(employee.firstName));
  if(!name || !clean(employee.employeeNumber))throw new Error("The approver's full name and employee number must be recorded before signing.");
  return {uid:user.uid,email,name,role:clean(employee.jobTitle || employee.position) || (manager ? "Fleet Manager" : access==="super admin" ? "Super Administrator" : "Administrator"),employeeNumber:clean(employee.employeeNumber),employeeRole:clean(employee.role),department:clean(employee.department),employeeDisplayName:clean(employee.displayName)};
}

export function normaliseApprovalSnapshot(value) {
  if(value==null)return null;
  if(value instanceof Date)return value.toISOString();
  if(typeof value.toDate==="function")return value.toDate().toISOString();
  if(Array.isArray(value))return value.map(v=>v===undefined ? null : normaliseApprovalSnapshot(v));
  if(typeof value==="object")return Object.fromEntries(Object.keys(value).sort().filter(key=>value[key]!==undefined).map(key=>[key,normaliseApprovalSnapshot(value[key])]));
  return value;
}
export function workshopJobRevision(job) {
  return normaliseApprovalSnapshot({id:job.id,jobNumber:job.jobNumber || "",busId:job.busId || "",fleetNumber:job.fleetNumber || "",rego:job.rego || "",jobType:job.jobType || "",reportedFault:job.reportedFault || "",mechanicName:job.mechanicName || "",assignedMechanic:job.assignedMechanic || "",jobCard:job.jobCard || {},inspectionCompletedDate:job.inspectionCompletedDate || "",airConditioningServiceDate:job.airConditioningServiceDate || "",specialServiceCompletedDate:job.specialServiceCompletedDate || "",mechanicInspectionSignOff:job.mechanicInspectionSignOff || null,airConditioningMechanicSignOff:job.airConditioningMechanicSignOff || null,specialServiceMechanicSignOff:job.specialServiceMechanicSignOff || null,mechanicCompletedAt:job.mechanicCompletedAt || null});
}
export async function approvalHash(value) {
  const bytes=new TextEncoder().encode(JSON.stringify(normaliseApprovalSnapshot(value)));
  const hash=await globalThis.crypto.subtle.digest("SHA-256",bytes);
  return [...new Uint8Array(hash)].map(n=>n.toString(16).padStart(2,"0")).join("");
}
export async function createWorkshopElectronicApproval({job,approver,decision,consent,approvalId,timestamp}) {
  if(job.status!=="Waiting Approval")throw new Error("Only a job waiting for approval can receive a new electronic signature. Closed records cannot be retrospectively signed.");
  if(consent!==true)throw new Error("Confirm the electronic approval declaration before signing.");
  if(!approver?.uid || !approver.name || !approver.role || !approver.email || !approvalId)throw new Error("Verified approver identity is required.");
  if(decision.returnToService && norm(job.jobCard?.safeToReturn)==="no")throw new Error("The mechanic marked this vehicle NOT safe to return. Return it for correction or select No.");
  const snapshot=normaliseApprovalSnapshot({job:workshopJobRevision(job),approver,decision,declaration:WORKSHOP_SIGNOFF_DECLARATION,signatureVersion:WORKSHOP_SIGNOFF_VERSION,approvalId});
  return {approved:true,approvedByName:approver.name,approvedByEmail:approver.email,approvedByUid:approver.uid,approvedByEmployeeNumber:approver.employeeNumber,approvedByRole:approver.role,approvedEmployeeRole:approver.employeeRole,approvedDepartment:approver.department,...decision,approvedAt:timestamp,signatureVersion:WORKSHOP_SIGNOFF_VERSION,signatureMethod:"Authenticated electronic approval",electronicConsent:true,declaration:WORKSHOP_SIGNOFF_DECLARATION,approvalId,signedRecordHash:await approvalHash(snapshot),signedRecordSnapshot:snapshot};
}

export function workshopApprovalRecord(job) {
  const a=job.fleetManagerApproval || {};
  const signed=a.signatureVersion===WORKSHOP_SIGNOFF_VERSION && a.electronicConsent===true && Boolean(a.approvedByUid && /^[a-f0-9]{64}$/.test(a.signedRecordHash || "") && a.approvalId && a.declaration && a.signedRecordSnapshot?.job);
  const recorded=Boolean(a.approvedByName || a.approvedByEmail || job.closedByEmail || a.approvedAt || job.closedAt);
  const recordChanged=signed && a.signedRecordSnapshot?.job && JSON.stringify(workshopJobRevision(job))!==JSON.stringify(normaliseApprovalSnapshot(a.signedRecordSnapshot.job));
  return {recordChanged,kind:signed ? "signed" : job.status==="Closed" || recorded ? "legacy" : "pending",name:a.approvedByName || a.approvedByEmail || job.closedByEmail || "Not recorded",email:a.approvedByEmail || job.closedByEmail || "",role:a.approvedByRole || "Not recorded",employeeNumber:a.approvedByEmployeeNumber || "",signedAt:a.approvedAt || job.closedAt || null,approval:a};
}
export function workshopApprovalHtml(job) {
  const record=workshopApprovalRecord(job),a=record.approval;
  if(record.kind==="pending")return "";
  const date=record.signedAt?.toDate?.() || (record.signedAt ? new Date(record.signedAt) : null);
  const dateText=date && !Number.isNaN(date.getTime()) ? new Intl.DateTimeFormat("en-AU",{timeZone:"Australia/Sydney",day:"2-digit",month:"short",year:"numeric",hour:"numeric",minute:"2-digit",timeZoneName:"short"}).format(date) : "Not recorded";
  return `<section class="wm-electronic-signoff" data-approval-kind="${record.kind}" style="margin:16px 0;padding:14px;border:1px solid #cfd7e2;border-radius:7px;break-inside:avoid"><h3 style="margin:0 0 10px;font-size:15px">${record.kind==="signed" ? "Electronic manager approval" : "Legacy approval record"}</h3><div><strong>${record.kind==="signed" ? "Electronically approved by" : "Recorded approver"}:</strong> ${esc(record.name)}</div><div><strong>Role:</strong> ${esc(record.role)}${record.employeeNumber ? ` · Employee ${esc(record.employeeNumber)}` : ""}</div><div><strong>${record.kind==="signed" ? "Signed" : "Recorded approval / closure time"}:</strong> ${esc(dateText)}</div>${record.email ? `<div><strong>Account:</strong> ${esc(record.email)}</div>` : ""}${record.recordChanged ? `<p style="color:#a1262e"><strong>Record changed after signing.</strong> This approval refers to the saved signed snapshot, not the changed job-card contents.</p>` : ""}<div><strong>Return to service:</strong> ${a.returnToService===true ? "Approved" : a.returnToService===false ? "Not approved" : "Not recorded"}</div><div><strong>Vehicle decision:</strong> ${esc(a.vehicleStatus || "Not recorded")}</div><div><strong>Manager comments:</strong> ${esc(a.comments || "—")}</div>${record.kind==="signed" ? `<p style="margin:10px 0;font-size:12px">${esc(a.declaration)}</p><div style="font-size:11px;overflow-wrap:anywhere">Approval reference: ${esc(a.approvalId)}<br>Signed record SHA-256: ${esc(a.signedRecordHash)}</div>` : `<p style="margin:10px 0 0;font-size:12px">Closed before electronic sign-off was captured, or no electronic signature is recorded. Original approval details are preserved; no retrospective signature has been added.</p>`}</section>`;
}
