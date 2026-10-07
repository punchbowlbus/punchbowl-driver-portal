const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(process.env.WORKSHOP_ROOT || path.join(__dirname, '../public'));
(async () => {
  const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath:process.env.CHROMIUM_PATH } : {}), headless:true, args:['--no-sandbox','--disable-dev-shm-usage'] });
  try {
    const page = await browser.newPage({ timezoneId:'Australia/Sydney' });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      let body, contentType = 'text/javascript';
      if (url.hostname === 'www.gstatic.com') {
        body = `export const collection=(db,name)=>({name});export const doc=(db,name,id)=>({name,id});
          export const onSnapshot=(ref,cb)=>{(window.listeners[ref.name]??=[]).push(cb);cb(window.snapshot(ref.name));return ()=>{};};
          export const serverTimestamp=()=>null;export const setDoc=async()=>{window.writes++;};export const updateDoc=async()=>{window.writes++;};`;
      } else if (url.pathname === '/js/firebase.js') {
        body = 'export const db={};export const auth={currentUser:null};';
      } else if (url.pathname === '/') {
        contentType = 'text/html';
        body = `<div id="dashboardView"><div class="metrics-grid"></div><section class="panel"><div id="maintenanceDueList"></div></section></div>
          <table><thead><tr><th>Fleet</th><th>Rego</th><th>Vehicle</th><th>Depot</th><th>Km</th><th>Service</th><th>A/C</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody id="fleetTableBody"><tr><td><strong>M0007</strong></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr></tbody></table>
          <script>window.writes=0;window.listeners={};window.seeds={buses:[{id:'bus1',fleetNumber:'M0007',last90DaySafetyCheckDate:'2026-08-31',next90DaySafetyCheckDate:'2026-11-29',last90DaySafetyCheckJobId:'older'}],workshopJobs:[
            {id:'older',busId:'bus1',jobType:'90 Day Safety Check',status:'Closed',inspectionCompletedDate:'2026-08-31'},
            {id:'newer',busId:'bus1',jobType:'90 Day Safety Check',status:'Closed',inspectionCompletedDate:'2026-10-07'},
            {id:'legacy',busId:'bus1',jobType:'90 Day Safety Check',status:'Closed'}]};
          window.snapshot=name=>({docs:(window.seeds[name]||[]).map(item=>({id:item.id,data:()=>item}))});
          window.emit=name=>(window.listeners[name]||[]).forEach(cb=>cb(window.snapshot(name)));</script>
          <script type="module">import '/js/workshop_90day_tracking.js';window.ready=true;</script>`;
      } else {
        body = await fs.readFile(root + url.pathname, 'utf8');
      }
      await route.fulfill({ body, contentType });
    });
    await page.goto('http://workshop.test/');
    await page.waitForFunction(() => window.ready);
    await page.waitForTimeout(200);
    const cell = page.locator('[data-safety90-cell]');
    assert.match(await cell.innerText(), /29 Nov 2026/);
    await page.evaluate(() => { for (let i=0;i<20;i++) { window.emit('buses'); window.emit('workshopJobs'); } });
    await page.waitForTimeout(150);
    assert.equal(await page.evaluate(() => window.writes), 0, 'Viewing historical closed inspections must not write fleet dates');
    assert.match(await cell.innerText(), /29 Nov 2026/);
    await page.evaluate(() => { Object.assign(window.seeds.buses[0], {last90DaySafetyCheckDate:'2026-10-07',next90DaySafetyCheckDate:'2027-01-05',last90DaySafetyCheckJobId:'newer'});window.emit('buses'); });
    await page.waitForTimeout(150);
    assert.match(await cell.innerText(), /05 Jan 2027/);
    await page.evaluate(() => { window.seeds.workshopJobs.reverse();for(let i=0;i<20;i++){window.emit('workshopJobs');window.emit('buses');} });
    await page.waitForTimeout(150);
    assert.match(await cell.innerText(), /05 Jan 2027/);
    assert.equal(await page.evaluate(() => window.writes), 0);
    assert.deepEqual(errors, []);
    console.log('PASS: closed historical and undated jobs never overwrite safety dates; genuine saved date updates still display.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error);process.exit(1); });
