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
test("cleaning updates the due date only after approval and preserves performer and actual date",async()=>{
  const {db,svc}=setup();await svc.update(a,{busId:"b1",type:"interior",action:"start"});
  await assert.rejects(svc.update(a,{busId:"b1",type:"interior",action:"complete",checklist:[],completedDate:"2026-10-01"}),/every/);
  const result=await svc.update(a,{busId:"b1",type:"interior",action:"complete",checklist:CHECKLISTS.interior,completedDate:"2026-09-30"});
  assert.equal(db.data.get("yardFleet/b1").interior.lastDate,undefined);
  await assert.rejects(svc.update(a,{busId:"b1",type:"interior",action:"approve",recordId:result.recordId}),/Fleet Manager/);
  await svc.update(manager,{busId:"b1",type:"interior",action:"approve",recordId:result.recordId});
  assert.equal(db.data.get("yardFleet/b1").interior.lastDate,"2026-09-30");assert.equal(db.data.get("yardFleet/b1").interior.lastBy.uid,a.uid);
  assert.equal(db.data.get("yardRecords/"+result.recordId).status,"Approved");
  assert.equal(db.data.get("buses/b1").status,undefined);
  await assert.rejects(svc.update(manager,{busId:"b1",type:"interior",action:"approve",recordId:result.recordId}),/no longer/);
});
test("returning work preserves history and makes the task available for correction",async()=>{
  const {db,svc}=setup();await svc.update(a,{busId:"b1",type:"exterior",action:"start"});const {recordId}=await svc.update(a,{busId:"b1",type:"exterior",action:"complete",checklist:CHECKLISTS.exterior,completedDate:"2026-10-01"});
  await assert.rejects(svc.update(manager,{busId:"b1",type:"exterior",action:"return",recordId}),/Explain/);
  await svc.update(manager,{busId:"b1",type:"exterior",action:"return",recordId,notes:"Clean rear windows"});
  assert.equal(db.data.get("yardFleet/b1").exterior.reviewNotes,"Clean rear windows");assert.equal(db.data.get("yardRecords/"+recordId).status,"Returned");
  await svc.update(b,{busId:"b1",type:"exterior",action:"start"});assert.equal(db.data.get("yardFleet/b1").exterior.active.uid,b.uid);
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
