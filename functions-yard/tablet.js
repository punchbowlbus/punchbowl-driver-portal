const {createHash,randomUUID}=require('node:crypto');
const {hasYardAccess,fail,norm}=require('./domain');
const TABLET_EMAIL='punchbowlcbc1@gmail.com';
const workerUid=id=>'yard-pin-'+createHash('sha256').update(id).digest('hex').slice(0,40);
const workerEmail=id=>workerUid(id)+'@yard.punchbowl.invalid';
function isTabletAccount(auth){return Boolean(auth?.uid&&auth.token?.email_verified===true&&norm(auth.token.email)===TABLET_EMAIL&&auth.token.firebase?.sign_in_provider==='google.com');}
function createTabletAccess({db,auth,now=()=>Date.now()}){
 async function employee(id){
  if(typeof id!=='string'||!id||id.includes('/'))fail('Choose a valid employee.','invalid-argument');
  const row=await db.collection('employees').doc(id).get();
  if(!row.exists||!hasYardAccess(row.data()))fail('This employee does not have active Yard Work access.','permission-denied');
  return {...row.data(),id:row.id};
 }
 async function getUser(uid){try{return await auth.getUser(uid);}catch(error){if(error.code==='auth/user-not-found')return null;throw error;}}
 async function roster(request){
  if(!isTabletAccount(request.auth))fail('Sign in with the registered company tablet Google account.','permission-denied');
  let company;try{company=await auth.verifyIdToken(request.data?.companyIdToken,true);}catch{fail('Company tablet sign-in has expired. Sign in again.','unauthenticated');}
  if(company.uid!==request.auth.uid||!isTabletAccount({uid:company.uid,token:company}))fail('Company tablet account does not match.','permission-denied');
  const rows=await db.collection('employees').get();
  return {employees:await Promise.all(rows.docs.filter(row=>hasYardAccess(row.data())).map(async row=>{
   const data=row.data(),user=await getUser(workerUid(row.id));
   return {id:row.id,name:data.displayName||`${data.firstName||''} ${data.lastName||''}`.trim(),employeeNumber:String(data.employeeNumber||row.id),loginEmail:workerEmail(row.id),pinConfigured:Boolean(user&&!user.disabled&&user.customClaims?.yardEmployeeId===row.id)};
  }))};
 }
 async function setPin(manager,input){
  if(!manager.manager||manager.tablet)fail('Fleet Manager access is required.','permission-denied');
  const staff=await employee(input.employeeId);
  if(typeof input.pin!=='string'||!/^\d{6}$/.test(input.pin))fail('Use a six-digit employee PIN.','invalid-argument');
  const uid=workerUid(staff.id),existing=await getUser(uid);
  // Firebase Authentication stores and rate-limits PIN/password credentials.
  // These separate Yard-only users never replace the employee's personal Google account.
  if(existing&&(existing.email!==workerEmail(staff.id)||(existing.customClaims?.yardEmployeeId&&existing.customClaims.yardEmployeeId!==staff.id)))fail("This reserved Yard PIN account is already in use. Contact the system administrator.");
  if(existing)await auth.updateUser(uid,{password:input.pin,disabled:false});
  else await auth.createUser({uid,email:workerEmail(staff.id),password:input.pin,displayName:staff.displayName||String(staff.employeeNumber||staff.id)});
  await auth.setCustomUserClaims(uid,{yardEmployeeId:staff.id,yardPinVersion:randomUUID()});
  await auth.revokeRefreshTokens(uid);
  return {saved:true};
 }
 async function person(request){
  const token=request.auth?.token,id=token?.yardEmployeeId;
  if(typeof id!=='string'||!id||id.includes('/')||request.auth.uid!==workerUid(id))fail('Select your name and enter your Yard PIN.','unauthenticated');
  const companyToken=request.data?.companyIdToken;
  if(typeof companyToken!=='string'||companyToken.length>12000)fail('Company tablet sign-in is required.','unauthenticated');
  let company;try{company=await auth.verifyIdToken(companyToken,true);}catch{fail('Company tablet sign-in has expired. Sign in again.','unauthenticated');}
  if(!isTabletAccount({uid:company.uid,token:company}))fail('This is not the registered company tablet account.','permission-denied');
  const staff=await employee(id),user=await getUser(request.auth.uid);
  if(!user||user.disabled||!token.yardPinVersion||user.customClaims?.yardPinVersion!==token.yardPinVersion||user.customClaims?.yardEmployeeId!==id)fail('Your PIN was reset. Select your name and enter the current PIN.','unauthenticated');
  if(!Number.isFinite(token.auth_time)||now()/1000-token.auth_time>12*60*60)fail('Your Yard session has ended. Enter your PIN again.','unauthenticated');
  return {uid:request.auth.uid,email:staff.email||'',name:staff.displayName||`${staff.firstName||''} ${staff.lastName||''}`.trim(),employeeNumber:String(staff.employeeNumber||id),manager:false,driver:false,tablet:true,companyAccount:TABLET_EMAIL};
 }
 return {roster,setPin,person};
}
module.exports={createTabletAccess,isTabletAccount,TABLET_EMAIL,workerUid,workerEmail};
