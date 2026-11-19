const test=require('node:test'),assert=require('node:assert/strict');
const {createDeviceRegistry,recipientTokens,keyFor,ownedRecipientTokens}=require('../functions-notifications/devices');
function memory(){
 const records=new Map(),del={__delete:true};let queue=Promise.resolve();
 const merge=(a,b)=>{a={...(a||{})};for(const[k,v]of Object.entries(b)){if(v?.__delete)delete a[k];else if(v&&typeof v==='object'&&!Array.isArray(v))a[k]=merge(a[k],v);else a[k]=v;}return a};
 const snap=path=>({id:path.split('/').at(-1),ref:ref(path),exists:records.has(path),data:()=>structuredClone(records.get(path))});
 function ref(path){return{path,get:async()=>snap(path)}}
 function collection(name,filters=[]){return{doc:id=>ref(name+'/'+id),where:(k,op,v)=>collection(name,[...filters,[k,v]]),get:async()=>({docs:[...records.keys()].filter(p=>p.startsWith(name+'/')&&filters.every(([k,v])=>records.get(p)[k]===v)).map(snap)})}}
 const db={doc:ref,collection,runTransaction:fn=>{const p=queue.then(async()=>{const writes=[];const result=await fn({get:async r=>snap(r.path),set:(r,d,o)=>writes.push(()=>records.set(r.path,o?.merge?merge(records.get(r.path),d):structuredClone(d))),delete:r=>writes.push(()=>records.delete(r.path)),update:(r,d)=>writes.push(()=>{let data=records.get(r.path);for(const[k,v]of Object.entries(d)){const parts=k.split('.');if(parts.length===1)data=merge(data,{[k]:v});else {data=structuredClone(data);let target=data;for(const part of parts.slice(0,-1))target=target[part]??=( {} );if(v?.__delete)delete target[parts.at(-1)];else target[parts.at(-1)]=v;}}records.set(r.path,data)})});writes.forEach(w=>w());return result});queue=p.catch(()=>{});return p}};
 const registry=createDeviceRegistry({db,FieldValue:{delete:()=>del,serverTimestamp:()=>123},HttpsError:class extends Error{constructor(code,msg){super(msg);this.code=code}},resolveRecipient:async request=>({type:'employee',ref:ref('employees/'+request.auth.uid)})});
 const request=(uid,token)=>({auth:{uid,token:{email:uid+'@test.example',email_verified:true}},data:{token}});
 for(const uid of ['1','2'])records.set('employees/'+uid,{email:uid+'@test.example',status:'Active'});
 return{records,db,registry,request};
}
test('second device is added without replacing first; legacy token is included only once',async()=>{
 const h=memory();h.records.get('employees/1').fcmToken='phone1';await h.registry.register(h.request('1','phone1'));await h.registry.register(h.request('1','phone2'));
 assert.deepEqual(recipientTokens(h.records.get('employees/1')).sort(),['phone1','phone2']);
});
test('shared browser token moves exclusively to new account and stale logout cannot remove it',async()=>{
 const h=memory();h.records.get('employees/1').fcmToken='shared';await h.registry.register(h.request('1','shared'));await h.registry.register(h.request('2','shared'));
 assert.deepEqual(recipientTokens(h.records.get('employees/1')),[]);assert.deepEqual(recipientTokens(h.records.get('employees/2')),['shared']);
 assert.deepEqual(await h.registry.unregister(h.request('1','shared')),{unregistered:false});assert.equal(h.records.get('portalNotificationDevices/'+keyFor('shared')).uid,'2');
});
test('logout removes only that device, preserving other phones',async()=>{
 const h=memory();await h.registry.register(h.request('1','phone1'));await h.registry.register(h.request('1','phone2'));await h.registry.unregister(h.request('1','phone1'));
 assert.deepEqual(recipientTokens(h.records.get('employees/1')),['phone2']);
});
test('unverified/anonymous/inactive registration cannot write device ownership',async()=>{
 const h=memory();await assert.rejects(h.registry.register({data:{token:'secret'}}));const r=h.request('1','phone');r.auth.token.email_verified=false;await assert.rejects(h.registry.register(r));h.records.get('employees/1').status='Inactive';await assert.rejects(h.registry.register(h.request('1','phone')));assert.equal(h.records.has('portalNotificationDevices/'+keyFor('phone')),false);
});
test('send-token selection excludes managed devices owned by another recipient, preserves legacy devices',async()=>{
 const h=memory();await h.registry.register(h.request('2','managed'));assert.deepEqual(await ownedRecipientTokens(h.db,{fcmToken:'managed',fcmDevices:{a:{token:'legacy'}}},'employees/1'),['legacy']);
});
