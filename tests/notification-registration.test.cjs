const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('public/js/main.js','utf8');
const code=source.slice(source.indexOf('function registerPortalNotifications('),source.indexOf('onMessage(messaging,'));
const employee={employeeNumber:'963',role:'Driver',status:'Active'};
function harness(){
 const calls=[],state={currentUser:{uid:'user1',email:'driver@test.example'},employee};let token='phone1';
 const c=vm.createContext({state,console:{log(){},error(){}},isAdminEmail:()=>false,Notification:{permission:'granted'},window:{Notification:{},matchMedia:()=>({matches:true})},navigator:{userAgent:'Android',platform:'Linux',maxTouchPoints:0},messaging:{},functions:{},auth:{},FCM_VAPID_KEY:'TEST',getToken:async()=>token,deleteToken:async()=>calls.push(['deleteToken']),httpsCallable:(_,name)=>async data=>{calls.push([name,data]);return{data:{registered:true}}},signOut:async()=>{calls.push(['signOut']);state.currentUser=null},showError:msg=>calls.push(['error',msg])});
 vm.runInContext('let notificationRegisteredForEmpNo="",notificationCurrentToken="",notificationRegistrationQueue=Promise.resolve();\n'+code,c);
 return{c,calls,state,setToken:t=>token=t};
}
test('client registers via authenticated callable and refreshes when its token changes',async()=>{
 const h=harness();assert.equal((await h.c.registerPortalNotifications(employee)).ok,true);await h.c.registerPortalNotifications(employee);assert.equal(h.calls.length,1);
 h.setToken('phone2');await h.c.registerPortalNotifications(employee);assert.equal(h.calls.length,2);assert.equal(h.calls[1][0],'registerPortalNotificationDevice');assert.equal(h.calls[1][1].token,'phone2');
});
test('sign out detaches and invalidates only current token before signing out',async()=>{
 const h=harness();await h.c.registerPortalNotifications(employee);await h.c.signOutPortalWithNotificationDevice();
 assert.deepEqual(h.calls.map(c=>c[0]),['registerPortalNotificationDevice','unregisterPortalNotificationDevice','deleteToken','signOut']);assert.equal(h.calls[1][1].token,'phone1');
});
test('queued registration for a previous account cannot run after account changes',async()=>{
 const h=harness();const pending=h.c.registerPortalNotifications(employee);h.state.currentUser={uid:'user2',email:'other@test.example'};const result=await pending;assert.equal(result.status,'account-changed');assert.equal(h.calls.length,0);
});
