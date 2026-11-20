import {createOfflineStore} from './offline_driver_store.js';
let storage;try{storage=localStorage;}catch{storage={getItem:()=>null,removeItem:()=>{}};}
const store=createOfflineStore(storage);
const root=document.getElementById('savedWork');
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const time=value=>Number.isFinite(Number(value))?`${String(Math.floor(Number(value)/60)).padStart(2,'0')}:${String(Number(value)%60).padStart(2,'0')}`:'—';
const stamp=value=>new Date(value).toLocaleString('en-AU',{timeZone:'Australia/Sydney',dateStyle:'medium',timeStyle:'short'});
function render(){
 const data=store.read();
 if(!data){root.innerHTML='<div class="card"><h2>No saved driver work</h2><p>Connect to the internet, sign in as a driver and open My Work. Open each duty sheet online to save its job details. Copies expire after 72 hours and are removed on sign-out or account change.</p></div>';return;}
 root.innerHTML=`<p><strong>${esc(data.duties[0]?.driverName||'Driver')} · Employee ${esc(data.employeeNumber)}</strong></p><p>Roster last synced: ${esc(stamp(data.savedAt))} (Sydney). Only previously opened duty sheets include saved job details. PDFs and attachments are not saved.</p>${data.duties.length?'':'<div class="card">No published duties in the last downloaded roster.</div>'}`+data.duties.slice().sort((a,b)=>a.serviceDate.localeCompare(b.serviceDate)||a.startMin-b.startMin).map(duty=>{
 const details=data.details?.[duty.id];const cancelled=duty.dispatchStatus==='Cancelled';
 return `<article class="card ${cancelled?'cancelled':''}"><h2>${esc(duty.serviceDate)} · ${esc(duty.dutyNumber||duty.dutyType||'Duty')}</h2><p><strong>${time(duty.startMin)}–${time(duty.endMin)}</strong> · Bus ${esc(duty.assignedBus||'Unassigned')} · ${esc(duty.dispatchStatus)} (saved status)</p><p>${esc(duty.routeNumber||'')} ${esc(duty.startLocation||'')} ${duty.endLocation?'→ '+esc(duty.endLocation):''}</p>${cancelled?'<p><strong>This duty was cancelled at the last sync.</strong></p>':details?`<details><summary>Saved job details (${details.jobs.length} job sections)</summary><p class="muted">Details saved: ${esc(stamp(details.savedAt))} (Sydney)</p>${details.jobs.map((job,i)=>`<section class="card"><h3>${i+1}. ${esc(job.name||'Assigned job')}</h3><p>${esc(job.direction||'')} ${time(job.startMin)}–${time(job.endMin)}</p><p>${esc(job.from)} → ${esc(job.to)}</p>${job.stops.length?`<ol>${job.stops.map(s=>`<li>${time(s.startMin)} ${esc(s.from)} → ${time(s.endMin)} ${esc(s.to)}</li>`).join('')}</ol>`:''}</section>`).join('')}${!details.jobs.length?'<p>No assigned jobs were present when this duty sheet was saved.</p>':''}</details>`:'<p><strong>Job details not downloaded.</strong> Open this duty sheet online before relying on it offline.</p>'}${duty.breaks.length?`<h3>Scheduled breaks</h3><ul>${duty.breaks.map(b=>`<li>${time(b.startMin)}–${time(b.endMin)} · ${esc(b.type||'Break')} ${esc(b.location||'')}</li>`).join('')}</ul>`:''}<small>Scheduled times only. Take required rest and contact Dispatch if you cannot complete the duty safely.</small></article>`;
 }).join('');
}
document.getElementById('removeCopy').addEventListener('click',()=>{store.clear();render();});
document.getElementById('liveLink').addEventListener('click',event=>{if(navigator.onLine===false){event.preventDefault();root.insertAdjacentHTML('afterbegin','<p role="alert">Reconnect before opening live My Work.</p>');}});
window.addEventListener('storage',render);
window.addEventListener('pageshow',render);
render();
