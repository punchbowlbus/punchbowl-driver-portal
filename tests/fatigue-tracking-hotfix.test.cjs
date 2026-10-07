const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const asModule=s=>'data:text/javascript;base64,'+Buffer.from(s).toString('base64');
const modules=Promise.all(['dispatch_fatigue.js','fatigue_tracking.js','fatigue_schedule.js'].map(f=>fs.readFile(path.join(__dirname,'../public/js',f),'utf8'))).then(async([calculator,tracking,schedule])=>{
 const calcUrl=asModule(calculator);
 const scheduleUrl=asModule(`import {calculateFatigue,refreshLegacyRestBreach,qualifyingRestBlocks,recordedRestBlocks} from '${calcUrl}';\n` + schedule.replace(/^import .*;\s*$/gm,'').replace(/^export function /gm,'export function '));
 const report=tracking.replace(/^(?:import|export \{).*;\s*$/gm,'');
 const escapeHtml = value => String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
 return {calc:await import(calcUrl),schedule:await import(scheduleUrl),report:await import(asModule(`import {calculateTurnarounds,mergeIntervals,workIntervals,minutesWithin,shortWindowWork,shortWindowAssessment} from '${scheduleUrl}';\nconst escapeHtml = ${escapeHtml.toString()};\n${report}\nexport {renderPage};`))};
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
const employee={employeeNumber:'899',fatigueCategory:'Standard'};
test('single duty cannot certify 7-hour stationary rest',async()=>{
 const {calc}=await modules;const result=calc.calculateFatigue(duty('2026-10-13',0,480));
 assert.equal(result.has7hContinuousStationaryRest,null);assert.equal(result.restIn24hMinutes,null);
});
test('a long duty with a 24-hour non-work break is not treated as one 14-hour working day',async()=>{
 const {calc}=await modules;const result=calc.calculateFatigue(duty('2026-10-13',0,2280,[{startMin:420,endMin:1860}]));
 assert.equal(result.workMinutes,840);assert.equal(result.maximumWorkIn24hMinutes,420);assert.equal(result.hasScheduled12hWorkLimit,true);
 assert.doesNotMatch(result.fatigueWarning,/work exceeds 12 hours/);
});
test('BFM and AFM profiles never inherit Standard Hours breaches',async()=>{
 const {calc,report,schedule}=await modules;
 for(const profile of ['BFM','AFM','Unknown']){
  const d={...duty('2026-10-13',0,900),id:'d',fatigueCategory:profile};
  const result=calc.calculateFatigue(d);assert.equal(result.fatigueStatus,'WARNING');assert.equal(result.has12hRestIn24h,null);
  const alerts=report.calculateStandardHoursAlerts([d],range,[{...employee,fatigueCategory:profile}]);
  assert.equal(alerts.length,1);assert.equal(alerts[0].rule,'Hours-option verification');
  const row=schedule.refreshRosterFatigue([d],[{...employee,fatigueCategory:profile}])[0];
  assert.equal(row.fatigueStatus,'WARNING');assert.doesNotMatch(row.fatigueWarning,/315|12 hours|15-minute/);
 }
});
test('invalid times cannot silently pass as zero-hour duties',async()=>{
 const {calc}=await modules;
 for(const d of [{startMin:undefined,endMin:300},{startMin:null,endMin:300},{startMin:" ",endMin:300},{startMin:100,endMin:50},{startMin:NaN,endMin:300}]){
  const result=calc.calculateFatigue(d);assert.equal(result.fatigueStatus,'WARNING');assert.match(result.fatigueWarning,/invalid/);
 }
});
test('employee profile loading clears temporary Unknown messages',async()=>{
 const {schedule}=await modules;const d={...duty('2026-10-13',0,120),id:'d'};
 const unknown=schedule.refreshRosterFatigue([d],[])[0];assert.equal(unknown.fatigueStatus,'WARNING');
 const standard=schedule.refreshRosterFatigue([unknown],[employee])[0];assert.equal(standard.fatigueStatus,'OK');assert.equal(standard.fatigueWarning,'');
});
test('short duty with an operator warning still receives newly detected roster risk',async()=>{
 const {schedule}=await modules;
 const rows=schedule.refreshRosterFatigue([{...duty('2026-10-13',0,180),id:'a',fatigueWarning:'Operator review required.',fatigueStatus:'WARNING'},{...duty('2026-10-13',190,360),id:'b'}],[employee]);
 assert.match(rows[0].fatigueWarning,/Operator review required/);assert.match(rows[0].fatigueWarning,/Scheduled roster risk/);
 assert.equal(rows[1].fatigueStatus,'BREACH');
});
test('all separate risky periods are flagged, not only the worst period',async()=>{
 const {schedule}=await modules;
 const rows=schedule.refreshRosterFatigue([{...duty('2026-10-11',0,400),id:'a'},{...duty('2026-10-13',0,180),id:'b'},{...duty('2026-10-13',190,360),id:'c'}],[employee]);
 assert.match(rows[2].fatigueWarning,/Scheduled roster risk/);assert.equal(rows[2].fatigueStatus,'BREACH');
});
test('company turnaround accounts for extended overnight duties across a skipped date',async()=>{
 const {schedule}=await modules;
 const rows=schedule.refreshRosterFatigue([{...duty('2026-10-11',1200,2940),id:'a'},{...duty('2026-10-13',360,480),id:'b'}],[employee]);
 assert.match(rows[1].fatigueWarning,/Company 8-hour turnaround breach/);assert.match(rows[1].fatigueWarning,/5h 00m/);
});
test('nested overlapping duties remain conflicts beyond an intervening short duty',async()=>{
 const {schedule}=await modules;
 const results=schedule.calculateTurnarounds([{...duty('2026-10-13',0,600),id:'a'},{...duty('2026-10-13',100,200),id:'b'},{...duty('2026-10-13',300,400),id:'c'}]);
 assert.ok(results.some(x=>x.previous.id==='a' && x.next.id==='c' && x.status==='overlap'));
});
test('transfer or roster edit removes a stale company warning and computes the new driver result',async()=>{
 const {schedule}=await modules;
 const stale={...duty('2026-10-13',540,660),id:'transferred',fatigueStatus:'BREACH',fatigueWarning:'Company 8-hour turnaround breach. Rest available: 6h.'};
 const updated=schedule.refreshRosterFatigue([stale],[employee])[0];assert.equal(updated.fatigueStatus,'OK');assert.equal(updated.fatigueWarning,'');
 assert.equal(stale.fatigueStatus,'BREACH');
});
test('cancelled and deleted records never raise active fatigue alerts',async()=>{
 const {schedule}=await modules;
 for(const patch of [{dispatchStatus:'Cancelled'},{deleted:true}]){
 const row=schedule.refreshRosterFatigue([{...duty('2026-10-13',0,1000),id:'d',...patch,fatigueStatus:'BREACH',fatigueWarning:'Old warning'}],[employee])[0];
 assert.equal(row.fatigueStatus,'OK');assert.equal(row.fatigueWarning,'');}
});
test('report keeps separate review dates for the same driver and rule',async()=>{
 const {report}=await modules;
 const results=report.calculateStandardHoursAlerts([duty('2026-10-12',0,360),duty('2026-10-13',0,360)],{start:'2026-10-12',end:'2026-10-13'});
 assert.equal(results.filter(x=>x.rule.includes('5½')).length,2);
});

test('short non-work rest reduces work but earns no minimum-rest credit',async()=>{
 const {calc}=await modules;
 const result=calc.calculateFatigue(duty('2026-10-13',0,330,[{type:'meal',startMin:150,endMin:163}]));
 assert.equal(result.workMinutes,317);assert.equal(result.qualifyingRestMinutes,0);assert.equal(result.unpaidMinutes,13);assert.equal(result.has15MinWithin5h15m,false);
});
test('an incomplete short window is not failed merely because rest is under 15 minutes',async()=>{
 const {calc}=await modules;
 const result=calc.calculateFatigue(duty('2026-10-13',0,318,[{startMin:150,endMin:160}]));
 assert.equal(result.workMinutes,308);assert.equal(result.has15MinWithin5h15m,true);assert.notEqual(result.fatigueStatus,'BREACH');
});
test('clipped and overlapping meals cannot corrupt pay totals',async()=>{
 const {calc}=await modules;
 const result=calc.calculateFatigue(duty('2026-10-13',100,200,[{type:'meal',startMin:90,endMin:130},{type:'meal',startMin:120,endMin:150},{type:'meal',startMin:220,endMin:300}]));
 assert.equal(result.unpaidMinutes,50);assert.equal(result.paidMinutes,50);
});

test('old 12-hour work wording is recalculated after corrected rest entries',async()=>{
 const {calc}=await modules;
 const row=calc.refreshLegacyRestBreach({...duty('2026-10-13',0,120),fatigueStatus:'BREACH',fatigueWarning:'Recorded fatigue work exceeds 12 hours in this duty (excluding qualifying rest).'});
 assert.equal(row.fatigueStatus,'OK');assert.equal(row.fatigueWarning,'');
});
test('operator warning following a stale company message survives recalculation',async()=>{
 const {schedule}=await modules;
 const row=schedule.refreshRosterFatigue([{...duty('2026-10-13',0,120),id:'d',fatigueStatus:'BREACH',fatigueWarning:'Company 8-hour turnaround breach. Rest available: 6h. Operator review required.'}],[employee])[0];
 assert.match(row.fatigueWarning,/Operator review required/);assert.doesNotMatch(row.fatigueWarning,/turnaround breach/);
});

test('invalid neighbouring duty does not produce a compliant turnaround',async()=>{
 const {schedule,report}=await modules;
 const bad={...duty('2026-10-12',0,NaN),id:'bad'};const valid={...duty('2026-10-13',540,660),id:'good'};
 assert.deepEqual(schedule.calculateTurnarounds([bad,valid]),[]);
 assert.ok(report.calculateStandardHoursAlerts([bad,valid],{start:'2026-10-12',end:'2026-10-13'}).some(x=>x.rule==='Duty data verification'));
});

test('independent operator warning cannot be hidden by a saved OK status',async()=>{
 const {calc}=await modules;
 const row=calc.refreshLegacyRestBreach({...duty('2026-10-13',0,120),fatigueStatus:'OK',fatigueWarning:'Operator review required.'});
 assert.equal(row.fatigueStatus,'WARNING');assert.match(row.fatigueWarning,/Operator review required/);
});
