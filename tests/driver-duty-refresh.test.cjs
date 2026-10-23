const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../public/js/main.js'),'utf8');
const sheet=fs.readFileSync(path.join(__dirname,'../public/js/driver_duty_sheet.js'),'utf8');
const branch=source.slice(source.indexOf('        if (pageId === "jobDetails")'),source.indexOf('  // Shared menu'))
 .replace(/await import\("\.\/driver_duty_sheet\.js\?v=\d+"\)/,'({renderDriverDutySheet: renderSheet})');
const stop=source.slice(source.indexOf('  function stopAllListeners()'),source.indexOf('async function setShiftConfirmation'));
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function setup(){
 const duty={id:'duty-1',serviceDate:'2026-10-15',driverEmployeeNumber:'486',driverName:'B REYNOLDS',startMin:505,endMin:930};
 const blocks=[
  {id:'am-f',routePairId:'morning',routeDirection:'Forward',startMin:530,endMin:570,jobGroupName:'Morning school job'},
  {id:'am-r',routePairId:'morning',routeDirection:'Return',startMin:620,endMin:650,jobGroupName:'Morning school job'},
  {id:'pm-f',routePairId:'afternoon',routeDirection:'Forward',startMin:735,endMin:762,jobGroupName:'Stanmore PS'},
  {id:'pm-r',routePairId:'afternoon',routeDirection:'Return',startMin:855,endMin:882,jobGroupName:'Stanmore PS'}
 ].map(block=>({...block,dutySpanId:duty.id,serviceDate:duty.serviceDate,assignedDriverEmployeeNumber:'486'}));
 const state={activePage:'jobDetails',selectedJobId:duty.id,driverDutySpans:[duty],blocks:blocks.slice(2),blocksDate:duty.serviceDate,unsubscribeJobDetailsBlocks:null};
 const subscriptions=[];
 const els={contentArea:{innerHTML:''}};
 const context=vm.createContext({state,els,console,window:{},document:{getElementById:()=>null},db:{},collection:()=>({}),getDocs:async()=>({docs:[]}),escapeHtml:v=>String(v??''),pageId:'jobDetails',showError:()=>{},renderPlaceholder:()=>{},updateDutySpanDriverAcknowledgment:()=>{},listenBlocksByDate:(date,callback)=>{const subscription={date,callback,stopped:false};subscriptions.push(subscription);return ()=>{subscription.stopped=true;};}});
 vm.runInContext(sheet.replace(/^import[\s\S]*?;\s*/gm,'').replace('export async function renderDriverDutySheet','async function renderDriverDutySheet')+'\n globalThis.renderSheet=renderDriverDutySheet;',context);
 const render=()=>vm.runInContext('(async()=>{'+branch+'})()',context);
 context.go=async id=>{state.activePage=id;await render();};
 vm.runInContext(stop,context);
 return {state,duty,blocks,subscriptions,els,render,stop:()=>context.stopAllListeners()};
}
test('reopening a stopped duty sheet reloads both complete jobs instead of cached afternoon-only jobs',async()=>{
 const h=setup();await h.render();assert.equal(h.subscriptions.length,1,'A stale cache without a listener must resubscribe');
 h.subscriptions[0].callback(h.blocks);await flush();
 assert.match(h.els.contentArea.innerHTML,/<h2>2 assigned jobs<\/h2>/);assert.match(h.els.contentArea.innerHTML,/Morning school job/);assert.match(h.els.contentArea.innerHTML,/Stanmore PS/);
 assert.equal((h.els.contentArea.innerHTML.match(/driver-duty-job-card /g)||[]).length,2);
 assert.equal((h.els.contentArea.innerHTML.match(/driver-duty-job-section/g)||[]).length,4);
 await h.render();assert.equal(h.subscriptions.length,1,'Live updates must not create duplicate subscriptions');
});
test('adding and removing assigned blocks updates an open duty sheet',async()=>{
 const h=setup();await h.render();h.subscriptions[0].callback(h.blocks.slice(2));await flush();assert.match(h.els.contentArea.innerHTML,/<h2>1 assigned job<\/h2>/);
 h.subscriptions[0].callback(h.blocks);await flush();assert.match(h.els.contentArea.innerHTML,/<h2>2 assigned jobs<\/h2>/);
 h.subscriptions[0].callback([]);await flush();assert.match(h.els.contentArea.innerHTML,/<h2>0 assigned jobs<\/h2>/);
});
test('a date listener refreshes whichever duty is selected on that date',async()=>{
 const h=setup();await h.render();h.subscriptions[0].callback(h.blocks);await flush();
 const other={...h.duty,id:'duty-2',startMin:1000,endMin:1200};h.state.driverDutySpans.push(other);h.state.selectedJobId=other.id;await h.render();
 h.subscriptions[0].callback([...h.blocks,{...h.blocks[0],id:'evening',routePairId:'evening',dutySpanId:other.id,startMin:1050,endMin:1100,jobGroupName:'Evening job'}]);await flush();assert.match(h.els.contentArea.innerHTML,/Evening job/);assert.equal(h.subscriptions.length,1);
});
test('changing dates stops the previous listener and ignores late snapshots',async()=>{
 const h=setup();await h.render();h.subscriptions[0].callback(h.blocks);await flush();
 h.duty.serviceDate='2026-10-16';await h.render();assert.equal(h.subscriptions[0].stopped,true);assert.equal(h.subscriptions.length,2);
 h.subscriptions[0].callback(h.blocks);assert.equal(h.state.blocks,null,'Old-date response cannot replace current data');
});
test('leaving My Work or signing out clears the stopped listener cache',async()=>{
 const h=setup();await h.render();h.subscriptions[0].callback(h.blocks);await flush();h.stop();assert.equal(h.subscriptions[0].stopped,true);assert.equal(h.state.blocks,null);assert.equal(h.state.blocksDate,'');
 await h.render();assert.equal(h.subscriptions.length,2);
});
