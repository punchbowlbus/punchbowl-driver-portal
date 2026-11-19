const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {JSDOM}=require(process.env.JSDOM_MODULE||'jsdom');
const dom=new JSDOM('<details id="log"></details>',{url:'https://portal.test',runScripts:'outside-only'}),w=dom.window;
let fail=false;const calls=[];
const timestamp=Date.parse('2026-11-19T15:00:00Z');
const rows=[{id:'1',driverName:'Alpha <img src=x>',employeeNumber:'963',eventType:'assigned',dutySpanId:'d1',dutyNumber:'D1',serviceDate:'2026-11-20',timestamp,status:'accepted',acceptedDevices:2,failedDevices:0,reason:'',errorCode:''},{id:'2',driverName:'Beta',employeeNumber:'943',eventType:'job-updated',dutySpanId:'d2',timestamp,status:'failed',acceptedDevices:0,failedDevices:1,reason:'retry-limit',errorCode:'messaging/server-unavailable'}];
Object.assign(w,{functions:{},escapeHtml:s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),httpsCallable:(_,name)=>async data=>{calls.push({name,data});if(fail)throw Error('Read unavailable');return{data:{rows:data.kind==='duty'?rows:[{...rows[0],employeeNumber:'',driverName:'All recipients',dutySpanId:'',eventType:'general'}],eventCount:2}}}});
const source=fs.readFileSync('public/js/notification_delivery_ui.js','utf8').replace(/import[^;]+;/g,'').replace(/export /g,'');vm.runInContext(source,dom.getInternalVMContext());
const root=w.document.getElementById('log');w.mountNotificationDeliveryLog(root);
const q=s=>root.querySelector(s),change=(s,v)=>{q(s).value=v;q(s).dispatchEvent(new w.Event('change',{bubbles:true}))},tick=()=>new Promise(r=>setImmediate(r));
(async()=>{
assert.equal(calls.length,0);root.open=true;root.dispatchEvent(new w.Event('toggle'));await tick();assert.equal(q('[data-log-rows]').children.length,2);assert.equal(root.querySelector('img'),null);assert.match(root.textContent,/does not confirm phone delivery/);
q('[data-log-driver]').value='963';q('[data-log-driver]').dispatchEvent(new w.Event('input'));assert.equal(q('[data-log-rows]').children.length,1);assert.match(q('[data-log-rows]').textContent,/Firebase accepted/);
change('[data-log-date]','2026-11-19');assert.match(q('[data-log-rows]').textContent,/No results/);change('[data-log-date]','2026-11-20');assert.match(q('[data-log-rows]').textContent,/Alpha/);
q('[data-log-clear]').click();change('[data-log-status]','failed');assert.match(q('[data-log-rows]').textContent,/Beta/);assert.doesNotMatch(q('[data-log-rows]').textContent,/Alpha/);
q('[data-log-clear]').click();change('[data-log-kind]','general');await tick();assert.equal(q('[data-log-driver]').disabled,true);assert.match(q('[data-log-rows]').textContent,/All recipients/);
fail=true;q('[data-log-refresh]').click();await tick();assert.match(q('[data-log-message]').textContent,/Read unavailable/);assert.equal(q('[data-log-refresh]').disabled,false);
assert.ok(calls.every(c=>c.name==='getNotificationDeliveryLog'));console.log('PASS: read-only log UI, lazy loading, driver/date/result/category filters, Sydney date boundary, escaped content and refresh error handling.');
})().catch(error=>{console.error(error);process.exitCode=1}).finally(()=>w.close());
