import { collection, onSnapshot, orderBy, query } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";
import { db } from "./firebase.js";
import { getRequirementTemplate } from "./workshop_service_requirements.js?v=20260914-descriptions";

const $ = (id) => document.getElementById(id);
const norm = (value) => String(value || "").trim().toLowerCase();
const esc = (value) => String(value ?? "").replace(/[&<>'\"]/g, (char) => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'\"':"&quot;"}[char]));
let jobs = [];
let buses = [];
let selectedJob = null;
let jobUnsub = null;
let busUnsub = null;

function localDate(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
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
    return `<tr><td><strong>${esc(job.jobNumber||job.id)}</strong><div class="list-meta">${esc(job.assignedChecklist?.templateTitle || job.inspectionType || "90 Day Safety Check")}</div></td><td><strong>${esc(job.fleetNumber||"—")}</strong><div class="list-meta">${esc(job.rego||"")}</div></td><td>${esc(vehicleType(job))}</td><td>${esc(fmtDate(inspectionDate(job)))}</td><td>${esc(job.mechanicInspectionSignOff?.name || job.mechanicName || job.assignedMechanic || "—")}</td><td>${esc(approval.approvedByName || approval.approvedByEmail || "Not signed off")}<div class="list-meta">${esc(fmtDateTime(approval.approvedAt || job.closedAt))}</div></td><td><span class="badge ${job.status==="Closed"?"good":job.status==="Waiting Approval"?"warn":"info"}">${esc(job.status||"Active")}</span>${attentionCount(job)?`<div class="list-meta report-attention">${attentionCount(job)} attention item(s)</div>`:""}</td><td><button class="button secondary" type="button" data-compliance-view="${esc(job.id)}">View Report</button></td></tr>`;
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
  </div><h3>Mandatory Inspection Checklist</h3><div class="table-wrap">${checklistRows(job)}</div>`;
}

function ensureDialog() {
  if ($("complianceReportDialog")) return;
  const dialog=document.createElement("dialog");dialog.id="complianceReportDialog";dialog.className="dialog compliance-report-dialog";
  dialog.innerHTML=`<div class="dialog-head"><div><h2>Inspection Compliance Report</h2><p>Complete job record and mandatory checklist evidence.</p></div><button id="closeComplianceReport" class="icon-button" type="button">×</button></div><div id="complianceReportBody"></div><div class="dialog-actions"><button id="printComplianceReport" class="button primary" type="button">Print / Save PDF</button><button id="doneComplianceReport" class="button secondary" type="button">Close</button></div>`;
  document.body.appendChild(dialog);
  $("closeComplianceReport").onclick=()=>dialog.close();$("doneComplianceReport").onclick=()=>dialog.close();$("printComplianceReport").onclick=printReport;
}
function openReport(id) { ensureDialog();selectedJob=jobs.find((job)=>job.id===id);if(!selectedJob)return;$("complianceReportBody").innerHTML=reportHtml(selectedJob);$("complianceReportDialog").showModal(); }
function printReport() {
  if(!selectedJob)return;
  const win=window.open("","_blank");
  if(!win){const status=$("status");if(status){status.className="status error";status.textContent="Allow pop-ups to print or save this compliance report as PDF.";}return;}
  win.opener=null;
  win.document.write(`<!doctype html><html><head><title>${esc(selectedJob.jobNumber||"90 Day Inspection")}</title><style>body{font-family:Arial,sans-serif;color:#101828;margin:24px}h2,h3{margin:8px 0 14px}.compliance-report-head{display:flex;justify-content:space-between}.wm-review-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}.wm-review-box{border:1px solid #ccc;padding:10px}.wm-full{grid-column:1/-1}.wm-review-label{font-size:10px;font-weight:bold;text-transform:uppercase;color:#667085;margin-bottom:4px}table{width:100%;border-collapse:collapse;font-size:10px;margin-top:10px}th,td{border:1px solid #bbb;padding:6px;text-align:left;vertical-align:top}.badge{font-weight:bold}.list-meta{font-size:10px;color:#475467;margin-top:3px}@media print{body{margin:10mm}}</style></head><body>${reportHtml(selectedJob)}</body></html>`);win.document.close();win.focus();setTimeout(()=>win.print(),250);
}

function renderAll(){renderMetrics();renderReportList();renderFleetStatus();}
function start(){if(jobUnsub||busUnsub)return;ensureDialog();jobUnsub=onSnapshot(query(collection(db,"workshopJobs"),orderBy("createdAt","desc")),snap=>{jobs=snap.docs.map(doc=>({id:doc.id,...doc.data()}));renderAll();});busUnsub=onSnapshot(collection(db,"buses"),snap=>{buses=snap.docs.map(doc=>({id:doc.id,...doc.data()}));renderAll();});}

function injectStyles(){const style=document.createElement("style");style.textContent=`.report-filter-grid{display:grid;grid-template-columns:2fr repeat(4,minmax(140px,1fr)) auto;gap:10px;align-items:end;padding:16px}.report-filter-grid label{display:grid;gap:5px;font-size:12px;font-weight:800}.compliance-table td{vertical-align:top}.report-attention{color:#b42318;font-weight:800}.compliance-report-dialog{width:min(1250px,calc(100vw - 28px))}.compliance-report-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;margin-bottom:14px}.compliance-detail-grid{margin-bottom:18px}.compliance-checklist{min-width:900px}@media(max-width:1000px){.report-filter-grid{grid-template-columns:repeat(2,1fr)}}@media(max-width:600px){.report-filter-grid{grid-template-columns:1fr}}`;document.head.appendChild(style);}
injectStyles();
["complianceReportSearch","complianceReportStatus","complianceReportVehicleType","complianceReportFrom","complianceReportTo"].forEach(id=>$(id)?.addEventListener(id==="complianceReportSearch"?"input":"change",renderReportList));
$("clearComplianceReportFilters")?.addEventListener("click",()=>{["complianceReportSearch","complianceReportStatus","complianceReportVehicleType","complianceReportFrom","complianceReportTo"].forEach(id=>{$(id).value="";});renderReportList();});
$("refreshComplianceReports")?.addEventListener("click",renderAll);
window.addEventListener("workshop-manager-access-granted",start);
if(window.workshopManagerAccessGranted)start();
