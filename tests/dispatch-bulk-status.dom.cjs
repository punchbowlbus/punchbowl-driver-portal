const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const {JSDOM}=require(process.env.JSDOM_MODULE||'jsdom');
const dom=new JSDOM('<div id="contentArea"></div><div id="errorArea"></div>',{url:'https://dispatch.test',runScripts:'outside-only',pretendToBeVisual:true});
const w=dom.window, c=dom.getInternalVMContext();
const employees=['Alpha','Beta','No duty'].map((displayName,i)=>({displayName,employeeNumber:String(i+1),role:'Driver',status:'Active'}));
let duties=[{id:'a',driverEmployeeNumber:'1',startMin:300,endMin:600,dispatchStatus:'Pending'},{id:'b',driverEmployeeNumber:'1',startMin:700,endMin:900,dispatchStatus:'Assigned'},{id:'c',driverEmployeeNumber:'2',startMin:400,endMin:800,dispatchStatus:'Pending'}].map(s=>({...s,serviceDate:'2026-11-20',driverAcknowledgment:'Yes',breaks:[]}));
let emitDuties;const bulkCalls=[],singleCalls=[],transferCalls=[],copyCalls=[];
Object.assign(w,{CSS:{escape:s=>String(s)},els:{contentArea:w.document.getElementById('contentArea')},showError:msg=>{if(msg)throw Error(msg)},state:{dispatchDate:'2026-11-20',isAdmin:true},scheduleCoverage:()=>({}),refreshRosterFatigue:s=>s,calculateFatigue:()=>({totalSpanMinutes:300,paidMinutes:300,unpaidMinutes:0,fatigueStatus:"OK",fatigueWarning:""}),fatigueStatusLabel:()=> 'OK',
listenEmployees:cb=>{cb(employees);return()=>{}},listenBuses:cb=>{cb([]);return()=>{}},listenJobGroups:cb=>{cb([]);return()=>{}},listenBlocksByDate:(date,cb)=>{cb([]);return()=>{}},listenDutySpansByDateRange:(from,to,cb)=>{emitDuties=()=>cb(duties.map(s=>({...s})));emitDuties();return()=>{}},
getDutySpansByDriverAndDate:async(emp,date)=>duties.filter(s=>s.driverEmployeeNumber===String(emp)&&s.serviceDate===date).map(s=>({...s})),
transferDutySpanWithBlocks:async payload=>transferCalls.push(payload),
addDutySpan:async payload=>{copyCalls.push(payload);duties.push({...payload,id:'copied-duty'});emitDuties()},
updateDutySpanStatusesBulk:async(entries,status,date)=>{bulkCalls.push({entries,status,date});if(w.failBulk)throw Error('Transaction rejected');entries.forEach(e=>{const d=duties.find(s=>s.id===e.id);d.dispatchStatus=status;if(status!=='Assigned')d.driverAcknowledgment='Pending'});emitDuties()},
updateDutySpanDispatchStatus:async(id,status)=>{singleCalls.push({id,status});duties.find(s=>s.id===id).dispatchStatus=status;emitDuties()}});
const clean=s=>s.replace(/import\s+[\s\S]*?\s+from\s+["'][^"']+["'];/g,'').replace(/export /g,'');
vm.runInContext(clean(fs.readFileSync('public/js/dispatch_duty_copy.js','utf8'))+'\n'+clean(fs.readFileSync('public/js/dispatch_bulk_status.js','utf8'))+'\n'+clean(fs.readFileSync('public/js/dispatch_board.js','utf8'))+'\nrenderDispatchBoardPage()',c);
const q=s=>w.document.querySelector(s), change=(sel,value)=>{q(sel).value=value;q(sel).dispatchEvent(new w.Event('change',{bubbles:true}))},check=s=>{q(s).checked=true;q(s).dispatchEvent(new w.Event('change',{bubbles:true}))},click=s=>q(s).click(),flush=()=>new Promise(resolve=>setImmediate(resolve));
(async()=>{
assert.equal(w.document.querySelectorAll('[data-bulk-driver]').length,2);
change('#driverViewFilter','all');assert.equal(q('[data-bulk-driver="3"]').disabled,true);
const detailBefore=q('#dispatchDetailPanel').innerHTML;
check('#bulkSelectAll');assert.match(q('#bulkStatusCount').textContent,/2 drivers selected · 3 duty spans · 2 to change/);assert.equal(q('#dispatchDetailPanel').innerHTML,detailBefore);
click('#bulkStatusReview');assert.equal(w.document.querySelectorAll('.dispatch-bulk-review tbody tr').length,2);click('#dispatchModalCancel');await flush();assert.equal(bulkCalls.length,0);
click('#bulkStatusReview');click('#dispatchModalConfirm');await flush();assert.equal(bulkCalls.length,1);assert.equal(duties[1].driverAcknowledgment,'Yes');assert.match(q('#bulkStatusCount').textContent,/^0 drivers/);
check('#bulkSelectAll');change('#bulkStatusTarget','Cancelled');click('#bulkStatusReview');assert.match(q('#dispatchModalMessage').textContent,/Assigned jobs are not deleted/);click('#dispatchModalConfirm');await flush();assert.ok(duties.every(d=>d.dispatchStatus==='Cancelled'&&d.driverAcknowledgment==='Pending'));
check('#bulkSelectAll');change('#bulkStatusTarget','Assigned');click('#bulkStatusReview');duties[0].startMin=320;emitDuties();click('#dispatchModalConfirm');await flush();assert.equal(bulkCalls.length,2);assert.match(q('#dispatchPageMessage').textContent,/changed/);
change('#driverSortBy','start_time');assert.match(q('#bulkStatusCount').textContent,/^2 drivers/);change('#driverViewFilter','working');assert.match(q('#bulkStatusCount').textContent,/^0 drivers/);
// Single-driver controls continue using the original path.
change('[data-dispatch-status="2"]','Assigned');await flush();assert.equal(singleCalls.length,1);
// A failure keeps selection for review/retry and does not display success.
check('#bulkSelectAll');w.failBulk=true;click('#bulkStatusReview');click('#dispatchModalConfirm');await flush();assert.match(q('#dispatchPageMessage').textContent,/Transaction rejected/);assert.match(q('#bulkStatusCount').textContent,/^2 drivers/);w.failBulk=false;
change('#dispatchDate','2026-11-21');assert.match(q('#bulkStatusCount').textContent,/^0 drivers/);
// Actual duty drop handlers: plain drag transfers, Ctrl drag copies; never cross-call.
change('#dispatchDate','2026-11-20');change('#driverViewFilter','all');
async function dropDuty(ctrl){
 const data={},transfer={setData:(k,v)=>data[k]=v,getData:k=>data[k]||''};
 q('[data-duty-span-bar="a"]').ondragstart({dataTransfer:transfer,ctrlKey:ctrl});
 const cell=q('[data-time-cell][data-driver-empno="3"]');
 cell.ondragover({preventDefault(){},dataTransfer:transfer,ctrlKey:ctrl});
 assert.equal(transfer.dropEffect,ctrl?'copy':'move');
 const result=cell.ondrop({preventDefault(){},dataTransfer:transfer,ctrlKey:ctrl});
 await flush();return {result};
}
let drop=await dropDuty(false);assert.equal(q('#dispatchModalTitle').textContent,'Transfer complete duty');click('#dispatchModalConfirm');await drop.result;assert.equal(transferCalls.length,1);assert.equal(copyCalls.length,0);
const sourceBefore=JSON.stringify(duties.find(s=>s.id==='a'));
drop=await dropDuty(true);click('#dispatchModalCancel');await drop.result;assert.equal(copyCalls.length,0);assert.equal(transferCalls.length,1);
drop=await dropDuty(true);duties.push({id:'new-target-duty',driverEmployeeNumber:'3',serviceDate:'2026-11-20',startMin:1000,endMin:1100,breaks:[]});emitDuties();click('#dispatchModalConfirm');await drop.result;assert.equal(copyCalls.length,0);assert.match(q('#dispatchPageMessage').textContent,/roster changed/);duties=duties.filter(s=>s.id!=='new-target-duty');emitDuties();

drop=await dropDuty(true);assert.equal(q('#dispatchModalTitle').textContent,'Copy duty to another driver');assert.match(q('#dispatchModalMessage').textContent,/original duty and its jobs stay/);click('#dispatchModalConfirm');await drop.result;
assert.equal(transferCalls.length,1);assert.equal(copyCalls.length,1);assert.equal(copyCalls[0].driverEmployeeNumber,'3');assert.equal(copyCalls[0].dispatchStatus,'Pending');assert.equal(copyCalls[0].assignedBus,'');assert.equal(JSON.stringify(duties.find(s=>s.id==='a')),sourceBefore);
// Repeating the copy is blocked by the destination overlap.
drop=await dropDuty(true);await drop.result;assert.equal(copyCalls.length,1);assert.match(q('#dispatchPageMessage').textContent,/overlapping/);
console.log('PASS: actual Dispatch DOM with bulk selection, select all, review/back/confirm, multi-duty counts, skip unchanged, stale review, failure/retry, filter/date clearing existing individual controls, normal drag transfer, Ctrl drag copy, copy cancellation, stale copy review and duplicate overlap prevention.');
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>w.close());
