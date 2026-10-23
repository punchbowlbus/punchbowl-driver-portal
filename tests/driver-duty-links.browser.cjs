const fs=require('node:fs/promises');
const path=require('node:path');
const assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'../public');
(async()=>{
 const browser=await chromium.launch({...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 try{
  const page=await browser.newPage({timezoneId:'Australia/Sydney'});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',async route=>{
   const url=new URL(route.request().url());let body,contentType='text/javascript';
   if(url.hostname==='www.gstatic.com')body=`export const collection=(db,name)=>({name});export const doc=(db,name,id)=>({name,id});export const getDocs=async()=>({docs:[]});export const getDoc=async ref=>{window.linkReads++;if(window.failRead)throw new Error('Read failed');return {id:ref.id,exists:()=>true,data:()=>({id:ref.id,deleted:true})};};`;
   else if(url.pathname==='/js/firebase.js')body='export const db={};';
   else if(url.pathname==='/js/ui.js')body='export const els={contentArea:document.getElementById("contentArea")};';
   else if(url.pathname==='/'){
    contentType='text/html';body=`<main id="contentArea"></main><script type="module">
     import {renderDriverDutySheet} from '/js/driver_duty_sheet.js';window.linkReads=0;window.yesCount=0;
     window.duty={id:'current',driverEmployeeNumber:'972',driverName:'C ANDREWS',serviceDate:'2026-10-20',startMin:515,endMin:870,assignedBus:'M09659',dispatchStatus:'Assigned',breaks:[{type:'meal',startMin:600,endMin:630}]};
     window.blocks=[{id:'f',routePairId:'school',jobGroupName:"ST MAROUN'S COLLEGE",routeDirection:'Forward',startMin:555,endMin:570},{id:'r',routePairId:'school',jobGroupName:"ST MAROUN'S COLLEGE",routeDirection:'Return',startMin:840,endMin:855}].map(b=>({...b,dutySpanId:'deleted-duty',serviceDate:'2026-10-20',assignedDriverEmployeeNumber:'972'}));
     window.draw=()=>renderDriverDutySheet({dutySpan:window.duty,blocks:window.blocks,onYes:()=>window.yesCount++,onNo:()=>{},onBack:()=>{}});await window.draw();window.ready=true;
    </script>`;
   }else body=await fs.readFile(root+url.pathname,'utf8');
   await route.fulfill({body,contentType});
  });
  await page.goto('http://driver.test/');await page.waitForFunction(()=>window.ready);
  assert.equal(await page.locator('.driver-duty-job-card').count(),1);assert.equal(await page.locator('.driver-duty-job-section').count(),2);assert.match(await page.locator('.driver-duty-jobs-heading').innerText(),/1 assigned job/);assert.match(await page.locator('.driver-duty-job-card').innerText(),/ST MAROUN/);
  await page.locator('#yesBtn').click();assert.equal(await page.evaluate(()=>window.yesCount),1);
  await page.evaluate(async()=>{window.blocks.push({...window.blocks[0],id:'second',routePairId:'second',dutySpanId:'current',jobGroupName:'Second complete job',startMin:645,endMin:660});await window.draw();});assert.equal(await page.locator('.driver-duty-job-card').count(),2);
  await page.evaluate(async()=>{window.blocks=window.blocks.filter(b=>b.dutySpanId==='current');await window.draw();});assert.equal(await page.locator('.driver-duty-job-card').count(),1);assert.match(await page.locator('.driver-duty-job-card').innerText(),/Second complete job/);
  await page.evaluate(async()=>{window.blocks[0].assignedDriverEmployeeNumber='999';await window.draw();});assert.equal(await page.locator('.driver-duty-job-card').count(),0);
  await page.evaluate(async()=>{window.blocks[0].assignedDriverEmployeeNumber='972';window.blocks[0].dutySpanId='unknown';window.failRead=true;await window.draw();});assert.match(await page.locator('[role="alert"]').innerText(),/could not be verified/);assert.equal(await page.locator('.driver-duty-job-card').count(),0);
  assert.deepEqual(errors,[]);console.log('PASS: C ANDREWS orphan-linked round trip renders; updates, removal, confirmation, driver isolation and read failures behave correctly.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
