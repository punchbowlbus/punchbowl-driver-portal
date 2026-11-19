const test=require('node:test'),assert=require('node:assert/strict');
const {getDeliveryReport}=require('../functions-notifications/delivery-report');
function dbFor(data){
 const snapshot=(id,d)=>({id,exists:!!d,data:()=>d});
 const db={
  collection:name=>({
   orderBy:field=>({limit:n=>({get:async()=>({docs:Object.entries(data[name]||{}).filter(([,v])=>v[field]!=null).sort((a,b)=>b[1][field]-a[1][field]).slice(0,n).map(([id,d])=>snapshot(id,d))})})}),
   doc:id=>({id,collection:()=>({limit:()=>({get:async()=>({docs:(data.children?.[id]||[]).map((d,i)=>snapshot(String(i),d))})})})})
  }),
  getAll:async(...refs)=>refs.map(r=>snapshot(r.id,data.employees?.[r.id]))
 };
 return db;
}
test('report merges legacy/current timestamp queries and sanitizes private fields',async()=>{
 const db=dbFor({dutyNotificationDeliveries:{old:{createdAt:100,dutySpanId:'d1',serviceDate:'2026-11-20',eventTypes:['assigned'],recipientEmployeeNumbers:['963'],results:[{employeeNumber:'963',status:'sent',token:'SECRET',messageId:'PRIVATE'}]},new:{createdAt:200,updatedAt:300,dutySpanId:'d2',eventTypes:['job-updated'],results:[{employeeNumber:'963',status:'accepted',acceptedDeviceCount:1,failedDeviceCount:1}]}},employees:{963:{displayName:'Driver Name',email:'PRIVATE_EMAIL',fcmToken:'SECRET'}}});
 const result=await getDeliveryReport(db);assert.equal(result.eventCount,2);assert.equal(result.rows.length,2);assert.equal(result.rows[0].status,'partial');assert.equal(result.rows[1].status,'accepted');assert.equal(result.rows[1].driverName,'Driver Name');assert.equal(result.rows[1].acceptedDevices,1);assert.doesNotMatch(JSON.stringify(result),/SECRET|PRIVATE/);
});
test('retrying events use authoritative recipient journal and show attempt timing',async()=>{
 const result=await getDeliveryReport(dbFor({dutyNotificationDeliveries:{e:{createdAt:1,updatedAt:2,status:'pending-retry',results:[]}},children:{e:[{employeeNumber:'963',status:'retryable',eventType:'assigned',attempts:2,nextAttemptAt:5000,errorCode:'messaging/server-unavailable'}]}}));
 assert.equal(result.rows[0].status,'retrying');assert.equal(result.rows[0].attempts,2);assert.equal(result.rows[0].nextAttemptAt,5000);
});
test('general/defect activity is clearly aggregate and distinguishes partial acceptance',async()=>{
 const general=await getDeliveryReport(dbFor({generalNotifications:{e:{sentAt:5,successCount:2,failureCount:1,noDeviceCount:3}}}),{kind:'general'});assert.equal(general.rows[0].status,'partial');assert.equal(general.rows[0].employeeNumber,'');assert.equal(general.rows[0].acceptedDevices,2);
 const defect=await getDeliveryReport(dbFor({defectNotificationDeliveries:{e:{createdAt:5,successCount:0,failureCount:1}}}),{kind:'defect'});assert.equal(defect.rows[0].status,'failed');
});
test('query limits are bounded, unsupported categories reject, and reports make no writes',async()=>{
 const records={};for(let i=0;i<110;i++)records['e'+i]={createdAt:i+1,eventTypes:['assigned'],recipientEmployeeNumbers:['963'],results:[{employeeNumber:'963',status:'skipped',reason:'no-device'}]};
 const result=await getDeliveryReport(dbFor({dutyNotificationDeliveries:records}),{limit:100000});assert.equal(result.eventCount,100);assert.equal(result.truncated,true);assert.equal(result.rows[0].reason,'no-device');await assert.rejects(getDeliveryReport(dbFor({}),{kind:'employees'}));
});
