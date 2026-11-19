const test=require('node:test'), assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('public/js/dispatch_board.js','utf8');
const setter=source.slice(source.indexOf('function setUnassignedPanelState('),source.indexOf('function renderUnassignedBlockDetail('));
const handlers=source.slice(source.indexOf('toggleUnassignedJobsBtn.onclick ='),source.indexOf('unassignedJobsSearchEl.oninput ='));
function harness(){
 const classes=new Set(),attributes={},chevron={},button={},density={},saved=[];let renders=0;
 const c=vm.createContext({unassignedJobsPanelEl:{classList:{remove:(...v)=>v.forEach(x=>classes.delete(x)),add:v=>classes.add(v)}},toggleUnassignedJobsBtn:Object.assign(button,{setAttribute:(k,v)=>attributes[k]=v,querySelector:()=>chevron}),unassignedDensityBtn:density,localStorage:{setItem:(k,v)=>saved.push(v)},renderUnassignedJobs:()=>renders++,blocksCache:[],getSelectedDate:()=> '2026-11-20'});
 vm.runInContext('let unassignedDensity="compact",lastOpenUnassignedDensity="compact";\n'+setter+handlers,c);
 return {set:s=>vm.runInContext(`setUnassignedPanelState(${JSON.stringify(s)})`,c),button,density,attributes,chevron,classes,saved,get renders(){return renders;}};
}
test('minimise and reopen restore expanded height with correct control state',()=>{
 const h=harness();h.set('expanded');h.button.onclick();
 assert.deepEqual([...h.classes],['collapsed']);assert.equal(h.attributes['aria-expanded'],'false');assert.equal(h.density.textContent,'Show');assert.equal(h.chevron.textContent,'›');
 h.button.onclick();assert.deepEqual([...h.classes],['expanded']);assert.equal(h.attributes['aria-expanded'],'true');assert.equal(h.density.textContent,'Compact');
 h.density.onclick();assert.deepEqual([...h.classes],['compact']);h.button.onclick();h.density.onclick();assert.deepEqual([...h.classes],['compact']);assert.equal(h.renders,6);
});
test('saved collapsed state reopens and invalid saved state falls back safely',()=>{
 const h=harness();h.set('collapsed');h.density.onclick();assert.deepEqual([...h.classes],['compact']);h.set('bad-state');assert.deepEqual([...h.classes],['compact']);
});
test('collapse hides both columns through the shared axis container',()=>{
 const css=fs.readFileSync('public/styles.css','utf8');
 assert.match(css,/\.dispatch-unassigned-panel\.collapsed \.dispatch-unassigned-axis-row\s*\{\s*display:\s*none;/);
 assert.match(source,/id="unassignedJobsAxisRow" class="dispatch-unassigned-axis-row"/);
});
