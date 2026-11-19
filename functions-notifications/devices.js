const {createHash}=require('node:crypto');
const keyFor=token=>createHash('sha256').update(token).digest('hex');
function recipientTokens(data={}){
 return [...new Set([String(data.fcmToken||'').trim(),...Object.values(data.fcmDevices||{}).map(device=>String(device?.token||'').trim())].filter(Boolean))];
}
async function ownedRecipientTokens(db,data,path){
 const tokens=recipientTokens(data);
 const allowed=await Promise.all(tokens.map(async token=>{
  const owner=await db.collection('portalNotificationDevices').doc(keyFor(token)).get();
  return !owner.exists||owner.data().recipientPath===path?token:null;
 }));
 return allowed.filter(Boolean);
}
function createDeviceRegistry({db,FieldValue,HttpsError,resolveRecipient}){
 const validate=request=>{
  if(!request.auth?.uid||request.auth.token?.email_verified!==true)throw new HttpsError('unauthenticated','A verified signed-in account is required.');
  const token=String(request.data?.token||'').trim();
  if(!token||token.length>4096)throw new HttpsError('invalid-argument','A valid notification device token is required.');
  return token;
 };
 async function register(request){
  const token=validate(request),key=keyFor(token),recipient=await resolveRecipient(request);
  const registry=db.collection('portalNotificationDevices').doc(key);
  // Clear legacy single-token registrations belonging to a previous account on
  // the same browser, as well as the registry's previous multi-device owner.
  const [employees,admins]=await Promise.all(['employees','portalNotificationUsers'].map(name=>db.collection(name).where('fcmToken','==',token).get()));
  const legacyRefs=[...employees.docs,...admins.docs].map(s=>s.ref);
  await db.runTransaction(async tx=>{
   const old=await tx.get(registry),oldData=old.exists?old.data():{};
   const paths=new Set([recipient.ref.path,...legacyRefs.map(r=>r.path)]);
   if(oldData.recipientPath)paths.add(oldData.recipientPath);
   const refs=[...paths].map(p=>db.doc(p)),snapshots=await Promise.all(refs.map(r=>tx.get(r)));
   const target=snapshots.find(s=>s.ref.path===recipient.ref.path);
   if(recipient.type==='employee'&&(!target?.exists||String(target.data().status||'').toLowerCase()!=='active'||String(target.data().email||'').toLowerCase()!==String(request.auth.token.email||'').toLowerCase()))throw new HttpsError('permission-denied','This employee is no longer active.');
   snapshots.forEach((s,i)=>{
    if(!s.exists||refs[i].path===recipient.ref.path)return;
    const patch={['fcmDevices.'+key]:FieldValue.delete()};
    if(String(s.data().fcmToken||'').trim()===token)patch.fcmToken=FieldValue.delete();
    tx.update(refs[i],patch);
   });
   tx.set(recipient.ref,{...(recipient.profile||{}),fcmDevices:{[key]:{token,uid:request.auth.uid,updatedAt:FieldValue.serverTimestamp()}},fcmTokenUpdatedAt:FieldValue.serverTimestamp()},{merge:true});
   tx.set(registry,{uid:request.auth.uid,recipientPath:recipient.ref.path,updatedAt:FieldValue.serverTimestamp()});
  });
  return {registered:true,recipient:recipient.publicProfile||null};
 }
 async function unregister(request){
  const token=validate(request),key=keyFor(token),registry=db.collection('portalNotificationDevices').doc(key);
  return db.runTransaction(async tx=>{
   const current=await tx.get(registry);
   if(!current.exists||current.data().uid!==request.auth.uid)return {unregistered:false};
   const ref=db.doc(current.data().recipientPath),snapshot=await tx.get(ref);
   if(snapshot.exists){
    const patch={['fcmDevices.'+key]:FieldValue.delete(),fcmTokenUpdatedAt:FieldValue.serverTimestamp()};
    if(String(snapshot.data().fcmToken||'').trim()===token)patch.fcmToken=FieldValue.delete();
    tx.update(ref,patch);
   }
   tx.delete(registry);return {unregistered:true};
  });
 }
 return {register,unregister};
}
module.exports={keyFor,recipientTokens,ownedRecipientTokens,createDeviceRegistry};
