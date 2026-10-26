const {fail,text,dateValue,today,hasYardAccess}=require('./domain');
const staff=hasYardAccess;
function createTasks({db,stamp,now,actor,activity,savePhotos,removePhotos}){
  async function update(person,input){
    const action=input.action;
    if(!['create','start','block','handover','complete','approve','return'].includes(action))fail('Invalid yard task action.');
    if(['create','approve','return'].includes(action)&&!person.manager)fail('Fleet Manager access is required.','permission-denied');
    if(action!=='create'&&(typeof input.taskId!=='string'||!input.taskId||input.taskId.includes('/')))fail('Select a valid yard task.');
    const tasks=db.collection('yardTasks');
    // Firestore generates an ID only when doc() is called without an argument.
    const ref=action==='create'?tasks.doc():tasks.doc(input.taskId),recordRef=db.collection('yardRecords').doc();
    const notes=text(input.notes),files=Array.isArray(input.photos)?input.photos:[];
    if(files.length&&!['complete','create'].includes(action))fail('Photos can only accompany task completion.');
    let photos=[];
    try{
      photos=await savePhotos(files,recordRef.id,person);
      await db.runTransaction(async tx=>{
        const snap=await tx.get(ref);let task=snap.exists?snap.data():null;
        if(action==='create'){
          const title=text(input.title,160),location=text(input.location,200),instructions=text(input.instructions);
          if(!title||!location)fail('Enter the task and yard location.');
          if(!['Normal','Urgent'].includes(input.priority))fail('Select a priority.');
          // Due dates can be future dates; validate against the maximum supported date.
          const dueDate=dateValue(input.dueDate,'9999-12-31');
          if(!Array.isArray(input.assignees)||input.assignees.some(v=>typeof v!=='string'))fail('Select yard employees or Anyone available.');
          const assignees=[...new Set(input.assignees)];
          if(assignees.length){
            const employees=await Promise.all(assignees.map(id=>{if(!id||id.includes('/'))fail('Invalid employee.');return tx.get(db.collection('employees').doc(id));}));
            if(employees.some(e=>!e.exists||!staff(e.data())))fail('Select active employees with Yard Work access.');
            task={assignees:employees.map(e=>({id:e.id,employeeNumber:String(e.data().employeeNumber||e.id),name:e.data().displayName||`${e.data().firstName||''} ${e.data().lastName||''}`.trim()}))};
          }else task={assignees:[]};
          task={...task,title,location,instructions,priority:input.priority,dueDate,status:'Open',instructionPhotos:photos,createdAt:stamp(),createdBy:actor(person),active:null};
        }else{
          if(!task)fail('Yard task no longer exists.');
          const own=task.active?.uid===person.uid;
          if(action==='start'){
            if(!['Open','Handed Over','Blocked','Returned'].includes(task.status)||task.active)fail('This task is already claimed or completed.');
            if(task.assignees.length&&!task.assignees.some(e=>e.employeeNumber===person.employeeNumber)&&!person.manager)fail('This task is assigned to another employee.','permission-denied');
            task={...task,status:'In Progress',active:{...actor(person),startedAt:stamp()}};
          }else if(['handover','block','complete'].includes(action)){
            if(!own||task.status!=='In Progress')fail('Start this task under your own account first.','permission-denied');
            if(action!=='complete'&&!notes)fail('Describe the remaining work or problem.');
            task={...task,status:action==='complete'?'Waiting Review':action==='block'?'Blocked':'Handed Over',active:null,notes};
            if(action==='complete')Object.assign(task,{completedBy:actor(person),completedAt:stamp(),performedDate:dateValue(input.completedDate,today(now())),photos});
          }else{
            if(task.status!=='Waiting Review')fail('This task is not waiting for review.');
            if(action==='return'&&!notes)fail('Explain the work still required.');
            task={...task,status:action==='approve'?'Completed':'Returned',review:{...actor(person),notes,reviewedAt:stamp()}};
          }
        }
        const record=activity(person,'task_'+action,null,{type:'general',taskId:ref.id,title:task.title,location:task.location,status:task.status,notes,photos,performedDate:task.performedDate||null});
        tx.set(ref,{...task,updatedAt:stamp(),updatedBy:actor(person)});tx.set(recordRef,record);
      });
      return {saved:true,taskId:ref.id,recordId:recordRef.id};
    }catch(error){await removePhotos(photos);throw error;}
  }
  return {update};
}
module.exports={createTasks,staff};
