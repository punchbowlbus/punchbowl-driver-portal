const test=require('node:test'),assert=require('node:assert/strict');
const {createTabletAccess,workerUid,TABLET_EMAIL,isTabletAccount}=require('../functions-yard/tablet');
const {memoryDb}=require('./yard-memory.cjs');
const now=Date.parse('2026-10-23T01:00:00Z');
const company={uid:'company-google',token:{email:TABLET_EMAIL,email_verified:true,firebase:{sign_in_provider:'google.com'}}};
const manager={uid:'manager',name:'Fleet Manager',employeeNumber:'1',manager:true};
function setup(){
 const db=memoryDb({'employees/a':{employeeNumber:'101',displayName:'K SOTHISWARAN',role:'Driver',accessLevel:'Driver',status:'Active',yardAccess:true,email:'personal@example.test'},'employees/b':{employeeNumber:'102',displayName:'Palad-im',role:'Driver',accessLevel:'Driver',status:'Active',yardAccess:true},'employees/no':{displayName:'Driver only',role:'Driver',status:'Active'}});
 const users=new Map([['personal-google',{uid:'personal-google',email:'personal@example.test',customClaims:{driver:true}}]]),copy=value=>structuredClone(value);
 const auth={getUser:async uid=>{if(!users.has(uid)){const e=new Error('missing');e.code='auth/user-not-found';throw e;}return copy(users.get(uid));},createUser:async input=>{users.set(input.uid,copy({...input,customClaims:{},disabled:false}));return input;},updateUser:async(uid,input)=>{users.set(uid,{...users.get(uid),...input});},setCustomUserClaims:async(uid,claims)=>{users.get(uid).customClaims=copy(claims);},revokeRefreshTokens:async()=>{},verifyIdToken:async token=>{if(token!=='company-token')throw new Error('bad token');return {uid:company.uid,...company.token};}};
 const access=createTabletAccess({db,auth,now:()=>now});
 const request=id=>({auth:{uid:workerUid(id),token:{...users.get(workerUid(id)).customClaims,auth_time:now/1000}},data:{companyIdToken:'company-token'}});
 return {access,db,users,auth,request};
}
test('only the verified company Google account can list Yard PIN staff; no personal credentials are returned',async()=>{
 const {access}=setup();await assert.rejects(access.roster({auth:{...company,token:{...company.token,email:'other@test'}}}),/company/);
 await assert.rejects(access.roster({auth:company,data:{companyIdToken:'revoked'}}),/expired/);
 assert.equal(isTabletAccount({...company,token:{...company.token,email_verified:false}}),false);
 assert.equal(isTabletAccount({...company,token:{...company.token,firebase:{sign_in_provider:'password'}}}),false);
 const rows=(await access.roster({auth:company,data:{companyIdToken:"company-token"}})).employees;assert.equal(rows.length,2);assert.equal(rows[0].pinConfigured,false);assert.equal(rows[0].name,'K SOTHISWARAN');assert.equal(JSON.stringify(rows).includes('personal@example.test'),false);
});
test('manager creates PIN identities separately from personal Driver accounts, with no manager privilege',async()=>{
 const {access,users,request}=setup();await assert.rejects(access.setPin({manager:false},{employeeId:'a',pin:'123456'}),/Fleet Manager/);
 await assert.rejects(access.setPin(manager,{employeeId:'a',pin:'1234'}),/six-digit/);
 await assert.rejects(access.setPin(manager,{employeeId:'no',pin:'123456'}),/active Yard/);
 const original=structuredClone(users.get('personal-google'));await access.setPin(manager,{employeeId:'a',pin:'582194'});
 assert.deepEqual(users.get('personal-google'),original);
 const who=await access.person(request('a'));assert.equal(who.name,'K SOTHISWARAN');assert.equal(who.employeeNumber,'101');assert.equal(who.manager,false);assert.equal(who.driver,false);assert.equal(who.companyAccount,TABLET_EMAIL);
 assert.equal((await access.roster({auth:company,data:{companyIdToken:"company-token"}})).employees[0].pinConfigured,true);
 await access.setPin(manager,{employeeId:'b',pin:'846291'});assert.notEqual((await access.person(request('a'))).uid,(await access.person(request('b'))).uid);
});
test('PIN resets, account disablement, revoked Yard access, inactive staff and expired sessions block use immediately',async()=>{
 const {access,db,users,request}=setup();await access.setPin(manager,{employeeId:'a',pin:'582194'});const old=request('a');
 await access.setPin(manager,{employeeId:'a',pin:'846291'});await assert.rejects(access.person(old),/reset/);
 const fresh=request('a');await assert.rejects(access.person({...fresh,data:{}}),/Company tablet/);
 await assert.rejects(access.person({...fresh,data:{companyIdToken:'forged'}}),/expired/);
 await assert.rejects(access.person({...fresh,auth:{...fresh.auth,uid:'different'}}),/Select your name/);
 await assert.rejects(access.person({...fresh,auth:{...fresh.auth,token:{...fresh.auth.token,auth_time:now/1000-43201}}}),/session has ended/);
 users.get(workerUid('a')).disabled=true;await assert.rejects(access.person(fresh),/reset/);users.get(workerUid('a')).disabled=false;
 const employee=db.data.get('employees/a');db.data.set('employees/a',{...employee,yardAccess:false});await assert.rejects(access.person(fresh),/active Yard/);
 db.data.set('employees/a',{...employee,status:'Inactive'});await assert.rejects(access.person(fresh),/active Yard/);
 db.data.set('employees/a',{...employee,deleted:true});await assert.rejects(access.person(fresh),/active Yard/);
});

test('a reserved PIN UID collision never modifies an unrelated personal account',async()=>{
 const {access,users}=setup();users.set(workerUid('a'),{uid:workerUid('a'),email:'unrelated@example.test',customClaims:{driver:true}});
 await assert.rejects(access.setPin(manager,{employeeId:'a',pin:'582194'}),/already in use/);
 assert.equal(users.get(workerUid('a')).email,'unrelated@example.test');assert.equal(users.get(workerUid('a')).password,undefined);
});
