const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('public/js/bus_allocation.js','utf8');
function load(){
  const nodes={baPrintRows:{},baPrintCount:{},baPrint:{},baPrintTypeSummary:{}};
  const options={checks:[],all:{},set innerHTML(html){this.checks=[...html.matchAll(/data-print-type="([^"]+)"\s*(checked)?/g)].map(m=>({dataset:{printType:m[1]},checked:!!m[2]}));},querySelectorAll(){return this.checks;},querySelector(){return this.all;}};
  nodes.baPrintTypeOptions=options;
  const context=vm.createContext({console,document:{getElementById:id=>nodes[id]||null}});
  const code=source.replace(/^import[\s\S]*?;\n/gm,'').replace(/export function /g,'function ');
  vm.runInContext(code+'\n globalThis.api={sortDepartures,departureMinute,printRowHtml,renderPrintSelection,selectedPrintDuties};',context);
  return {api:context.api,nodes,options};
}
const fixtures=[
 {id:'rail',dutyNumber:'NIGHT',dutyType:'Rail Replacement',startMin:1220,endMin:1595},
 {id:'charter',dutyNumber:'AM',dutyType:'Charter',startMin:355,endMin:700},
 {id:'yard',dutyNumber:'YARD',dutyType:'Yard',startMin:300,endMin:810},
 {id:'overnight',dutyNumber:'NEXT',dutyType:'Charter',startMin:1450,endMin:1520},
 {id:'override',dutyNumber:'OVERRIDE',dutyType:'Rail Replacement',startMin:400,yardDepartureMin:350,endMin:500},
 {id:'missing',dutyNumber:'UNKNOWN',dutyType:'Office'}
];
test('sorts mixed job types by displayed departure, respecting overrides and extended overnight minutes',()=>{
 const {api}=load();const before=JSON.stringify(fixtures);
 assert.equal(api.sortDepartures(fixtures).map(d=>d.id).join(','),'yard,override,charter,rail,overnight,missing');
 assert.equal(JSON.stringify(fixtures),before);
 assert.equal(api.departureMinute({yardDepartureMin:0}),0);
});
test('one or more checkbox selections filter only the print rows without modifying duties',()=>{
 const {api,nodes,options}=load();const before=JSON.stringify(fixtures);
 api.renderPrintSelection(fixtures);
 assert.match(nodes.baPrintCount.textContent,/6 duties/);
 const check=key=>options.checks.find(c=>c.dataset.printType===key);
 options.all.checked=false;options.onchange({target:options.all});
 assert.equal(nodes.baPrint.disabled,true);
 check('charter').checked=true;options.onchange({target:check('charter')});
 assert.match(nodes.baPrintRows.innerHTML,/>AM</);assert.doesNotMatch(nodes.baPrintRows.innerHTML,/>NIGHT</);
 assert.match(nodes.baPrintCount.textContent,/2 duties/);
 check('rail').checked=true;options.onchange({target:check('rail')});
 assert.match(nodes.baPrintCount.textContent,/4 duties/);
 assert.doesNotMatch(nodes.baPrintRows.innerHTML,/>YARD</);
 assert.ok(nodes.baPrintRows.innerHTML.indexOf('OVERRIDE')<nodes.baPrintRows.innerHTML.indexOf('AM'));
 assert.equal(options.all.indeterminate,true);
 assert.equal(JSON.stringify(fixtures),before);
});
test('selection persists across refresh and Select all restores other job types',()=>{
 const {api,nodes,options}=load();api.renderPrintSelection(fixtures);
 options.checks.forEach(c=>{c.checked=c.dataset.printType==='rail';});options.onchange({target:options.checks[0]});
 api.renderPrintSelection(fixtures.slice(0,3));
 assert.match(nodes.baPrintCount.textContent,/1 duties/);
 options.all.checked=true;options.onchange({target:options.all});
 assert.match(nodes.baPrintCount.textContent,/3 duties/);
 assert.equal(nodes.baPrint.disabled,false);
});
test('print row retains seven columns, blank allocation and original extended return clock',()=>{
 const {api}=load();const html=api.printRowHtml({...fixtures[0],driverName:'Test Driver'});
 assert.equal((html.match(/<td\b/g)||[]).length,7);
 assert.match(html,/<td class="ba-print-bus"><\/td>/);
 assert.match(html,/<td>26:35<\/td>/);
 assert.match(api.printRowHtml(fixtures[5]),/<td><\/td>/);
});
test('keeps A4 portrait, margins, repeating header and row-break print protections',()=>{
 for(const rule of ['@page{size:210mm 297mm;margin:8mm}','.ba-print-only thead{display:table-header-group}','.ba-print-only tr{break-inside:avoid;page-break-inside:avoid}','@media print{.ba-print-controls{display:none!important}}'])assert.ok(source.includes(rule),rule);
});
