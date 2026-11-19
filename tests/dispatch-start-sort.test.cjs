const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('public/js/dispatch_board.js', 'utf8');
const body = source.slice(source.indexOf('  function getActiveDrivers()'), source.indexOf('  function getDriverSelectorName'));
function sorted(mode, spans, view = 'all') {
  const employeesCache = ['Zulu','Alpha','Beta','No duty'].map((displayName,i)=>({displayName,employeeNumber:String(i+1),role:'Driver',status:'Active'}));
  const context = {employeesCache,dutySpansCache:spans,driverSortByEl:{value:mode},driverViewFilterEl:{value:view},selectedDriverEmpNos:new Set(),getSelectedDate:()=> '2026-11-22',getDriverDutySpans:emp=>spans.filter(s=>s.driverEmployeeNumber===emp&&s.serviceDate==='2026-11-22'),getAssignedBlocksForDriver:()=>[]};
  return Array.from(vm.runInNewContext(body+'\ngetActiveDrivers().map(d=>d.displayName)', context));
}
const span=(emp,start,date='2026-11-22')=>({driverEmployeeNumber:emp,startMin:start,serviceDate:date});
test('start sort uses earliest duty on selected date, midnight first, no duty last',()=>{
 assert.deepEqual(sorted('start_time',[span('1',900),span('1',300),span('2',600),span('3',0),span('4',1,'2026-11-21')]),['Beta','Zulu','Alpha','No duty']);
});
test('ties and absent starts sort alphabetically; extended hours stay after same-day starts',()=>{
 assert.deepEqual(sorted('start_time',[span('1',1500),span('2',300),span('3',300),span('4','')]),['Alpha','Beta','Zulu','No duty']);
 assert.deepEqual(sorted('start_time',[span('1','bad'),span('2',null),span('3',-1)]),['Alpha','Beta','No duty','Zulu']);
});
test('existing name, employee number, and working filters remain available',()=>{
 assert.deepEqual(sorted('name',[]),['Alpha','Beta','No duty','Zulu']);
 assert.deepEqual(sorted('empno',[]),['Zulu','Alpha','Beta','No duty']);
 assert.deepEqual(sorted('start_time',[span('1',300)],'working'),['Zulu']);
 assert.match(source, /<option value="start_time">Start time<\/option>/);
});
