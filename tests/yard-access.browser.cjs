const {chromium}=require('playwright'),fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../public');
(async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>{window.employee={employeeNumber:'963',displayName:'K SOTHISWARAN',role:'Driver',accessLevel:'Driver',department:'Operations',employmentType:'Full Time',status:'Active',email:'yard@example.test',licenceNumber:'DL123',daNumber:'DA123'};});
  await page.route('**/*',async route=>{
   const url=new URL(route.request().url());let body,type='text/javascript';
   if(url.pathname==='/test.html'){type='text/html';body='<link rel="stylesheet" href="/styles.css"><div id="contentArea"></div><div id="errorArea"></div><div id="navArea"></div><div id="adminNavArea"></div><script type="module">import {renderEmployeesPage} from "/js/employees.js";import {renderSidebar} from "/js/ui.js";window.renderSidebar=renderSidebar;renderEmployeesPage();</script>';}
   else if(url.pathname==='/js/db.js')body='export function listenEmployees(cb){window.empListener=cb;cb([window.employee]);return()=>{};} export async function getEmployee(){return window.employee;} export async function saveEmployee(employee){window.saved=employee;window.employee={...window.employee,...employee};window.empListener([window.employee]);} export async function deactivateEmployee(){}';
   else if(url.pathname==='/js/main.js')body='export function go(){}';
   else {try{body=await fs.readFile(root+url.pathname);if(url.pathname.endsWith('.css'))type='text/css';}catch{return route.fulfill({status:404,body:'missing'});}}
   await route.fulfill({contentType:type,body});
  });
  await page.goto('http://access.test/test.html');await page.locator('[data-employee-select="963"]').first().click();await page.locator('#editEmployeeBtn').click();await page.locator('#employeeFormWrap').waitFor({state:'visible'});
  await page.getByLabel('Allow Yard Work access').check();assert.match(await page.locator('#employeeAccessHint').innerText(),/Yard Work access is also enabled/);
  await page.getByRole('button',{name:'Save Changes',exact:true}).click();await page.locator('#employeeFormWrap').waitFor({state:'hidden'});
  const saved=await page.evaluate(()=>window.saved);assert.equal(saved.role,'Driver');assert.equal(saved.accessLevel,'Driver');assert.equal(saved.yardAccess,true);assert.equal(saved.licenceNumber,'DL123');assert.equal(saved.daNumber,'DA123');
  await page.locator('[data-employee-select="963"]').first().click();await page.locator('#editEmployeeBtn').click();await page.locator('#employeeFormWrap').waitFor({state:'visible'});assert.equal(await page.getByLabel('Allow Yard Work access').isChecked(),true);
  await page.evaluate(()=>window.renderSidebar({currentUser:{uid:'driver'},isAdmin:false,employee:window.employee,activePage:'myWork'},id=>window.navTo=id));
  assert.equal(await page.locator('[data-nav="myWork"]').count(),1);await page.locator('[data-nav="yardWork"]').click();assert.equal(await page.evaluate(()=>window.navTo),'yardWork');
  await page.getByLabel('Allow Yard Work access').uncheck();await page.getByRole('button',{name:'Save Changes',exact:true}).click();await page.locator('#employeeFormWrap').waitFor({state:'hidden'});
  await page.evaluate(()=>window.renderSidebar({currentUser:{uid:'driver'},isAdmin:false,employee:window.employee,activePage:'myWork'},()=>{}));
  assert.equal(await page.locator('[data-nav="yardWork"]').count(),0);assert.equal(await page.locator('[data-nav="myWork"]').count(),1);
  assert.equal((await page.evaluate(()=>window.saved)).yardAccess,false);assert.deepEqual(errors,[]);
  console.log('PASS: employee additional Yard permission saves/reopens/revokes, driver compliance remains, sidebar has both My Work and Yard Work without admin controls.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
