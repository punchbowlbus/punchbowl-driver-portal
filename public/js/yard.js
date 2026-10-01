import {onAuthStateChanged,signInWithPopup,signOut} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-auth.js";
import {yardAuth,yardProvider,yardCall} from "./yard_api.js";
import {escapeHtml as esc} from "./utils.js";
import {TASK_LABELS,cleaningState,checkState,fleetFilter,dateAdd} from "./yard_model.js";
const root=document.getElementById("yardRoot"),standalone=Boolean(document.getElementById("yardIdentity"));
if(standalone&&new URLSearchParams(location.search).get("managerView")==="1")root.dataset.mode="manager";
const byId=(id)=>document.getElementById(id),val=(id)=>String(byId(id)?.value || "").trim();
let model=null,tab="fleet",authVersion=0,loadingVersion=null,busy=false,poll=null,lastUpdated="",historyRecords=null;
const fmtDate=(value)=>value?new Date(`${value}T12:00:00Z`).toLocaleDateString("en-AU",{day:"2-digit",month:"short"}):"Not recorded";
const fmtTime=(value)=>value?new Date(value).toLocaleString("en-AU",{timeZone:"Australia/Sydney",day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"}):"—";
const pill=({label,tone})=>`<span class="badge ${tone}">${esc(label)}</span>`;
const statusPill=(status)=>pill({label:status || "Recorded",tone:status==="Approved"||status==="Reviewed"?"good":status==="Returned"?"bad":"warn"});
function msg(message,error=false,dialog=false){const node=byId(dialog?"yardModalMessage":"yardMessage");if(!node)return;node.textContent=message;node.className=`status ${error?"error":"success"}`;node.hidden=!message;}
function dialog(title,html){
  let modal=byId("yardModal");
  if(!modal){modal=document.createElement("dialog");modal.id="yardModal";modal.className="yard-dialog";modal.setAttribute("aria-labelledby","yardModalTitle");modal.innerHTML='<div class="yard-dialog-head"><h2 id="yardModalTitle"></h2><button id="yardModalClose" type="button" class="button secondary">Close</button></div><div class="yard-dialog-body"><div id="yardModalMessage" role="alert" class="status" hidden></div><div id="yardModalContent"></div></div>';document.body.appendChild(modal);byId("yardModalClose").onclick=()=>{if(!busy)modal.close();};modal.addEventListener("cancel",(event)=>{if(busy)event.preventDefault();});}
  byId("yardModalTitle").textContent=title;byId("yardModalContent").innerHTML=html;msg("",false,true);if(!modal.open)modal.showModal();
}
function setBusy(value){busy=value;byId("yardModal")?.querySelectorAll("button,input,textarea,select").forEach((node)=>node.disabled=value);}
function shell(){
  const manager=root.dataset.mode==="manager";
  root.innerHTML=`<div class="yard-page"><div class="page-head"><div><h1>${manager?"Yard Work Queue":"Full Fleet"}</h1><p>${manager?"Fleet cleaning, daily checks and every employee update.":"Choose a bus available in your yard. Your name is recorded when you start work."}</p></div><div class="yard-actions"><button id="yardRefresh" type="button" class="button secondary">Refresh</button></div></div><div id="yardMessage" class="status" role="status" hidden></div><div id="yardMetrics" class="metrics-grid"></div><nav id="yardTabs" class="yard-tabs" aria-label="Yard views"></nav><section class="panel table-panel"><div class="yard-filters"><label>Search bus / rego<input id="yardSearch" type="search" placeholder="Search bus, rego or depot" /></label><label>Depot<select id="yardDepot"><option value="">All depots</option></select></label><label>Show<select id="yardShow"><option value="all">Full fleet</option><option value="due">Due &amp; overdue</option><option value="approval">Awaiting cleaning approval</option><option value="problems">Reported check problems</option></select></label></div><p class="yard-hint strip">Depot is the fleet record location. Confirm the bus is physically in your yard before starting. Exterior wash and interior cleaning are due every 7 days.</p><div id="yardContent" class="table-wrap"></div></section><div id="yardRecent"></div><div id="yardUpdated" class="yard-live"></div></div>`;
  ["yardSearch","yardDepot","yardShow"].forEach((id)=>byId(id).addEventListener(id==="yardSearch"?"input":"change",()=>{historyRecords=null;render();}));
  byId("yardRefresh").onclick=()=>refresh(true);
}
function render(){
  if(!model||!byId("yardContent"))return;
  const manager=root.dataset.mode==="manager",fleet=model.fleet;
  const overdue=fleet.filter((bus)=>["exterior","interior"].some((type)=>cleaningState(bus.yard[type],model.today).label==="Overdue")).length;
  const outstanding=fleet.filter((bus)=>checkState(bus.yard.checks,model.today).due).length;
  const problemIds=new Set(model.records.filter((row)=>row.action==="checks"&&row.problem&&row.status==="Needs Review").map((row)=>row.busId));
  const problems=fleet.filter((bus)=>bus.yard.checks?.problem||problemIds.has(bus.id)).length;
  const approval=fleet.reduce((sum,bus)=>sum+(bus.yard.exterior?.pending?1:0)+(bus.yard.interior?.pending?1:0),0);
  byId("yardMetrics").innerHTML=[["Cleaning overdue",overdue,"danger"],["Checks outstanding",outstanding,"warning"],["Problems reported",problems,"danger"],["Awaiting approval",approval,"warning"]].map(([label,count,tone])=>`<article class="metric ${count?tone:""}"><span>${label}</span><strong>${count}</strong></article>`).join("");
  const tabs=manager?[["fleet","Fleet Overview"],["checks","Daily Checks"],["history","Cleaning History"],["activity","Team Activity"]]:[["fleet","Full Fleet"],["mine","My Work"],["activity","Team Activity"],["history","History"]];
  byId("yardTabs").innerHTML=tabs.map(([key,label])=>`<button class="button ${tab===key?"active":"secondary"}" type="button" data-yard-tab="${key}" aria-current="${tab===key?"page":"false"}">${label}</button>`).join("");
  byId("yardTabs").querySelectorAll("button").forEach((button)=>button.onclick=()=>{tab=button.dataset.yardTab;historyRecords=null;render();});
  const depot=val("yardDepot"),depots=[...new Set(fleet.map((bus)=>bus.depot).filter(Boolean))].sort();
  byId("yardDepot").innerHTML='<option value="">All depots</option>'+depots.map((name)=>`<option ${depot===name?"selected":""} value="${esc(name)}">${esc(name)}</option>`).join("");
  const list=fleetFilter(fleet,{search:val("yardSearch"),depot,show:val("yardShow"),today:model.today});
  if(["fleet","checks","mine"].includes(tab))renderFleet(list.filter((bus)=>tab!=="mine"||["exterior","interior"].some((type)=>bus.yard[type]?.active?.uid===model.person.uid||bus.yard[type]?.pending?.uid===model.person.uid)),manager);
  else renderRecords(list,manager);
  byId("yardRecent").innerHTML=tab==="fleet"?`<section class="panel" style="margin-top:16px"><div class="panel-head"><h2>Latest Yard Updates</h2><span class="hint">Employee and time recorded for every update</span></div><div class="table-wrap">${recordsTable(model.records.slice(0,8),manager)}</div></section>`:"";
  wireRecordButtons();
  byId("yardUpdated").textContent=`Last refreshed ${lastUpdated} · Updates refresh every 20 seconds while this page is visible.`;
}
function renderFleet(list,manager){
  const checksOnly=tab==="checks";
  byId("yardContent").innerHTML=list.length?`<table class="yard-table"><thead><tr><th>Bus / Depot</th>${checksOnly?"<th>Oil</th><th>Coolant</th><th>Tyres</th>":"<th>Exterior Wash</th><th>Interior + Mop</th><th>Daily Checks</th>"}<th>EV Charge</th><th>${manager?"Last Updated By":"Team Activity"}</th><th>Action</th></tr></thead><tbody>${list.map((bus)=>{
    const y=bus.yard,check=y.checks || {},updated=y.updatedBy;
    const cleaning=(type)=>{const state=y[type] || {};return `${pill(cleaningState(state,model.today))}<div class="list-meta">Last: ${esc(fmtDate(state.lastDate))}</div>${state.priority?'<div class="list-meta">Manager priority</div>':""}`;};
    const who=["exterior","interior"].map((type)=>{const state=y[type] || {};return state.active?`${TASK_LABELS[type]}: ${state.active.name}`:state.pending?`Submitted: ${state.pending.name}`:"";}).filter(Boolean).join(" · ");
    return `<tr><td><strong class="fleet-number">${bus.electric?'<span class="badge info">EV</span> ':""}${esc(bus.fleetNumber)}</strong><div class="list-meta">${esc(bus.depot || "No depot")} · ${esc(bus.rego)}</div></td>${checksOnly?`<td>${esc(check.oilLevel || (bus.oilCheckApplicable?"Not checked":"N/A"))}</td><td>${esc(check.coolantLevel || (bus.coolantCheckApplicable?"Not checked":"N/A"))}</td><td>${esc(check.tyres || "Not checked")}</td>`:`<td>${cleaning("exterior")}</td><td>${cleaning("interior")}</td><td>${pill(checkState(check,model.today))}${check.actor?`<div class="list-meta">${esc(check.actor.name)} · ${esc(fmtDate(check.performedDate))}</div>`:""}${check.problem?`<div class="list-meta">${esc(check.notes)}</div>`:""}</td>`}<td>${bus.electric?check.charge!=null?`${pill({label:`${check.charge}%`,tone:"info"})}<div class="list-meta">${esc(check.chargingStatus)} · ${esc(fmtTime(check.createdAt))}</div>`:"Not recorded":"N/A"}</td><td>${esc(manager?updated?.name || "No update yet":who || check.actor?.name || "—")}<div class="list-meta">${y.availability?.performedDate===model.today?`Bus unavailable: ${esc(y.availability.notes)}`:manager?esc(fmtTime(y.updatedAt)):""}</div></td><td><button class="button ${y.exterior?.pending||y.interior?.pending?"primary":"secondary"}" type="button" data-yard-bus="${esc(bus.id)}">${manager?"View / Review":"Choose Task"}</button></td></tr>`;
  }).join("")}</tbody></table>`:'<div class="yard-empty">No buses match this view.</div>';
  byId("yardContent").querySelectorAll("[data-yard-bus]").forEach((button)=>button.onclick=()=>openBus(button.dataset.yardBus));
}
function actionLabel(record){return {start:"Cleaning started",complete:"Cleaning submitted",checks:"Daily check recorded",unavailable:"Bus not in yard",release:"Task released",priority:"Priority updated",approve:"Cleaning approved",return:"Work returned",acknowledge:"Check reviewed"}[record.action] || record.action;}
function recordsTable(records,manager){return records.length?`<table class="yard-table"><thead><tr><th>Time</th><th>Bus</th><th>Update</th><th>Performed By</th><th>Status</th><th>Action</th></tr></thead><tbody>${records.map((row)=>`<tr><td>${esc(fmtTime(row.createdAt))}</td><td><strong>${esc(row.fleetNumber)}</strong><div class="list-meta">${esc(row.depot)}</div></td><td>${esc(actionLabel(row))}<div class="list-meta">${esc(TASK_LABELS[row.type] || "")}${row.problem?" · Problem reported":""}</div></td><td>${esc(row.actor?.name)}<div class="list-meta">${esc(row.actor?.employeeNumber)}</div></td><td>${statusPill(row.status)}</td><td><button class="button secondary" type="button" data-yard-record="${esc(row.id)}">${manager&&["Waiting Approval","Needs Review"].includes(row.status)?"Review":"View"}</button></td></tr>`).join("")}</tbody></table>`:'<div class="yard-empty">No matching updates recorded yet.</div>';}
function renderRecords(list,manager){
  const ids=new Set(list.map((bus)=>bus.id));
  const records=(historyRecords || model.records).filter((row)=>ids.has(row.busId)).filter((row)=>tab!=="history"||!manager||["complete","approve","return"].includes(row.action));
  byId("yardContent").innerHTML=recordsTable(records,manager)+(historyRecords?"":'<p class="yard-hint strip">Showing the latest 150 fleet updates. Open a bus and select Full Bus History for its older records.</p>');
}
function wireRecordButtons(){root.querySelectorAll("[data-yard-record]").forEach((button)=>button.onclick=()=>{const row=(historyRecords || model.records).find((record)=>record.id===button.dataset.yardRecord)||model.records.find((record)=>record.id===button.dataset.yardRecord);if(row)openRecord(row);});}
function openBus(id){
  const bus=model.fleet.find((item)=>item.id===id);if(!bus)return;
  const manager=root.dataset.mode==="manager"&&model.person.manager;
  dialog(`Bus ${bus.fleetNumber} · ${bus.depot || "No depot"}`,`<div class="yard-job-options">${["exterior","interior"].map((type)=>{
    const task=bus.yard[type] || {},own=task.active?.uid===model.person.uid;
    return `<section class="yard-option"><h3>${TASK_LABELS[type]}</h3>${pill(cleaningState(task,model.today))}<p class="yard-hint">Last approved clean: ${esc(fmtDate(task.lastDate))}${task.lastDate?` · Next due: ${esc(fmtDate(dateAdd(task.lastDate,7)))}`:""}${task.lastBy?` · ${esc(task.lastBy.name)}`:""}</p>${task.active?`<p class="yard-text">In progress by ${esc(task.active.name)} · ${esc(fmtTime(task.active.startedAt))}</p>`:""}${task.reviewNotes?`<div class="yard-task-note">Manager: ${esc(task.reviewNotes)}</div>`:""}<div class="yard-actions">${!task.active&&!task.pending?`<button class="button primary" type="button" data-start="${type}">Start ${TASK_LABELS[type]}</button>`:""}${own?`<button class="button primary" type="button" data-complete="${type}">Complete Checklist</button>`:""}${task.active&&(own||manager)?`<button class="button secondary" type="button" data-release="${type}">Release / Unable to Continue</button>`:""}${task.pending?`<button class="button ${manager?"primary":"secondary"}" type="button" data-review-id="${esc(task.pending.id)}">${manager?"Review Completion":"View Submitted Work"}</button>`:""}${manager?`<button class="button secondary" type="button" data-priority="${type}">${task.priority?"Clear":"Set"} Priority</button>`:""}</div></section>`;
  }).join("")}<section class="yard-option"><h3>Daily Checks</h3>${pill(checkState(bus.yard.checks,model.today))}<div class="yard-actions"><button id="yardOpenChecks" class="button primary" type="button">Open Daily Checks</button>${bus.yard.checks?.id?'<button id="yardViewCheck" class="button secondary" type="button">View Last Check</button>':""}</div></section><div class="yard-actions"><button id="yardUnavailable" class="button secondary" type="button">Bus Not in Yard</button><button id="yardBusHistory" class="button secondary" type="button">Full Bus History</button></div></div>`);
  byId("yardModalContent").querySelectorAll("[data-start]").forEach((button)=>button.onclick=()=>mutate({busId:id,type:button.dataset.start,action:"start"},()=>openBus(id)));
  byId("yardModalContent").querySelectorAll("[data-complete]").forEach((button)=>button.onclick=()=>completion(bus,button.dataset.complete));
  byId("yardModalContent").querySelectorAll("[data-release]").forEach((button)=>button.onclick=()=>reasonForm(bus,button.dataset.release,"release","Why are you releasing this task?"));
  byId("yardModalContent").querySelectorAll("[data-priority]").forEach((button)=>button.onclick=()=>mutate({busId:id,type:button.dataset.priority,action:"priority",urgent:!bus.yard[button.dataset.priority]?.priority},()=>openBus(id)));
  byId("yardModalContent").querySelectorAll("[data-review-id]").forEach((button)=>button.onclick=()=>loadRecord(bus.id,button.dataset.reviewId));
  byId("yardOpenChecks").onclick=()=>checks(bus);
  if(byId("yardViewCheck"))byId("yardViewCheck").onclick=()=>loadRecord(bus.id,bus.yard.checks.id);
  byId("yardUnavailable").onclick=()=>reasonForm(bus,"checks","unavailable","Why is this bus unavailable in your yard?");
  byId("yardBusHistory").onclick=()=>busHistory(bus);
}
const photoInput=()=>'<label>Add photos (optional)<input id="yardPhotoFiles" type="file" accept="image/jpeg,image/png,image/webp" multiple /></label><p class="yard-hint">Up to 3 photos. Photos are resized for uploading.</p>';
function completion(bus,type){
  dialog(`${bus.fleetNumber} · ${TASK_LABELS[type]}`,`<form id="yardCompleteForm" class="yard-form"><p class="yard-hint">Performed by ${esc(model.person.name)}. Complete every item and submit for Fleet Manager approval.</p>${(model.checklists[type] || []).map((label)=>`<label class="yard-check"><input type="checkbox" name="yardChecklist" value="${esc(label)}" required />${esc(label)}</label>`).join("")}<label>Actual completion date<input id="yardCompletedDate" type="date" value="${model.today}" max="${model.today}" required /></label><label>Completion notes / problems<textarea id="yardNotes" maxlength="2000"></textarea></label>${photoInput()}<div class="yard-actions"><button class="button primary" type="submit">Submit for Approval</button></div></form>`);
  byId("yardCompleteForm").onsubmit=(event)=>{event.preventDefault();mutate({busId:bus.id,type,action:"complete",completedDate:val("yardCompletedDate"),notes:val("yardNotes"),checklist:[...byId("yardCompleteForm").querySelectorAll("[name=yardChecklist]:checked")].map((node)=>node.value)},null,true);};
}
function selectInput(id,label,items,selected=""){return `<label>${label}<select id="${id}" required><option value="">Select result</option>${items.map((item)=>`<option ${selected===item?"selected":""}>${esc(item)}</option>`).join("")}</select></label>`;}
function checks(bus){
  dialog(`${bus.fleetNumber} · Daily Bus Checks`,`<form id="yardCheckForm" class="yard-form"><p class="yard-hint">Record your actual observations. Applicable checks follow this bus’s fleet configuration.</p><div class="yard-form-grid">${bus.oilCheckApplicable?selectInput("yardOil","Oil level",["OK","Low","Unable to check"]):'<label>Oil level<input value="Not applicable" disabled /></label>'}${bus.coolantCheckApplicable?selectInput("yardCoolant","Coolant level",["OK","Low","Unable to check"]):'<label>Coolant level<input value="Not applicable" disabled /></label>'}${selectInput("yardTyres","Tyre condition",["OK","Problem","Unable to check"])}<label>Check date<input id="yardCompletedDate" type="date" max="${model.today}" value="${model.today}" required /></label>${bus.electric?'<label>Battery charge (%)<input id="yardCharge" type="number" min="0" max="100" step="1" required /></label>'+selectInput("yardCharging","Charging status",["Charging","Not connected","Charge complete","Unable to check"]):""}</div><label>Notes / problem details<textarea id="yardNotes" maxlength="2000" placeholder="Required for Low, Problem or Unable to check"></textarea></label>${photoInput()}<div class="yard-actions"><button class="button primary" type="submit">Submit Check Update</button></div></form>`);
  byId("yardCheckForm").onsubmit=(event)=>{event.preventDefault();mutate({busId:bus.id,type:"checks",action:"checks",oilLevel:val("yardOil"),coolantLevel:val("yardCoolant"),tyres:val("yardTyres"),completedDate:val("yardCompletedDate"),charge:bus.electric?val("yardCharge"):null,chargingStatus:val("yardCharging"),notes:val("yardNotes")},null,true);};
}
function reasonForm(bus,type,action,label,recordId){
  dialog(`${bus.fleetNumber} · ${label}`,`<form id="yardReasonForm" class="yard-form"><label>${esc(label)}<textarea id="yardReason" maxlength="2000" required></textarea></label><div class="yard-actions"><button type="submit" class="button primary">${action==="return"?"Return Work":"Save Update"}</button></div></form>`);
  byId("yardReasonForm").onsubmit=(event)=>{event.preventDefault();mutate({busId:bus.id,type,action,recordId,notes:val("yardReason")});};
}
function photosHtml(photos){return `<div class="yard-photos">${(photos || []).filter((photo)=>/^https:\/\//.test(photo.url)).map((photo)=>`<a target="_blank" rel="noopener" href="${esc(photo.url)}"><img src="${esc(photo.url)}" alt="${esc(photo.name || "Yard photo")}" /></a>`).join("")}</div>`;}
function openRecord(record){
  const bus=model.fleet.find((row)=>row.id===record.busId),manager=root.dataset.mode==="manager"&&model.person.manager;
  dialog(`${record.fleetNumber} · ${TASK_LABELS[record.type] || "Update"}`,`<div class="yard-details"><h3>${esc(actionLabel(record))}</h3><dl><div><dt>Performed by</dt><dd>${esc(record.actor?.name)} (${esc(record.actor?.employeeNumber)})</dd></div><div><dt>Recorded at</dt><dd>${esc(fmtTime(record.createdAt))}</dd></div><div><dt>Actual completion date</dt><dd>${esc(fmtDate(record.performedDate))}</dd></div><div><dt>Status</dt><dd>${statusPill(record.status)}</dd></div></dl></div>${record.checklist?`<h3>Completed checklist</h3><ul>${record.checklist.map((item)=>`<li>${esc(item)}</li>`).join("")}</ul>`:""}${record.action==="checks"?`<h3>Check results</h3><div class="yard-text">Oil: ${esc(record.oilLevel)}\nCoolant: ${esc(record.coolantLevel)}\nTyres: ${esc(record.tyres)}${record.charge!=null?`\nEV charge: ${record.charge}% · ${esc(record.chargingStatus)}`:""}</div>${record.problem?'<div class="yard-task-note">Problem reported. Manager review does not itself clear a defect or authorise return to service.</div>':""}`:""}<h3>Notes</h3><div class="yard-text">${esc(record.notes || "No notes")}</div>${photosHtml(record.photos)}${record.review?`<h3>Fleet Manager review</h3><div class="yard-text">${esc(record.review.name)} · ${esc(fmtTime(record.review.reviewedAt))}\n${esc(record.review.notes || "")}</div>`:""}${manager&&["Waiting Approval","Needs Review"].includes(record.status)?`<div class="yard-form"><label>Manager review notes<textarea id="yardReviewNotes" maxlength="2000"></textarea></label><div class="yard-actions">${record.status==="Waiting Approval"?'<button id="yardReturn" type="button" class="button secondary">Return for Further Work</button><button id="yardApprove" type="button" class="button primary">Approve Cleaning</button>':'<button id="yardAcknowledge" type="button" class="button primary">Mark Reviewed</button>'}</div></div>`:""}`);
  if(byId("yardApprove"))byId("yardApprove").onclick=()=>mutate({busId:record.busId,type:record.type,action:"approve",recordId:record.id,notes:val("yardReviewNotes")});
  if(byId("yardReturn"))byId("yardReturn").onclick=()=>{const reason=val("yardReviewNotes");if(!reason)return msg("Explain the work still required before returning it.",true,true);mutate({busId:record.busId,type:record.type,action:"return",recordId:record.id,notes:reason});};
  if(byId("yardAcknowledge"))byId("yardAcknowledge").onclick=()=>mutate({busId:record.busId,type:"checks",action:"acknowledge",recordId:record.id,notes:val("yardReviewNotes")});
}
async function loadRecord(busId,id){try{const result=await yardCall("History",{busId}),row=result.records.find((record)=>record.id===id);if(!row)throw new Error("This record was not found.");openRecord(row);}catch(error){msg(error.message,true,true);}}
async function busHistory(bus){
  try{const result=await yardCall("History",{busId:bus.id});dialog(`${bus.fleetNumber} · Full Bus History`,`<ul class="yard-activity">${result.records.map((row)=>`<li><strong>${esc(actionLabel(row))} · ${esc(TASK_LABELS[row.type])}</strong><div class="yard-hint">${esc(row.actor?.name)} · ${esc(fmtTime(row.createdAt))} · ${esc(row.status || "Recorded")}</div><button class="button secondary" type="button" data-history-id="${esc(row.id)}">View Details</button></li>`).join("") || '<li>No history yet.</li>'}</ul>`);byId("yardModalContent").querySelectorAll("[data-history-id]").forEach((button)=>button.onclick=()=>openRecord(result.records.find((row)=>row.id===button.dataset.historyId)));}catch(error){msg(error.message,true,true);}
}
async function photoData(){
  const files=[...(byId("yardPhotoFiles")?.files || [])];if(files.length>3)throw new Error("Choose no more than 3 photos.");
  const output=[];
  for(const file of files){
    if(!["image/jpeg","image/png","image/webp"].includes(file.type)||file.size>15*1024*1024)throw new Error("Use JPG, PNG or WebP images smaller than 15 MB.");
    const bitmap=await createImageBitmap(file),ratio=Math.min(1,1400/Math.max(bitmap.width,bitmap.height));
    const canvas=document.createElement("canvas");canvas.width=Math.max(1,Math.round(bitmap.width*ratio));canvas.height=Math.max(1,Math.round(bitmap.height*ratio));const ctx=canvas.getContext("2d");ctx.fillStyle="#fff";ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();
    let base64=canvas.toDataURL("image/jpeg",0.8).split(",")[1];if(base64.length>1400000)base64=canvas.toDataURL("image/jpeg",0.55).split(",")[1];if(base64.length>1400000)throw new Error("This photo is too large. Choose a smaller image.");output.push({base64,contentType:"image/jpeg",name:file.name});
  }
  return output;
}
async function mutate(data,after=null,withPhotos=false){
  if(busy)return;const version=authVersion;
  try{setBusy(true);msg("Saving update…",false,true);if(withPhotos)data.photos=await photoData();if(version!==authVersion)throw new Error("Your sign-in changed. Reopen this page.");await yardCall("Update",data);if(version!==authVersion)return;await refresh(false);if(after){after();msg("Update saved.",false,true);}else{byId("yardModal")?.close();msg("Yard update saved successfully.");}}
  catch(error){msg(error.message || "Unable to save your update.",true,true);}finally{setBusy(false);}
}
async function refresh(showMessage=false){
  const version=authVersion;if(loadingVersion===version)return;loadingVersion=version;
  try{const result=await yardCall("Board");if(version!==authVersion)return;
    if(root.dataset.mode==="manager"&&!result.person.manager)throw new Error("Fleet Manager access is required for this page.");
    model=result;lastUpdated=new Date().toLocaleTimeString("en-AU");if(!byId("yardContent"))shell();render();
    if(standalone){byId("yardIdentity").textContent=result.person.name;byId("yardManagerLink").hidden=!result.person.manager;}
    if(showMessage)msg("Fleet updates refreshed.");
  }catch(error){if(version!==authVersion)return;
    const message=error.message || "Unable to load Yard Work.";
    if(model){msg(`${message} Displayed data may be out of date.`,true);byId("yardUpdated").textContent=`Refresh failed · Last successful refresh ${lastUpdated}`;}
    else root.innerHTML=`<div class="yard-error"><strong>Yard Work is unavailable</strong><p>${esc(message)}</p><p>For this development branch, the isolated Yard functions must be configured locally before testing.</p><button id="yardRetry" class="button secondary" type="button">Try Again</button></div>`;
    if(byId("yardRetry"))byId("yardRetry").onclick=()=>refresh(true);
  }finally{if(loadingVersion===version)loadingVersion=null;}
}
if(root){
  if(standalone){byId("yardSignIn").onclick=()=>signInWithPopup(yardAuth,yardProvider).catch((error)=>{root.textContent=error.message;});byId("yardSignOut").onclick=()=>signOut(yardAuth);}
  onAuthStateChanged(yardAuth,async(user)=>{
    authVersion++;clearInterval(poll);poll=null;model=null;historyRecords=null;tab="fleet";lastUpdated="";byId("yardModal")?.close();
    if(standalone){byId("yardSignIn").hidden=Boolean(user);byId("yardSignOut").hidden=!user;byId("yardManagerLink").hidden=true;byId("yardIdentity").textContent=user?"Checking employee access…":"Not signed in";}
    root.innerHTML=`<div class="yard-empty">${user?"Loading fleet and employee access…":"Sign in with your own employee account to use Yard Work."}</div>`;
    if(!user)return;const version=authVersion;await refresh();if(version!==authVersion)return;
    poll=setInterval(()=>{if(document.visibilityState==="visible"&&!busy&&(standalone||byId("yardView")?.classList.contains("active")))refresh();},20000);
  });
  document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible"&&yardAuth.currentUser&&!busy)refresh();});
  window.addEventListener("pagehide",()=>clearInterval(poll));
}
