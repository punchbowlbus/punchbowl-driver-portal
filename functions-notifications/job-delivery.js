const {createHash}=require('node:crypto');
const {createDutyDeliveryHandler,MAX_EVENT_AGE_MS}=require('./duty-delivery');
const text=v=>String(v||'').trim();
const owner=b=>text(b?.assignedDriverEmployeeNumber||b?.assignedDriverId||b?.driverId);
const date=b=>text(b?.serviceDate||b?.date);
const inactive=b=>!b||b.deleted===true||['cancelled','canceled'].includes(text(b.dispatchStatus).toLowerCase());
function jobVersion(b){
 if(!b)return 'missing';
 return JSON.stringify(['deleted','dispatchStatus','assignedDriverEmployeeNumber','assignedDriverId','driverId','dutySpanId','serviceDate','date','startMin','startMinutes','endMin','endMinutes','from','fromName','to','toName','pickup','dropoff','startLocation','endLocation','routeNumber','routePdfUrl','origin','destination','blockType','direction','routeDirection','runDirection','tripDirection','group','groupName','jobGroupName','jobName','name','title','school','schoolName','jobGroupId','jobNumber','reference','customerName','notes','generatedLegs'].map(k=>b[k]??null));
}
function fits(b,d){
 const start=Number(b.startMin??b.startMinutes),end=Number(b.endMin??b.endMinutes);
 return [start,end,Number(d.startMin),Number(d.endMin)].every(Number.isFinite)&&end>start&&start>=Number(d.startMin)&&end<=Number(d.endMin);
}
async function resolveJobDuty(db,block){
 if(inactive(block)||!owner(block))return null;
 const same=d=>text(d.driverEmployeeNumber)===owner(block)&&(!date(block)||date(d)===date(block));
 const link=text(block.dutySpanId);
 if(link){
  const snapshot=await db.collection('dutySpans').doc(link).get();
  if(snapshot.exists&&!inactive(snapshot.data())&&same(snapshot.data()))return {id:snapshot.id||link,...snapshot.data(),snapshot};
 }
 if(!date(block))return null;
 const snapshot=await db.collection('dutySpans').where('driverEmployeeNumber','==',owner(block)).where('serviceDate','==',date(block)).get();
 const matches=snapshot.docs.map(s=>({id:s.id,...s.data(),snapshot:s})).filter(d=>!inactive(d)&&same(d)&&fits(block,d));
 return matches.length===1?matches[0]:null;
}
const visible=d=>d&&!inactive(d)&&text(d.dispatchStatus).toLowerCase()==='assigned';
const dutyKey=d=>d?d.id+':'+d.driverEmployeeNumber:'';
function createJobDeliveryHandler({db,FieldValue,send,dutySummary}){
 return async event=>{
  if(Date.now()-Date.parse(event.time)>MAX_EVENT_AGE_MS)return;
  const before=event.data?.before?.exists?event.data.before.data():null;
  const after=event.data?.after?.exists?event.data.after.data():null;
  if(jobVersion(before)===jobVersion(after))return;
  const planRef=db.collection('dutyJobNotificationEvents').doc(event.id);
  const savedPlan=await planRef.get();
  let alerts;
  if(savedPlan.exists){alerts=savedPlan.data().alerts||[];}else{
  const [oldDuty,newDuty]=await Promise.all([resolveJobDuty(db,before),resolveJobDuty(db,after)]);
  const candidates=[];
  if(dutyKey(oldDuty)!==dutyKey(newDuty)){
   if(visible(oldDuty))candidates.push({duty:oldDuty,eventType:'job-removed'});
   if(visible(newDuty))candidates.push({duty:newDuty,eventType:'job-added'});
  }else if(visible(newDuty))candidates.push({duty:newDuty,eventType:'job-updated'});
  const frozen=candidates.filter(({duty})=>{
    // New duty publication already includes the jobs created in the same batch.
    const time=event.data?.after?.exists?event.data.after.updateTime?.toMillis?.():null;
    return !(Number.isFinite(time)&&duty.snapshot?.createTime?.toMillis?.()>=time);
  }).map(({duty,eventType})=>{const {snapshot,...data}=duty;return{duty:data,eventType}});
  alerts=await db.runTransaction(async tx=>{
    const snapshot=await tx.get(planRef);
    if(snapshot.exists)return snapshot.data().alerts||[];
    tx.set(planRef,{eventId:event.id,blockId:event.params.blockId,alerts:frozen,createdAt:FieldValue.serverTimestamp()});
    return frozen;
  });
  }
  let retry=false;
  for(const {duty,eventType}of alerts){
   const dutyData=duty;
   const notification={employeeNumber:text(duty.driverEmployeeNumber),eventType,linkToDuty:true,title:eventType==='job-added'?'Job added to your duty':eventType==='job-removed'?'Job removed from your duty':'Duty job updated',body:dutySummary(dutyData)};
   const handler=createDutyDeliveryHandler({db,FieldValue,send,classify:()=>[notification],isRelevant:async()=>{
    const latest=await db.collection('blocks').doc(event.params.blockId).get();
    const block=latest.exists?latest.data():null;
    const latestDuty=await resolveJobDuty(db,block);
    if(eventType==='job-removed')return dutyKey(latestDuty)!==dutyKey(duty);
    return jobVersion(block)===jobVersion(after)&&dutyKey(latestDuty)===dutyKey(duty);
   }});
   const suffix=createHash('sha256').update(dutyKey(duty)+':'+eventType).digest('hex').slice(0,32);
   try{await handler({id:event.id+'-job-'+suffix,time:event.time,params:{dutySpanId:duty.id},data:{before:{exists:true,data:()=>dutyData},after:{exists:true,data:()=>dutyData}}});}catch(error){retry=true;}
  }
  if(retry)throw new Error('Job notification delivery requires retry.');
 };
}
module.exports={createJobDeliveryHandler,resolveJobDuty,jobVersion};
