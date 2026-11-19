const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'../public');
(async()=>{
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
try{
const page=await browser.newPage({viewport:{width:1500,height:1000},timezoneId:'Australia/Sydney'}),errors=[];page.on('pageerror',e=>errors.push(e.message));
const dbSource=await fs.readFile(root+'/js/db.js','utf8'),names=[...dbSource.matchAll(/export (?:async )?function (\w+)/g)].map(m=>m[1]);
const stubs={listenEmployees:'cb=>{queueMicrotask(()=>cb(window.employees));return ()=>{}}',listenBuses:'cb=>{queueMicrotask(()=>cb([]));return ()=>{}}',listenJobGroups:'cb=>{queueMicrotask(()=>cb([]));return ()=>{}}',listenBlocksByDate:'(date,cb)=>{queueMicrotask(()=>cb([]));return ()=>{}}',listenDutySpansByDateRange:'(from,to,cb)=>{window.emitDuties=()=>cb(window.duties.map(s=>({...s})));queueMicrotask(window.emitDuties);return ()=>{}}',updateDutySpanStatusesBulk:'async(entries,status,date)=>{window.bulkCalls.push({entries,status,date});if(window.failBulk)throw Error("Test transaction rejected: no changes");for(const e of entries){const duty=window.duties.find(s=>s.id===e.id);duty.dispatchStatus=status;if(status!=="Assigned")duty.driverAcknowledgment="Pending";}window.emitDuties();}',updateDutySpanDispatchStatus:'async(id,status)=>{window.singleCalls.push({id,status});window.duties.find(s=>s.id===id).dispatchStatus=status;window.emitDuties();}'};
await page.addInitScript(()=>{
localStorage.clear();window.bulkCalls=[];window.singleCalls=[];
window.employees=['Alpha','Beta','No duty'].map((displayName,i)=>({displayName,employeeNumber:String(i+1),role:'Driver',status:'Active'}));
window.duties=[{id:'a',driverEmployeeNumber:'1',startMin:300,endMin:600,dispatchStatus:'Pending'},{id:'b',driverEmployeeNumber:'1',startMin:700,endMin:900,dispatchStatus:'Assigned'},{id:'c',driverEmployeeNumber:'2',startMin:400,endMin:800,dispatchStatus:'Pending'}].map(s=>({...s,serviceDate:'2026-11-20',driverAcknowledgment:'Yes',breaks:[]}));
});
await page.route('**/*',async route=>{
const url=new URL(route.request().url());let body,type='text/javascript';
if(url.pathname==='/') {type='text/html';body='<link rel="stylesheet" href="/styles.css"><div id="contentArea"></div><div id="errorArea"></div><script type="module">import {renderDispatchBoardPage} from "/js/dispatch_board.js";renderDispatchBoardPage();</script>'}
else if(url.pathname==='/js/db.js')body=names.map(n=>`export const ${n}=${stubs[n]||'async()=>[]'};`).join('\n');
else if(url.pathname==='/js/ui.js')body='export const els={contentArea:document.getElementById("contentArea")};export const showError=msg=>document.getElementById("errorArea").textContent=msg;';
else if(url.pathname==='/js/state.js')body='export const state={dispatchDate:"2026-11-20",isAdmin:true};';
else if(url.pathname==='/js/dispatch_fatigue.js')body='export const calculateFatigue=()=>({});export const fatigueStatusLabel=()=>"OK";';
else if(url.pathname==='/js/fatigue_schedule.js')body='export const scheduleCoverage=()=>({});export const refreshRosterFatigue=s=>s;';
else if(url.pathname==='/js/dispatch_assignments.js')body='export const assignBlockToDriver=async()=>{};export const unassignBlockFromDriver=async()=>{};';
else {try{body=await fs.readFile(root+url.pathname);if(url.pathname.endsWith('.css'))type='text/css';}catch{return route.fulfill({status:404,body:'missing'})}}
return route.fulfill({body,contentType:type});
});
await page.goto('http://dispatch.test/');await page.waitForFunction(()=>document.querySelectorAll('[data-bulk-driver]').length===2);assert.deepEqual(errors,[]);
await page.selectOption('#driverViewFilter','all');assert.equal(await page.locator('[data-bulk-driver="3"]').isDisabled(),true);
const detailBefore=await page.locator('#dispatchDetailPanel').innerHTML();
await page.locator('#bulkSelectAll').check();assert.match(await page.locator('#bulkStatusCount').innerText(),/2 drivers selected · 3 duty spans · 2 to change/);
assert.equal(await page.locator('#dispatchDetailPanel').innerHTML(),detailBefore);
await page.click('#bulkStatusReview');assert.equal(await page.locator('.dispatch-bulk-review tbody tr').count(),2);await page.click('#dispatchModalCancel');assert.equal(await page.evaluate(()=>window.bulkCalls.length),0);
await page.click('#bulkStatusReview');await page.click('#dispatchModalConfirm');assert.equal(await page.evaluate(()=>window.bulkCalls.length),1);assert.equal(await page.evaluate(()=>window.duties[1].driverAcknowledgment),'Yes');
assert.match(await page.locator('#bulkStatusCount').innerText(),/^0 drivers/);
await page.locator('#bulkSelectAll').check();await page.selectOption('#bulkStatusTarget','Cancelled');await page.click('#bulkStatusReview');assert.match(await page.locator('#dispatchModalMessage').innerText(),/Assigned jobs are not deleted/);await page.click('#dispatchModalConfirm');assert.equal(await page.evaluate(()=>window.duties.every(s=>s.dispatchStatus==='Cancelled'&&s.driverAcknowledgment==='Pending')),true);
// A changed duty while reviewing requires a new review, with no write.
await page.locator('#bulkSelectAll').check();await page.selectOption('#bulkStatusTarget','Assigned');await page.click('#bulkStatusReview');await page.evaluate(()=>{window.duties[0].startMin=320;window.emitDuties()});await page.click('#dispatchModalConfirm');assert.equal(await page.evaluate(()=>window.bulkCalls.length),2);assert.match(await page.locator('#dispatchPageMessage').innerText(),/changed/);
// Filter changes clear dangerous bulk selections; sort changes retain them.
await page.selectOption('#driverSortBy','start_time');assert.match(await page.locator('#bulkStatusCount').innerText(),/^2 drivers/);await page.selectOption('#driverViewFilter','working');assert.match(await page.locator('#bulkStatusCount').innerText(),/^0 drivers/);
// Existing individual dropdown still invokes its existing update function.
await page.selectOption('[data-dispatch-status="2"]','Assigned');assert.equal(await page.evaluate(()=>window.singleCalls.length),1);
// Existing panels continue to collapse completely.
await page.click('#toggleUnassignedJobsBtn');assert.equal(await page.locator('#unassignedJobsAxisRow').isVisible(),false);await page.click('#toggleDetailPanelBtn');assert.equal(await page.locator('#dispatchDetailPanel').isVisible(),false);
assert.deepEqual(errors,[]);await page.screenshot({path:'/tmp/dispatch-bulk-preview.png',fullPage:true});
console.log('PASS: real dispatch UI selection/review/cancel/confirm, multiple duties, no-op skipping, acknowledgment rules, stale review, filtering, individual controls and panel regression.');
}finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
