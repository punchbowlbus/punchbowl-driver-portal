const test=require('node:test'),assert=require('node:assert/strict');
const {createDutyDeliveryHandler,isRetryableMessagingError,isCurrentNotification}=require('../functions-notifications/duty-delivery');
const duty={driverEmployeeNumber:'963',dispatchStatus:'Assigned',serviceDate:'2026-11-20',startMin:300,endMin:600,driverAcknowledgment:'Pending'};
const assigned={employeeNumber:'963',eventType:'assigned',linkToDuty:true};
function harness({notifications=[assigned],send}={}){
 const records=new Map([['dutySpans/duty-1',structuredClone(duty)]]),calls=[];let clock=Date.parse('2026-11-19T00:00:00Z'),serial=0,queue=Promise.resolve();
 const snapshot=path=>({exists:records.has(path),data:()=>structuredClone(records.get(path))});
 const ref=path=>({path,collection:name=>({doc:id=>ref(path+'/'+name+'/'+id)}),get:async()=>snapshot(path),set:async(data,options)=>records.set(path,options?.merge?{...records.get(path),...structuredClone(data)}:structuredClone(data))});
 const db={collection:name=>({doc:id=>ref(name+'/'+id)}),runTransaction:fn=>{
  const run=queue.then(async()=>{const writes=[];const value=await fn({get:async r=>snapshot(r.path),set:(r,d,o)=>writes.push([r,d,o])});for(const [r,d,o]of writes)await r.set(d,o);return value});queue=run.catch(()=>{});return run;
 }};
 const handler=createDutyDeliveryHandler({db,FieldValue:{serverTimestamp:()=>clock},classify:()=>notifications,send:async input=>{calls.push(input);return send?send(input,calls.length):{status:'accepted',employeeNumber:input.notification.employeeNumber,messageId:'TEST'}},now:()=>clock,leaseId:()=>String(++serial)});
 const event={id:'event-1',time:new Date(clock).toISOString(),params:{dutySpanId:'duty-1'},data:{before:{exists:false},after:{exists:true,data:()=>({...duty})}}};
 return{records,calls,event,run:()=>handler(event),advance:ms=>clock+=ms,recipient:()=>[...records.entries()].filter(([p])=>p.includes('/recipients/')).map(([,v])=>v)};
}
test('repeat event is not resent after acceptance and acknowledgment alone does not make event stale',async()=>{
 const h=harness();h.records.set('dutySpans/duty-1',{...duty,driverAcknowledgment:'Yes',updatedAt:'later'});await h.run();await h.run();assert.equal(h.calls.length,1);assert.equal(h.recipient()[0].status,'accepted');
});
test('concurrent replay respects an active lease rather than sending twice',async()=>{
 let release,started;const ready=new Promise(r=>started=r),gate=new Promise(r=>release=r);
 const h=harness({send:async()=>{started();await gate;return{status:'accepted',employeeNumber:'963'}}});
 const first=h.run();await ready;await assert.rejects(h.run(),/bounded retry/);assert.equal(h.calls.length,1);release();await first;await h.run();assert.equal(h.calls.length,1);
});
test('temporary failures back off and stop after five processing attempts',async()=>{
 const h=harness({send:async()=>({status:'retryable',employeeNumber:'963',errorCode:'messaging/server-unavailable'})});
 await assert.rejects(h.run());await assert.rejects(h.run());assert.equal(h.calls.length,1);
 for(let i=1;i<5;i++){h.advance(1000000);if(i===4)await h.run();else await assert.rejects(h.run());}
 assert.equal(h.calls.length,5);assert.equal(h.recipient()[0].status,'failed');assert.equal(h.recipient()[0].reason,'retry-limit');await h.run();assert.equal(h.calls.length,5);
});
test('a successful transfer recipient is not resent when the other recipient retries',async()=>{
 const notifications=[{employeeNumber:'1',eventType:'reassigned-away'},{employeeNumber:'963',eventType:'reassigned-to'}];
 let targetAttempts=0;const h=harness({notifications,send:async({notification:n})=>({status:n.employeeNumber==='963'&&++targetAttempts===1?'retryable':'accepted',employeeNumber:n.employeeNumber})});
 await assert.rejects(h.run());h.advance(1000000);await h.run();assert.deepEqual(h.calls.map(c=>c.notification.employeeNumber),['1','963','963']);
});
test('later cancellation, transfer, detail change or deletion suppresses an old assignment',async()=>{
 for(const current of [{...duty,dispatchStatus:'Cancelled'},{...duty,driverEmployeeNumber:'943'},{...duty,startMin:310},{...duty,deleted:true},null]){
  const h=harness();if(current)h.records.set('dutySpans/duty-1',current);else h.records.delete('dutySpans/duty-1');await h.run();assert.equal(h.calls.length,0);assert.equal(h.recipient()[0].reason,'stale-event');
 }
});
test('terminal failures and inactive/no-device skips never retry',async()=>{
 for(const result of [{status:'failed',errorCode:'messaging/registration-token-not-registered'},{status:'skipped',reason:'employee-inactive'},{status:'skipped',reason:'no-device'}]){
  const h=harness({send:async()=>({...result,employeeNumber:'963'})});await h.run();h.advance(1000000);await h.run();assert.equal(h.calls.length,1);
 }
});
test('older-than-24-hour events stop sending and log expiration; completed logs stay completed',async()=>{
 const h=harness();h.advance(25*3600000);await h.run();assert.equal(h.calls.length,0);assert.equal(h.records.get('dutyNotificationDeliveries/event-1').status,'expired');
});
test('legacy sent-event records are adopted so rollout does not resend an old accepted alert',async()=>{
 const h=harness();h.records.set('dutyNotificationDeliveries/event-1',{results:[{employeeNumber:'963',status:'sent',messageId:'OLD'}]});await h.run();await h.run();assert.equal(h.calls.length,0);assert.equal(h.recipient()[0].status,'accepted');
});
test('expired worker lease can recover while a live lease is not stolen',async()=>{
 const h=harness();const crypto=require('node:crypto'),key=crypto.createHash('sha256').update('963:assigned').digest('hex');
 h.records.set('dutyNotificationDeliveries/event-1/recipients/'+key,{status:'processing',owner:'crashed',attempts:1,leaseUntil:Date.parse(h.event.time)+120000,firstAttemptAt:Date.parse(h.event.time)});
 await assert.rejects(h.run());assert.equal(h.calls.length,0);h.advance(120001);await h.run();assert.equal(h.calls.length,1);assert.equal(h.recipient()[0].attempts,2);
});
test('stale removal is suppressed after driver regains assigned duty; withdrawal is suppressed after cancellation',()=>{
 assert.equal(isCurrentNotification({employeeNumber:'963',eventType:'reassigned-away'},duty,duty),false);
 assert.equal(isCurrentNotification({employeeNumber:'963',eventType:'withdrawn'},duty,{...duty,dispatchStatus:'Cancelled'}),false);
});
test('retry classification excludes permanent invalid token and invalid payload failures',()=>{
 for(const code of ['messaging/server-unavailable','messaging/internal-error','messaging/quota-exceeded','app/network-error'])assert.equal(isRetryableMessagingError(code),true);
 for(const code of ['messaging/registration-token-not-registered','messaging/invalid-registration-token','messaging/invalid-argument','messaging/authentication-error'])assert.equal(isRetryableMessagingError(code),false);
});
