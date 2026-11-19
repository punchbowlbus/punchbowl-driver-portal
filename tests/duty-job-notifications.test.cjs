const test=require('node:test'),assert=require('node:assert/strict');
const {createJobDeliveryHandler}=require('../functions-notifications/job-delivery');
const d=(id,emp,status='Assigned')=>({id,driverEmployeeNumber:emp,dispatchStatus:status,serviceDate:'2026-11-20',startMin:300,endMin:900,breaks:[]});
const job={assignedDriverEmployeeNumber:'963',dutySpanId:'d1',serviceDate:'2026-11-20',startMin:400,endMin:500,from:'A',to:'B',generatedLegs:[]};
function harness({duties=[d('d1','963')],before=null,after=job,current=after,createdAt,jobWriteAt}={}){
 const records=new Map(duties.map(d=>['dutySpans/'+d.id,d]));if(current)records.set('blocks/b1',current);
 const sends=[];let queue=Promise.resolve();
 const snapshot=path=>({id:path.split('/').at(-1),exists:records.has(path),data:()=>structuredClone(records.get(path)),...(path.startsWith('dutySpans/')&&createdAt!=null?{createTime:{toMillis:()=>createdAt}}:{})});
 const ref=path=>({path,collection:n=>({doc:id=>ref(path+'/'+n+'/'+id)}),get:async()=>snapshot(path),set:async(data,o)=>records.set(path,o?.merge?{...records.get(path),...structuredClone(data)}:structuredClone(data))});
 function collection(name,filters=[]){return{doc:id=>ref(name+'/'+id),where:(k,op,v)=>collection(name,[...filters,[k,v]]),get:async()=>({docs:[...records.keys()].filter(p=>p.startsWith(name+'/')&&!p.slice(name.length+1).includes('/')&&filters.every(([k,v])=>records.get(p)[k]===v)).map(snapshot)})}}
 const db={collection,runTransaction:fn=>{const p=queue.then(async()=>{const writes=[];const r=await fn({get:r=>r.get(),set:(r,d,o)=>writes.push([r,d,o])});for(const[r,d,o]of writes)await r.set(d,o);return r});queue=p.catch(()=>{});return p}};
 const handler=createJobDeliveryHandler({db,FieldValue:{serverTimestamp:()=>0},send:async({notification,dutySpanId})=>{sends.push({notification,dutySpanId});return{status:'accepted',employeeNumber:notification.employeeNumber}},dutySummary:d=>'Duty '+d.id});
 const snap=data=>({exists:!!data,data:()=>data,...(jobWriteAt!=null?{updateTime:{toMillis:()=>jobWriteAt}}:{})});
 const event={id:'job-event',time:new Date().toISOString(),params:{blockId:'b1'},data:{before:snap(before),after:snap(after)}};
 return{run:()=>handler(event),sends,records,event};
}
for(const[label,config,expected]of[
 ['linked job added',{after:job},['job-added:963:d1']],
 ['job removed',{before:job,after:{...job,assignedDriverEmployeeNumber:'',dutySpanId:''}},['job-removed:963:d1']],
 ['job hard deleted',{before:job,after:null},['job-removed:963:d1']],
 ['job soft deleted',{before:job,after:{...job,deleted:true}},['job-removed:963:d1']],
 ['job route/time changed',{before:job,after:{...job,startMin:410,to:'C'}},['job-updated:963:d1']],
 ['job legs changed',{before:job,after:{...job,generatedLegs:[{from:'A',to:'C'}]}},['job-updated:963:d1']],
 ['Pending duty silent',{duties:[d('d1','963','Pending')],after:job},[]],
 ['Cancelled duty silent',{duties:[d('d1','963','Cancelled')],after:job},[]],
 ['deleted duty silent',{duties:[{...d('d1','963'),deleted:true}],after:job},[]],
 ['job reassigned',{duties:[d('d1','963'),d('d2','943')],before:job,after:{...job,assignedDriverEmployeeNumber:'943',dutySpanId:'d2'}},['job-removed:963:d1','job-added:943:d2']],
 ['whole-duty transfer to Pending stays silent',{duties:[d('d1','943','Pending')],before:job,after:{...job,assignedDriverEmployeeNumber:'943'}},[]],
 ['unlinked legacy job matches exactly one duty',{after:{...job,dutySpanId:''}},['job-added:963:d1']],
 ['ambiguous legacy job stays silent',{duties:[d('d1','963'),d('d2','963')],after:{...job,dutySpanId:''}},[]],
 ['timestamp-only job write stays silent',{before:job,after:{...job,updatedAt:'later'}},[]],
 ['new duty assignment covers same-batch job',{after:job,createdAt:100,jobWriteAt:100},[]],
 ['hard deletion never uses prior job timestamp to suppress removal',{before:job,after:null,createdAt:100,jobWriteAt:100},['job-removed:963:d1']]
])test(label,async()=>{const h=harness(config);await h.run();assert.deepEqual(h.sends.map(s=>s.notification.eventType+':'+s.notification.employeeNumber+':'+s.dutySpanId),expected)});
test('event replay uses existing recipient journal and does not resend',async()=>{const h=harness();await h.run();await h.run();assert.equal(h.sends.length,1)});
test('superseded job edit is skipped before send',async()=>{const h=harness({before:job,after:{...job,to:'C'},current:{...job,to:'D'}});await h.run();assert.equal(h.sends.length,0);assert.ok([...h.records.values()].some(d=>d.reason==='stale-event'))});
test('removed-job alert is suppressed if job was put back',async()=>{const h=harness({before:job,after:{...job,assignedDriverEmployeeNumber:'',dutySpanId:''},current:job});await h.run();assert.equal(h.sends.length,0)});
test('old job events stop before querying/sending',async()=>{const h=harness();h.event.time=new Date(Date.now()-25*3600000).toISOString();await h.run();assert.equal(h.sends.length,0)});
test('a silent Pending plan stays silent on replay after the duty becomes Assigned',async()=>{
 const h=harness({duties:[d('d1','963','Pending')]});await h.run();h.records.set('dutySpans/d1',d('d1','963'));await h.run();assert.equal(h.sends.length,0);
});
test('driver-visible job label changes alert; duty and block data are never written',async()=>{
 const h=harness({before:job,after:{...job,schoolName:'New school'}});const originalDuty=structuredClone(h.records.get('dutySpans/d1')),originalJob=structuredClone(h.records.get('blocks/b1'));await h.run();assert.equal(h.sends.length,1);assert.deepEqual(h.records.get('dutySpans/d1'),originalDuty);assert.deepEqual(h.records.get('blocks/b1'),originalJob);
});
test('a frozen recipient plan is not redirected to a different driver on replay',async()=>{
 const h=harness();await h.run();h.records.set('dutySpans/d1',d('d1','943'));await h.run();assert.equal(h.sends.length,1);assert.equal(h.sends[0].notification.employeeNumber,'963');
});
