import {collection,doc,query,where,limit,onSnapshot,serverTimestamp,writeBatch} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";
import {onAuthStateChanged,signInWithPopup,signOut} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-auth.js";
import {auth,db,provider} from "./firebase.js";
import {ADMIN_EMAILS} from "./config.js";
import {normalizeEmail,escapeHtml} from "./utils.js";

const el=(id)=>document.getElementById(id);const val=(id)=>String(el(id)?.value||"").trim();const set=(id,v)=>{if(el(id))el(id).value=v??"";};
let user=null,enquiries=[],employees=[],selectedId=null,unsubscribeActivity=null,saving=false;
let unsubscribers=[];
const today=()=>new Date().toISOString().slice(0,10);
const allowed=(email)=>ADMIN_EMAILS.map(normalizeEmail).includes(normalizeEmail(email));
const norm=(v)=>String(v||"").toLowerCase().replace(/\s+/g," ").trim();
const isOverdue=(item)=>item.status!=="Closed"&&item.followUpDate&&item.followUpDate<today();

function status(message,type="success"){el("status").className=`notice ${type}`;el("status").innerHTML=`<strong>${type==="success"?"Saved":"Action required"}</strong><span>${escapeHtml(message)}</span>`;}
function clearStatus(){el("status").className="notice";el("status").innerHTML="";}
function dateLabel(value){if(!value)return"Date pending";const d=new Date(`${value}T00:00:00`);return Number.isNaN(d.getTime())?value:new Intl.DateTimeFormat("en-AU",{day:"2-digit",month:"short",year:"numeric"}).format(d);}
function customerName(item){return item.organisationName||item.customer?.organisationName||item.contactName||item.customer?.contactName||"Unnamed customer";}
function field(item,key,nested){return item[key]??item.trip?.[nested||key]??"";}

function renderStats(){
  const active=enquiries.filter((i)=>!i.deleted);
  el("statNew").textContent=active.filter((i)=>(i.status||"New")==="New").length;
  el("statWaiting").textContent=active.filter((i)=>i.status==="Waiting for information").length;
  el("statReady").textContent=active.filter((i)=>i.status==="Ready to quote").length;
  el("statFollowUp").textContent=active.filter((i)=>i.status==="Quote follow-up").length;
  el("statOverdue").textContent=active.filter(isOverdue).length;
}

function filtered(){
  const search=norm(val("search")),statusValue=val("statusFilter"),source=val("sourceFilter"),owner=val("ownerFilter"),follow=val("followUpFilter");
  return enquiries.filter((i)=>!i.deleted).filter((i)=>statusValue?(i.status||"New")===statusValue:(i.status||"New")!=="Closed").filter((i)=>!source||(i.source||i.channel)===source).filter((i)=>!owner||normalizeEmail(i.assignedToEmail)===owner).filter((i)=>{
    if(!follow)return true;if(follow==="overdue")return isOverdue(i);if(follow==="today")return i.followUpDate===today();if(follow==="upcoming")return i.followUpDate>today();return !i.followUpDate;
  }).filter((i)=>!search||norm([i.reference,i.id,customerName(i),i.contactName,i.phone,i.email,i.pickupLocation,i.destination,i.notes].join(" ")).includes(search)).sort((a,b)=>{
    if(isOverdue(a)!==isOverdue(b))return isOverdue(a)?-1:1;
    return String(b.createdAt?.seconds||b.serviceDate||"").localeCompare(String(a.createdAt?.seconds||a.serviceDate||""));
  });
}

function renderList(){
  renderStats();const items=filtered();el("resultCount").textContent=`${items.length} result${items.length===1?"":"s"}`;
  if(!items.length){el("enquiryList").innerHTML=`<div class="empty">No enquiries match these filters.</div>`;return;}
  el("enquiryList").innerHTML=items.map((i)=>`<button class="item ${selectedId===i.id?"active":""}" data-id="${escapeHtml(i.id)}" type="button"><span class="item-top"><strong>${escapeHtml(i.reference||i.id)}</strong><span class="badge ${isOverdue(i)?"overdue":""}">${escapeHtml(isOverdue(i)?"Overdue":i.status||"New")}</span></span><h3>${escapeHtml(customerName(i))}</h3><p>${escapeHtml(i.pickupLocation||"Pickup pending")} → ${escapeHtml(i.destination||"Destination pending")}</p><span class="item-foot"><b>${escapeHtml(dateLabel(i.serviceDate))}${i.pickupTime?` · ${escapeHtml(i.pickupTime)}`:""}</b><span>${escapeHtml(i.source||"Other")} · ${escapeHtml(i.assignedToName||i.assignedToEmail||"Unassigned")}</span></span></button>`).join("");
  el("enquiryList").querySelectorAll("[data-id]").forEach((b)=>b.onclick=()=>selectEnquiry(b.dataset.id));
}

