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
 return {calc:await import(calcUrl),schedule:await import(scheduleUrl),report:await import(asModule(`import {validDutyRecord,plannedCountingPeriods,scheduledWorkRisks,calculateTurnarounds,mergeIntervals,workIntervals,minutesWithin,shortWindowWork,shortWindowAssessment,calculatePlannedRestChecks,serviceMinute} from '${scheduleUrl}';\nconst escapeHtml = ${escapeHtml.toString()};\n${report}\nexport {renderPage};`))};
});
const range={start:'2026-10-13',end:'2026-10-13'};
const duty=(date,start,end,breaks=[])=>({serviceDate:date,startMin:start,endMin:end,breaks,driverEmployeeNumber:'899',driverName:'Test Driver',dutyNumber:'WAD',dispatchStatus:'Pending'});
test('cross-midnight work over two service dates is detected',async()=>{
 const {report}=await modules;
 const results=report.calculateStandardHoursAlerts([duty('2026-10-12',1200,1620),duty('2026-10-13',660,1080)],range,null,{start:Date.parse('2026-09-01T00:00:00Z')/60000,end:Date.parse('2026-10-20T00:00:00Z')/60000});
 assert.ok(results.some(x=>x.rule==='Planned work: 24-hour counting period' && x.detail.includes('14h 00m')));
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
  assert.match(nodes.ftStandardRows.innerHTML,/Planned alert/);
  assert.match(nodes.ftStandardRows.innerHTML,/data-employee="899"/);
  report.renderPage([],[],range);
  assert.doesNotMatch(nodes.ftStandardRows.innerHTML,/Planned alert/);
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
 const standard=schedule.refreshRosterFatigue([unknown],[employee],fullCoverage)[0];assert.equal(standard.fatigueStatus,'OK');assert.equal(standard.fatigueWarning,'');
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
 const updated=schedule.refreshRosterFatigue([stale],[employee],fullCoverage)[0];assert.equal(updated.fatigueStatus,'OK');assert.equal(updated.fatigueWarning,'');
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
const fullCoverage={start:Date.parse('2026-09-01T00:00:00Z')/60000,end:Date.parse('2026-10-20T00:00:00Z')/60000};
test('no duty means planned rest throughout a completely loaded roster window',async()=>{
 const {schedule}=await modules;
 const checks=schedule.calculatePlannedRestChecks([],'2026-10-13',fullCoverage);
 assert.deepEqual(checks.map(x=>x.result),['NO SCHEDULED WORK','NO SCHEDULED WORK','NO SCHEDULED WORK']);
 assert.ok(checks.every(x=>x.count===null));
});
test('one normal duty does not produce a false zero-rest warning from empty previous days',async()=>{
 const {schedule}=await modules;
 const checks=schedule.calculatePlannedRestChecks([duty('2026-10-13',540,1020)],'2026-10-13',fullCoverage);
 assert.equal(checks[0].count,960);assert.equal(checks[0].result,'PLANNED PASS');
 assert.ok(checks.slice(1).every(x=>x.result==='DATA REVIEW'));
});
test('daily early starts prevent seven-hour night rest; the following day is included',async()=>{
 const {schedule}=await modules;
 const days=Array.from({length:8},(_,i)=>duty('2026-10-'+String(7+i).padStart(2,'0'),240,720));
 const checks=schedule.calculatePlannedRestChecks(days,'2026-10-13',fullCoverage);
 assert.equal(checks[1].count,0);assert.equal(checks[1].result,'PLANNED SHORTFALL');
});
test('a 24-hour alternative counts when neither adjoining night contains seven continuous hours',async()=>{
 const {schedule}=await modules;
 const start=schedule.serviceMinute('2026-10-12',120),end=start+1440;
 assert.equal(schedule.countPlannedNightRests([{start,end}],start,end),1);
});
test('the same 24-hour rest is not credited again as a night rest',async()=>{
 const {schedule}=await modules;
 const start=schedule.serviceMinute('2026-10-12',1320),end=start+1440;
 assert.equal(schedule.countPlannedNightRests([{start,end}],start,end),1);
});
test('48-hour planned rest provides two non-overlapping 24-hour alternatives',async()=>{
 const {schedule}=await modules;
 const start=schedule.serviceMinute('2026-10-12',120),end=start+2880;
 assert.equal(schedule.countPlannedNightRests([{start,end}],start,end),2);
});
test('overnight work cuts a rest gap on the following service date',async()=>{
 const {schedule}=await modules;
 const start=schedule.serviceMinute('2026-10-13',0),end=start+1440;
 const rest=schedule.plannedRestIntervals([duty('2026-10-12',1200,1620),duty('2026-10-13',540,1020)],start,end);
 assert.deepEqual(rest,[{start:start+180,end:start+540},{start:start+1020,end}]);
});
test('cancelled/deleted duties disappear from planned-rest occupancy',async()=>{
 const {schedule}=await modules;
 const days=[{...duty('2026-10-13',0,1440),dispatchStatus:'Cancelled'},{...duty('2026-10-13',0,1440),deleted:true}];
 assert.deepEqual(schedule.calculatePlannedRestChecks(days,'2026-10-13',fullCoverage).map(x=>x.result),['NO SCHEDULED WORK','NO SCHEDULED WORK','NO SCHEDULED WORK']);
});
test('unloaded history or following-day coverage produces DATA REVIEW, not an inferred pass',async()=>{
 const {schedule}=await modules;
 const missingHistory={start:schedule.serviceMinute('2026-10-07'),end:fullCoverage.end};
 const checks=schedule.calculatePlannedRestChecks([],'2026-10-13',missingHistory);
 assert.equal(checks[0].result,'NO SCHEDULED WORK');assert.equal(checks[2].result,'DATA REVIEW');
 const missingNextDay={start:fullCoverage.start,end:schedule.serviceMinute('2026-10-13',0)};
 assert.ok(schedule.calculatePlannedRestChecks([],'2026-10-13',missingNextDay).every(x=>x.result==='DATA REVIEW'));
});
test('work on one overlapping duty prevents a break in another becoming planned rest',async()=>{
 const {schedule}=await modules;
 const start=schedule.serviceMinute('2026-10-13');
 const rest=schedule.plannedRestIntervals([duty('2026-10-13',0,600,[{startMin:100,endMin:200}]),duty('2026-10-13',100,200)],start,start+600);
 assert.deepEqual(rest,[]);
});
test('seven-hour continuous planned rest includes the boundary exactly',async()=>{
 const {schedule}=await modules;
 const end=schedule.serviceMinute('2026-10-14',480),start=end-1440;
 // Cover the entire review except one rest gap of 420 or 419 minutes.
 for(const minutes of [420,419]){
  const d=duty('2026-10-13',480,1920,[{startMin:900,endMin:900+minutes}]);
  const check=schedule.calculatePlannedRestChecks([d],'2026-10-13',fullCoverage)[0];
  assert.equal(check.count,minutes);assert.equal(check.result,minutes===420?'PLANNED PASS':'PLANNED SHORTFALL');
 }
});
test('report displays planned-rest counts instead of blanket rest DATA REVIEW when coverage is loaded',async()=>{
 const {report}=await modules;
 const results=report.calculateStandardHoursAlerts([duty('2026-10-13',540,1020,[{startMin:780,endMin:810}])],range,[employee],fullCoverage);
 assert.equal(results.filter(x=>x.result==='PLANNED PASS').length,1);
 assert.ok(!results.some(x=>x.rule.includes('rest verification')));
});
test('active employee with no duty spans still receives planned-rest results',async()=>{
 const {report}=await modules;
 const results=report.calculateStandardHoursAlerts([],range,[{...employee,role:'Driver',status:'Active',displayName:'Test Driver'}],fullCoverage);
 assert.equal(results.length,3);assert.ok(results.every(x=>x.result==='NO SCHEDULED WORK'));
});
test('invalid duty times prevent a planned rest pass despite empty work intervals',async()=>{
 const {schedule}=await modules;
 assert.ok(schedule.calculatePlannedRestChecks([duty('2026-10-13',0,NaN)],'2026-10-13',fullCoverage).every(x=>x.result==='DATA REVIEW'));
});


test('12th/13th example uses 07:33 anchor, not the arbitrary 13:25 window',async()=>{
 const {schedule,report}=await modules;
 const duties=[{...duty('2026-10-12',453,542),id:'am'},{...duty('2026-10-12',805,1232,[{type:'meal',startMin:905,endMin:953}]),id:'pm'},{...duty('2026-10-13',355,1005,[{type:'meal',startMin:626,endMin:659},{type:'meal',startMin:837,endMin:893}]),id:'next'}];
 const periods=schedule.plannedCountingPeriods(duties,fullCoverage).filter(x=>x.window===1440);
 assert.equal(periods.find(x=>x.start===schedule.serviceMinute('2026-10-12',453)).minutes,566);
 assert.ok(!periods.some(x=>x.start===schedule.serviceMinute('2026-10-12',805)));
 assert.equal(schedule.calculateTurnarounds(duties)[0].restMinutes,563);
 assert.equal(schedule.calculateTurnarounds(duties)[0].status,'compliant');
 assert.ok(!report.calculateStandardHoursAlerts(duties,range,[employee],fullCoverage).some(x=>x.rule.includes('24-hour') && x.result==='PLANNED SHORTFALL'));
 assert.ok(schedule.refreshRosterFatigue(duties,[employee],fullCoverage).every(x=>x.fatigueStatus==='OK'));
});
test('subsequent 8-hour rest does not erase work in an earlier 24-hour period',async()=>{
 const {schedule}=await modules;
 const duties=[{...duty('2026-10-12',360,1140,[{startMin:660,endMin:675},{startMin:960,endMin:1005}]),id:'first'},{...duty('2026-10-13',180,360),id:'second'}];
 const risks=schedule.scheduledWorkRisks(duties,fullCoverage).filter(x=>x.rule==='Planned work: 24-hour counting period');
 assert.ok(risks.some(x=>x.minutes===900 && x.start===schedule.serviceMinute('2026-10-12',360)));
 assert.equal(schedule.calculateTurnarounds(duties)[0].restMinutes,480);
 assert.equal(schedule.calculateTurnarounds(duties)[0].status,'compliant');
});
test('broken shift has no 8-hour requirement between its same-day parts',async()=>{
 const {schedule}=await modules;
 const duties=[{...duty('2026-10-12',420,540),id:'am'},{...duty('2026-10-12',780,1200),id:'pm'},{...duty('2026-10-13',239,300),id:'next'}];
 const gaps=schedule.calculateTurnarounds(duties);
 assert.equal(gaps.length,1);assert.equal(gaps[0].previous.id,'pm');assert.equal(gaps[0].restMinutes,479);assert.equal(gaps[0].shortfallMinutes,1);assert.equal(gaps[0].status,'breach');
 duties[2].startMin=240;assert.equal(schedule.calculateTurnarounds(duties)[0].status,'compliant');
});
test('long overnight duty remains the turnaround frontier across intervening days',async()=>{
 const {schedule}=await modules;
 const duties=[{...duty('2026-10-11',1200,2940),id:'long'},{...duty('2026-10-12',600,700),id:'inside'},{...duty('2026-10-13',360,480),id:'next'}];
 const next=schedule.calculateTurnarounds(duties).find(x=>x.next.id==='next');
 assert.equal(next.previous.id,'long');assert.equal(next.restMinutes,300);assert.equal(next.status,'breach');
});
test('malformed break cannot establish planned rest passes',async()=>{
 const {schedule,report}=await modules;
 const duties=[{...duty('2026-10-13',540,1020,[{type:'crib',startMin:null,endMin:900}]),id:'bad'}];
 assert.deepEqual(schedule.plannedCountingPeriods(duties,fullCoverage),[]);
 assert.ok(schedule.calculatePlannedRestChecks(duties,'2026-10-13',fullCoverage).every(x=>x.result==='DATA REVIEW'));
 assert.ok(report.calculateStandardHoursAlerts(duties,range,[employee],fullCoverage).some(x=>x.rule==='Duty data verification'));
});
test('completed 28-day anchored period detects work and missing full-day rests',async()=>{
 const {schedule}=await modules;
 const duties=Array.from({length:29},(_,i)=>({...duty(schedule.shiftServiceDate('2026-09-15',i),360,1080,[{startMin:660,endMin:720}]),id:'d'+i}));
 const risks=schedule.scheduledWorkRisks(duties,fullCoverage);
 assert.ok(risks.some(x=>x.rule==='Planned work: 28-day counting period' && x.minutes===18480));
 assert.ok(risks.some(x=>x.window===40320 && x.rule.startsWith('Planned rest:') && x.count===0));
});
test('future incomplete period cannot claim a rest shortfall or pass',async()=>{
 const {schedule}=await modules;
 const coverage={start:fullCoverage.start,end:schedule.serviceMinute('2026-10-13',1100)};
 const duties=[{...duty('2026-10-13',540,1020),id:'d'}];
 assert.ok(!schedule.scheduledWorkRisks(duties,coverage).some(x=>x.rule.startsWith('Planned rest:')));
 assert.ok(schedule.calculatePlannedRestChecks(duties,'2026-10-13',coverage).every(x=>x.result==='DATA REVIEW'));
});


test('driver overview combines records into one row and preserves missing-history review',async()=>{
 const {report}=await modules;
 const alerts=[{employeeNumber:'899',driverName:'Test',rule:'Planned rest: 7 continuous hours in 24 hours',result:'PLANNED PASS',assessment:{window:1440,minutes:566}},{employeeNumber:'899',driverName:'Test',rule:'Planned rest: 4 × 24-hour rests in 28 days',result:'DATA REVIEW',assessment:{window:40320}}];
 const gaps=[{employeeNumber:'899',driverName:'Test',previous:duty('2026-10-12',805,1232),next:duty('2026-10-13',355,1005),restMinutes:563,status:'compliant'}];
 const reviews=report.buildFatigueDriverReviews(alerts,gaps,range);
 assert.equal(reviews.length,1);assert.equal(reviews[0].result,'Review information');assert.equal(reviews[0].work24.assessment.minutes,566);assert.equal(reviews[0].gap.restMinutes,563);assert.equal(reviews[0].history,'History needed');
});
test('overview alert takes precedence over passes and uses shortest gap in range',async()=>{
 const {report}=await modules;
 const alerts=[{employeeNumber:'899',driverName:'Test',rule:'Planned rest: 7 continuous hours in 24 hours',result:'PLANNED PASS',assessment:{window:1440,minutes:600}}];
 const gaps=[600,479].map(restMinutes=>({employeeNumber:'899',driverName:'Test',previous:duty('2026-10-12',600,900),next:duty('2026-10-13',400,900),restMinutes,status:restMinutes<480?'breach':'compliant'}));
 const result=report.buildFatigueDriverReviews(alerts,gaps,range)[0];
 assert.equal(result.result,'Planned alert');assert.equal(result.gap.restMinutes,479);
});
test('driver detail retains zero rest, shows actual break records and escapes names',async()=>{
 const {report}=await modules;
 const driver={employeeNumber:'899',driverName:'<script>bad</script>',tone:'breach',result:'Planned alert',turnarounds:[],checks:[{date:'2026-10-13',rule:'Planned rest: 6 night rests in 7 days',result:'PLANNED SHORTFALL',detail:'No night rest',assessment:{window:10080,count:0,required:6}}]};
 const html=report.renderDriverReview(driver,[duty('2026-10-13',540,1020,[{type:'crib',startMin:780,endMin:810}])]);
 assert.match(html,/0 night rests/);assert.match(html,/6 rest blocks below minimum/);assert.match(html,/crib 13:00–13:30/);assert.doesNotMatch(html,/<script>bad/);assert.match(html,/&lt;script&gt;/);
});


test('Review opens only the selected driver and survives updated results',async()=>{
 const {report}=await modules;
 function element(){return {innerHTML:'',hidden:false,dataset:{},setAttribute(key,value){this[key]=value;},querySelector(){return null;},querySelectorAll(){return [...this.innerHTML.matchAll(/data-employee="([^"]+)"/g)].map(match=>({dataset:{employee:match[1]},addEventListener(name,handler){this.click=handler;}}));}};}
 const nodes=Object.fromEntries(['ftRows','ftStandardRows','ftMetrics','ftDriverCounts','ftDriverDetail','ftSummaryPanel','ftDetailPanel','ftSummaryTab','ftDetailTab'].map(id=>[id,element()]));
 // Keep the actual button references returned to the renderer.
 nodes.ftStandardRows.querySelectorAll=function(){this.buttons=[...this.innerHTML.matchAll(/data-employee="([^"]+)"/g)].map(match=>({dataset:{employee:match[1]},addEventListener(name,handler){this.click=handler;}}));return this.buttons;};
 const alerts=['899','900'].map(employeeNumber=>({employeeNumber,driverName:'Driver '+employeeNumber,date:'2026-10-13',rule:'Hours-option verification',result:'DATA REVIEW',detail:'Profile needed'}));
 const view={employeeNumber:'',tab:'summary',duties:[]};
 global.document={getElementById:id=>nodes[id]};
 try {
   view.redraw=()=>report.renderPage([],alerts,range,'','all',view);
   view.redraw();assert.equal(nodes.ftDetailPanel.hidden,true);
   nodes.ftStandardRows.buttons.find(b=>b.dataset.employee==='900').click();
   assert.equal(view.employeeNumber,'900');assert.equal(nodes.ftSummaryPanel.hidden,true);assert.equal(nodes.ftDetailPanel.hidden,false);
   assert.match(nodes.ftDriverDetail.innerHTML,/Driver 900/);assert.doesNotMatch(nodes.ftDriverDetail.innerHTML,/Driver 899/);
   view.redraw();assert.equal(view.employeeNumber,'900');assert.equal(nodes.ftDetailPanel.hidden,false);
 } finally {delete global.document;}
});
