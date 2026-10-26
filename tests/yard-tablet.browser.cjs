// Real Yard UI + real yard_api + real service/tablet authorization. Firebase transport is mocked.
const {chromium}=require('playwright'),fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const {createTabletAccess,workerUid,TABLET_EMAIL}=require('../functions-yard/tablet'),{createService}=require('../functions-yard/service'),{memoryDb}=require('./yard-memory.cjs');
const root=path.resolve(__dirname,'../public'),users=new Map(),now=()=>Date.now();
const db=memoryDb({'employees/a':{employeeNumber:'101',displayName:'K SOTHISWARAN',role:'Driver',status:'Active',yardAccess:true},'employees/b':{employeeNumber:'102',displayName:'Palad-im',role:'Driver',status:'Active',yardAccess:true},'buses/bus':{fleetNumber:'M07538',status:'Active',fuelType:'Diesel'}});
const auth={getUser:async uid=>{if(!users.has(uid)){const error=new Error('missing');error.code='auth/user-not-found';throw error;}return structuredClone(users.get(uid));},createUser:async input=>users.set(input.uid,{...input,customClaims:{},disabled:false}),updateUser:async(uid,patch)=>users.set(uid,{...users.get(uid),...patch}),setCustomUserClaims:async(uid,claims)=>{users.get(uid).customClaims=claims;},revokeRefreshTokens:async()=>{},verifyIdToken:async token=>{if(token!=='company-token')throw new Error('invalid');return {uid:'company',email:TABLET_EMAIL,email_verified:true,firebase:{sign_in_provider:'google.com'}};}};
const tablet=createTabletAccess({db,auth}),service=createService({db,stamp:()=>new Date().toISOString()}),manager={uid:'manager',name:'Fleet Manager',email:'manager@test',manager:true,employeeNumber:'1'};
const sdk=`
export function initializeApp(config,name){return {name};}
export function getAuth(){if(!window.pinAuth)window.pinAuth={currentUser:JSON.parse(sessionStorage.getItem('testPinUser')||'null'),authStateReady:async()=>{}};return window.pinAuth;}
export const browserSessionPersistence={};export async function setPersistence(){}
export function onAuthStateChanged(auth,callback){window.primaryAuthCallback=callback;queueMicrotask(()=>callback(auth.currentUser));return()=>{};}
export async function signInWithPopup(){} export class GoogleAuthProvider {setCustomParameters(){}}
export async function signOut(auth){auth.currentUser=null;if(auth===window.pinAuth)sessionStorage.removeItem('testPinUser');else window.primaryAuthCallback(null);}
export async function signInWithEmailAndPassword(auth,email,pin){const r=await fetch('/test-signin',{method:'POST',body:JSON.stringify({email,pin})});const result=await r.json();if(result.error)throw Object.assign(new Error(result.error),{code:'auth/invalid-credential'});auth.currentUser=result;sessionStorage.setItem('testPinUser',JSON.stringify(result));}
export function getFunctions(app){return {app};}export function connectAuthEmulator(){}export function connectFunctionsEmulator(){}
export function httpsCallable(functions,name){return async data=>{const r=await fetch('/test-call',{method:'POST',body:JSON.stringify({name,data,worker:functions.app.name==='yard-pin'?window.pinAuth.currentUser:null,manager:new URLSearchParams(location.search).has('testManager')})});const result=await r.json();if(result.error)throw Object.assign(new Error(result.error),{code:'functions/'+result.code});return {data:result};};}
`;
(async()=>{
 const browser=await chromium.launch({headless:true});try{
 const page=await browser.newPage({viewport:{width:768,height:1024}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());let body,type='text/javascript';
  try{
   if(url.hostname==='www.gstatic.com')body=sdk;
   else if(url.pathname==='/test-signin'){
    const input=JSON.parse(route.request().postData()),user=[...users.values()].find(user=>user.email===input.email);
    if(!user||user.password!==input.pin)throw new Error('Incorrect PIN');
    body=JSON.stringify({uid:user.uid,token:{...user.customClaims,auth_time:Math.floor(now()/1000)}});type='application/json';
   }else if(url.pathname==='/test-call'){
    const input=JSON.parse(route.request().postData()),name=input.name.replace('pbcYard','');let result;
    if(name==='TabletRoster')result=await tablet.roster({data:input.data,auth:{uid:'company',token:{email:TABLET_EMAIL,email_verified:true,firebase:{sign_in_provider:'google.com'}}}});
    else if(name==='SetPin')result=await tablet.setPin(input.manager?manager:{manager:false},input.data);
    else{
     const who=input.manager?manager:await tablet.person({auth:input.worker,data:input.data});
     result=name==='Board'?await service.board(who):name==='History'?await service.history(who,input.data.busId,input.data.taskId):await service.update(who,input.data);
    }
    body=JSON.stringify(result);type='application/json';
   }else if(url.pathname==='/js/firebase.js')body=`export const app={name:'primary'},provider={setCustomParameters(){}};export const auth={currentUser:{uid:new URLSearchParams(location.search).has('testManager')?'manager':'company',email:new URLSearchParams(location.search).has('testManager')?'manager@test':'${TABLET_EMAIL}',getIdToken:async()=> 'company-token'}};`;
   else{body=await fs.readFile(root+url.pathname);if(url.pathname.endsWith('.html'))type='text/html';if(url.pathname.endsWith('.css'))type='text/css';}
   await route.fulfill({contentType:type,body});
  }catch(error){await route.fulfill({contentType:'application/json',body:JSON.stringify({error:error.message,code:error.code||'unauthenticated'})});}
 });
 await page.goto('http://tablet.test/yard.html?managerView=1&testManager=1');await page.getByRole('button',{name:'Manage Yard PINs',exact:true}).waitFor();
 for(const [id,pin] of [['a','582194'],['b','846291']]){
  await page.getByRole('button',{name:'Manage Yard PINs',exact:true}).click();await page.locator('#yardSetPinEmployee').selectOption(id);await page.locator('#yardSetPin').fill(pin);await page.locator('#yardConfirmPin').fill(pin);await page.getByRole('button',{name:'Save Employee PIN',exact:true}).click();await page.locator('#yardModal').waitFor({state:'hidden'});
 }
 await page.goto('http://tablet.test/yard.html');await page.getByRole('heading',{name:'Start Yard Work',exact:true}).waitFor();await page.locator('#yardPinEmployee').selectOption('a');await page.locator('#yardLoginPin').fill('111111');await page.getByRole('button',{name:'Start My Yard Work',exact:true}).click();await page.getByText('Unable to sign in. Check the selected employee and six-digit PIN.',{exact:true}).waitFor();
 await page.locator('#yardLoginPin').fill('582194');await page.getByRole('button',{name:'Start My Yard Work',exact:true}).click();await page.getByRole('heading',{name:'Full Fleet',exact:true}).waitFor();assert.equal(await page.locator('#yardIdentity').innerText(),'K SOTHISWARAN');assert.equal(await page.evaluate(async()=> (await import('/js/yard_api.js')).yardAuth.currentUser.email),TABLET_EMAIL);
 assert.equal(await page.getByRole('button',{name:'Assign Yard Task',exact:true}).count(),0);assert.equal(await page.locator('#yardDriverLink').isVisible(),false);
 await page.locator('[data-yard-bus="bus"]').click();await page.getByRole('button',{name:'Start Exterior Wash',exact:true}).click();await page.getByRole('button',{name:'Complete Checklist',exact:true}).click();for(const checkbox of await page.locator('[name="yardChecklist"]').all())await checkbox.check();await page.getByRole('button',{name:'Complete Cleaning',exact:true}).click();await page.locator('#yardModal').waitFor({state:'hidden'});
 const completion=[...db.data.values()].find(row=>row.action==='complete');assert.equal(completion.actor.name,'K SOTHISWARAN');assert.equal(completion.actor.signInMethod,'yard-pin');assert.equal(completion.actor.companyAccount,TABLET_EMAIL);
 await page.reload();await page.getByRole('heading',{name:'Full Fleet',exact:true}).waitFor();assert.equal(await page.locator('#yardIdentity').innerText(),'K SOTHISWARAN');assert.equal(await page.evaluate(async()=> (await import('/js/yard_api.js')).yardAuth.currentUser.email),TABLET_EMAIL);
 await page.getByRole('button',{name:'Change employee / Lock tablet',exact:true}).click();await page.getByRole('heading',{name:'Start Yard Work',exact:true}).waitFor();assert.equal(await page.evaluate(async()=> (await import('/js/yard_api.js')).yardAuth.currentUser.email),TABLET_EMAIL);await page.locator('#yardPinEmployee').selectOption('b');await page.locator('#yardLoginPin').fill('846291');await page.getByRole('button',{name:'Start My Yard Work',exact:true}).click();await page.getByRole('heading',{name:'Full Fleet',exact:true}).waitFor();assert.equal(await page.locator('#yardIdentity').innerText(),'Palad-im');
 await tablet.setPin(manager,{employeeId:'b',pin:'719284'});await page.getByRole('button',{name:'Refresh',exact:true}).click();await page.getByRole('heading',{name:'Start Yard Work',exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.deepEqual(errors,[]);
 console.log('PASS: actual Yard API uses separate PIN auth, manager sets PINs, wrong PIN rejected, company stays signed in, staff switch and reload, correct employee audit, no manager or driver permissions on shared tablet.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
