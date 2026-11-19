const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const code=fs.readFileSync('public/js/dispatch_duty_copy.js','utf8').replace(/export /g,'');
const c=vm.createContext({});vm.runInContext(code,c);
const source={id:'original',serviceDate:'2026-11-20',driverEmployeeNumber:'1',driverName:'Source',startMin:1380,endMin:1560,dutyNumber:'RAIL1',dutyType:'Rail Replacement',routeNumber:'R1',routePdfUrl:'route.pdf',startLocation:'A',endLocation:'B',assignedBus:'BUS1',dispatchStatus:'Assigned',driverAcknowledgment:'Yes',breaks:[{type:'meal',startMin:1440,endMin:1470,paid:false}],createdAt:'old',jobIds:['job1'],fatigueStatus:'OK'};
const target={employeeNumber:'2',displayName:'Destination'},fatigue={totalSpanMinutes:180,paidMinutes:150,unpaidMinutes:30,fatigueStatus:'WARNING',fatigueWarning:'Target roster needs review'};
test('copy whitelists duty details, starts unallocated/Pending, recalculates fatigue, never mutates original',()=>{
 const before=JSON.stringify(source),p=c.dutyCopyPayload(source,target,fatigue);
 assert.equal(p.assignedBus,'');assert.equal(p.dispatchStatus,'Pending');assert.equal(p.driverAcknowledgment,'Pending');assert.equal(p.driverEmployeeNumber,'2');assert.equal(p.fatigueStatus,'WARNING');assert.equal(p.paidMinutes,150);
 for(const k of ['id','createdAt','jobIds'])assert.equal(k in p,false);
 for(const k of ['serviceDate','dutyNumber','dutyType','routeNumber','routePdfUrl','startLocation','endLocation','startMin','endMin'])assert.equal(p[k],source[k]);
 p.breaks[0].startMin=1450;assert.equal(JSON.stringify(source),before);
});
test('copy rejects invalid times and detects overnight overlap across service dates',()=>{
 assert.throws(()=>c.dutyCopyPayload({...source,startMin:''},target,fatigue));
 assert.equal(c.dutyCopyOverlaps(source,[{serviceDate:'2026-11-21',startMin:60,endMin:200}]),true);
 assert.equal(c.dutyCopyOverlaps(source,[{serviceDate:'2026-11-21',startMin:120,endMin:200}]),false);
 assert.equal(c.dutyCopyOverlaps(source,[{serviceDate:'2026-11-20',startMin:1370,endMin:1390,deleted:true}]),false);
});
