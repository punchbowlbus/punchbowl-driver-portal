// Runs the actual mechanic page against a local Firebase double; never writes live data.
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '../public');
(async () => {
  const browser = await chromium.launch({executablePath:process.env.CHROMIUM_PATH || '/usr/bin/chromium',headless:true,args:['--no-sandbox']});
  try {
    const sources = await Promise.all((await fs.readdir(root+'/js')).filter(f=>f.endsWith('.js')).map(f=>fs.readFile(root+'/js/'+f,'utf8')));
    const names = new Set();
    for (const source of sources) for (const m of source.matchAll(/import\s*\{([^}]+)\}\s*from\s*["']https:\/\/www.gstatic.com[^"']+["']/g)) for (const n of m[1].split(',')) names.add(n.trim());
    const mocks = {
      collection:'(db,name)=>({name})',
      doc:'(db,name,id)=>typeof name === "string"?{name,id:id||`generated${++window.serial}`}:{name:db.name,id:`generated${++window.serial}`}',
      query:'ref=>ref',
      onSnapshot:'(ref,cb)=>{(window.listeners[ref.name]??=[]).push(cb);cb(window.snapshot(ref.name));return ()=>{};}',
      getDocs:'async ref=>window.snapshot(ref.name)',
      onAuthStateChanged:'(auth,cb)=>{window.authCallbacks.push(cb);setTimeout(()=>cb(auth.currentUser),0);return ()=>{};}',
      serverTimestamp:'()=>null',
      setDoc:'async(ref,data)=>{if(window.saveFailure)throw Error("Save rejected");window.seeds[ref.name].push({id:ref.id,...data});window.writes.push({ref,data});window.emit(ref.name);}',
      runTransaction:'async(db,fn)=>{const writes=[];await fn({get:async ref=>{const data=window.seeds[ref.name].find(r=>r.id===ref.id);return {exists:()=>!!data,data:()=>data};},set:(ref,data,options)=>writes.push({ref,data,options})});for(const w of writes){window.writes.push(w);const rows=window.seeds[w.ref.name],i=rows.findIndex(r=>r.id===w.ref.id);if(i<0)rows.push({id:w.ref.id,...w.data});else rows[i]={...rows[i],...w.data};}for(const w of writes)window.emit(w.ref.name);}',
      ref:'(storage,path)=>({fullPath:path})',
      uploadBytes:'async(ref,file)=>{window.uploads.push(ref.fullPath);if(window.uploadHook)window.uploadHook();}',
      getDownloadURL:'async ref=>{if(window.photoFailure)throw Error("Photo URL failed");return "https://photos.test/"+ref.fullPath;}',
      deleteObject:'async ref=>window.deleted.push(ref.fullPath)',
      arrayUnion:'(...values)=>values',writeBatch:'()=>({set(){},update(){},commit:async()=>{}})',httpsCallable:'()=>async()=>({data:{}})'
    };
    const mock = [...names].map(n=>`export const ${n}=${mocks[n]||'()=>({})'};`).join('\n');
    const dbSource = await fs.readFile(root+'/js/db.js','utf8');
    const mockDb = [...dbSource.matchAll(/export (?:async )?function (\w+)/g)].map(m=>`export const ${m[1]}=${m[1]==='getEmployeeByEmail'?'async()=>({status:"Active",department:"Workshop",role:"Mechanic",displayName:"Test Mechanic",employeeNumber:"123"})':m[1].startsWith('listen')?'cb=>{if(typeof cb==="function")cb([]);return ()=>{};}':'async()=>[]'};`).join('\n');
    const page = await browser.newPage({viewport:{width:1440,height:1000},timezoneId:'Australia/Sydney'});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(()=>{
      window.serial=0;window.listeners={};window.authCallbacks=[];window.writes=[];window.uploads=[];window.deleted=[];
      window.testAuth={currentUser:{uid:'mechanic1',email:'mechanic@example.com',displayName:'Google name'}};
      window.seeds={employees:[],workshopJobs:[],buses:[{id:'bus1',fleetNumber:'M001',rego:'ABC123',status:'Active',depot:'Punchbowl'},{id:'retired',fleetNumber:'Retired',status:'Inactive'}],defectReports:[{id:'driver1',reportNumber:'DR-DRIVER',busId:'bus1',fleetNumber:'M001',safeToDrive:'Yes',status:'New',description:'Driver reported door fault',reportedByName:'Driver One'}]};
      window.snapshot=name=>({docs:(window.seeds[name]||[]).map(d=>({id:d.id,data:()=>d}))});
      window.emit=name=>(window.listeners[name]||[]).forEach(cb=>cb(window.snapshot(name)));
    });
    await page.route('**/*',async route=>{
      const url=new URL(route.request().url());let body,type='text/javascript';
      if(url.hostname==='www.gstatic.com')body=mock;
      else if(url.pathname==='/js/firebase.js')body='export const auth=window.testAuth;export const db={},provider={},storage={};';
      else if(url.pathname==='/js/config.js')body='export const ADMIN_EMAILS=[];';
      else if(url.pathname==='/js/db.js')body=mockDb;
      else {try{body=await fs.readFile(root+url.pathname);if(url.pathname.endsWith('.html'))type='text/html';if(url.pathname.endsWith('.css'))type='text/css';}catch{return route.fulfill({status:404,body:'missing'});}}
      await route.fulfill({body,contentType:type});
    });
    await page.goto('http://workshop.test/mechanic.html');
    await page.locator('#reportDefectBtn').waitFor({state:'visible'});
    const open=async()=>{await page.locator('#reportDefectBtn').click();await page.locator('#mechanicReportBus').waitFor({state:'visible'});await page.waitForFunction(()=>!document.querySelector('#mechanicReportBus').disabled);};
    const fill=async(safety='No')=>{await page.locator('#mechanicReportBus').selectOption('bus1');await page.locator('#mechanicReportCategory').selectOption('Brakes');await page.locator('#mechanicReportSafe').selectOption(safety);await page.locator('#mechanicReportDescription').fill('Mechanic found brake noise');};
    await open();
    assert.equal(await page.locator('#mechanicReportBus option').count(),2,'inactive fleet excluded');
    await page.locator('button[value="save"]').click();
    assert.equal(await page.evaluate(()=>window.writes.length),0,'incomplete form cannot save');
    await fill();
    await page.locator('#mechanicReportWarning').waitFor({state:'visible'});
    await page.locator('#mechanicReportPhotos').setInputFiles({name:'fault.png',mimeType:'image/png',buffer:Buffer.from('photo fixture')});
    await page.locator('button[value="job"]').click();
    await page.locator('#mechanicDefectJobDialog').waitFor({state:'visible'});
    const report=await page.evaluate(()=>window.writes.find(w=>w.ref.name==='defectReports').data);
    assert.equal(report.source,'Mechanic');assert.equal(report.reportedByUid,'mechanic1');assert.equal(report.reportedByName,'Test Mechanic');assert.equal(report.reportedByEmployeeNumber,'123');assert.equal(report.priority,'Critical');assert.equal(report.photoCount,1);assert.equal(report.photos[0].fileName,'fault.png');assert.equal(report.busId,'bus1');
    assert.equal(await page.locator('#mechanicDefectJobPriority').inputValue(),'Safety Critical');
    await page.locator('#mechanicDefectJobCancel').click();
    assert.equal(await page.evaluate(()=>window.seeds.workshopJobs.length),0,'cancelling conversion keeps saved defect without a job');
    await page.locator('[data-create-defect-job="generated1"]').click();
    await page.locator('#mechanicDefectJobSubmit').click();
    await page.waitForFunction(()=>window.seeds.workshopJobs.length===1);
    const job=await page.evaluate(()=>window.seeds.workshopJobs[0]);
    assert.equal(job.source,'Mechanic Defect');assert.equal(job.assignedMechanicEmail,'mechanic@example.com');assert.equal(job.status,'Assigned');assert.equal(job.returnToServiceApproved,false);assert.equal(job.sourceDefectId,'generated1');assert.equal(job.defectPhotos.length,1);
    assert.equal(await page.locator('[data-create-defect-job="generated1"]').count(),0,'linked defect no longer offers a duplicate job');
    await page.locator('#backToQueueBtn').click();
    // Existing driver defects still use the same job-card workflow.
    await page.locator('[data-create-defect-job="driver1"]').click();await page.locator('#mechanicDefectJobSubmit').click();
    await page.waitForFunction(()=>window.seeds.workshopJobs.length===2);
    assert.equal(await page.evaluate(()=>window.seeds.workshopJobs[1].source),'Driver Defect');
    await page.locator('#backToQueueBtn').click();
    await open();await fill('Yes');
    await page.locator('#mechanicReportPhotos').setInputFiles({name:'notes.txt',mimeType:'text/plain',buffer:Buffer.from('not photo')});
    await page.locator('button[value="save"]').click();await page.locator('#mechanicReportMessage.error').waitFor();
    assert.match(await page.locator('#mechanicReportMessage').innerText(),/image files/);
    await page.locator('#mechanicReportPhotos').setInputFiles({name:'fault.png',mimeType:'image/png',buffer:Buffer.from('photo')});
    await page.evaluate(()=>window.saveFailure=true);
    await page.locator('button[value="save"]').click();await page.waitForFunction(()=>document.querySelector('#mechanicReportMessage').textContent==='Save rejected');
    assert.equal(await page.evaluate(()=>window.deleted.length),1,'failed report cleans uploaded photo');
    await page.evaluate(()=>{window.saveFailure=false;window.photoFailure=true;});
    await page.locator('button[value="save"]').click();await page.waitForFunction(()=>document.querySelector('#mechanicReportMessage').textContent==='Photo URL failed');
    assert.equal(await page.evaluate(()=>window.deleted.length),2,'failed URL lookup also cleans uploaded photo');
    await page.evaluate(()=>window.photoFailure=false);
    await page.locator('#mechanicReportPhotos').setInputFiles([]);
    await page.locator('button[value="save"]').click();await page.locator('#mechanicReportDialog').waitFor({state:'hidden'});
    assert.equal(await page.evaluate(()=>window.seeds.defectReports.at(-1).priority),'Medium');
    assert.equal(await page.evaluate(()=>window.seeds.workshopJobs.length),2,'save-only does not create a job');
    // Check the mobile modal fits, and stale identity cannot submit a report.
    await page.setViewportSize({width:390,height:844});await open();await fill();
    assert.equal(await page.evaluate(()=>document.querySelector('#mechanicReportDialog').scrollWidth<=document.querySelector('#mechanicReportDialog').clientWidth),true);
    await page.locator('#mechanicReportPhotos').setInputFiles({name:'fault.png',mimeType:'image/png',buffer:Buffer.from('photo')});
    await page.evaluate(()=>{window.uploadHook=()=>{window.testAuth.currentUser={uid:'other',email:'other@example.com'};};});
    await page.locator('button[value="save"]').click();await page.locator('#mechanicReportDialog').waitFor({state:'hidden'});
    assert.equal(await page.evaluate(()=>window.seeds.defectReports.length),3,'changed identity cannot save');
    assert.equal(await page.evaluate(()=>window.deleted.length),3,'changed identity cleans uploaded photo');
    await page.locator('#reportDefectBtn').waitFor({state:'hidden'});
    assert.deepEqual(errors,[]);
    console.log('PASS mechanic defect reporting: mechanic access, validation, active fleet, photos, save-only, critical safety, conversion/cancel, driver conversion, mobile, failures and changed session');
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exit(1);});