function staffOptions(selected=""){
  return employees.map((i)=>`<option value="${escapeHtml(normalizeEmail(i.email))}" data-name="${escapeHtml(i.displayName||i.email)}" ${normalizeEmail(i.email)===normalizeEmail(selected)?"selected":""}>${escapeHtml(i.displayName||i.email)}</option>`).join("");
}
function populateStaff(){
  const filter=val("ownerFilter"),editor=val("editOwner");
  el("ownerFilter").innerHTML=`<option value="">All staff</option>${staffOptions(filter)}`;
  el("editOwner").innerHTML=staffOptions(editor||user?.email||"");
}

function selectEnquiry(id){
  const i=enquiries.find((x)=>x.id===id);if(!i)return;selectedId=id;clearStatus();el("detailWelcome").hidden=true;el("detailForm").hidden=false;
  el("detailSource").textContent=i.source||i.channel||"Enquiry";el("detailReference").textContent=i.reference||i.id;el("detailSummary").textContent=`${customerName(i)} · ${dateLabel(i.serviceDate)}`;
  el("openCustomerBtn").href=i.organisationId?`./customers.html?organisationId=${encodeURIComponent(i.organisationId)}`:"./customers.html";
  set("editStatus",i.status||"New");set("editPriority",i.priority||"Normal");set("editSource",i.source||i.channel||"Phone");populateStaff();set("editOwner",i.assignedToEmail||user.email);set("editFollowUp",i.followUpDate);
  set("editOrganisation",i.organisationName||i.customer?.organisationName);set("editContact",i.contactName||i.customer?.contactName);set("editPhone",i.phone||i.customer?.phone);set("editEmail",i.email||i.customer?.email);
  set("editJourneyType",field(i,"journeyType"));set("editPassengers",field(i,"passengerCount"));set("editVehicle",field(i,"vehiclePreference","vehicleRequirements"));set("editDate",field(i,"serviceDate","outwardDate"));set("editTime",field(i,"pickupTime","outwardTime"));set("editReturnDate",field(i,"returnDate"));set("editReturnTime",field(i,"returnTime"));set("editPickup",field(i,"pickupLocation"));set("editDestination",field(i,"destination"));set("editStops",Array.isArray(i.stops)?i.stops.join("\n"):i.stops||i.trip?.stops?.join("\n")||"");set("editSpecial",field(i,"specialRequirements","specialInstructions"));set("editNotes",i.notes);
  el("lastUpdated").textContent=i.updatedByEmail?`Last updated by ${i.updatedByEmail}`:"Changes are recorded in activity history.";listenActivity(id);renderList();
}

function listenActivity(id){
  unsubscribeActivity?.();unsubscribeActivity=onSnapshot(query(collection(db,"enquiryActivities"),where("enquiryId","==",id),limit(100)),(snapshot)=>{
    const rows=snapshot.docs.map((d)=>d.data()).sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));
    el("activityList").innerHTML=rows.length?rows.map((a)=>`<div class="activity"><strong>${escapeHtml(a.summary||"Enquiry updated")}</strong><small>${escapeHtml(a.createdByName||a.createdByEmail||"Staff")}${a.createdAt?.toDate?` · ${escapeHtml(a.createdAt.toDate().toLocaleString("en-AU"))}`:""}</small></div>`).join(""):`<div class="empty">No activity recorded yet.</div>`;
  },()=>{el("activityList").innerHTML=`<div class="empty">Activity history is unavailable.</div>`;});
}

