const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {identity,hasYardAccess}=require('../functions-yard/domain');
const {createService}=require('../functions-yard/service');
const {memoryDb}=require('./yard-memory.cjs');
const driver={employeeNumber:'963',displayName:'Driver and Yard',role:'Driver',accessLevel:'Driver',department:'Operations',status:'Active',yardAccess:true,licenceNumber:'DL123',daNumber:'DA123'};
const auth={uid:'driver-yard',token:{email:'driver@example.test',email_verified:true}};
const source=file=>fs.readFileSync(path.join(__dirname,'../public/js',file),'utf8');
const context=vm.createContext({});vm.runInContext(source('yard_access.js').replace(/export /g,''),context);
test('additional Yard permission preserves Driver access and cannot confer manager privileges',()=>{
 const who=identity(auth,driver);assert.equal(who.driver,true);assert.equal(who.manager,false);
 for(const employee of [driver,{...driver,yardAccess:false},{...driver,yardAccess:'true'},{...driver,status:'Inactive'},{...driver,deleted:true},{...driver,role:'Yard Man',accessLevel:'Yard Man',yardAccess:false}]){
  context.employee=employee;assert.equal(vm.runInContext('hasYardAccess(employee)',context),hasYardAccess(employee));
 }
 context.employee=driver;assert.equal(vm.runInContext('hasDriverAccess(employee)',context),true);assert.equal(vm.runInContext('isYardOnly(employee)',context),false);
 for(const employee of [{...driver,yardAccess:false},{...driver,status:'Inactive'},{...driver,deleted:true}])assert.throws(()=>identity(auth,employee),/active Yard Man/);
});
test('additional Yard staff appear for assignment and can claim work without changing their primary role',async()=>{
 const db=memoryDb({'employees/963':driver,'employees/other':{...driver,employeeNumber:'other',yardAccess:false}});
 const svc=createService({db,stamp:()=> '2026-10-23T01:00:00Z'}),who=identity(auth,driver),manager={uid:'manager',manager:true,name:'Fleet Manager',email:'manager@example.test',employeeNumber:'1'};
 const board=await svc.board(manager);assert.equal(board.employees.length,1);assert.equal(board.employees[0].employeeNumber,'963');
 const result=await svc.update(manager,{type:'general',action:'create',title:'Clean yard',location:'Yard',priority:'Normal',dueDate:'2026-10-30',assignees:['963']});
 await svc.update(who,{type:'general',taskId:result.taskId,action:'start'});
 assert.equal(db.data.get('yardTasks/'+result.taskId).active.uid,auth.uid);
 await assert.rejects(svc.update(who,{type:'general',action:'create'}),/Fleet Manager/);
 db.data.set('employees/963',{...driver,yardAccess:false});assert.equal((await svc.board(manager)).employees.length,0);
 await assert.rejects(svc.update(manager,{type:'general',action:'create',title:'Test',location:'Yard',priority:'Normal',dueDate:'2026-10-30',assignees:['963']}),/Yard Work access/);
 assert.equal(db.data.get('employees/963').role,'Driver');
});
test('saving and revoking Yard permission persists a boolean while preserving driver and licence fields',async()=>{
 const dbSource=source('db.js'),saveSource=dbSource.slice(dbSource.indexOf('export async function saveEmployee('),dbSource.indexOf('export async function getEmployee(')).replace('export ','');
 let saved;const ctx=vm.createContext({db:{},doc:()=>({}),getDoc:async()=>({exists:()=>true,data:()=>({createdAt:'original'})}),setDoc:async(ref,value)=>{saved=value;},serverTimestamp:()=> 'now'});
 vm.runInContext(saveSource,ctx);ctx.employee=driver;await vm.runInContext('saveEmployee(employee)',ctx);
 assert.equal(saved.yardAccess,true);assert.equal(saved.role,'Driver');assert.equal(saved.accessLevel,'Driver');assert.equal(saved.licenceNumber,'DL123');assert.equal(saved.daNumber,'DA123');assert.equal(saved.createdAt,'original');
 ctx.employee={...driver,yardAccess:false};await vm.runInContext('saveEmployee(employee)',ctx);assert.equal(saved.yardAccess,false);
});
test('auth boot redirects Yard-only staff but keeps a driver with additional Yard permission in the driver portal',()=>{
 const main=source('main.js'),section=main.slice(main.indexOf('// Yard staff enter'),main.indexOf('// ✅ ADD THIS (you are missing it)'));
 let destination;const ctx=vm.createContext({state:{isAdmin:false,employee:driver},window:{location:{replace:url=>{destination=url;}}},isYardOnly:employee=>{context.employee=employee;return vm.runInContext('isYardOnly(employee)',context);}});
 vm.runInContext(`function routeYardOnly(){${section}} routeYardOnly();`,ctx);assert.equal(destination,undefined);
 ctx.state.employee={...driver,role:'Yard Man',accessLevel:'Yard Man'};vm.runInContext('routeYardOnly()',ctx);assert.equal(destination,'./yard.html');
});
