// Run after npm --prefix functions-yard ci. Real SDK references; no network or credentials.
const test=require('node:test'),assert=require('node:assert/strict');
const {createRequire}=require('node:module');
const sdk=createRequire(require.resolve('../functions-yard/package.json'));
const {initializeApp}=sdk('firebase-admin/app');
const {getFirestore}=sdk('firebase-admin/firestore');
const {createService}=require('../functions-yard/service');
const firestore=getFirestore(initializeApp({projectId:'demo-yard-task-sdk'},'yard-task-sdk'));
const manager={uid:'manager',employeeNumber:'1',name:'Fleet Manager',manager:true};
const worker={uid:'worker',employeeNumber:'959',name:'K SOTHISWARAN',manager:false};
function setup(){
  const employee={employeeNumber:'959',displayName:worker.name,role:'Driver',accessLevel:'Driver',status:'Active',yardAccess:true};
  const data=new Map([['employees/worker',employee]]);
  const db={
    collection:name=>firestore.collection(name),
    runTransaction:async callback=>{
      const writes=[];
      const result=await callback({
        get:async ref=>({id:ref.id,exists:data.has(ref.path),data:()=>structuredClone(data.get(ref.path))}),
        set:(ref,value)=>writes.push([ref.path,structuredClone(value)])
      });
      writes.forEach(([path,value])=>data.set(path,value));return result;
    }
  };
  return {data,employee,service:createService({db,stamp:()=> '2026-10-26T03:00:00Z',now:()=>new Date('2026-10-26T03:00:00Z')})};
}
const input={type:'general',action:'create',title:'Mow lawns and trim grass',location:'Test',instructions:'from 10:00 to 11:00',priority:'Normal',dueDate:'2026-10-27'};
for(const assigned of [false,true])test(`real Firestore references support new Yard tasks ${assigned?'assigned to a Driver with Yard access':'for anyone available'}`,async()=>{
  const {data,employee,service}=setup();
  const result=await service.update(manager,{...input,assignees:assigned?['worker']:[]});
  assert.equal(result.saved,true);assert.match(result.taskId,/^[A-Za-z0-9]{20}$/);
  assert.notEqual(result.taskId,result.recordId);
  const task=data.get('yardTasks/'+result.taskId);
  assert.equal(task.title,input.title);assert.equal(task.dueDate,input.dueDate);assert.equal(task.status,'Open');
  assert.deepEqual(task.assignees,assigned?[{id:'worker',employeeNumber:'959',name:worker.name}]:[]);
  assert.equal(data.get('yardRecords/'+result.recordId).taskId,result.taskId);
  await service.update(worker,{type:'general',taskId:result.taskId,action:'start'});
  await service.update(worker,{type:'general',taskId:result.taskId,action:'complete',completedDate:'2026-10-26'});
  await service.update(manager,{type:'general',taskId:result.taskId,action:'approve'});
  assert.equal(data.get('yardTasks/'+result.taskId).status,'Completed');
  assert.deepEqual(data.get('employees/worker'),employee);
});
