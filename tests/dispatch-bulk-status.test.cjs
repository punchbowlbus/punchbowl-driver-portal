const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const planner=fs.readFileSync('public/js/dispatch_bulk_status.js','utf8').replace(/export /g,'');
const ctx=vm.createContext({});vm.runInContext(planner,ctx);
const drivers=[{employeeNumber:'1',displayName:'A'},{employeeNumber:'2',displayName:'B'}];
const span=(id,emp,status='Pending',date='2026-11-20')=>({id,driverEmployeeNumber:emp,dispatchStatus:status,serviceDate:date,startMin:300,endMin:600,driverAcknowledgment:'Yes'});
const plan=(spans,status='Assigned')=>ctx.buildBulkStatusPlan(drivers,spans,new Set(['1','2','3']),'2026-11-20',status);
test('review includes multiple duties, skips same status, excludes other dates, deleted and hidden drivers',()=>{
 const p=plan([span('a','1'),span('b','1','Assigned'),span('c','2'),span('other','1','Pending','2026-11-21'),{...span('deleted','1'),deleted:true},span('hidden','3')]);
 assert.deepEqual(Array.from(p.changes,e=>e.id),['a','c']);assert.equal(p.entries.length,3);assert.equal(p.skipped,1);
 const changed=plan([span('a','1'),{...span('b','1'),startMin:400}]);assert.notEqual(ctx.bulkStatusFingerprint(p),ctx.bulkStatusFingerprint(changed));
});
const db=fs.readFileSync('public/js/db.js','utf8');
const code=db.slice(db.indexOf('export async function updateDutySpanStatusesBulk'),db.indexOf('export async function updateDutySpanDriverAcknowledgment')).replace('export ','');
async function update(entries,status,records){
 const writes=[];let committed=false;
 const c=vm.createContext({db:{},doc:(_,name,id)=>({name,id}),serverTimestamp:()=> 'SERVER_TIME',runTransaction:async(_,fn)=>{const value=await fn({get:async ref=>({exists:()=>!!records[ref.id],data:()=>records[ref.id]}),update:(ref,patch)=>writes.push({ref,patch})});committed=true;return value;}});
 vm.runInContext(code,c);let error;try{await c.updateDutySpanStatusesBulk(entries,status,'2026-11-20')}catch(e){error=e}
 return{writes,committed,error};
}
test('bulk status writes only status/update timestamp and preserves existing acknowledgment rules',async()=>{
 for(const status of ['Assigned','Pending','Cancelled']){
  const record=span('a','1',status==='Pending'?'Assigned':'Pending');const p=plan([record],status);const r=await update(p.changes,status,{a:record});
  assert.equal(r.committed,true);assert.equal(r.writes.length,1);assert.equal(r.writes[0].ref.name,'dutySpans');
  assert.deepEqual(Object.keys(r.writes[0].patch).sort(),status==='Assigned'?['dispatchStatus','updatedAt']:['dispatchStatus','driverAcknowledgment','updatedAt']);
  if(status!=='Assigned')assert.equal(r.writes[0].patch.driverAcknowledgment,'Pending');
 }
});
test('changed, deleted, removed or reassigned reviewed duties reject atomically before any writes',async()=>{
 const original=span('b','2');const entries=plan([span('a','1'),original]).changes;
 for(const replacement of [null,{...original,deleted:true},{...original,dispatchStatus:'Cancelled'},{...original,driverEmployeeNumber:'9'},{...original,serviceDate:'2026-11-21'},{...original,startMin:400}]){
  const r=await update(entries,'Assigned',{a:span('a','1'),b:replacement});assert.ok(r.error);assert.equal(r.committed,false);assert.equal(r.writes.length,0);
 }
});
test('invalid status, duplicate IDs and oversized selections do not write',async()=>{
 const entry=plan([span('a','1')]).changes[0];
 for(const [entries,status] of [[[entry],'bad'],[[entry,entry],'Assigned'],[Array.from({length:401},(_,i)=>({...entry,id:String(i)})),'Assigned']]){
  const r=await update(entries,status,{});assert.ok(r.error);assert.equal(r.writes.length,0);
 }
});
