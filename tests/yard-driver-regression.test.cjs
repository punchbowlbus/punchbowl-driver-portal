const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const read=file=>fs.readFileSync(path.join(__dirname,'../public',file),'utf8'),main=read('js/main.js');
const access=read('js/yard_access.js').replace(/export /g,'');
const boot=main.slice(main.indexOf('onAuthStateChanged(auth, async (u) => {'));
const linked=main.slice(main.indexOf('async function openLinkedDutyIfRequested()'),main.indexOf('/* =========================================================\n   Auth Boot'));
const driver={employeeNumber:'963',role:'Driver',accessLevel:'Driver',status:'Active',displayName:'Driver',email:'driver@example.test',licenceNumber:'DL123'};
async function login({employee=driver,email='driver@example.test',search='',signedOut=false}={}){
 let callback;const routes=[],redirects=[],notifications=[],errors=[];
 const state={};const ctx=vm.createContext({state,console:{log(){},error(){}},auth:{},provider:{},URLSearchParams,
  window:{location:{search,replace:url=>redirects.push(url)}},localStorage:{setItem(){}},
  els:{contentArea:{style:{},innerHTML:''}},onAuthStateChanged:(auth,cb)=>callback=cb,getEmployeeByEmail:async()=>employee?structuredClone(employee):null,
  isAdminEmail:email=>email==='manager@example.test',renderAuth(){},signInWithPopup(){},signOut(){},stopAllListeners(){},
  registerPortalNotifications:async emp=>notifications.push(emp?.employeeNumber),showError:message=>errors.push(message),go:async id=>routes.push(id),
  db:{},doc:(db,name,id)=>({name,id}),getDoc:async ref=>({exists:()=>true,data:()=>({id:ref.id,driverEmployeeNumber:'963',deleted:false})})});
 vm.runInContext(access+'\n'+linked+'\n'+boot,ctx);
 await callback(signedOut?null:{uid:'google-driver',email});
 return {state,routes,redirects,notifications,errors};
}
test('ordinary drivers and drivers with Yard access keep their personal Driver login and My Work route',async()=>{
 for(const yardAccess of [false,true]){
  const h=await login({employee:{...driver,yardAccess},search:'?page=myWork'});
  assert.equal(h.state.isDriver,true);assert.equal(h.state.isAdmin,false);assert.deepEqual(h.redirects,[]);assert.deepEqual(h.routes,['myWork']);assert.deepEqual(h.notifications,['963']);assert.equal(h.state.employee.licenceNumber,'DL123');
 }
});
test('Driver duty notification links keep opening the assigned duty with or without Yard permission',async()=>{
 for(const yardAccess of [false,true]){
  const h=await login({employee:{...driver,yardAccess},search:'?page=dutySheet&dutySpanId=assigned-duty'});
  assert.deepEqual(h.redirects,[]);assert.deepEqual(h.routes,['jobDetails']);assert.equal(h.state.selectedJobId,'assigned-duty');assert.equal(h.state.driverDutySpans.length,1);
 }
});
test('only the configured company email gets the company redirect; normal drivers and admins retain existing landing pages',async()=>{
 const company=await login({email:'punchbowlcbc1@gmail.com',employee:null});assert.deepEqual(company.redirects,['./yard.html']);assert.deepEqual(company.routes,[]);
 const ordinary=await login({email:'punchbowlcbc2@gmail.com'});assert.deepEqual(ordinary.redirects,[]);assert.deepEqual(ordinary.routes,['notice']);
 const admin=await login({email:'manager@example.test',employee:{...driver,accessLevel:'Admin',yardAccess:true}});assert.equal(admin.state.isAdmin,true);assert.deepEqual(admin.redirects,[]);assert.deepEqual(admin.routes,['operationsDashboard']);
 const yardOnly=await login({employee:{...driver,role:'Yard Man',accessLevel:'Yard Man'}});assert.deepEqual(yardOnly.redirects,['./yard.html']);
});
test('inactive, missing and signed-out accounts do not gain Driver or Yard access',async()=>{
 for(const input of [{employee:{...driver,status:'Inactive',yardAccess:true}},{employee:null},{signedOut:true}]){
  const h=await login(input);assert.equal(h.state.isDriver,false);assert.deepEqual(h.routes,[]);assert.deepEqual(h.redirects,[]);
 }
});
test('service worker installation preloads the shared access helper needed by Driver auth',async()=>{
 const listeners={},cached=[],worker=read('sw.js');
 const context=vm.createContext({self:{addEventListener:(name,fn)=>listeners[name]=fn,skipWaiting(){}},caches:{open:async()=>({addAll:async assets=>cached.push(...assets)})},console});
 vm.runInContext(worker,context);let done;listeners.install({waitUntil:promise=>done=promise});await done;
 assert.ok(cached.includes('/js/main.js'));assert.ok(cached.includes('/js/ui.js'));assert.ok(cached.includes('/js/yard_access.js'));
});
