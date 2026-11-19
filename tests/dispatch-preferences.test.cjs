const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('public/js/dispatch_board.js','utf8');
const read=source.slice(source.indexOf('  let dispatchPreferences ='),source.indexOf('  state.dispatchDate = null;'));
const restore=source.slice(source.indexOf('const selectedDriverEmpNos ='),source.indexOf('  const SLOT_MINUTES'));
function open(storage,override=null){
 const c=vm.createContext({localStorage:{getItem:k=>storage[k],setItem:(k,v)=>storage[k]=v},state:{dispatchDate:override},getLocalTodayStr:()=> '2026-11-19',driverSortByEl:{value:'name'},driverViewFilterEl:{value:'working'}});
 vm.runInContext(read+'\nfunction getSelectedDate(){return today;}\n'+restore,c);return c;
}
test('dispatch choices survive a fresh board instance and browser storage reload',()=>{
 const storage={};const first=open(storage);
 vm.runInContext('driverSortByEl.value="start_time";driverViewFilterEl.value="all";selectedDriverEmpNos.add("963");saveDispatchPreferences()',first);
 const second=open(storage);
 assert.equal(second.driverSortByEl.value,'start_time');assert.equal(second.driverViewFilterEl.value,'all');assert.equal(vm.runInContext('selectedDriverEmpNos.has("963")',second),true);
 vm.runInContext('selectedDriverEmpNos.clear();saveDispatchPreferences()',second);
 assert.equal(vm.runInContext('selectedDriverEmpNos.size',open(storage)),0);
});
test('saved date persists; explicit navigation date wins; invalid preferences use defaults',()=>{
 const storage={'dispatch-preferences':JSON.stringify({date:'2026-11-22',sort:'bad',view:'bad',drivers:null})};
 assert.equal(vm.runInContext('today',open(storage)),'2026-11-22');assert.equal(vm.runInContext('today',open(storage,'2026-12-01')),'2026-12-01');
 assert.equal(open(storage).driverSortByEl.value,'name');
 assert.equal(vm.runInContext('today',open({'dispatch-preferences':'broken json'})),'2026-11-19');
});
