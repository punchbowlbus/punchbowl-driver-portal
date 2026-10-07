const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const modulePromise=fs.readFile(path.join(__dirname,'../public/js/dispatch_fatigue.js'),'utf8')
  .then(source=>import('data:text/javascript;base64,'+Buffer.from(source).toString('base64')));
const duty={startMin:900,endMin:1625,breaks:[
  {type:'meal',startMin:1140,endMin:1170},
  {type:'meal',startMin:1350,endMin:1380}
]};
test('902PM: 15:00–03:05 with two meals does not trigger the false 12-hour breach',async()=>{
  const {calculateFatigue}=await modulePromise;const result=calculateFatigue(duty);
  assert.equal(result.totalSpanMinutes,725);assert.equal(result.unpaidMinutes,60);
  assert.equal(result.paidMinutes,665);assert.equal(result.workMinutes,665);
  assert.equal(result.restIn24hMinutes,null);assert.equal(result.fatigueStatus,'OK');
  assert.equal(result.fatigueWarning,'');
});
test('12-hour net-work boundary still enforces real over-limit work',async()=>{
  const {calculateFatigue}=await modulePromise;
  assert.equal(calculateFatigue({...duty,endMin:1680}).workMinutes,720);
  assert.equal(calculateFatigue({...duty,endMin:1680}).fatigueStatus,'OK');
  const over=calculateFatigue({...duty,endMin:1685});
  assert.equal(over.workMinutes,725);assert.equal(over.fatigueStatus,'BREACH');
  assert.match(over.fatigueWarning,/work exceeds 12 hours/);
});
test('break violations remain breaches',async()=>{
  const {calculateFatigue}=await modulePromise;
  const noBreak=calculateFatigue({...duty,breaks:[]});assert.equal(noBreak.fatigueStatus,'BREACH');
  assert.match(noBreak.fatigueWarning,/15 continuous minutes/);
  assert.match(noBreak.fatigueWarning,/30 min/);assert.match(noBreak.fatigueWarning,/60 min/);
  const late=calculateFatigue({...duty,breaks:[{type:'meal',startMin:1260,endMin:1320}]});
  assert.equal(late.fatigueStatus,'BREACH');assert.match(late.fatigueWarning,/15 continuous minutes/);
});
test('qualifying paid rest is independent of payroll',async()=>{
  const {calculateFatigue}=await modulePromise;
  const result=calculateFatigue({...duty,breaks:duty.breaks.map(b=>({...b,type:'crib',paid:true}))});
  assert.equal(result.paidMinutes,725);assert.equal(result.unpaidMinutes,0);
  assert.equal(result.workMinutes,665);assert.equal(result.fatigueStatus,'OK');
});
test('short, overlapping and out-of-duty breaks cannot inflate rest credit',async()=>{
  const {calculateFatigue}=await modulePromise;
  const result=calculateFatigue({startMin:900,endMin:1625,breaks:[
    {type:'meal',startMin:1140,endMin:1170},{type:'meal',startMin:1150,endMin:1180},
    {type:'meal',startMin:1350,endMin:1360},{type:'meal',startMin:800,endMin:850},
    {type:'meal',startMin:1700,endMin:1800}
  ]});
  assert.equal(result.qualifyingRestMinutes,40);assert.equal(result.workMinutes,675);
});
test('meal rests are not added to continuous off-duty rest',async()=>{
  const {calculateFatigue}=await modulePromise;
  const result=calculateFatigue({...duty,endMin:1950});
  assert.equal(result.has7hContinuousStationaryRest,null);
  assert.doesNotMatch(result.fatigueWarning,/7 continuous hours/);
});
test('legacy false warning refresh preserves independent warnings and original records',async()=>{
  const {refreshLegacyRestBreach}=await modulePromise;
  const original={...duty,id:'old',fatigueStatus:'BREACH',fatigueWarning:'Need at least 12 hours rest in 24 hours.'};
  const refreshed=refreshLegacyRestBreach(original);
  assert.equal(refreshed.fatigueStatus,'OK');assert.equal(refreshed.fatigueWarning,'');
  assert.equal(original.fatigueStatus,'BREACH');
  const turnaround={...original,fatigueWarning:original.fatigueWarning+' Company 8-hour turnaround breach. Rest available: 6h.'};
  const retained=refreshLegacyRestBreach(turnaround);assert.equal(retained.fatigueStatus,'BREACH');
  assert.match(retained.fatigueWarning,/turnaround breach/);assert.doesNotMatch(retained.fatigueWarning,/12 hours rest/);
  const genuine={...original,endMin:1685};assert.equal(refreshLegacyRestBreach(genuine).fatigueStatus,'BREACH');
  const unrelated={...duty,fatigueStatus:'BREACH',fatigueWarning:'Other review required.'};
  assert.match(refreshLegacyRestBreach(unrelated).fatigueWarning,/Other review required/);
});
