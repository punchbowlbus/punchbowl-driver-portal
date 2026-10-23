const {chromium}=require('playwright'),assert=require('node:assert/strict');
const {start}=require('../tools/yard-local.cjs');
(async()=>{
  const app=await start({port:0,dataPath:null});let browser;
  try{
    const module=process.env.YARD_CHROMIUM_PACKAGE?require(process.env.YARD_CHROMIUM_PACKAGE):null,bundled=module?.default||module;
    browser=await chromium.launch({headless:true,...(bundled?{executablePath:await bundled.executablePath(),args:bundled.args}:{})});
    const page=await browser.newPage({viewport:{width:768,height:1024}}),origin=`http://127.0.0.1:${app.port}`,errors=[],external=[];
    page.on('pageerror',error=>errors.push(error.message));page.on('request',r=>{if(!r.url().startsWith(origin))external.push(r.url());});
    page.on('dialog',dialog=>dialog.accept('1'));
    await page.goto(origin+'/yard.html');await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.getByRole('heading',{name:'Full Fleet',exact:true}).waitFor();
    assert.equal(await page.locator('[data-yard-bus]').count(),3);
    await page.locator('[data-yard-bus="M07538"]').click();await page.getByRole('button',{name:'Start Exterior Wash',exact:true}).click();await page.getByRole('button',{name:'Complete Checklist'}).click();
    for(const box of await page.locator('[name="yardChecklist"]').all())await box.check();
    await page.locator('#yardPhotoFiles').setInputFiles({name:'sample.jpg',mimeType:'image/jpeg',buffer:await page.screenshot({type:'jpeg'})});
    await page.getByRole('button',{name:'Complete Cleaning'}).click();await page.locator('#yardModal').waitFor({state:'hidden'});
    await page.reload();await page.getByRole('heading',{name:'Full Fleet',exact:true}).waitFor();assert.equal(await page.locator('body').innerText().then(s=>s.includes('Waiting approval')),false);
    await page.getByRole('button',{name:'Sign out / Change employee',exact:true}).click();await page.getByRole('button',{name:'Sign in',exact:true}).waitFor();
    page.removeAllListeners('dialog');page.on('dialog',dialog=>dialog.accept('3'));
    await page.goto(origin+'/yard.html?managerView=1');await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.getByRole('heading',{name:'Yard Work Queue',exact:true}).waitFor();
    assert.equal(app.db.data.get('yardFleet/M07538').exterior.lastBy.name,'K SOTHISWARAN');
    const completion=[...app.db.data.values()].find(row=>row.action==='complete');assert.equal(completion.photos.length,1);assert.equal(completion.photos[0].url.startsWith('data:image/jpeg;base64,'),true);
    // Assign a general task to both shifts on the shared tablet.
    await page.getByRole('button',{name:'Assign Yard Task',exact:true}).click();
    await page.locator('#yardTaskTitle').fill('Trim entrance trees');await page.locator('#yardTaskLocation').fill('Riverwood entrance');
    await page.locator('#yardTaskInstructions').fill('Clear entrance branches');
    for(const checkbox of await page.locator('[name="yardAssignee"]').all())await checkbox.check();
    await page.getByRole('button',{name:'Create Yard Task',exact:true}).click();await page.locator('#yardModal').waitFor({state:'hidden'});
    assert.equal(await page.getByText('Trim entrance trees',{exact:true}).count(),1);
    async function switchEmployee(choice,manager=false){
      await page.getByRole('button',{name:'Sign out / Change employee',exact:true}).click();
      page.removeAllListeners('dialog');page.on('dialog',dialog=>dialog.accept(choice));
      await page.goto(origin+'/yard.html'+(manager?'?managerView=1':''));
      await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.getByRole('heading',{name:manager?'Yard Work Queue':'Full Fleet',exact:true}).waitFor();
    }
    await switchEmployee('1');
    await page.locator('[data-yard-bus="M07538"]').click();await page.getByRole('button',{name:'Start Interior Clean + Mop',exact:true}).click();
    await page.getByRole('button',{name:'Hand over',exact:true}).click();await page.locator('#yardReason').fill('Swept; mopping remains');await page.getByRole('button',{name:'Save Update',exact:true}).click();await page.locator('#yardModal').waitFor({state:'hidden'});
    await page.getByRole('button',{name:'Yard Tasks',exact:true}).click();await page.getByRole('button',{name:'Open Task',exact:true}).click();
    await page.getByRole('button',{name:'Start / Accept Task',exact:true}).click();await page.locator('#yardTaskNotes').fill('Entrance done; rear branches remain');await page.getByRole('button',{name:'Hand over',exact:true}).click();await page.locator('#yardModal').waitFor({state:'hidden'});
    await switchEmployee('2');
    await page.locator('[data-yard-bus="M07538"]').click();assert.equal(await page.getByText('Handover from K SOTHISWARAN: Swept; mopping remains',{exact:true}).count(),1);
    await page.getByRole('button',{name:'Start Interior Clean + Mop',exact:true}).click();await page.getByRole('button',{name:'Complete Checklist'}).click();for(const box of await page.locator('[name="yardChecklist"]').all())await box.check();await page.getByRole('button',{name:'Complete Cleaning',exact:true}).click();await page.locator('#yardModal').waitFor({state:'hidden'});
    await page.getByRole('button',{name:'Yard Tasks',exact:true}).click();await page.getByRole('button',{name:'Open Task',exact:true}).click();
    await page.getByRole('button',{name:'Start / Accept Task',exact:true}).click();await page.locator('#yardTaskNotes').fill('All branches cleared');await page.getByRole('button',{name:'Submit Completed Task',exact:true}).click();await page.locator('#yardModal').waitFor({state:'hidden'});
    await switchEmployee('3',true);await page.getByRole('button',{name:'Yard Tasks',exact:true}).click();await page.getByRole('button',{name:'Open Task',exact:true}).click();await page.getByRole('button',{name:'Approve Task',exact:true}).click();await page.locator('#yardModal').waitFor({state:'hidden'});
    const task=[...app.db.data].find(([key])=>key.startsWith('yardTasks/'))[1];assert.equal(task.status,'Completed');assert.equal(task.completedBy.name,'Palad-im');
    assert.equal(app.db.data.get('yardFleet/M07538').interior.lastBy.name,'Palad-im');
    assert.equal(await page.getByRole('button',{name:'Approve Cleaning',exact:true}).count(),0);
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
    console.log('PASS: Node-only browser sign-in, cleaning completion, reload, shift handover, shared tablet employee switching, manager-assigned yard tasks and review, tablet layout; zero Firebase/external requests.');
  }finally{await browser?.close();await new Promise(resolve=>app.server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
