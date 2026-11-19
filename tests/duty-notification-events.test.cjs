const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('functions-notifications/index.js','utf8');
function harness(){
 const sends=[],logs=[];
 const db={collection:name=>({doc:id=>({get:async()=>({exists:true,data:()=>({status:'Active',fcmToken:'TEST-DEVICE-'+id})}),set:async data=>logs.push({name,id,data})})})};
 const exported={};
 const c=vm.createContext({exports:exported,process:{env:{}},console:{log(){}},require:name=>{
  if(name==='firebase-functions/v2/https')return {onCall:(options,run)=>({options,run}),HttpsError:Error};
  if(name==='firebase-functions/v2/firestore')return {onDocumentCreated:(options,run)=>({options,run}),onDocumentWritten:(options,run)=>({options,run})};
  if(name==='firebase-admin')return {initializeApp(){}};
  if(name==='firebase-admin/firestore')return {getFirestore:()=>db,FieldValue:{serverTimestamp:()=> 'TIMESTAMP',delete:()=> 'DELETE'}};
  if(name==='firebase-admin/messaging')return {getMessaging:()=>({send:async payload=>{sends.push(payload);return 'TEST-MESSAGE'}})};
  throw Error('Unexpected dependency: '+name);
 }});
 vm.runInContext(source,c);
 const classify=(before,after)=>JSON.parse(JSON.stringify(c.classifyDutyNotifications(before,after)));
 const snapshot=data=>({exists:!!data,data:()=>data});
 const run=(before,after)=>exported.notifyDriverOnDutyWritten.run({id:'event-1',params:{dutySpanId:'duty-1'},data:{before:snapshot(before),after:snapshot(after)}});
 return{classify,run,sends,logs};
}
const duty={driverEmployeeNumber:'963',dispatchStatus:'Assigned',driverAcknowledgment:'Yes',serviceDate:'2026-11-20',dutyNumber:'RAIL1',startMin:1380,endMin:1560,breaks:[],assignedBus:'BUS1'};
const types=events=>events.map(e=>e.eventType+':'+e.employeeNumber);
for(const [label,before,after,expected] of [
 ['new Pending copy is silent',null,{...duty,dispatchStatus:'Pending'},[]],
 ['draft cancellation is silent',{...duty,dispatchStatus:'Pending'},{...duty,dispatchStatus:'Cancelled'},[]],
 ['created Cancelled draft is silent',null,{...duty,dispatchStatus:'Cancelled'},[]],
 ['assigned duty cancellation remains',duty,{...duty,dispatchStatus:'Cancelled'},['cancelled:963']],
 ['cancelled duty edits stay silent',{...duty,dispatchStatus:'Cancelled'},{...duty,dispatchStatus:'Cancelled',startMin:1390},[]],
 ['assignment remains',{...duty,dispatchStatus:'Pending'},duty,['assigned:963']],
 ['new Assigned duty remains',null,duty,['assigned:963']],
 ['assigned edit remains',duty,{...duty,startMin:1390},['updated:963']],
 ['driver response alone stays silent',{...duty,driverAcknowledgment:'Pending'},duty,[]],
 ['same status bulk update stays silent',duty,{...duty,updatedAt:'later'},[]],
 ['transfer alerts both drivers',duty,{...duty,driverEmployeeNumber:'943'},['reassigned-away:963','reassigned-to:943']],
 ['transfer into Pending only removes old duty',duty,{...duty,driverEmployeeNumber:'943',dispatchStatus:'Pending'},['reassigned-away:963']],
 ['Assigned to Pending remains',duty,{...duty,dispatchStatus:'Pending'},['withdrawn:963']],
 ['soft deletion alerts original driver',duty,{...duty,deleted:true},['removed:963']],
 ['hard deletion alerts original driver',duty,null,['removed:963']],
 ['deleted edits stay silent',{...duty,deleted:true},{...duty,deleted:true,startMin:1390},[]],
 ['creating a deleted record stays silent',null,{...duty,deleted:true},[]],
 ['hard deleting an already deleted record stays silent',{...duty,deleted:true},null,[]],
 ['delete plus reassignment alerts original owner only',duty,{...duty,deleted:true,driverEmployeeNumber:'943'},['removed:963']],
 ['cancel plus reassignment does not alert unpublished target',duty,{...duty,dispatchStatus:'Cancelled',driverEmployeeNumber:'943'},['reassigned-away:963']],
 ['restore as Assigned republishes',{...duty,deleted:true},{...duty,deleted:false},['assigned:963']],
 ['restore as Pending stays silent',{...duty,deleted:true},{...duty,deleted:false,dispatchStatus:'Pending'},[]]
])test(label,()=>assert.deepEqual(types(harness().classify(before,after)),expected));
test('actual Firestore handler does not call Messaging or write a delivery log for suppressed events',async()=>{
 for(const [before,after] of [[{...duty,dispatchStatus:'Pending'},{...duty,dispatchStatus:'Cancelled'}],[{...duty,deleted:true},{...duty,deleted:true,endMin:1600}]]){
  const h=harness();await h.run(before,after);assert.equal(h.sends.length,0);assert.equal(h.logs.length,0);
 }
});
test('actual handler preserves recipient tokens, event types, duty links and delivery logging',async()=>{
 const h=harness();await h.run(duty,{...duty,driverEmployeeNumber:'943'});
 assert.deepEqual(h.sends.map(s=>s.token),['TEST-DEVICE-963','TEST-DEVICE-943']);
 assert.equal(h.sends[0].data.link,'https://punchbowl-driver-portal.web.app/?page=myWork');
 assert.match(h.sends[1].data.link,/page=dutySheet&dutySpanId=duty-1/);
 assert.equal(h.logs[0].name,'dutyNotificationDeliveries');assert.equal(h.logs[0].id,'event-1');assert.equal(h.logs[0].data.results.length,2);
 assert.match(h.sends[1].webpush.notification.body,/23:00–26:00/);
});
