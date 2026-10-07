const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const asModule=s=>'data:text/javascript;base64,'+Buffer.from(s).toString('base64');
const modules=Promise.all(['dispatch_fatigue.js','fatigue_tracking.js'].map(f=>fs.readFile(path.join(__dirname,'../public/js',f),'utf8'))).then(async([calculator,tracking])=>{
 const calcUrl=asModule(calculator);
 const report=tracking.replace(/^import .*;\s*$/gm,'');
 const escapeHtml = value => String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
 return {calc:await import(calcUrl),report:await import(asModule(`import {qualifyingRestBlocks} from '${calcUrl}';\nconst escapeHtml = ${escapeHtml.toString()};\n${report}\nexport {renderPage};`))};
});
const range={start:'2026-10-13',end:'2026-10-13'};
const duty=(date,start,end,breaks=[])=>({serviceDate:date,startMin:start,endMin:end,breaks,driverEmployeeNumber:'899',driverName:'Test Driver',dutyNumber:'WAD',dispatchStatus:'Pending'});
test('cross-midnight work over two service dates is detected',async()=>{
 const {report}=await modules;
 const results=report.calculateStandardHoursAlerts([duty('2026-10-12',1200,1620),duty('2026-10-13',660,1080)],range);
 assert.ok(results.some(x=>x.rule==='Scheduled work risk: 24-hour window' && x.detail.includes('14h 00m')));
});
test('empty roster history is not invented as zero statutory rests',async()=>{
 const {report}=await modules;
 const results=report.calculateStandardHoursAlerts([duty('2026-10-13',540,1020,[{startMin:780,endMin:810}])],range);
 assert.equal(results.filter(x=>x.result==='DATA REVIEW').length,1);
 assert.ok(!results.some(x=>/qualifying.*rest.*identified|0 qualifying/.test(x.detail)));
});
test('duplicate overlapping duties do not double-count scheduled work',async()=>{
 const {report}=await modules;
 const d=duty('2026-10-13',540,1020);
 assert.ok(!report.calculateStandardHoursAlerts([d,{...d,id:'duplicate'}],range).some(x=>x.rule.includes('24-hour window')));
});
test('cancelled, deleted and unassigned duties are excluded',async()=>{
 const {report}=await modules;
 const d=duty('2026-10-13',0,1400);
 assert.deepEqual(report.calculateStandardHoursAlerts([{...d,dispatchStatus:'Cancelled'},{...d,deleted:true},{...d,driverEmployeeNumber:''}],range),[]);
});
test('a valid early meal does not hide a later unbroken work period',async()=>{
 const {calc,report}=await modules;
 const d=duty('2026-10-13',0,720,[{startMin:240,endMin:270}]);
 assert.equal(calc.calculateFatigue(d).has15MinWithin5h15m,false);
 assert.ok(report.calculateStandardHoursAlerts([d],range).some(x=>x.rule.includes('5½')));
});
test('two overlapping rest entries cannot satisfy 30-minute requirement',async()=>{
 const {calc}=await modules;
 const result=calc.calculateFatigue(duty('2026-10-13',0,480,[{startMin:240,endMin:260},{startMin:245,endMin:265}]));
 assert.equal(result.qualifyingRestMinutes,25);
 assert.equal(result.has30MinWithin8h,false);
});
test('out-of-duty break cannot satisfy the short rest checks',async()=>{
 const {calc,report}=await modules;
 const d=duty('2026-10-13',540,900,[{startMin:400,endMin:540}]);
 assert.equal(calc.calculateFatigue(d).has15MinWithin5h15m,false);
 assert.ok(report.calculateStandardHoursAlerts([d],range).some(x=>x.rule.includes('5½')));
});
test('split-duty work counts together when the gap is under 15 minutes',async()=>{
 const {report}=await modules;
 const result=report.calculateStandardHoursAlerts([duty('2026-10-13',0,180),duty('2026-10-13',190,360)],range);
 assert.ok(result.some(x=>x.rule.includes('5½')));
});
test('Standard Hours table renders even with no turnaround results',async()=>{
 const {report}=await modules;
 const nodes={ftRows:{},ftStandardRows:{},ftMetrics:{}};
 global.document={getElementById:id=>nodes[id]};
 try {
  const alerts=report.calculateStandardHoursAlerts([duty('2026-10-13',0,360)],range);
  report.renderPage([],alerts,range);
  assert.match(nodes.ftRows.innerHTML,/No matching turnaround/);
  assert.match(nodes.ftStandardRows.innerHTML,/DATA REVIEW/);
  assert.match(nodes.ftStandardRows.innerHTML,/5½/);
  report.renderPage([],[],range);
  assert.doesNotMatch(nodes.ftStandardRows.innerHTML,/DATA REVIEW/);
 } finally {delete global.document;}
});
test('a saved obsolete break message is refreshed while company turnaround survives',async()=>{
 const {calc}=await modules;
 const d=duty('2026-10-13',0,480,[{startMin:240,endMin:255}]);
 const result=calc.refreshLegacyRestBreach({...d,fatigueStatus:'BREACH',fatigueWarning:'Need at least 30 min total rest within first 8 hours. Company 8-hour turnaround breach.'});
 assert.match(result.fatigueWarning,/8-hour counting window/);
 assert.match(result.fatigueWarning,/turnaround breach/);
 assert.doesNotMatch(result.fatigueWarning,/first 8 hours/);
});

test('a partial rest fragment at the eight-hour boundary is not credited',async()=>{
 const {calc,report}=await modules;
 const d=duty('2026-10-13',0,540,[{startMin:240,endMin:260},{startMin:470,endMin:490}]);
 assert.equal(calc.calculateFatigue(d).has30MinWithin8h,false);
 assert.ok(report.calculateStandardHoursAlerts([d],range).some(x=>x.rule.includes('within 8 hours')));
});
