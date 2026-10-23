const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'../public');
(async()=>{const browser=await chromium.launch({...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--no-sandbox','--disable-dev-shm-usage'],headless:true});
const files=await fs.readdir(root+'/js');const sources=await Promise.all(files.filter(f=>f.endsWith('.js')).map(f=>fs.readFile(root+'/js/'+f,'utf8')));
const exports=new Set();for(const s of sources)for(const m of s.matchAll(/import\s*\{([^}]+)\}\s*from\s*["']https:\/\/www.gstatic.com[^"']+["']/g))for(const n of m[1].split(','))exports.add(n.trim());
const mocks={collection:'(db,name)=>({name})',doc:'(db,name,id)=>({name,id})',query:'ref=>ref',onSnapshot:'(ref,cb)=>{(window.listeners[ref.name]??=[]).push(cb);cb(window.snapshot(ref.name));return ()=>{};}',getDocs:'async ref=>window.snapshot(ref.name)',getDoc:'async()=>({exists:()=>true,data:()=>({status:"Active",accessLevel:"Admin",role:"Mechanic",displayName:"Test User",employeeNumber:"123"})})',onAuthStateChanged:'(auth,cb)=>{setTimeout(()=>cb(auth.currentUser),0);return ()=>{};}',serverTimestamp:'()=>null',writeBatch:'()=>({set(){},update(){},commit:async()=>{}})',arrayUnion:'(...values)=>values',httpsCallable:'()=>async()=>({data:{}})'};
const mock=Array.from(exports).map(n=>`export const ${n}=${mocks[n]||'()=>({})'};`).join('\n');
const dbSource=await fs.readFile(root+'/js/db.js','utf8');const dbNames=[...dbSource.matchAll(/export (?:async )?function (\w+)/g)].map(m=>m[1]);
const mockDb=dbNames.map(n=>`export const ${n}=${n==='getEmployeeByEmail'?'async()=>({status:"Active",accessLevel:"Admin",role:"Mechanic",displayName:"Test User",employeeNumber:"123"})':n.startsWith('listen')?'cb=>{if(typeof cb==="function")cb([]);return ()=>{};}':'async()=>[]'};`).join('\n');
for(const html of ['workshop.html']){
const page=await browser.newPage({timezoneId:'Australia/Sydney',viewport:{width:1640,height:950}});await page.addInitScript(()=>{window.print=()=>{window.top.printedReports??=[];window.top.printedReports.push(document.documentElement.outerHTML);};});const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.addInitScript(()=>{window.listeners={};window.seeds={buses:[{id:'bus1',fleetNumber:'M09104',status:'Active',depot:'Punchbowl',fuelType:'Diesel',regoExpiryDate:'2027-08-01',next90DaySafetyCheckDate:'2026-10-27',nextFireSuppressionCheckDate:'2026-10-20'}],workshopJobs:[{id:'job1',jobNumber:'WJ-2026-001',busId:'bus1',fleetNumber:'M09104',jobType:'Repair',status:'Assigned',assignedMechanic:'Test User',assignedMechanicName:'Test User',assignedMechanicEmployeeNumber:'123',createdAt:'2026-10-01T08:00:00Z'},{id:'job2',jobNumber:'WJ-2026-002',busId:'bus1',fleetNumber:'M09104',jobType:'90 Day Safety Check',status:'Closed',createdAt:'2026-10-01T08:00:00Z',inspectionCompletedDate:'2026-10-01',last90DaySafetyCheckJobId:'job2'}],employees:[]};window.seeds.buses[0].last90DaySafetyCheckJobId='job2';window.seeds.defectReports=[{id:'defect1',reportNumber:'DR-001',fleetNumber:'M09104',busNumber:'M09104',status:'New',category:'Brakes',safeToDrive:'No',description:'Brake noise',defectDate:new Date().toLocaleDateString('en-CA'),reportedAtIso:new Date().toISOString(),workshopJobId:'job1'}];const due=new Date(Date.now()+90*86400000).toLocaleDateString('en-CA');
window.seeds.buses=[
 {id:'bus1',fleetNumber:'M0007',rego:'REGO7',make:'SCANIA',model:'L9402A',depot:'Hannans',status:'Active',fuelType:'Diesel',year:2004,vin:'VIN7',next90DaySafetyCheckDate:due,nextFireSuppressionCheckDate:due,nextRadiatorWashDate:due},
 {id:'bus2',fleetNumber:'M0014',rego:'REGO14',make:'SCANIA',model:'L113CRL',depot:'Hannans',status:'Active',fuelType:'Diesel',year:2000,vin:'VIN14',next90DaySafetyCheckDate:due,nextFireSuppressionCheckDate:due,nextRadiatorWashDate:due},
 {id:'bus3',fleetNumber:'M0408',rego:'REGO408',make:'BYD',depot:'Goulburn',status:'Active',fuelType:'Electric'},
 {id:'bus4',fleetNumber:'M0521',rego:'REGO521',make:'SCANIA',depot:'Hannans',status:'Out of Service',fuelType:'Diesel'},
 ...Array.from({length:35},(_,i)=>({id:'extra'+i,fleetNumber:'X'+String(i).padStart(3,'0'),rego:'EX'+i,make:'BYD',depot:'Goulburn',status:'Active',fuelType:'Electric'}))];
window.seeds.buses[0].last90DaySafetyCheckJobId='job2';
window.snapshot=name=>({docs:(window.seeds[name]||[]).map(b=>({id:b.id,data:()=>b}))});window.emit=name=>(window.listeners[name]||[]).forEach(cb=>cb(window.snapshot(name)));});
await page.route('**/*',async route=>{const url=new URL(route.request().url());let body,type='text/javascript';
if(url.hostname==='www.gstatic.com')body=mock;
else if(url.pathname==='/js/firebase.js')body='export const db={};export const provider={};export const auth={currentUser:{email:"test@example.com",displayName:"Test User",uid:"test"}};export const storage={};';
else if(url.pathname==='/js/config.js')body='export const ADMIN_EMAILS=["test@example.com"];';
else if(url.pathname==='/js/db.js')body=mockDb;
else {try{body=await fs.readFile(root+url.pathname);if(url.pathname.endsWith('.html'))type='text/html';else if(url.pathname.endsWith('.css'))type='text/css';}catch{return route.fulfill({status:404,body:'missing'})}}
await route.fulfill({body,contentType:type});});
await page.goto('http://workshop.test/'+html);await page.waitForTimeout(700);assert.deepEqual(errors,[]);await page.locator('[data-view="fleet"]').click();
// Select a compact set of visible columns. Printing must honour these choices.
await page.locator('#fleetColumnsButton').click();const keys=await page.locator('#fleetColumnOptions input').evaluateAll(inputs=>inputs.map(input=>input.dataset.columnKey));
for(const key of keys){if(key==='fleet')continue;await page.locator('#fleetColumnOptions input[data-column-key="'+key+'"]').setChecked(['rego','vehicle','depot','year'].includes(key));}
await page.locator('#fleetColumnsButton').click();
await page.locator('#fleetSearch').fill('SCANIA');await page.locator('#fleetRegisterDepot').selectOption('Hannans');await page.locator('#fleetRegisterStatus').selectOption('Active');await page.locator('#fleetRegisterFuel').selectOption('Diesel');await page.locator('#fleetRegisterMaintenance').selectOption('not-set');await page.waitForTimeout(100);
await page.locator('[data-fleet-sort="fleet"]').click();
const before=await page.evaluate(()=>({columns:localStorage.getItem('pbc.workshop.fleet.columns.v1'),search:document.getElementById('fleetSearch').value}));
await page.locator('#fleetPrintFiltered').click();await page.waitForFunction(()=>window.printedReports?.length===1);await page.waitForTimeout(30);
const report=page.frames().find(frame=>frame.url()==='about:srcdoc');assert.ok(report,'Print uses an iframe rather than a popup');
assert.equal(await report.locator('tbody tr').count(),2);assert.deepEqual(await report.locator('tbody tr td:first-child').allTextContents(),['M0014','M0007']);
assert.deepEqual(await report.locator('thead th').allTextContents(),['Fleet','Rego','Vehicle','Depot','Year']);
const reportText=await report.locator('body').innerText();assert.match(reportText,/2 vehicles/);assert.match(reportText,/Search: SCANIA/);assert.match(reportText,/Depot: Hannans/);assert.match(reportText,/Fuel: Diesel/);assert.match(reportText,/Maintenance: Not set/);assert.doesNotMatch(reportText,/M0408|M0521|Open record|VIN14/);
assert.deepEqual(await page.evaluate(()=>({columns:localStorage.getItem('pbc.workshop.fleet.columns.v1'),search:document.getElementById('fleetSearch').value})),before);
const printHtml=await report.locator('html').evaluate(el=>el.outerHTML);const preview=await browser.newPage();await preview.setContent(printHtml);await preview.pdf({path:'/tmp/pbc-fleet-filtered-print.pdf',preferCSSPageSize:true,printBackground:true});await preview.screenshot({path:'/tmp/pbc-fleet-print-preview.png',fullPage:true});await preview.close();
await page.evaluate(()=>document.getElementById('fleetRegisterPrintFrame').contentWindow.dispatchEvent(new Event('afterprint')));assert.equal(await page.locator('#fleetRegisterPrintFrame').count(),0);
await page.locator('#fleetSearch').fill('NOT-A-VEHICLE');await page.waitForTimeout(100);assert.equal(await page.locator('#fleetPrintFiltered').isDisabled(),true);assert.equal(await page.evaluate(()=>window.printedReports.length),1);
await page.locator('#fleetClearFilters').click();await page.waitForTimeout(100);assert.equal(await page.locator('#fleetPrintFiltered').isEnabled(),true);
// All rows, including those below the scroll area, and wide column selections.
await page.locator('#fleetColumnsButton').click();for(const key of keys){if(key==='fleet')continue;await page.locator('#fleetColumnOptions input[data-column-key="'+key+'"]').check();}await page.locator('#fleetColumnsButton').click();
await page.locator('#fleetPrintFiltered').click();await page.waitForFunction(()=>window.printedReports.length===2);
const wide=page.frames().find(frame=>frame.url()==='about:srcdoc');const parts=await wide.locator('.print-section').count();assert.ok(parts>1);for(let i=0;i<parts;i++){assert.equal(await wide.locator('.print-section').nth(i).locator('tbody tr').count(),39);assert.ok(await wide.locator('.print-section').nth(i).locator('thead th').count()<=10);}
const wideHtml=await wide.locator('html').evaluate(el=>el.outerHTML);const widePage=await browser.newPage();await widePage.setContent(wideHtml);await widePage.pdf({path:'/tmp/pbc-fleet-wide-print.pdf',preferCSSPageSize:true,printBackground:true});await widePage.close();
for(const width of [1640,1200,900,600]){await page.setViewportSize({width,height:950});assert.equal(await page.locator('#fleetRegisterControls').evaluate(root=>{const bounds=root.getBoundingClientRect();return [...root.querySelectorAll('select,button:not(#fleetResetColumns)')].filter(el=>el.getBoundingClientRect().width>0).every(el=>{const rect=el.getBoundingClientRect();return rect.left>=bounds.left&&rect.right<=bounds.right+1;});}),true,'Filter controls must fit at '+width);}
await page.setViewportSize({width:1640,height:950});await page.screenshot({path:'/tmp/pbc-fleet-print-button.png',fullPage:false});assert.deepEqual(errors,[]);console.log('PASS: filtered rows, sorting, visible columns, print metadata, empty state, all scroll-area rows, wide column grouping, iframe cleanup, and unchanged screen filters.');await page.close();}
await browser.close();})().catch(e=>{console.error(e);process.exit(1)});
