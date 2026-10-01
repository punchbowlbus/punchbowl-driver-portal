// Browser UI tests run against the real yard service with an in-memory database.
// Firebase Auth and callable transport are stubbed. No external Firebase calls are made.
const {chromium}=require("playwright"),http=require("node:http"),fs=require("node:fs/promises"),path=require("node:path"),assert=require("node:assert/strict");
const {memoryDb}=require("./yard-memory.cjs"),{createService}=require("../functions-yard/service");
const base=path.resolve(__dirname,"../public");
const db=memoryDb({
  "buses/b1":{fleetNumber:"M07538",depot:"Riverwood",fuelType:"Diesel"},
  "buses/b2":{fleetNumber:"M09104",depot:"Hannan's",fuelType:"Diesel"},
  "buses/ev1":{fleetNumber:"EV012",depot:"Riverwood",fuelType:"Electric"},
  "yardFleet/b1":{exterior:{lastDate:"2026-09-23"},interior:{lastDate:"2026-09-24"}},
  "yardFleet/b2":{exterior:{lastDate:"2026-09-30"},interior:{active:{uid:"other",name:"Employee B",startedAt:"2026-10-01T00:00:00Z"}}}
});
const worker={uid:"worker",email:"yard@example.test",name:"Employee A",employeeNumber:"101",manager:false},manager={uid:"manager",email:"manager@example.test",name:"Fleet Manager",employeeNumber:"1",manager:true};
let current=worker;
const service=createService({db,stamp:()=>new Date().toISOString(),now:()=>new Date("2026-10-01T02:00:00Z")});
const server=http.createServer(async(req,res)=>{
  try{const pathname=new URL(req.url,"http://localhost").pathname;const file=path.resolve(base,"."+pathname);if(!file.startsWith(base+path.sep))throw new Error("Invalid path");const body=await fs.readFile(file);res.setHeader("content-type",file.endsWith(".js")?"text/javascript":file.endsWith(".css")?"text/css":"text/html");res.end(body);}catch{res.statusCode=404;res.end("Not found");}
});
(async()=>{
  await new Promise((resolve)=>server.listen(0,"127.0.0.1",resolve));const url=`http://127.0.0.1:${server.address().port}`;
  const bundledModule=process.env.YARD_CHROMIUM_PACKAGE?require(process.env.YARD_CHROMIUM_PACKAGE):null;
  const bundled=bundledModule?.default || bundledModule;
  const browser=await chromium.launch({headless:true,...(bundled?{executablePath:await bundled.executablePath(),args:bundled.args}:{})});const context=await browser.newContext({viewport:{width:1280,height:900}});const page=await context.newPage();const errors=[];page.on("pageerror",(e)=>errors.push(e.message));
  await page.route("https://www.gstatic.com/**",(route)=>route.fulfill({contentType:"text/javascript",body:'export function onAuthStateChanged(auth,cb){queueMicrotask(()=>cb(auth.currentUser));return ()=>{};} export async function signInWithPopup(){} export async function signOut(){}'}));
  await page.route("**/js/yard_api.js",(route)=>route.fulfill({contentType:"text/javascript",body:`export const yardAuth={currentUser:{uid:"${current.uid}",email:"${current.email}"}},yardProvider={};export async function yardCall(name,data={}){const r=await fetch('/__yard/'+name,{method:'POST',body:JSON.stringify(data)});const result=await r.json();if(result.error)throw new Error(result.error);return result;}`}));
  await page.route("**/__yard/*",async(route)=>{try{const operation=route.request().url().split("/").at(-1),data=JSON.parse(route.request().postData()||"{}");const result=operation==="Board"?await service.board(current):operation==="History"?await service.history(current,data.busId):await service.update(current,data);await route.fulfill({contentType:"application/json",body:JSON.stringify(result)});}catch(error){await route.fulfill({contentType:"application/json",body:JSON.stringify({error:error.message})});}});
  await page.goto(url+"/yard.html");await page.getByRole("heading",{name:"Full Fleet",exact:true}).waitFor();
  assert.equal(await page.locator("[data-yard-bus]").count(),3);
  assert.equal(await page.locator("#yardManagerLink").isVisible(),false);
  await page.locator('[data-yard-bus="b1"]').click();await page.getByRole("button",{name:"Start Exterior Wash",exact:true}).click();await page.getByRole("button",{name:"Complete Checklist"}).waitFor();
  await page.getByRole("button",{name:"Complete Checklist"}).click();for(const box of await page.locator('[name="yardChecklist"]').all())await box.check();
  await page.locator("#yardNotes").fill("Exterior completed at Riverwood");await page.getByRole("button",{name:"Submit for Approval"}).click();await page.locator("#yardModal").waitFor({state:"hidden"});
  assert.equal(db.data.get("yardFleet/b1").exterior.pending.name,"Employee A");
  await page.locator('[data-yard-bus="ev1"]').click();await page.getByRole("button",{name:"Open Daily Checks",exact:true}).click();assert.equal(await page.locator("#yardOil").count(),0);
  await page.locator("#yardCoolant").selectOption("OK");await page.locator("#yardTyres").selectOption("OK");await page.locator("#yardCharge").fill("82");await page.locator("#yardCharging").selectOption("Charging");await page.getByRole("button",{name:"Submit Check Update"}).click();await page.locator("#yardModal").waitFor({state:"hidden"});
  assert.equal(db.data.get("yardFleet/ev1").checks.charge,82);
  const previewDir=process.env.YARD_PREVIEW_DIR || require("node:os").tmpdir();
  await page.setViewportSize({width:768,height:1024});await page.screenshot({path:path.join(previewDir,"yard-tablet-preview.png"),fullPage:true});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  // A manager shell uses the same component. Existing workshop modules are excluded from this isolated test.
  current=manager;await page.route("**/workshop.html",async(route)=>{let html=await fs.readFile(path.join(base,"workshop.html"),"utf8");html=html.replace(/<script[\s\S]*?<\/script>/g,"");html=html.replace('</body>','<script type="module" src="./js/yard.js"></script><script>document.querySelectorAll("[data-view]").forEach(b=>b.onclick=()=>{document.querySelectorAll(".view").forEach(v=>v.classList.toggle("active",v.id===b.dataset.view+"View"));});</script></body>');await route.fulfill({contentType:"text/html",body:html});});
  await page.setViewportSize({width:1440,height:1000});await page.goto(url+"/workshop.html");await page.getByRole("button",{name:"Yard Work Queue",exact:true}).click();await page.getByRole("heading",{name:"Yard Work Queue",exact:true}).waitFor();
  await page.locator('[data-yard-bus="b1"]').click();await page.getByRole("button",{name:"Review Completion"}).click();await page.getByRole("button",{name:"Approve Cleaning"}).click();await page.locator("#yardModal").waitFor({state:"hidden"});
  assert.equal(db.data.get("yardFleet/b1").exterior.lastDate,"2026-10-01");assert.equal(db.data.get("yardFleet/b1").exterior.lastBy.name,"Employee A");
  await page.getByRole("button",{name:"Daily Checks",exact:true}).click();assert.equal(await page.locator(".yard-table thead").innerText().then((s)=>s.toLowerCase().includes("oil")),true);
  await page.getByRole("button",{name:"Fleet Overview",exact:true}).click();await page.screenshot({path:path.join(previewDir,"yard-manager-preview.png"),fullPage:true});
  assert.deepEqual(errors,[]);console.log("PASS: full-fleet tablet list, cleaning claim/completion, EV check, manager approval, ownership audit, 768px layout, zero page errors.");
  await browser.close();server.close();
})().catch((error)=>{console.error(error);server.close();process.exit(1);});
