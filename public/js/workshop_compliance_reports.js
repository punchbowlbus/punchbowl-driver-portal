import { collection, doc, onSnapshot, orderBy, query, runTransaction, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";
import { auth, db } from "./firebase.js";
import { getRequirementTemplate } from "./workshop_service_requirements.js?v=20260914-descriptions";
import { isDefectCompleted, normalizeDefectStatus } from "./workshop_status.js";

const $ = (id) => document.getElementById(id);
const norm = (value) => String(value || "").trim().toLowerCase();
const esc = (value) => String(value ?? "").replace(/[&<>'\"]/g, (char) => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'\"':"&quot;"}[char]));
let jobs = [];
let buses = [];
let defects = [];
let selectedJob = null;
let jobUnsub = null;
let busUnsub = null;
let defectUnsub = null;

function localDate(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
}
function addDays(dateString, days) {
  const date = new Date(`${dateString}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "";
  date.setDate(date.getDate() + days);
  return localDate(date);
}
function fmtDate(value) {
  if (!value) return "—";
  const date = typeof value?.toDate === "function" ? value.toDate() : new Date(/^\d{4}-\d{2}-\d{2}$/.test(String(value)) ? `${value}T00:00:00` : value);
  return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat("en-AU", {day:"2-digit",month:"short",year:"numeric"}).format(date);
}
function fmtDateTime(value) {
  if (!value) return "—";
  const date = typeof value?.toDate === "function" ? value.toDate() : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat("en-AU", {day:"2-digit",month:"short",year:"numeric",hour:"numeric",minute:"2-digit"}).format(date);
}
function fleetNo(bus) { return bus?.fleetNumber || bus?.busNumber || bus?.number || bus?.id || ""; }
function is90Day(job) {
  const key = norm(job.serviceTemplateKey);
  const category = norm(job.serviceType || job.inspectionType || job.jobCategory);
  return /-(90day|rms)$/.test(key) || norm(job.jobType) === "90 day safety check" || (norm(job.jobType).includes("safety inspection") && (category.includes("90") || category.includes("rms")));
}
function busFor(job) { return buses.find((bus) => bus.id === job.busId || norm(fleetNo(bus)) === norm(job.fleetNumber)); }
function vehicleType(job) {
  const bus = busFor(job);
  return /\b(ev|electric)\b/i.test(`${job.serviceProgram || ""} ${job.serviceTemplateKey || ""} ${bus?.fuelType || bus?.fuel || bus?.powertrain || ""}`) ? "Electric" : "Diesel";
}
function inspectionDate(job) { return job.inspectionCompletedDate || job.jobCard?.inspectionCompletedDate || ""; }
function attentionCount(job) { return Object.values(job.jobCard?.checklist || {}).filter((value) => value === "Attention").length; }
function dueState(bus) {
  const due = String(bus.next90DaySafetyCheckDate || "");
  if (!due) return {kind:"missing",label:"NOT SET",detail:"No next inspection date"};
  const days = Math.round((new Date(`${due}T00:00:00`) - new Date(`${localDate()}T00:00:00`)) / 86400000);
  if (days < 0) return {kind:"bad",label:"OVERDUE",detail:`${Math.abs(days)} day${Math.abs(days)===1?"":"s"} overdue`};
  if (days <= 14) return {kind:"warn",label:days===0?"DUE TODAY":"DUE SOON",detail:`Due in ${days} day${days===1?"":"s"}`};
  return {kind:"good",label:"ON TRACK",detail:`Due in ${days} days`};
}
function activeStatus(job) { return ["Closed","Waiting Approval"].includes(job.status) ? job.status : "Active"; }

function filteredJobs() {
  const term = norm($("complianceReportSearch")?.value);
  const status = $("complianceReportStatus")?.value || "";
  const type = $("complianceReportVehicleType")?.value || "";
  const from = $("complianceReportFrom")?.value || "";
  const to = $("complianceReportTo")?.value || "";
  return jobs.filter(is90Day).filter((job) => {
    const haystack = norm([job.jobNumber,job.fleetNumber,job.rego,job.assignedMechanic,job.mechanicName].join(" "));
    const date = inspectionDate(job);
    return (!term || haystack.includes(term)) && (!status || activeStatus(job) === status) && (!type || vehicleType(job) === type) && (!from || (date && date >= from)) && (!to || (date && date <= to));
  });
}

function renderMetrics() {
  const all = jobs.filter(is90Day);
  const overdue = buses.filter((bus) => dueState(bus).kind === "bad").length;
  const dueSoon = buses.filter((bus) => dueState(bus).kind === "warn").length;
  const attention = all.filter((job) => attentionCount(job) > 0).length;
  $("complianceReportMetrics").innerHTML = `
    <article class="metric"><span>Inspection Records</span><strong>${all.length}</strong></article>
    <article class="metric warning"><span>Waiting Approval</span><strong>${all.filter((job)=>job.status==="Waiting Approval").length}</strong></article>
    <article class="metric danger"><span>Fleet Overdue</span><strong>${overdue}</strong></article>
    <article class="metric warning"><span>Due Within 14 Days</span><strong>${dueSoon}</strong></article>
    <article class="metric danger"><span>Attention Recorded</span><strong>${attention}</strong></article>`;
}

function renderReportList() {
  const list = filteredJobs().sort((a,b) => String(inspectionDate(b) || "9999").localeCompare(String(inspectionDate(a) || "9999")));
  $("complianceReportList").innerHTML = list.length ? `<div class="table-wrap"><table class="compliance-table"><thead><tr><th>Inspection</th><th>Bus</th><th>Vehicle</th><th>Inspection Date</th><th>Mechanic</th><th>Fleet Manager Sign-off</th><th>Status</th><th>Action</th></tr></thead><tbody>${list.map((job)=>{
    const approval=job.fleetManagerApproval||{};
    return `<tr><td><strong>${esc(job.jobNumber||job.id)}</strong><div class="list-meta">${esc(job.assignedChecklist?.templateTitle || job.inspectionType || "90 Day Safety Check")}</div></td><td><strong>${esc(job.fleetNumber||"—")}</strong><div class="list-meta">${esc(job.rego||"")}</div></td><td>${esc(vehicleType(job))}</td><td>${inspectionDate(job)?esc(fmtDate(inspectionDate(job))):'<span class="badge warn">CONFIRM DATE</span><div class="list-meta">Missing inspection date</div>'}</td><td>${esc(job.mechanicInspectionSignOff?.name || job.mechanicName || job.assignedMechanic || "—")}</td><td>${esc(approval.approvedByName || approval.approvedByEmail || "Not signed off")}<div class="list-meta">${esc(fmtDateTime(approval.approvedAt || job.closedAt))}</div></td><td><span class="badge ${job.status==="Closed"?"good":job.status==="Waiting Approval"?"warn":"info"}">${esc(job.status||"Active")}</span>${attentionCount(job)?`<div class="list-meta report-attention">${attentionCount(job)} attention item(s)</div>`:""}</td><td><button class="button secondary" type="button" data-compliance-view="${esc(job.id)}">View Report</button></td></tr>`;
  }).join("")}</tbody></table></div>` : `<div class="empty">No 90-day inspection records match these filters.</div>`;
  $("complianceReportList").querySelectorAll("[data-compliance-view]").forEach((button)=>button.addEventListener("click",()=>openReport(button.dataset.complianceView)));
}

function renderFleetStatus() {
  const sorted=[...buses].sort((a,b)=>String(fleetNo(a)).localeCompare(String(fleetNo(b)),undefined,{numeric:true}));
  $("complianceFleetStatus").innerHTML = sorted.length ? `<div class="table-wrap"><table><thead><tr><th>Fleet</th><th>Rego</th><th>Vehicle Type</th><th>Last Inspection</th><th>Next Due</th><th>Compliance</th></tr></thead><tbody>${sorted.map((bus)=>{const state=dueState(bus);return `<tr><td><strong>${esc(fleetNo(bus))}</strong></td><td>${esc(bus.rego||"—")}</td><td>${/\b(ev|electric)\b/i.test(`${bus.fuelType||""} ${bus.fuel||""} ${bus.powertrain||""}`)?"Electric":"Diesel"}</td><td>${esc(fmtDate(bus.last90DaySafetyCheckDate))}</td><td>${esc(fmtDate(bus.next90DaySafetyCheckDate))}</td><td><span class="badge ${state.kind}">${esc(state.label)}</span><div class="list-meta">${esc(state.detail)}</div></td></tr>`}).join("")}</tbody></table></div>` : `<div class="empty">No fleet records available.</div>`;
}

function checklistRows(job) {
  const card=job.jobCard||{};
  const saved=card.checklist||{};
  const evidence=card.checklistEvidence||{};
  const assigned=Array.isArray(job.assignedChecklist?.items)?job.assignedChecklist.items:[];
  const template=getRequirementTemplate(job.serviceTemplateKey);
  const keys=Object.keys(saved);
  if (!keys.length && !assigned.length) return `<div class="empty">No checklist evidence recorded.</div>`;
  const items=keys.length?keys.map((key,index)=>({...(template?.items?.[index]||{}),key,value:saved[key],...(evidence[key]||{})})):assigned.map((item,index)=>({...(template?.items?.[index]||{}),key:item.id||String(index),value:"",...item,description:item.description||template?.items?.[index]?.description||""}));
  return `<table class="compliance-checklist"><thead><tr><th>Item</th><th>Action</th><th>Description of Work</th><th>Result</th><th>Mechanic Details</th></tr></thead><tbody>${items.map((item)=>`<tr><td><strong>${esc(item.item||item.key)}</strong></td><td>${esc(item.action||"—")}</td><td>${esc(item.description||"—")}</td><td><span class="badge ${item.value==="Pass"?"good":item.value==="Attention"?"bad":""}">${esc(item.value||"Not recorded")}</span></td><td>${esc(item.note||card.checklistNotes?.[item.key]||"—")}</td></tr>`).join("")}</tbody></table>`;
}

function reportHtml(job) {
  const approval=job.fleetManagerApproval||{};
  return `<div class="compliance-report-head"><div><div class="eyebrow">90-Day Inspection Compliance Record</div><h2>${esc(job.jobNumber||job.id)}</h2></div><span class="badge ${job.status==="Closed"?"good":"warn"}">${esc(job.status||"Active")}</span></div>
  <div class="wm-review-grid compliance-detail-grid">
    <div class="wm-review-box"><div class="wm-review-label">Bus / Registration</div><strong>${esc(job.fleetNumber||"—")} · ${esc(job.rego||"—")}</strong></div>
    <div class="wm-review-box"><div class="wm-review-label">Vehicle / Form</div>${esc(vehicleType(job))} · ${esc(job.assignedChecklist?.templateTitle||job.inspectionType||"90 Day Safety Check")}</div>
    <div class="wm-review-box"><div class="wm-review-label">Inspection completed</div><strong>${esc(fmtDate(inspectionDate(job)))}</strong></div>
    <div class="wm-review-box"><div class="wm-review-label">Mechanic sign-off</div>${esc(job.mechanicInspectionSignOff?.name||job.mechanicName||job.assignedMechanic||"—")} ${job.mechanicInspectionSignOff?.employeeNumber?`(${esc(job.mechanicInspectionSignOff.employeeNumber)})`:""}<div class="list-meta">${esc(fmtDateTime(job.mechanicInspectionSignOff?.signedAt||job.mechanicCompletedAt))}</div></div>
    <div class="wm-review-box"><div class="wm-review-label">Fleet Manager sign-off</div>${esc(approval.approvedByName||approval.approvedByEmail||"Not signed off")}<div class="list-meta">${esc(fmtDateTime(approval.approvedAt||job.closedAt))}</div></div>
    <div class="wm-review-box"><div class="wm-review-label">Next due</div>${esc(fmtDate(busFor(job)?.next90DaySafetyCheckDate))}</div>
    <div class="wm-review-box wm-full"><div class="wm-review-label">Fleet Manager comments</div>${esc(approval.comments||"—")}</div>
  </div>${!inspectionDate(job) ? `<section class="missing-inspection-date"><h3>Inspection Date Confirmation Required</h3><p>This legacy record has no confirmed physical inspection date. Enter the actual date from the workshop record.</p><div class="report-date-correction"><label>Actual inspection date<input id="confirmInspectionDate" type="date" max="${localDate()}" /></label><label>Confirmation note<input id="confirmInspectionDateReason" placeholder="Source of the confirmed date" /></label><button id="saveConfirmedInspectionDate" class="button primary" type="button">Save Confirmed Date</button></div><div id="inspectionDateCorrectionMessage" class="status"></div></section>` : ""}<h3>Mandatory Inspection Checklist</h3><div class="table-wrap">${checklistRows(job)}</div>`;
}

function ensureDialog() {
  if ($("complianceReportDialog")) return;
  const dialog=document.createElement("dialog");dialog.id="complianceReportDialog";dialog.className="dialog compliance-report-dialog";
  dialog.innerHTML=`<div class="dialog-head"><div><h2>Inspection Compliance Report</h2><p>Complete job record and mandatory checklist evidence.</p></div><button id="closeComplianceReport" class="icon-button" type="button">×</button></div><div id="complianceReportBody"></div><div class="dialog-actions"><button id="printComplianceReport" class="button primary" type="button">Print / Save PDF</button><button id="doneComplianceReport" class="button secondary" type="button">Close</button></div>`;
  document.body.appendChild(dialog);
  $("closeComplianceReport").onclick=()=>dialog.close();$("doneComplianceReport").onclick=()=>dialog.close();$("printComplianceReport").onclick=printReport;
}
function openReport(id) { ensureDialog();selectedJob=jobs.find((job)=>job.id===id);if(!selectedJob)return;$("complianceReportBody").innerHTML=reportHtml(selectedJob);$("saveConfirmedInspectionDate")?.addEventListener("click",saveConfirmedInspectionDate);$("complianceReportDialog").showModal(); }
async function saveConfirmedInspectionDate() {
  if(!selectedJob || inspectionDate(selectedJob)) return;
  const date=$("confirmInspectionDate")?.value||"";
  const reason=$("confirmInspectionDateReason")?.value.trim()||"";
  const message=$("inspectionDateCorrectionMessage");
  if(!date || !reason){message.className="status error";message.textContent="Enter the actual inspection date and the source used to confirm it.";return;}
  const button=$("saveConfirmedInspectionDate");button.disabled=true;button.textContent="Saving...";
  try{
    await runTransaction(db,async(tx)=>{
      const jobRef=doc(db,"workshopJobs",selectedJob.id);const jobSnap=await tx.get(jobRef);
      if(!jobSnap.exists())throw new Error("This inspection job no longer exists.");
      const current=jobSnap.data();
      if(current.inspectionCompletedDate||current.jobCard?.inspectionCompletedDate)throw new Error("An inspection date has already been recorded. Refresh the report.");
      const audit=Array.isArray(current.inspectionDateAudit)?current.inspectionDateAudit:[];
      const bus=busFor(selectedJob);
      const busRef=bus?.id?doc(db,"buses",bus.id):null;
      const busSnap=busRef?await tx.get(busRef):null;
      tx.update(jobRef,{inspectionCompletedDate:date,inspectionDateAudit:[...audit,{previousDate:"",newDate:date,changedByName:auth.currentUser?.displayName||auth.currentUser?.email||"Fleet Manager",changedByEmail:norm(auth.currentUser?.email),changedAt:new Date().toISOString(),reason}],updatedAt:serverTimestamp()});
      if(busSnap?.exists()){const data=busSnap.data();if(!data.last90DaySafetyCheckDate||String(data.last90DaySafetyCheckDate)<=date)tx.update(busRef,{last90DaySafetyCheckDate:date,next90DaySafetyCheckDate:addDays(date,90),last90DaySafetyCheckJobId:selectedJob.id,last90DaySafetyCheckJobNumber:selectedJob.jobNumber||"",updatedAt:serverTimestamp()});}
    });
    selectedJob={...selectedJob,inspectionCompletedDate:date};
    $("complianceReportBody").innerHTML=reportHtml(selectedJob);
    const status=$("status");if(status){status.className="status success";status.textContent=`Inspection date confirmed for ${selectedJob.jobNumber||selectedJob.id}.`;}
  }catch(error){message.className="status error";message.textContent=error?.message||"Unable to save the inspection date.";button.disabled=false;button.textContent="Save Confirmed Date";}
}
function printReport() {
  if(!selectedJob)return;
  const win=window.open("","_blank");
  if(!win){const status=$("status");if(status){status.className="status error";status.textContent="Allow pop-ups to print or save this compliance report as PDF.";}return;}
  win.opener=null;
  win.document.write(`<!doctype html><html><head><title>${esc(selectedJob.jobNumber||"90 Day Inspection")}</title><style>body{font-family:Arial,sans-serif;color:#101828;margin:24px}h2,h3{margin:8px 0 14px}.compliance-report-head{display:flex;justify-content:space-between}.wm-review-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}.wm-review-box{border:1px solid #ccc;padding:10px}.wm-full{grid-column:1/-1}.wm-review-label{font-size:10px;font-weight:bold;text-transform:uppercase;color:#667085;margin-bottom:4px}table{width:100%;border-collapse:collapse;font-size:10px;margin-top:10px}th,td{border:1px solid #bbb;padding:6px;text-align:left;vertical-align:top}.badge{font-weight:bold}.list-meta{font-size:10px;color:#475467;margin-top:3px}@media print{body{margin:10mm}}</style></head><body>${reportHtml(selectedJob)}</body></html>`);win.document.close();win.focus();setTimeout(()=>win.print(),250);
}

function dateValue(value) {
  const date=typeof value?.toDate==="function"?value.toDate():value?new Date(value):null;
  return date&&!Number.isNaN(date.getTime())?date:null;
}
function dateKey(value) { const date=dateValue(value);return date?localDate(date):""; }
function jobMechanic(job) { return job.mechanicName||job.assignedMechanicName||job.assignedMechanic||"Unassigned"; }
function jobDuration(job) {
  const start=dateValue(job.createdAt);const finish=dateValue(job.closedAt||job.completedAt||job.mechanicCompletedAt);
  if(!start)return "—";
  const hours=Math.max(0,((finish||new Date())-start)/3600000);
  return hours<48?`${hours.toFixed(1)} hrs`:`${(hours/24).toFixed(1)} days${finish?"":" open"}`;
}
function populateWorkshopJobFilters() {
  const typeSelect=$("workshopJobReportType");const mechanicSelect=$("workshopJobReportMechanic");
  if(!typeSelect||!mechanicSelect)return;
  const currentType=typeSelect.value,currentMechanic=mechanicSelect.value;
  const types=[...new Set(jobs.map(job=>job.jobType||"Workshop Job"))].sort();
  const mechanics=[...new Set(jobs.map(jobMechanic).filter(name=>name!=="Unassigned"))].sort();
  typeSelect.innerHTML=`<option value="">All job types</option>${types.map(value=>`<option value="${esc(value)}">${esc(value)}</option>`).join("")}`;
  mechanicSelect.innerHTML=`<option value="">All mechanics</option>${mechanics.map(value=>`<option value="${esc(value)}">${esc(value)}</option>`).join("")}`;
  if(types.includes(currentType))typeSelect.value=currentType;if(mechanics.includes(currentMechanic))mechanicSelect.value=currentMechanic;
}
function filteredWorkshopJobs() {
  const term=norm($("workshopJobReportSearch")?.value);const status=$("workshopJobReportStatus")?.value||"";const type=$("workshopJobReportType")?.value||"";const mechanic=$("workshopJobReportMechanic")?.value||"";const from=$("workshopJobReportFrom")?.value||"";const to=$("workshopJobReportTo")?.value||"";
  return jobs.filter(job=>{const created=dateKey(job.createdAt);const haystack=norm([job.jobNumber,job.fleetNumber,job.rego,job.reportedFault,jobMechanic(job),job.jobType].join(" "));return(!term||haystack.includes(term))&&(!status||(job.status||"New")===status)&&(!type||(job.jobType||"Workshop Job")===type)&&(!mechanic||jobMechanic(job)===mechanic)&&(!from||(created&&created>=from))&&(!to||(created&&created<=to));});
}
function renderWorkshopJobMetrics() {
  const all=jobs;const closed=all.filter(job=>job.status==="Closed");const durations=closed.map(job=>{const a=dateValue(job.createdAt),b=dateValue(job.closedAt);return a&&b?(b-a)/3600000:null;}).filter(value=>value!=null&&value>=0);
  const average=durations.length?`${(durations.reduce((sum,value)=>sum+value,0)/durations.length).toFixed(1)}h`:"—";
  $("workshopJobReportMetrics").innerHTML=`<article class="metric"><span>Total Jobs</span><strong>${all.length}</strong></article><article class="metric warning"><span>Open Jobs</span><strong>${all.filter(job=>!["Closed","Completed","Cancelled"].includes(job.status)).length}</strong></article><article class="metric warning"><span>Waiting Approval</span><strong>${all.filter(job=>job.status==="Waiting Approval").length}</strong></article><article class="metric danger"><span>Waiting Parts</span><strong>${all.filter(job=>job.status==="Waiting Parts").length}</strong></article><article class="metric"><span>Closed Jobs</span><strong>${closed.length}</strong></article><article class="metric"><span>Average Turnaround</span><strong>${average}</strong></article>`;
}
function renderWorkshopJobList() {
  const list=filteredWorkshopJobs().sort((a,b)=>(dateValue(b.createdAt)?.getTime()||0)-(dateValue(a.createdAt)?.getTime()||0));
  $("workshopJobReportResultCount").textContent=`${list.length} matching job${list.length===1?"":"s"}`;
  $("workshopJobReportList").innerHTML=list.length?`<div class="table-wrap"><table><thead><tr><th>Job</th><th>Created</th><th>Bus</th><th>Job Type</th><th>Mechanic</th><th>Status</th><th>Due</th><th>Turnaround</th><th>Action</th></tr></thead><tbody>${list.map(job=>`<tr><td><strong>${esc(job.jobNumber||job.id)}</strong><div class="list-meta job-report-fault">${esc(job.reportedFault||"No work description")}</div></td><td>${esc(fmtDate(job.createdAt))}</td><td><strong>${esc(job.fleetNumber||"—")}</strong><div class="list-meta">${esc(job.rego||"")}</div></td><td>${esc(job.jobType||"Workshop Job")}<div class="list-meta">${esc(job.serviceType||job.inspectionType||job.jobCategory||"")}</div></td><td>${esc(jobMechanic(job))}</td><td><span class="badge ${job.status==="Closed"?"good":job.status==="Waiting Approval"||job.status==="Waiting Parts"?"warn":"info"}">${esc(job.status||"New")}</span></td><td>${esc(fmtDate(job.dueDate))}</td><td>${esc(jobDuration(job))}</td><td><button class="button secondary" type="button" data-workshop-report-view="${esc(job.id)}">View Job Card</button></td></tr>`).join("")}</tbody></table></div>`:`<div class="empty">No workshop jobs match these filters.</div>`;
  $("workshopJobReportList").querySelectorAll("[data-workshop-report-view]").forEach(button=>button.addEventListener("click",()=>{if(typeof window.openFleetManagerJobReview==="function")window.openFleetManagerJobReview(button.dataset.workshopReportView);else{const status=$("status");status.className="status error";status.textContent="Job Card review is not ready. Refresh and try again.";}}));
}
function csvCell(value) { let text=String(value??"");if(/^[=+\-@]/.test(text))text=`'${text}`;return `"${text.replace(/"/g,'""')}"`; }
function exportWorkshopJobsCsv() {
  const rows=[["Job Number","Created","Bus","Registration","Job Type","Category","Priority","Mechanic","Status","Due Date","Turnaround","Reported Fault"]];
  filteredWorkshopJobs().forEach(job=>rows.push([job.jobNumber||job.id,dateKey(job.createdAt),job.fleetNumber||"",job.rego||"",job.jobType||"Workshop Job",job.serviceType||job.inspectionType||job.jobCategory||"",job.priority||"Normal",jobMechanic(job),job.status||"New",job.dueDate||"",jobDuration(job),job.reportedFault||""]));
  const blob=new Blob(["\ufeff"+rows.map(row=>row.map(csvCell).join(",")).join("\r\n")],{type:"text/csv;charset=utf-8"});const url=URL.createObjectURL(blob);const link=document.createElement("a");link.href=url;link.download=`workshop-jobs-${localDate()}.csv`;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function printWorkshopJobsReport() {
  const list=filteredWorkshopJobs();const win=window.open("","_blank");if(!win){const status=$("status");status.className="status error";status.textContent="Allow pop-ups to print the Workshop Jobs report.";return;}win.opener=null;
  const rows=list.map(job=>`<tr><td>${esc(job.jobNumber||job.id)}</td><td>${esc(fmtDate(job.createdAt))}</td><td>${esc(job.fleetNumber||"—")}</td><td>${esc(job.jobType||"Workshop Job")}</td><td>${esc(jobMechanic(job))}</td><td>${esc(job.status||"New")}</td><td>${esc(fmtDate(job.dueDate))}</td><td>${esc(jobDuration(job))}</td></tr>`).join("");
  win.document.write(`<!doctype html><html><head><title>Workshop Jobs Report</title><style>body{font-family:Arial,sans-serif;color:#101828;margin:20px}h1{margin-bottom:4px}.meta{color:#475467;margin-bottom:16px}table{width:100%;border-collapse:collapse;font-size:11px}th,td{border:1px solid #bbb;padding:6px;text-align:left}@media print{body{margin:8mm}}</style></head><body><h1>Punchbowl Bus Company — Workshop Jobs Report</h1><div class="meta">Generated ${esc(fmtDateTime(new Date()))} · ${list.length} matching jobs</div><table><thead><tr><th>Job</th><th>Created</th><th>Bus</th><th>Type</th><th>Mechanic</th><th>Status</th><th>Due</th><th>Turnaround</th></tr></thead><tbody>${rows}</tbody></table></body></html>`);win.document.close();win.focus();setTimeout(()=>win.print(),250);
}

function defectDone(defect){return isDefectCompleted(defect);}
function defectDate(defect){return defect.defectDate||dateKey(defect.createdAt||defect.reportedAtIso);}
function defectActionTime(defect){const start=dateValue(defect.createdAt||defect.reportedAtIso);const action=dateValue(defect.convertedToJobAt||defect.updatedAt);if(!start||!action)return "—";const hours=Math.max(0,(action-start)/3600000);return hours<48?`${hours.toFixed(1)} hrs`:`${(hours/24).toFixed(1)} days`;}
function populateDefectFilters(){const select=$("driverDefectReportCategory");if(!select)return;const current=select.value;const values=[...new Set(defects.map(defect=>defect.category).filter(Boolean))].sort();select.innerHTML=`<option value="">All categories</option>${values.map(value=>`<option value="${esc(value)}">${esc(value)}</option>`).join("")}`;if(values.includes(current))select.value=current;}
function filteredDefects(){const term=norm($("driverDefectReportSearch")?.value),status=$("driverDefectReportStatus")?.value||"",category=$("driverDefectReportCategory")?.value||"",safety=$("driverDefectReportSafety")?.value||"",from=$("driverDefectReportFrom")?.value||"",to=$("driverDefectReportTo")?.value||"";return defects.filter(defect=>{const date=defectDate(defect),canonicalStatus=normalizeDefectStatus(defect.status),haystack=norm([defect.reportNumber,defect.fleetNumber,defect.rego,defect.reportedByName,defect.category,defect.description,canonicalStatus].join(" "));return(!term||haystack.includes(term))&&(!status||canonicalStatus===status)&&(!category||defect.category===category)&&(!safety||defect.safeToDrive===safety)&&(!from||(date&&date>=from))&&(!to||(date&&date<=to));});}
function renderDefectReports(){
  const all=defects,open=all.filter(defect=>!defectDone(defect)),unsafe=open.filter(defect=>defect.safeToDrive==="No"),converted=all.filter(defect=>defect.workshopJobId||defect.workshopJobNumber),unactioned=open.filter(defect=>!defect.workshopJobId&&!defect.workshopJobNumber);
  $("driverDefectReportMetrics").innerHTML=`<article class="metric"><span>Total Defects</span><strong>${all.length}</strong></article><article class="metric warning"><span>Open Defects</span><strong>${open.length}</strong></article><article class="metric danger"><span>Unsafe Open</span><strong>${unsafe.length}</strong></article><article class="metric"><span>Converted to Job</span><strong>${converted.length}</strong></article><article class="metric danger"><span>Awaiting Action</span><strong>${unactioned.length}</strong></article><article class="metric"><span>Completed</span><strong>${all.filter(defectDone).length}</strong></article>`;
  const list=filteredDefects().sort((a,b)=>(dateValue(b.createdAt||b.reportedAtIso)?.getTime()||0)-(dateValue(a.createdAt||a.reportedAtIso)?.getTime()||0));$("driverDefectReportResultCount").textContent=`${list.length} matching defect${list.length===1?"":"s"}`;
  $("driverDefectReportList").innerHTML=list.length?`<div class="table-wrap"><table><thead><tr><th>Defect</th><th>Reported</th><th>Bus</th><th>Driver</th><th>Category / Description</th><th>Safety</th><th>Status</th><th>Workshop Action</th></tr></thead><tbody>${list.map(defect=>`<tr><td><strong>${esc(defect.reportNumber||defect.id)}</strong></td><td>${esc(fmtDate(defect.createdAt||defect.reportedAtIso||defect.defectDate))}</td><td><strong>${esc(defect.fleetNumber||defect.busNumber||"—")}</strong><div class="list-meta">${esc(defect.rego||"")}</div></td><td>${esc(defect.reportedByName||"Unknown")}<div class="list-meta">${esc(defect.reportedByEmployeeNumber||"")}</div></td><td><strong>${esc(defect.category||"Other")}</strong><div class="list-meta defect-report-description">${esc(defect.description||"No description")}</div></td><td><span class="badge ${defect.safeToDrive==="No"?"bad":"good"}">${defect.safeToDrive==="No"?"Unsafe":"Safe"}</span></td><td>${esc(normalizeDefectStatus(defect.status))}</td><td>${defect.workshopJobId||defect.workshopJobNumber?`<button class="button secondary" type="button" data-defect-job="${esc(defect.workshopJobId||"")}" data-defect-job-number="${esc(defect.workshopJobNumber||"")}">${esc(defect.workshopJobNumber||"Open Job")}</button><div class="list-meta">Actioned in ${esc(defectActionTime(defect))}</div>`:'<span class="badge warn">Awaiting workshop action</span>'}</td></tr>`).join("")}</tbody></table></div>`:`<div class="empty">No driver defects match these filters.</div>`;
  $("driverDefectReportList").querySelectorAll("[data-defect-job]").forEach(button=>button.addEventListener("click",()=>{const id=button.dataset.defectJob||jobs.find(job=>job.jobNumber===button.dataset.defectJobNumber)?.id;if(id&&typeof window.openFleetManagerJobReview==="function")window.openFleetManagerJobReview(id);}));
}

function isoExpiry(bus){return bus.regoExpiryDate||(/^\d{4}-\d{2}-\d{2}$/.test(String(bus.regoExpiry||""))?bus.regoExpiry:"");}
function daysFromToday(date){if(!date)return null;const parsed=new Date(`${date}T00:00:00`);return Number.isNaN(parsed.getTime())?null:Math.round((parsed-new Date(`${localDate()}T00:00:00`))/86400000);}
function regoCompliance(bus){const date=isoExpiry(bus),days=daysFromToday(date);if(days==null)return{level:"Attention",label:"DATE REQUIRED",date};if(days<0)return{level:"Critical",label:"EXPIRED",date};if(days<=90)return{level:"Attention",label:"DUE SOON",date};return{level:"Compliant",label:"ON TRACK",date};}
function serviceCompliance(bus){const current=Number(bus.currentOdometer??bus.odometer??bus.odometerKm),dueKm=Number(bus.nextServiceOdometer??bus.nextServiceKm),date=bus.nextServiceDate||"";const days=daysFromToday(date);if((Number.isFinite(current)&&Number.isFinite(dueKm)&&dueKm<=current)||(days!=null&&days<0))return{level:"Critical",label:"OVERDUE"};if((Number.isFinite(current)&&Number.isFinite(dueKm)&&dueKm-current<=1000)||(days!=null&&days<=14))return{level:"Attention",label:"DUE SOON"};if((Number.isFinite(dueKm)&&dueKm>0)||date)return{level:"Compliant",label:"ON TRACK"};return{level:"Attention",label:"NOT SET"};}
function fleetDefects(bus){return defects.filter(defect=>!defectDone(defect)&&norm(defect.fleetNumber||defect.busNumber)===norm(fleetNo(bus)));}
function fleetJobs(bus){return jobs.filter(job=>!["Closed","Completed","Cancelled"].includes(job.status)&&norm(job.fleetNumber)===norm(fleetNo(bus)));}
function fleetComplianceRow(bus){const rego=regoCompliance(bus),service=serviceCompliance(bus),safety=dueState(bus),openDefects=fleetDefects(bus),openJobs=fleetJobs(bus);const critical=rego.level==="Critical"||service.level==="Critical"||safety.kind==="bad"||openDefects.some(defect=>defect.safeToDrive==="No")||/out of service/i.test(bus.status||"");const attention=rego.level==="Attention"||service.level==="Attention"||["warn","missing"].includes(safety.kind)||openDefects.length||openJobs.length||/workshop|restricted/i.test(bus.status||"");return{bus,rego,service,safety,openDefects,openJobs,overall:critical?"Critical":attention?"Attention":"Compliant"};}
function populateFleetFilters(){const select=$("fleetComplianceDepot");if(!select)return;const current=select.value,depots=[...new Set(buses.map(bus=>bus.depot).filter(Boolean))].sort();select.innerHTML=`<option value="">All depots</option>${depots.map(value=>`<option value="${esc(value)}">${esc(value)}</option>`).join("")}`;if(depots.includes(current))select.value=current;}
function filteredFleet(){const term=norm($("fleetComplianceSearch")?.value),status=$("fleetComplianceStatus")?.value||"",depot=$("fleetComplianceDepot")?.value||"",type=$("fleetComplianceVehicleType")?.value||"";return buses.map(fleetComplianceRow).filter(row=>{const bus=row.bus,vehicle=/\b(ev|electric)\b/i.test(`${bus.fuelType||""} ${bus.fuel||""} ${bus.powertrain||""}`)?"Electric":"Diesel",haystack=norm([fleetNo(bus),bus.rego,bus.make,bus.model,bus.depot].join(" "));return(!term||haystack.includes(term))&&(!status||row.overall===status)&&(!depot||bus.depot===depot)&&(!type||vehicle===type);});}
function statePill(label,level){return `<span class="badge ${level==="Critical"||level==="bad"?"bad":level==="Attention"||level==="warn"||level==="missing"?"warn":"good"}">${esc(label)}</span>`;}
function renderFleetCompliance(){const all=buses.map(fleetComplianceRow);$("fleetComplianceMetrics").innerHTML=`<article class="metric"><span>Total Fleet</span><strong>${all.length}</strong></article><article class="metric danger"><span>Critical</span><strong>${all.filter(row=>row.overall==="Critical").length}</strong></article><article class="metric warning"><span>Needs Attention</span><strong>${all.filter(row=>row.overall==="Attention").length}</strong></article><article class="metric"><span>Compliant</span><strong>${all.filter(row=>row.overall==="Compliant").length}</strong></article><article class="metric danger"><span>Unsafe Defects</span><strong>${all.reduce((sum,row)=>sum+row.openDefects.filter(defect=>defect.safeToDrive==="No").length,0)}</strong></article><article class="metric warning"><span>Open Jobs</span><strong>${all.reduce((sum,row)=>sum+row.openJobs.length,0)}</strong></article>`;
  const list=filteredFleet().sort((a,b)=>({Critical:0,Attention:1,Compliant:2}[a.overall]-{Critical:0,Attention:1,Compliant:2}[b.overall])||String(fleetNo(a.bus)).localeCompare(String(fleetNo(b.bus)),undefined,{numeric:true}));$("fleetComplianceResultCount").textContent=`${list.length} matching vehicle${list.length===1?"":"s"}`;
  $("fleetComplianceList").innerHTML=list.length?`<div class="table-wrap"><table><thead><tr><th>Fleet / Vehicle</th><th>Depot</th><th>Registration</th><th>Service</th><th>90-Day Safety</th><th>Open Defects</th><th>Open Jobs</th><th>Vehicle Status</th><th>Overall</th></tr></thead><tbody>${list.map(row=>{const bus=row.bus;return`<tr class="fleet-compliance-${norm(row.overall)}"><td><strong>${esc(fleetNo(bus))}</strong><div class="list-meta">${esc(bus.rego||"No rego")} · ${esc([bus.make,bus.model].filter(Boolean).join(" ")||"Vehicle")}</div></td><td>${esc(bus.depot||"—")}</td><td>${statePill(row.rego.label,row.rego.level)}<div class="list-meta">${esc(fmtDate(row.rego.date))}</div></td><td>${statePill(row.service.label,row.service.level)}<div class="list-meta">${esc(fmtDate(bus.nextServiceDate))}</div></td><td>${statePill(row.safety.label,row.safety.kind)}<div class="list-meta">${esc(fmtDate(bus.next90DaySafetyCheckDate))}</div></td><td>${row.openDefects.length}${row.openDefects.some(defect=>defect.safeToDrive==="No")?' · <strong class="critical-text">UNSAFE</strong>':""}</td><td>${row.openJobs.length}</td><td>${esc(bus.status||"Active")}</td><td>${statePill(row.overall,row.overall)}</td></tr>`}).join("")}</tbody></table></div>`:`<div class="empty">No fleet records match these filters.</div>`;}

function downloadCsv(filename,rows){const blob=new Blob(["\ufeff"+rows.map(row=>row.map(csvCell).join(",")).join("\r\n")],{type:"text/csv;charset=utf-8"}),url=URL.createObjectURL(blob),link=document.createElement("a");link.href=url;link.download=filename;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function exportDefects(){const rows=[["Report","Reported","Bus","Rego","Driver","Category","Description","Safe to Drive","Status","Workshop Job","Action Time"]];filteredDefects().forEach(defect=>rows.push([defect.reportNumber||defect.id,defectDate(defect),defect.fleetNumber||defect.busNumber||"",defect.rego||"",defect.reportedByName||"",defect.category||"",defect.description||"",defect.safeToDrive||"",normalizeDefectStatus(defect.status),defect.workshopJobNumber||"",defectActionTime(defect)]));downloadCsv(`driver-defects-${localDate()}.csv`,rows);}
function exportFleet(){const rows=[["Fleet","Rego","Make","Model","Depot","Registration","Registration Expiry","Service","Next Service","90-Day Safety","Next 90-Day Due","Open Defects","Unsafe Defects","Open Jobs","Vehicle Status","Overall"]];filteredFleet().forEach(row=>{const bus=row.bus;rows.push([fleetNo(bus),bus.rego||"",bus.make||"",bus.model||"",bus.depot||"",row.rego.label,row.rego.date||"",row.service.label,bus.nextServiceDate||"",row.safety.label,bus.next90DaySafetyCheckDate||"",row.openDefects.length,row.openDefects.filter(defect=>defect.safeToDrive==="No").length,row.openJobs.length,bus.status||"Active",row.overall]);});downloadCsv(`fleet-compliance-${localDate()}.csv`,rows);}
function printTableReport(title,headers,rows){const win=window.open("","_blank");if(!win){const status=$("status");status.className="status error";status.textContent=`Allow pop-ups to print ${title}.`;return;}win.opener=null;win.document.write(`<!doctype html><html><head><title>${esc(title)}</title><style>body{font-family:Arial,sans-serif;color:#101828;margin:20px}h1{margin-bottom:4px}.meta{color:#475467;margin-bottom:16px}table{width:100%;border-collapse:collapse;font-size:10px}th,td{border:1px solid #bbb;padding:5px;text-align:left}@media print{body{margin:7mm}}</style></head><body><h1>Punchbowl Bus Company — ${esc(title)}</h1><div class="meta">Generated ${esc(fmtDateTime(new Date()))} · ${rows.length} records</div><table><thead><tr>${headers.map(value=>`<th>${esc(value)}</th>`).join("")}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map(value=>`<td>${esc(value)}</td>`).join("")}</tr>`).join("")}</tbody></table></body></html>`);win.document.close();win.focus();setTimeout(()=>win.print(),250);}
function printDefects(){printTableReport("Driver Defect Report",["Report","Date","Bus","Driver","Category","Safety","Status","Workshop Job"],filteredDefects().map(defect=>[defect.reportNumber||defect.id,defectDate(defect),defect.fleetNumber||defect.busNumber||"—",defect.reportedByName||"Unknown",defect.category||"Other",defect.safeToDrive==="No"?"Unsafe":"Safe",normalizeDefectStatus(defect.status),defect.workshopJobNumber||"Awaiting action"]));}
function printFleet(){printTableReport("Fleet Compliance Summary",["Fleet","Rego","Depot","Registration","Service","90-Day","Defects","Jobs","Vehicle Status","Overall"],filteredFleet().map(row=>[fleetNo(row.bus),row.bus.rego||"—",row.bus.depot||"—",row.rego.label,row.service.label,row.safety.label,String(row.openDefects.length),String(row.openJobs.length),row.bus.status||"Active",row.overall]));}

function renderAll(){renderMetrics();renderReportList();renderFleetStatus();populateWorkshopJobFilters();renderWorkshopJobMetrics();renderWorkshopJobList();populateDefectFilters();renderDefectReports();populateFleetFilters();renderFleetCompliance();}
function start(){if(jobUnsub||busUnsub||defectUnsub)return;ensureDialog();jobUnsub=onSnapshot(query(collection(db,"workshopJobs"),orderBy("createdAt","desc")),snap=>{jobs=snap.docs.map(doc=>({id:doc.id,...doc.data()}));renderAll();});busUnsub=onSnapshot(collection(db,"buses"),snap=>{buses=snap.docs.map(doc=>({id:doc.id,...doc.data()}));renderAll();});defectUnsub=onSnapshot(collection(db,"defectReports"),snap=>{defects=snap.docs.map(doc=>({id:doc.id,...doc.data()})).filter(defect=>defect.deleted!==true);renderAll();});}

function injectStyles(){const style=document.createElement("style");style.textContent=`.report-tabs{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px;border-bottom:1px solid #d0d5dd}.report-tabs button{border:0;background:transparent;padding:11px 16px;font-weight:900;color:#475467;border-bottom:3px solid transparent;cursor:pointer}.report-tabs button.active{color:#b42318;border-bottom-color:#c62828}.report-tab-panel[hidden]{display:none}.report-filter-grid{display:grid;grid-template-columns:2fr repeat(4,minmax(140px,1fr)) auto;gap:10px;align-items:end;padding:16px}.job-report-filters{grid-template-columns:2fr repeat(5,minmax(130px,1fr)) auto}.fleet-report-filters{grid-template-columns:2fr repeat(3,minmax(150px,1fr)) auto}.report-filter-grid label{display:grid;gap:5px;font-size:12px;font-weight:800}.report-export-row{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:0 16px 14px}.report-export-row>div{display:flex;gap:8px}.compliance-table td{vertical-align:top}.report-attention,.critical-text{color:#b42318;font-weight:800}.job-report-fault,.defect-report-description{max-width:360px;white-space:normal;line-height:1.45}.fleet-compliance-critical{background:#fff6f5}.fleet-compliance-critical td:first-child{border-left:4px solid #d92d20}.fleet-compliance-attention{background:#fffcf5}.fleet-compliance-attention td:first-child{border-left:4px solid #f79009}.fleet-compliance-panel tbody tr:hover{background:#f9fafb}.compliance-report-dialog{width:min(1250px,calc(100vw - 28px))}.compliance-report-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;margin-bottom:14px}.compliance-detail-grid{margin-bottom:18px}.compliance-checklist{min-width:900px}.missing-inspection-date{border:1px solid #f79009;background:#fffaeb;border-radius:12px;padding:14px;margin:16px 0}.missing-inspection-date h3{color:#93370d;margin-top:0}.report-date-correction{display:grid;grid-template-columns:220px 1fr auto;gap:10px;align-items:end}.report-date-correction label{display:grid;gap:5px;font-size:12px;font-weight:800}@media(max-width:1200px){.job-report-filters,.fleet-report-filters{grid-template-columns:repeat(3,1fr)}}@media(max-width:1000px){.report-filter-grid{grid-template-columns:repeat(2,1fr)}.report-date-correction{grid-template-columns:1fr}}@media(max-width:600px){.report-tabs button{flex:1 1 45%;padding:10px 6px}.report-filter-grid{grid-template-columns:1fr}.report-export-row{align-items:stretch;flex-direction:column}.report-export-row div{display:flex;gap:8px}.report-export-row .button{flex:1}}`;document.head.appendChild(style);}
injectStyles();
["complianceReportSearch","complianceReportStatus","complianceReportVehicleType","complianceReportFrom","complianceReportTo"].forEach(id=>$(id)?.addEventListener(id==="complianceReportSearch"?"input":"change",renderReportList));
$("clearComplianceReportFilters")?.addEventListener("click",()=>{["complianceReportSearch","complianceReportStatus","complianceReportVehicleType","complianceReportFrom","complianceReportTo"].forEach(id=>{$(id).value="";});renderReportList();});
$("refreshComplianceReports")?.addEventListener("click",renderAll);
document.querySelectorAll("[data-report-tab]").forEach(button=>button.addEventListener("click",()=>{const selected=button.dataset.reportTab;const panels={compliance90:"compliance90ReportTab",workshopJobs:"workshopJobsReportTab",driverDefects:"driverDefectsReportTab",fleetCompliance:"fleetComplianceReportTab"};document.querySelectorAll("[data-report-tab]").forEach(item=>item.classList.toggle("active",item===button));Object.entries(panels).forEach(([key,id])=>{$(id).hidden=key!==selected;});}));
["workshopJobReportSearch","workshopJobReportStatus","workshopJobReportType","workshopJobReportMechanic","workshopJobReportFrom","workshopJobReportTo"].forEach(id=>$(id)?.addEventListener(id==="workshopJobReportSearch"?"input":"change",renderWorkshopJobList));
$("clearWorkshopJobReportFilters")?.addEventListener("click",()=>{["workshopJobReportSearch","workshopJobReportStatus","workshopJobReportType","workshopJobReportMechanic","workshopJobReportFrom","workshopJobReportTo"].forEach(id=>$(id).value="");renderWorkshopJobList();});
$("exportWorkshopJobsCsv")?.addEventListener("click",exportWorkshopJobsCsv);
$("printWorkshopJobsReport")?.addEventListener("click",printWorkshopJobsReport);
["driverDefectReportSearch","driverDefectReportStatus","driverDefectReportCategory","driverDefectReportSafety","driverDefectReportFrom","driverDefectReportTo"].forEach(id=>$(id)?.addEventListener(id==="driverDefectReportSearch"?"input":"change",renderDefectReports));
$("clearDriverDefectReportFilters")?.addEventListener("click",()=>{["driverDefectReportSearch","driverDefectReportStatus","driverDefectReportCategory","driverDefectReportSafety","driverDefectReportFrom","driverDefectReportTo"].forEach(id=>$(id).value="");renderDefectReports();});
$("exportDriverDefectsCsv")?.addEventListener("click",exportDefects);
$("printDriverDefectsReport")?.addEventListener("click",printDefects);
["fleetComplianceSearch","fleetComplianceStatus","fleetComplianceDepot","fleetComplianceVehicleType"].forEach(id=>$(id)?.addEventListener(id==="fleetComplianceSearch"?"input":"change",renderFleetCompliance));
$("clearFleetComplianceFilters")?.addEventListener("click",()=>{["fleetComplianceSearch","fleetComplianceStatus","fleetComplianceDepot","fleetComplianceVehicleType"].forEach(id=>$(id).value="");renderFleetCompliance();});
$("exportFleetComplianceCsv")?.addEventListener("click",exportFleet);
$("printFleetComplianceReport")?.addEventListener("click",printFleet);
window.addEventListener("workshop-manager-access-granted",start);
if(window.workshopManagerAccessGranted)start();
