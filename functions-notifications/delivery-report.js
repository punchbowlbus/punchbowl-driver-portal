const configs={duty:{collection:'dutyNotificationDeliveries',times:['updatedAt','createdAt']},general:{collection:'generalNotifications',times:['sentAt']},defect:{collection:'defectNotificationDeliveries',times:['createdAt']}};
const number=v=>Number.isFinite(Number(v))?Math.max(0,Number(v)):0;
function millis(v){if(v?.toMillis)return v.toMillis();if(v?.toDate)return v.toDate().getTime();const n=typeof v==='number'?v:Date.parse(v);return Number.isFinite(n)?n:0;}
function resultStatus(result,parent){
 if(['accepted','sent'].includes(result.status))return number(result.failedDeviceCount)>0?'partial':'accepted';
 if(parent.status==='expired')return 'expired';
 return {retryable:'retrying',processing:'processing',failed:'failed',skipped:'skipped'}[result.status]||(parent.status==='pending-retry'?'retrying':parent.status==='processing'?'processing':'unknown');
}
async function getDeliveryReport(db,{kind='duty',limit=100}={}){
 if(!configs[kind])throw new Error('Invalid notification category.');
 limit=Math.max(1,Math.min(100,Math.floor(Number(limit)||100)));
 const config=configs[kind],snapshots=await Promise.all(config.times.map(field=>db.collection(config.collection).orderBy(field,'desc').limit(limit+1).get()));
 const unique=new Map();for(const snapshot of snapshots)for(const doc of snapshot.docs)unique.set(doc.id,{id:doc.id,...doc.data()});
 const timestamp=log=>Math.max(...config.times.map(field=>millis(log[field])));
 const events=[...unique.values()].sort((a,b)=>timestamp(b)-timestamp(a)).slice(0,limit);
 const rows=[];
 for(const log of events){
  if(kind!=='duty'){
   const accepted=number(log.successCount),failed=number(log.failureCount);
   rows.push({id:log.id,employeeNumber:'',driverName:kind==='general'?'All active recipients':'Selected defect recipients',eventType:kind,dutySpanId:'',dutyNumber:kind==='defect'?String(log.reportNumber||''):'',serviceDate:'',timestamp:timestamp(log),status:accepted?(failed?'partial':'accepted'):failed?'failed':'skipped',acceptedDevices:accepted,failedDevices:failed,attempts:0,reason:log.noDeviceCount?`${number(log.noDeviceCount)} users without a registered device`:'',errorCode:(log.failureCodes||[]).map(String).join(', '),nextAttemptAt:0});continue;
  }
  let results=Array.isArray(log.results)?log.results:[];
  if(['processing','pending-retry'].includes(log.status)){
   const recipients=await db.collection(config.collection).doc(log.id).collection('recipients').limit(10).get();
   if(recipients.docs.length)results=recipients.docs.map(d=>d.data());
  }
  if(!results.length)results=(log.recipientEmployeeNumbers||['']).map(employeeNumber=>({employeeNumber,status:log.status==='expired'?'expired':'processing'}));
  results.forEach((result,index)=>rows.push({id:log.id+':'+index,employeeNumber:String(result.employeeNumber||log.recipientEmployeeNumbers?.[index]||''),driverName:'',eventType:String(result.eventType||log.eventTypes?.[index]||'duty'),dutySpanId:String(log.dutySpanId||''),dutyNumber:String(log.dutyNumber||''),serviceDate:String(log.serviceDate||''),timestamp:timestamp(log),status:resultStatus(result,log),acceptedDevices:result.acceptedDeviceCount==null&&['sent','accepted'].includes(result.status)?1:number(result.acceptedDeviceCount),failedDevices:number(result.failedDeviceCount),attempts:number(result.attempts),reason:String(result.reason||log.reason||''),errorCode:String(result.errorCode||''),nextAttemptAt:number(result.nextAttemptAt)}));
 }
 const ids=[...new Set(rows.map(r=>r.employeeNumber).filter(id=>id&&!id.includes('/')))];
 if(ids.length){const employees=await db.getAll(...ids.map(id=>db.collection('employees').doc(id)));const names=new Map(employees.filter(s=>s.exists).map(s=>{const d=s.data();return [s.id,String(d.displayName||[d.firstName,d.lastName].filter(Boolean).join(' ')||s.id)]}));for(const row of rows)row.driverName=names.get(row.employeeNumber)||row.employeeNumber;}
 return{kind,eventCount:events.length,truncated:unique.size>limit,limit,rows};
}
module.exports={getDeliveryReport,resultStatus,millis};
