const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('public/js/dispatch_board.js','utf8');
const code=source.slice(source.indexOf('function setDetailPanelCollapsed('),source.indexOf('const unassignedJobsPanelEl'));
test('duty details toggle keeps state, accessibility and arrow consistent across repeated clicks',()=>{
 const classes=()=>{const s=new Set();return{toggle:(k,on)=>on?s.add(k):s.delete(k),contains:k=>s.has(k)}};
 const panel={classList:classes()},area={classList:classes()},detail={hidden:false,innerHTML:'Selected duty'},attrs={},arrow={textContent:'›'},button={setAttribute:(k,v)=>attrs[k]=v,querySelector:()=>arrow};
 const c=vm.createContext({dispatchPreferences:{},saveDispatchPreferences(){},document:{getElementById:id=>id==='dispatchRightPanel'?panel:area},detailPanelEl:detail,toggleDetailPanelBtn:button});vm.runInContext(code,c);
 for(let i=0;i<4;i++){
  button.onclick();const collapsed=i%2===0;
  assert.equal(detail.hidden,collapsed);assert.equal(panel.classList.contains('collapsed'),collapsed);assert.equal(area.classList.contains('details-collapsed'),collapsed);assert.equal(attrs['aria-expanded'],String(!collapsed));assert.equal(attrs['aria-label'],collapsed?'Open duty details':'Close duty details');assert.equal(arrow.textContent,collapsed?'‹':'›');assert.equal(detail.innerHTML,'Selected duty');
 }
});
