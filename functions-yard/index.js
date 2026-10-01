const {onCall,HttpsError}=require("firebase-functions/v2/https");
const admin=require("firebase-admin");
const {getFirestore,FieldValue}=require("firebase-admin/firestore");
const {randomUUID}=require("node:crypto");
const {identity,fail}=require("./domain");
const {createService}=require("./service");
admin.initializeApp();
const db=getFirestore();
const storageBucket=()=>admin.storage().bucket();
async function person(request){
  if(!request.auth?.uid)throw new HttpsError("unauthenticated","Sign in to use Yard Work.");
  const email=String(request.auth.token?.email || "").trim().toLowerCase();
  const matches=await db.collection("employees").where("email","==",email).limit(2).get();
  if(matches.size>1)throw new HttpsError("permission-denied","More than one employee record uses this email. Ask the Fleet Manager to correct it.");
  const row=matches.docs[0];return identity(request.auth,row?{id:row.id,...row.data()}:null);
}
async function savePhotos(files,recordId,who){
  if(files.length>3)fail("Attach no more than 3 photos.","invalid-argument");
  const prepared=files.map((photo)=>{
    if(!["image/jpeg","image/png","image/webp"].includes(photo.contentType)||typeof photo.base64!=="string"||photo.base64.length>1400000)fail("Use image photos no larger than 1 MB.","invalid-argument");
    const bytes=Buffer.from(photo.base64,"base64");
    const valid=photo.contentType==="image/jpeg"?bytes[0]===255&&bytes[1]===216:photo.contentType==="image/png"?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):bytes.toString("ascii",0,4)==="RIFF"&&bytes.toString("ascii",8,12)==="WEBP";
    if(!valid||!bytes.length||bytes.length>1024*1024)fail("Invalid image photo.","invalid-argument");
    return {bytes,contentType:photo.contentType,name:String(photo.name || "Yard photo").slice(0,120)};
  });
  const saved=[];
  try{
    for(const photo of prepared){
      const path=`yard-photos/${recordId}/${randomUUID()}`,token=randomUUID();
      const bucket=storageBucket();
      await bucket.file(path).save(photo.bytes,{resumable:false,metadata:{contentType:photo.contentType,metadata:{firebaseStorageDownloadTokens:token,uploadedByUid:who.uid}}});
      const url=`https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(path)}?alt=media&token=${token}`;
      saved.push({path,url,name:photo.name});
    }
    return saved;
  }catch(error){await removePhotos(saved);throw error;}
}
async function removePhotos(photos){if(photos.length)await Promise.allSettled(photos.map((photo)=>storageBucket().file(photo.path).delete({ignoreNotFound:true})));}
const service=createService({db,stamp:()=>FieldValue.serverTimestamp(),savePhotos,removePhotos});
function serialise(value){
  if(value?.toDate)return value.toDate().toISOString();
  if(Array.isArray(value))return value.map(serialise);
  if(value&&typeof value==="object")return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,serialise(item)]));
  return value;
}
function endpoint(handler){return onCall({region:"australia-southeast1",maxInstances:10,memory:"256MiB",timeoutSeconds:60},async(request)=>{
  try{return serialise(await handler(await person(request),request.data || {}));}
  catch(error){if(error instanceof HttpsError)throw error;if(["permission-denied","unauthenticated","invalid-argument","failed-precondition"].includes(error.code))throw new HttpsError(error.code,error.message);console.error("Yard operation failed",error);throw new HttpsError("internal","Unable to save or load Yard Work. Try again.");}
});}
exports.pbcYardBoard=endpoint((who)=>service.board(who));
exports.pbcYardHistory=endpoint((who,data)=>service.history(who,data.busId));
exports.pbcYardUpdate=endpoint((who,data)=>service.update(who,data));
