const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../public/js/driver_duty_sheet.js'),'utf8');
const duty={id:'current',driverEmployeeNumber:'972',driverName:'C ANDREWS',serviceDate:'2026-10-20',startMin:515,endMin:870,dispatchStatus:'Assigned',assignedBus:'M09659'};
const job={id:'forward',assignedDriverEmployeeNumber:'972',serviceDate:'2026-10-20',startMin:555,endMin:570,jobGroupName:"ST MAROUN'S COLLEGE",routePairId:'college',routeDirection:'Forward',dutySpanId:'old-deleted-duty'};
function harness(records={}){
 const calls=[];const els={contentArea:{innerHTML:''}};
 const context=vm.createContext({console:{warn(){}},els,db:{},window:{},document:{getElementById:()=>null},escapeHtml:v=>String(v??''),collection:()=>({}),doc:(db,name,id)=>({name,id}),getDocs:async()=>({docs:[]}),getDoc:async ref=>{calls.push(ref.id);const record=records[ref.id];if(record instanceof Error)throw record;return {id:ref.id,exists:()=>Boolean(record),data:()=>record};}});
 vm.runInContext(source.replace(/^import[\s\S]*?;\s*/gm,'').replace('export async function renderDriverDutySheet','async function renderDriverDutySheet')+'\n globalThis.draw=renderDriverDutySheet;',context);
 return {calls,els,render:(blocks,options={})=>context.draw({dutySpan:{...duty},blocks,onYes:()=>{},onNo:()=>{},onBack:()=>{},...options})};
}
test('C ANDREWS: forward and return with a deleted old duty link appear as one complete job',async()=>{
 const h=harness();await h.render([job,{...job,id:'return',routeDirection:'Return',startMin:840,endMin:855}]);
 assert.match(h.els.contentArea.innerHTML,/<h2>1 assigned job<\/h2>/);assert.match(h.els.contentArea.innerHTML,/ST MAROUN/);assert.equal((h.els.contentArea.innerHTML.match(/driver-duty-job-section/g)||[]).length,2);
 assert.deepEqual(h.calls,['old-deleted-duty'],'Read each old reference once; never write or recreate assignments');
});
test('an explicitly deleted duty record also allows a verified replacement-duty match',async()=>{
 const h=harness({'old-deleted-duty':{...duty,id:'old-deleted-duty',deleted:true}});await h.render([job]);assert.match(h.els.contentArea.innerHTML,/<h2>1 assigned job/);
});
test('old links to a different service date cannot hide this driver’s current-date job',async()=>{
 const h=harness({'old-deleted-duty':{...duty,serviceDate:'2026-10-19'}});await h.render([job]);assert.match(h.els.contentArea.innerHTML,/<h2>1 assigned job/);
});
test('a valid link to another current duty remains exclusive even if that duty is not preloaded',async()=>{
 const h=harness({'old-deleted-duty':{...duty,id:'old-deleted-duty'}});await h.render([job]);assert.match(h.els.contentArea.innerHTML,/<h2>0 assigned jobs/);
});
test('a known valid other duty requires no extra read and is never reassigned',async()=>{
 const h=harness();await h.render([job],{dutySpans:[duty,{...duty,id:'old-deleted-duty'}]});assert.match(h.els.contentArea.innerHTML,/<h2>0 assigned jobs/);assert.deepEqual(h.calls,[]);
});
test('explicit current links and old unlinked records both render without database lookups',async()=>{
 const h=harness();await h.render([{...job,dutySpanId:'current'},{...job,id:'legacy',routePairId:'other',dutySpanId:''}]);assert.match(h.els.contentArea.innerHTML,/<h2>2 assigned jobs/);assert.deepEqual(h.calls,[]);
});
test('wrong-driver and wrong-date jobs stay hidden even when the stored duty ID matches',async()=>{
 const h=harness();await h.render([{...job,dutySpanId:'current',assignedDriverEmployeeNumber:'999'},{...job,id:'wrong-date',dutySpanId:'current',serviceDate:'2026-10-21'}]);assert.match(h.els.contentArea.innerHTML,/<h2>0 assigned jobs/);assert.deepEqual(h.calls,[]);
});
test('cancelled, deleted, unowned and out-of-duty stale-link jobs stay hidden',async()=>{
 const h=harness();await h.render([{...job,deleted:true},{...job,dispatchStatus:'Cancelled'},{...job,assignedDriverEmployeeNumber:''},{...job,startMin:900,endMin:920}]);assert.match(h.els.contentArea.innerHTML,/<h2>0 assigned jobs/);assert.deepEqual(h.calls,[]);
});
test('ambiguous overlapping duties cannot claim the same unlinked work',async()=>{
 const h=harness();await h.render([{...job,dutySpanId:''}],{dutySpans:[duty,{...duty,id:'overlap'}]});assert.match(h.els.contentArea.innerHTML,/<h2>0 assigned jobs/);
});
test('failed reference reads show an incomplete-work warning instead of assuming a deleted duty',async()=>{
 const h=harness({'old-deleted-duty':new Error('permission denied')});await h.render([job]);assert.match(h.els.contentArea.innerHTML,/Some assigned jobs could not be verified/);assert.match(h.els.contentArea.innerHTML,/<h2>0 assigned jobs/);
});
test('a new driver block snapshot does not leave a removed orphan job behind',async()=>{
 const h=harness();await h.render([job]);assert.match(h.els.contentArea.innerHTML,/<h2>1 assigned job/);await h.render([]);assert.match(h.els.contentArea.innerHTML,/<h2>0 assigned jobs/);
});
test('an obsolete async duty render cannot overwrite a newer page or snapshot',async()=>{
 const h=harness();h.els.contentArea.innerHTML='New page';await h.render([job],{isCurrent:()=>false});assert.equal(h.els.contentArea.innerHTML,'New page');
});
