const test=require("node:test"),assert=require("node:assert/strict");
const {identity,busSnapshot,validateChecks,dateValue,today,CHECKLISTS}=require("../functions-yard/domain");
const {createService}=require("../functions-yard/service");
const {memoryDb}=require("./yard-memory.cjs");
const a={uid:"yard-a",name:"Employee A",email:"a@test",employeeNumber:"101",manager:false},b={...a,uid:"yard-b",name:"Employee B",employeeNumber:"102"},manager={...a,uid:"manager",manager:true};
const bus={fleetNumber:"M07538",depot:"Riverwood",fuelType:"Diesel"};
function setup(){const db=memoryDb({"buses/b1":bus,"buses/ev1":{fleetNumber:"EV012",fuelType:"Electric"}});const svc=createService({db,stamp:()=>"2026-10-01T02:00:00Z",now:()=>new Date("2026-10-01T02:00:00Z")});return {db,svc};}
test("authentication rejects inactive employees and unrelated drivers",()=>{
  const auth={uid:"u",token:{email:"person@test",email_verified:true}};
  assert.throws(()=>identity(auth,{role:"Driver",status:"Active"}),/Yard Man/);
  assert.throws(()=>identity(auth,{role:"Yard Man",status:"Inactive"}),/Yard Man/);
  assert.throws(()=>identity({...auth,token:{...auth.token,email_verified:false}},{role:"Yard Man",status:"Active"}),/verified/);
  assert.equal(identity(auth,{role:"Yard Man",status:"Active",displayName:"Worker"}).name,"Worker");
});
test("simultaneous task claims allow exactly one owner, while another task can proceed",async()=>{
  const {db,svc}=setup();const outcomes=await Promise.allSettled([svc.update(a,{busId:"b1",type:"exterior",action:"start"}),svc.update(b,{busId:"b1",type:"exterior",action:"start"})]);
  assert.equal(outcomes.filter((row)=>row.status==="fulfilled").length,1);
  assert.equal(db.data.get("yardFleet/b1").exterior.active.uid,a.uid);
  await svc.update(b,{busId:"b1",type:"interior",action:"start"});assert.equal(db.data.get("yardFleet/b1").interior.active.uid,b.uid);
});
test("workers cannot complete or release another worker's task",async()=>{
  const {svc}=setup();await svc.update(a,{busId:"b1",type:"exterior",action:"start"});
  await assert.rejects(svc.update(b,{busId:"b1",type:"exterior",action:"complete",checklist:CHECKLISTS.exterior,completedDate:"2026-10-01"}),/own account/);
  await assert.rejects(svc.update(b,{busId:"b1",type:"exterior",action:"release",notes:"Leaving"}),/Only the person/);
});
test("cleaning completes immediately, permits extra washes, and preserves actual dates and performers",async()=>{
  const {db,svc}=setup();await svc.update(a,{busId:"b1",type:"exterior",action:"start"});
  await assert.rejects(svc.update(a,{busId:"b1",type:"exterior",action:"complete",checklist:[],completedDate:"2026-10-01"}),/every/);
  const result=await svc.update(a,{busId:"b1",type:"exterior",action:"complete",checklist:CHECKLISTS.exterior,completedDate:"2026-10-01"});
  assert.equal(db.data.get("yardFleet/b1").exterior.lastDate,"2026-10-01");
  assert.equal(db.data.get("yardFleet/b1").exterior.lastBy.uid,a.uid);
  assert.equal(db.data.get("yardRecords/"+result.recordId).status,"Completed");
  assert.equal(db.data.get("yardFleet/b1").exterior.pending,null);
  await assert.rejects(svc.update(manager,{busId:"b1",type:"exterior",action:"approve",recordId:result.recordId}),/Invalid action/);
  await svc.update(b,{busId:"b1",type:"exterior",action:"start"});
  await svc.update(b,{busId:"b1",type:"exterior",action:"complete",checklist:CHECKLISTS.exterior,completedDate:"2026-09-30"});
  assert.equal(db.data.get("yardFleet/b1").exterior.lastDate,"2026-10-01");
  assert.equal(db.data.get("yardFleet/b1").exterior.lastBy.uid,a.uid);
  assert.deepEqual(db.data.get("buses/b1"),bus);
});
test("cleaning handover requires notes and acceptance, with both employees retained in history",async()=>{
  const {db,svc}=setup();await svc.update(a,{busId:"b1",type:"interior",action:"start"});
  await assert.rejects(svc.update(b,{busId:"b1",type:"interior",action:"handover",notes:"Take over"}),/Only the person/);
  await assert.rejects(svc.update(a,{busId:"b1",type:"interior",action:"handover"}),/reason/);
  await svc.update(a,{busId:"b1",type:"interior",action:"handover",notes:"Swept; mopping remains"});
  assert.equal(db.data.get("yardFleet/b1").interior.handover.name,a.name);
  await svc.update(b,{busId:"b1",type:"interior",action:"start"});
  await svc.update(b,{busId:"b1",type:"interior",action:"complete",checklist:CHECKLISTS.interior,completedDate:"2026-10-01"});
  const history=(await svc.history(manager,"b1")).records;
  assert.equal(history.find(r=>r.action==="handover").actor.uid,a.uid);
  assert.equal(history.find(r=>r.action==="complete").actor.uid,b.uid);
});
test("weekly states use a rolling seven-day deadline and allow early priority",async()=>{
  const {dueState}=require('../functions-yard/domain');
  assert.equal(dueState('2026-09-24','2026-09-30').label,'Up to date');
  assert.equal(dueState('2026-09-24','2026-10-01').label,'Due today');
  assert.equal(dueState('2026-09-24','2026-10-02').label,'Overdue');
  const {svc,db}=setup();await svc.update(manager,{busId:'b1',type:'exterior',action:'priority',urgent:true});
  await svc.update(a,{busId:'b1',type:'exterior',action:'start'});
  await svc.update(a,{busId:'b1',type:'exterior',action:'complete',completedDate:'2026-10-01',checklist:CHECKLISTS.exterior});
  assert.equal(db.data.get('yardFleet/b1').exterior.priority,false);
});
test("general tasks enforce manager assignment, employee ownership, handover, problems and review",async()=>{
  const {svc,db}=setup();db.data.set('employees/a',{employeeNumber:'101',displayName:a.name,role:'Yard Man',status:'Active'});db.data.set('employees/b',{employeeNumber:'102',displayName:b.name,role:'Yard Man',status:'Active'});
  const task={type:'general',action:'create',title:'Trim entrance trees',location:'Main yard entrance',priority:'Urgent',dueDate:'2026-10-05',assignees:['a','b']};
  await assert.rejects(svc.update(a,task),/Fleet Manager/);
  await assert.rejects(svc.update(manager,{...task,assignees:['missing']}),/active/);
  const {taskId}=await svc.update(manager,task);const job={type:'general',taskId};
  const outcomes=await Promise.allSettled([svc.update(a,{...job,action:'start'}),svc.update(b,{...job,action:'start'})]);assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);
  await assert.rejects(svc.update(b,{...job,action:'complete',completedDate:'2026-10-01'}),/own account/);
  await svc.update(a,{...job,action:'handover',notes:'Entrance finished; rear branches remain'});
  await svc.update(b,{...job,action:'start'});await svc.update(b,{...job,action:'block',notes:'Need equipment'});
  await svc.update(a,{...job,action:'start'});await svc.update(a,{...job,action:'complete',completedDate:'2026-10-01',notes:'Finished'});
  await assert.rejects(svc.update(a,{...job,action:'approve'}),/Fleet Manager/);
  await svc.update(manager,{...job,action:'return',notes:'Remove remaining branches'});
  await svc.update(b,{...job,action:'start'});await svc.update(b,{...job,action:'complete',completedDate:'2026-10-01'});
  await svc.update(manager,{...job,action:'approve'});
  assert.equal(db.data.get('yardTasks/'+taskId).status,'Completed');assert.equal(db.data.get('yardTasks/'+taskId).completedBy.uid,b.uid);
  const next=await svc.update(manager,{...task,assignees:['a']});
  await assert.rejects(svc.update(b,{type:'general',taskId:next.taskId,action:'start'}),/another employee/);
  const open=await svc.update(manager,{...task,assignees:[]});await svc.update(b,{type:'general',taskId:open.taskId,action:'start'});
});
test("oil/coolant issues need notes and EV checks require a valid charge",()=>{
  const diesel=busSnapshot(bus,"b1"),ev=busSnapshot({fuelType:"EV"},"ev1");
  assert.throws(()=>validateChecks({oilLevel:"Low",coolantLevel:"OK",tyres:"OK"},diesel),/Add details/);
  assert.throws(()=>validateChecks({coolantLevel:"OK",tyres:"OK",charge:101,chargingStatus:"Charging"},ev),/0 and 100/);
  assert.throws(()=>validateChecks({coolantLevel:"OK",tyres:"OK",charge:"",chargingStatus:"Charging"},ev),/0 and 100/);
  assert.equal(validateChecks({coolantLevel:"OK",tyres:"OK",charge:82,chargingStatus:"Charging"},ev).oilLevel,"N/A");
});
test("backdated checks stay in history and do not replace a newer daily result",async()=>{
  const {db,svc}=setup();const result=await svc.update(a,{busId:"b1",type:"checks",action:"checks",oilLevel:"Low",coolantLevel:"OK",tyres:"OK",notes:"Oil below minimum mark",completedDate:"2026-10-01"});
  await svc.update(b,{busId:"b1",type:"checks",action:"checks",oilLevel:"OK",coolantLevel:"OK",tyres:"OK",completedDate:"2026-09-30"});
  assert.equal(db.data.get("yardFleet/b1").checks.problem,true);
  await svc.update(manager,{busId:"b1",type:"checks",action:"acknowledge",recordId:result.recordId,notes:"Workshop notified"});
  assert.equal(db.data.get("yardFleet/b1").checks.problem,true);assert.equal(db.data.get("yardFleet/b1").checks.reviewed,true);
  assert.equal((await svc.history(a,"b1")).records.length,3);
});
test("date handling follows Sydney and rejects invalid or future completion dates",()=>{
  assert.equal(today(new Date("2026-09-30T15:00:00Z")),"2026-10-01");
  assert.throws(()=>dateValue("2026-02-30","2026-10-01"),/valid/);
  assert.throws(()=>dateValue("2026-10-02","2026-10-01"),/future/);
});
