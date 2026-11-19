import {httpsCallable} from 'https://www.gstatic.com/firebasejs/12.9.0/firebase-functions.js';
import {functions} from './firebase.js';
import {escapeHtml} from './utils.js';
const labels={accepted:'Firebase accepted',partial:'Partly accepted',failed:'Failed',skipped:'Skipped',retrying:'Retry pending',processing:'Processing',expired:'Expired',unknown:'No detailed result'};
const events={assigned:'New duty',updated:'Duty changed',cancelled:'Duty cancelled',withdrawn:'Returned to Pending',removed:'Duty removed','reassigned-away':'Duty moved away','reassigned-to':'Duty transferred','job-added':'Job added','job-removed':'Job removed','job-updated':'Job changed',general:'General message',defect:'Defect alert'};
const reasons={'no-device':'No registered device','employee-inactive':'Employee inactive','employee-not-found':'Employee record missing','stale-event':'Superseded by a later change','device-account-changed':'Device now belongs to another account','retry-limit':'Retry limit reached','event-window-expired':'24-hour retry window ended'};
function activityDate(ms){return new Intl.DateTimeFormat('en-CA',{timeZone:'Australia/Sydney',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(ms));}
function time(ms){return ms?new Intl.DateTimeFormat('en-AU',{timeZone:'Australia/Sydney',dateStyle:'short',timeStyle:'short'}).format(new Date(ms)):'Not recorded';}
export function filterDeliveryRows(rows,{driver='',date='',status=''}={}){
 const search=driver.trim().toLowerCase();
 return rows.filter(row=>(!search||[row.employeeNumber,row.driverName].join(' ').toLowerCase().includes(search))&&(!date||(row.timestamp&&activityDate(row.timestamp)===date))&&(!status||row.status===status));
}
export function mountNotificationDeliveryLog(root){
 if(!root)return;
 root.innerHTML=`<summary><strong>Notification delivery activity</strong><span>View results and retry progress</span></summary><div class="notification-log-content">
 <p>Firebase acceptance does not confirm phone delivery or that the driver read the alert.</p>
 <div class="notification-log-filters"><label>Category<select data-log-kind><option value="duty">Duty &amp; job alerts</option><option value="general">General messages</option><option value="defect">Defect alerts</option></select></label><label>Driver name / number<input data-log-driver type="search" placeholder="All drivers" /></label><label>Activity date (Sydney)<input data-log-date type="date" /></label><label>Result<select data-log-status><option value="">All results</option>${Object.entries(labels).map(([v,label])=>`<option value="${v}">${label}</option>`).join('')}</select></label><button type="button" data-log-refresh>Refresh activity</button><button type="button" class="btn" data-log-clear>Clear filters</button></div>
 <p class="muted">Most recent 100 events per category. Filters apply to loaded activity. General and defect logs show aggregate device results.</p>
 <div data-log-message role="status" aria-live="polite">Open this section to load activity.</div><div class="notification-log-table"><table><thead><tr><th>Activity (Sydney)</th><th>Recipient</th><th>Alert</th><th>Duty / reference</th><th>Result</th><th>Devices</th><th>Details</th></tr></thead><tbody data-log-rows></tbody></table></div></div>`;
 const q=s=>root.querySelector(s),kind=q('[data-log-kind]'),driver=q('[data-log-driver]'),date=q('[data-log-date]'),status=q('[data-log-status]'),refresh=q('[data-log-refresh]'),message=q('[data-log-message]');
 let rows=[],eventCount=0,request=0,loaded=false,loading=false;
 function render(){
  const list=filterDeliveryRows(rows,{driver:driver.value,date:date.value,status:status.value});
  if(!loading)message.textContent=`${list.length} recipient result${list.length===1?'':'s'} shown · ${eventCount} recent events loaded`;
  q('[data-log-rows]').innerHTML=list.length?list.map(row=>{
   const detail=[reasons[row.reason]||row.reason,row.attempts?`${row.attempts} attempt${row.attempts===1?'':'s'}`:'',row.status==='retrying'&&row.nextAttemptAt?`Next attempt after ${time(row.nextAttemptAt)}`:''].filter(Boolean).join(' · ');
   const reference=escapeHtml(row.dutyNumber||row.dutySpanId||'—');
   return `<tr><td>${escapeHtml(time(row.timestamp))}</td><td><strong>${escapeHtml(row.driverName||row.employeeNumber||'—')}</strong>${row.employeeNumber?`<small>Emp ${escapeHtml(row.employeeNumber)}</small>`:''}</td><td>${escapeHtml(events[row.eventType]||row.eventType)}</td><td>${row.dutySpanId?`<a href="?page=dutySheet&amp;dutySpanId=${encodeURIComponent(row.dutySpanId)}" target="_blank" rel="noopener">${reference}</a>`:reference}${row.serviceDate?`<small>${escapeHtml(row.serviceDate)}</small>`:''}</td><td><span class="notification-result ${escapeHtml(row.status)}">${escapeHtml(labels[row.status]||labels.unknown)}</span></td><td>${row.acceptedDevices||0} accepted${row.failedDevices?`<small>${row.failedDevices} failed</small>`:''}</td><td>${escapeHtml(detail||'—')}${row.errorCode?`<small>${escapeHtml(row.errorCode)}</small>`:''}</td></tr>`;
  }).join(''):'<tr><td colspan="7">No results match these filters.</td></tr>';
 }
 async function load(){
  const version=++request;loading=true;refresh.disabled=true;message.textContent='Loading notification activity…';rows=[];q('[data-log-rows]').innerHTML='';
  try{
   const response=await httpsCallable(functions,'getNotificationDeliveryLog')({kind:kind.value,limit:100});
   if(version!==request||!root.isConnected)return;
   rows=Array.isArray(response.data?.rows)?response.data.rows:[];eventCount=response.data?.eventCount||0;loaded=true;loading=false;render();
  }catch(error){if(version===request&&root.isConnected){rows=[];loaded=false;message.textContent=error?.message||'Unable to load notification activity. Try Refresh activity.';}}
  finally{if(version===request){loading=false;refresh.disabled=false;}}
 }
 refresh.onclick=load;
 kind.onchange=()=>{driver.value='';driver.disabled=kind.value!=='duty';load();};
 for(const field of [driver,date,status])field.addEventListener(field===driver?'input':'change',render);
 q('[data-log-clear]').onclick=()=>{driver.value='';date.value='';status.value='';render();};
 root.addEventListener('toggle',()=>{if(root.open&&!loaded&&!loading)load();});
}
