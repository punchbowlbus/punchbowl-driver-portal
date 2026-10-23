const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs/promises');const path=require('node:path');
const url=s=>'data:text/javascript;base64,'+Buffer.from(s).toString('base64');
const read=name=>fs.readFile(path.join(__dirname,'../public/js',name),'utf8');
const strip=s=>s.replace(/^import[\s\S]*?;\s*/gm,'');
const prepared=Promise.all(['dispatch_fatigue.js','fatigue_schedule.js','db.js','dispatch_assignments.js'].map(read)).then(([calc,schedule,db,assign])=>{
 const calcUrl=url(calc);const scheduleUrl=url(`import {calculateFatigue,refreshLegacyRestBreach,qualifyingRestBlocks,recordedRestBlocks} from '${calcUrl}';\n${strip(schedule)}`);
 return {calcUrl,scheduleUrl,db:strip(db),assign:strip(assign).replace(/console\.log\([\s\S]*?\);/g,'')};
});
test('automatic duty creation stores freshly calculated warnings and pay totals',async()=>{
 const p=await prepared;
 const m=await import(url(`import {calculateFatigue} from '${p.calcUrl}';import {scheduleCoverage,refreshRosterFatigue,shiftServiceDate} from '${p.scheduleUrl}';
 export const calls=[];
 const getEmployee=async()=>({employeeNumber:'899',email:'test@example.com',fatigueCategory:'Standard'});
 const getDutySpansByDriverAndDate=async()=>[];
 const updateBlock=async(id,data)=>calls.push({kind:'block',id,data});
 const addDutySpan=async(data)=>calls.push({kind:'duty',data});
 ${p.assign}`));
 await m.assignBlockToDriver({block:{id:'job',startMin:0,endMin:360},serviceDate:'2026-10-13',driverEmployeeNumber:'899',driverName:'Test'});
 const stored=m.calls.find(x=>x.kind==='duty').data;
 assert.equal(stored.fatigueStatus,'BREACH');assert.match(stored.fatigueWarning,/15 continuous|Scheduled roster risk/);assert.equal(stored.paidMinutes,360);
});
test('invalid automatic duty cannot partially assign its job',async()=>{
 const p=await prepared;
 const m=await import(url(`import {calculateFatigue} from '${p.calcUrl}';import {scheduleCoverage,refreshRosterFatigue,shiftServiceDate} from '${p.scheduleUrl}';
 export const calls=[];
 const getEmployee=async()=>({employeeNumber:'899',email:'test@example.com',fatigueCategory:'Standard'});
 const getDutySpansByDriverAndDate=async()=>[];
 const updateBlock=async(id,data)=>calls.push({id,data});const addDutySpan=async(data)=>calls.push(data);
 ${p.assign}`));
 await assert.rejects(()=>m.assignBlockToDriver({block:{id:'job',startMin:100,endMin:50},serviceDate:'2026-10-13',driverEmployeeNumber:'899'}),/invalid/);
 assert.equal(m.calls.length,0);
});
const dbModule=async()=>{
 const p=await prepared;return import(url(`import {calculateFatigue} from '${p.calcUrl}';
 export const calls=[];const db={};const serverTimestamp=()=>({timestamp:true});const collection=(db,name)=>({name});const doc=(db,name,id)=>({name,id});const addDoc=async(ref,data)=>{calls.push({ref,data});return {id:'new'};};
 const writeBatch=()=>({update:(ref,data)=>calls.push({ref,data}),commit:async()=>calls.push({committed:true})});
 ${p.db}`));
};
test('legacy DB creation cannot default to an unchecked OK',async()=>{
 const m=await dbModule();await m.addDutySpan({serviceDate:'2026-10-13',startMin:0,endMin:120});
 assert.equal(m.calls.at(-1).data.fatigueStatus,'WARNING');assert.match(m.calls.at(-1).data.fatigueWarning,/Hours-option review/);
 await assert.rejects(()=>m.addDutySpan({startMin:120,endMin:0}),/invalid/);
});
test('transfer persists refreshed fatigue fields in the same batch as driver assignment',async()=>{
 const m=await dbModule();const before=m.calls.length;
 await m.transferDutySpanWithBlocks({dutySpanId:'d',blockIds:['j'],driverEmployeeNumber:'899',driverName:'Test',fatigueStatus:'WARNING',fatigueWarning:'New driver review.'});
 const transfer=m.calls.slice(before);const row=transfer.find(x=>x.ref?.name==='dutySpans');
 assert.equal(row.data.fatigueStatus,'WARNING');assert.equal(row.data.fatigueWarning,'New driver review.');assert.equal(row.data.dispatchStatus,'Pending');
 assert.equal(transfer.at(-1).committed,true);
});
