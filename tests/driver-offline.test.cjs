const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const read=file=>fs.readFileSync(path.join(__dirname,'../public/',file),'utf8');
const source=read('js/offline_driver_store.js').replace(/export /g,'');
const verified={fromCache:false,hasPendingWrites:false};
const duty={id:'d1',driverEmployeeNumber:'963',driverName:'N RAJAPAKSHA',serviceDate:'2026-11-20',dispatchStatus:'Assigned',startMin:300,endMin:900,assignedBus:'MO007'};
function setup(){
 let now=1000000000;const entries=new Map();
 const storage={getItem:key=>entries.get(key)||null,setItem:(k,v)=>entries.set(k,v),removeItem:k=>entries.delete(k)};
 const context=vm.createContext({});vm.runInContext(source+';globalThis.make=createOfflineStore;',context);
 const make=()=>context.make(storage,()=>now);const store=make();
 store.setUser('u1');store.identify('u1',{employeeNumber:'963'},true);
 return {store,storage,make,advance:ms=>{now+=ms;}};
}
test('only own server-confirmed published duties persist, with no fleet/private fields',()=>{
 const h=setup();const all=[{...duty,email:'private',payRate:22},{...duty,id:'other',driverEmployeeNumber:'other'},{...duty,id:'pending',dispatchStatus:'Pending'},{...duty,id:'deleted',deleted:true}];
 assert.equal(h.store.saveRoster(all,{fromCache:true,hasPendingWrites:false}),false);
 assert.equal(h.store.read(),null);
 assert.equal(h.store.saveRoster(all,{fromCache:false,hasPendingWrites:true}),false);
 assert.equal(h.store.saveRoster(all,verified),true);
 const saved=h.store.read();assert.equal(saved.duties.length,1);assert.equal(saved.duties[0].id,'d1');assert.equal(saved.duties[0].email,undefined);assert.equal(saved.duties[0].payRate,undefined);
});
test('job sections survive unchanged roster sync but are invalidated by duty edits, withdrawal and deletion',()=>{
 const h=setup();h.store.saveRoster([duty],verified);
 const jobs=[{id:'j1',name:'School run',from:'Depot',to:'School',startMin:320,endMin:400,stops:[{from:'Depot',to:'School',startMin:320,endMin:400}],customerEmail:'private'}];
 assert.equal(h.store.saveSheet(duty,jobs),true);assert.equal(h.store.read().details.d1.jobs[0].customerEmail,undefined);
 h.store.saveRoster([duty],verified);assert.equal(h.store.read().details.d1.jobs.length,1);
 h.store.saveRoster([{...duty,assignedBus:'MO018'}],verified);assert.equal(h.store.read().details.d1,undefined);
 assert.equal(h.store.saveSheet(duty,jobs),false,'Late renderer cannot restore stale details');
 h.store.saveRoster([{...duty,dispatchStatus:'Pending'}],verified);assert.equal(h.store.read().duties.length,0);
 h.store.saveRoster([],verified);assert.equal(h.store.read().duties.length,0);
});
test('cancellation remains visible and cannot retain a duty sheet',()=>{
 const h=setup();h.store.saveRoster([duty],verified);h.store.saveSheet(duty,[]);
 h.store.saveRoster([{...duty,dispatchStatus:'Cancelled'}],verified);
 assert.equal(h.store.read().duties[0].dispatchStatus,'Cancelled');assert.equal(h.store.read().details.d1,undefined);
});
test('sign-out, account/employee switch and non-driver login clear private copies',()=>{
 for(const change of [h=>h.store.setUser(''),h=>h.store.setUser('u2'),h=>h.store.identify('u1',{employeeNumber:'963'},false),h=>h.store.identify('u1',{employeeNumber:'941'},true)]){
  const h=setup();h.store.saveRoster([duty],verified);change(h);assert.equal(h.store.read(),null);
 }
});
test('a second tab cannot restore an old owner after sign-out or account switch',()=>{
 const h=setup();h.store.saveRoster([duty],verified);const other=h.make();other.setUser('u1');other.identify('u1',{employeeNumber:'963'},true);
 h.store.setUser('u2');h.store.identify('u2',{employeeNumber:'941'},true);
 assert.equal(other.saveRoster([duty],verified),false);
 h.store.saveRoster([{...duty,driverEmployeeNumber:'941'}],verified);assert.equal(h.store.read().uid,'u2');
 h.store.clear();assert.equal(h.store.saveRoster([duty],verified),false);
});
test('expired copies, malformed data, large data and storage denial fail closed',()=>{
 const h=setup();h.store.saveRoster([duty],verified);h.advance(73*3600000);assert.equal(h.store.read(),null);
 const h2=setup();h2.storage.setItem('pbc-driver-offline-v1','{broken');assert.equal(h2.store.read(),null);
 const h3=setup();h3.storage.setItem=()=>{throw Error('quota');};assert.equal(h3.store.saveRoster([duty],verified),false);
 const h4=setup();assert.equal(h4.store.saveRoster([{...duty,driverName:'x'.repeat(800000)}],verified),false);assert.equal(h4.store.read(),null);
});
test('old job details expire even while roster continues to refresh',()=>{
 const h=setup();h.store.saveRoster([duty],verified);h.store.saveSheet(duty,[]);h.advance(60*3600000);h.store.saveRoster([duty],verified);h.advance(13*3600000);h.store.saveRoster([duty],verified);assert.equal(h.store.read().details.d1,undefined);
});
test('offline entry needs no Firebase, CDN or remote stylesheet',()=>{
 const page=read('offline.html');const module=read('js/offline_driver_page.js');
 assert.doesNotMatch(page,/https?:\/\//);assert.doesNotMatch(module,/firebase|fetch\(|httpsCallable|updateDoc|addDoc/);
 assert.match(read('index.html'),/navigator.onLine === false/);
});
test('service worker preserves offline essentials when an optional asset fails and returns offline entry for app navigation',async()=>{
 const listeners={};const cached=new Set();const offline={offline:true};
 const context=vm.createContext({URL,Response,location:{origin:'https://example.test'},console,
 self:{addEventListener:(n,f)=>listeners[n]=f,skipWaiting(){},clients:{claim:async()=>{}}},
 caches:{open:async()=>({addAll:async assets=>assets.forEach(a=>cached.add(a)),add:async asset=>{if(asset==='/customers.html')throw Error('optional');cached.add(asset);},put(){}}),match:async key=>key==='/offline.html'?offline:undefined},
 fetch:async()=>{throw Error('offline');}});
 vm.runInContext(read('sw.js'),context);let done;listeners.install({waitUntil:p=>done=p});await done;
 assert.ok(cached.has('/js/offline_driver_store.js'));assert.ok(cached.has('/js/yard_access.js'));
 let result;listeners.fetch({request:{url:'https://example.test/index.html?page=dutySheet',mode:'navigate',destination:'document'},respondWith:p=>result=p});assert.equal(await result,offline);
});
