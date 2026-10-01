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
    await page.getByRole('button',{name:'Submit for Approval'}).click();await page.locator('#yardModal').waitFor({state:'hidden'});
    await page.reload();await page.getByRole('heading',{name:'Full Fleet',exact:true}).waitFor();assert.equal(await page.locator('body').innerText().then(s=>s.includes('Waiting approval')),true);
    await page.getByRole('button',{name:'Sign out',exact:true}).click();await page.getByRole('button',{name:'Sign in',exact:true}).waitFor();
    page.removeAllListeners('dialog');page.on('dialog',dialog=>dialog.accept('3'));
    await page.goto(origin+'/yard.html?managerView=1');await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.getByRole('heading',{name:'Yard Work Queue',exact:true}).waitFor();
    await page.locator('[data-yard-bus="M07538"]').click();await page.getByRole('button',{name:'Review Completion'}).click();await page.getByRole('button',{name:'Approve Cleaning'}).click();await page.locator('#yardModal').waitFor({state:'hidden'});
    assert.equal(app.db.data.get('yardFleet/M07538').exterior.lastBy.name,'Yard Employee A');
    const completion=[...app.db.data.values()].find(row=>row.action==='complete');assert.equal(completion.photos.length,1);assert.equal(completion.photos[0].url.startsWith('data:image/jpeg;base64,'),true);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
    console.log('PASS: Node-only browser sign-in, cleaning completion, reload, manager approval, tablet layout; zero Firebase/external requests.');
  }finally{await browser?.close();await new Promise(resolve=>app.server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