function payload(){
  const owner=el("editOwner").selectedOptions[0],stops=val("editStops").split("\n").map((x)=>x.trim()).filter(Boolean),passengers=val("editPassengers")?Number(val("editPassengers")):null;
  return{status:val("editStatus"),priority:val("editPriority"),source:val("editSource"),channel:val("editSource"),assignedToEmail:normalizeEmail(val("editOwner")),assignedToName:owner?.dataset.name||owner?.textContent||val("editOwner"),followUpDate:val("editFollowUp"),organisationName:val("editOrganisation"),contactName:val("editContact"),phone:val("editPhone"),email:normalizeEmail(val("editEmail")),journeyType:val("editJourneyType"),passengerCount:passengers,vehiclePreference:val("editVehicle"),serviceDate:val("editDate"),pickupTime:val("editTime"),returnDate:val("editReturnDate"),returnTime:val("editReturnTime"),pickupLocation:val("editPickup"),destination:val("editDestination"),stops,specialRequirements:val("editSpecial"),notes:val("editNotes"),customer:{organisationName:val("editOrganisation"),contactName:val("editContact"),phone:val("editPhone"),email:normalizeEmail(val("editEmail"))},trip:{journeyType:val("editJourneyType"),passengerCount:passengers,vehicleRequirements:val("editVehicle"),outwardDate:val("editDate"),outwardTime:val("editTime"),returnDate:val("editReturnDate"),returnTime:val("editReturnTime"),pickupLocation:val("editPickup"),destination:val("editDestination"),stops,specialInstructions:val("editSpecial")},updatedAt:serverTimestamp(),updatedByEmail:normalizeEmail(user.email)};
}

async function save(event){
  event.preventDefault();if(saving||!selectedId)return;if(!val("editContact")||!val("editDate")||!val("editPickup")||!val("editDestination")){status("Contact, date, pickup and destination are required.","error");return;}
  saving=true;el("saveBtn").disabled=true;el("saveBtn").innerHTML=`<span class="spinner"></span> Saving…`;
  try{const current=enquiries.find((i)=>i.id===selectedId),data=payload(),batch=writeBatch(db),activityRef=doc(collection(db,"enquiryActivities"));batch.set(doc(db,"enquiries",selectedId),data,{merge:true});batch.set(activityRef,{enquiryId:selectedId,organisationId:current?.organisationId||null,summary:`${current?.status||"New"} → ${data.status}; enquiry details updated`,createdAt:serverTimestamp(),createdByEmail:normalizeEmail(user.email),createdByName:user.displayName||user.email});await batch.commit();status(`${current?.reference||selectedId} was updated successfully.`);}catch(error){status(error?.message||"Unable to update the enquiry.","error");}finally{saving=false;el("saveBtn").disabled=false;el("saveBtn").textContent="Save changes";}
}

["search","statusFilter","sourceFilter","ownerFilter","followUpFilter"].forEach((id)=>el(id).addEventListener(id==="search"?"input":"change",renderList));el("detailForm").addEventListener("submit",save);el("loginBtn").onclick=()=>signInWithPopup(auth,provider);el("logoutBtn").onclick=()=>signOut(auth);
function start(){unsubscribers.forEach((u)=>u());unsubscribers=[onSnapshot(query(collection(db,"enquiries"),limit(1000)),(s)=>{enquiries=s.docs.map((d)=>({id:d.id,...d.data()}));renderList();if(selectedId)selectEnquiry(selectedId);},(e)=>status(e.message,"error")),onSnapshot(query(collection(db,"employees"),limit(300)),(s)=>{employees=s.docs.map((d)=>d.data()).filter((i)=>i.deleted!==true&&i.status!=="Inactive"&&i.email).sort((a,b)=>String(a.displayName||a.email).localeCompare(String(b.displayName||b.email)));populateStaff();},()=>{})];}
onAuthStateChanged(auth,(u)=>{user=u;const ok=u&&allowed(u.email);el("authText").textContent=u?(u.displayName||u.email):"Not signed in";el("loginBtn").hidden=!!u;el("logoutBtn").hidden=!u;if(!ok){unsubscribers.forEach((x)=>x());unsubscribers=[];unsubscribeActivity?.();el("enquiryList").innerHTML=`<div class="empty">${u?"Administrator access is required.":"Sign in to load enquiries."}</div>`;if(u)status("Your account does not have enquiry-management access.","error");}else{clearStatus();start();}});
