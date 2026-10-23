const {TYPES,CHECKLISTS,fail,text,today,dateValue,busSnapshot,validateChecks}=require("./domain");
const {createTasks,staff}=require('./tasks');
const recordTime=(value)=>value?.toMillis?.() || Date.parse(value) || 0;
function createService({db,stamp,now=()=>new Date(),savePhotos=async()=>[],removePhotos=async()=>{}}) {
  const actor=(person)=>({uid:person.uid,name:person.name,email:person.email,employeeNumber:person.employeeNumber});
  const activity=(person,action,busId,details={})=>({busId,action,actor:actor(person),createdAt:stamp(),...details});
  const tasks=createTasks({db,stamp,now,actor,activity,savePhotos,removePhotos});
  async function board(person){
    const [fleet,summaries,recent,pending,taskRows,employees]=await Promise.all([db.collection("buses").get(),db.collection("yardFleet").get(),db.collection("yardRecords").orderBy("createdAt","desc").limit(150).get(),db.collection("yardRecords").where("status","in",["Needs Review"]).get(),db.collection("yardTasks").get(),db.collection("employees").get()]);
    const summaryMap=new Map(summaries.docs.map((row)=>[row.id,row.data()]));
    const records=new Map([...recent.docs,...pending.docs].map((row)=>[row.id,{id:row.id,...row.data()}]));
    return {tasks:taskRows.docs.map(row=>({id:row.id,...row.data()})),employees:employees.docs.filter(row=>staff(row.data())).map(row=>({id:row.id,employeeNumber:String(row.data().employeeNumber||row.id),name:row.data().displayName||`${row.data().firstName||""} ${row.data().lastName||""}`.trim()})),person,today:today(now()),checklists:CHECKLISTS,fleet:fleet.docs.filter((row)=>row.data().deleted!==true&&String(row.data().status || "").toLowerCase()!=="inactive").map((row)=>({...busSnapshot(row.data(),row.id),yard:summaryMap.get(row.id)||{}})),records:[...records.values()].sort((a,b)=>recordTime(b.createdAt)-recordTime(a.createdAt)),historyLimited:recent.size===150};
  }
  async function history(person,busId,taskId){
    if(taskId){
      if(typeof taskId!=="string"||taskId.includes("/"))fail("Select a valid yard task.","invalid-argument");
      const rows=await db.collection("yardRecords").where("taskId","==",taskId).get();
      return {records:rows.docs.map(row=>({id:row.id,...row.data()})).sort((a,b)=>recordTime(b.createdAt)-recordTime(a.createdAt))};
    }
    if(!busId||typeof busId!=="string"||busId.includes("/"))fail("Select a valid bus.","invalid-argument");
    const records=await db.collection("yardRecords").where("busId","==",busId).get();
    return {records:records.docs.map((row)=>({id:row.id,...row.data()})).sort((a,b)=>recordTime(b.createdAt)-recordTime(a.createdAt))};
  }
  async function update(person,input){
    if(input.type==="general")return tasks.update(person,input);
    const {busId,type,action}=input;
    if(typeof busId!=="string"||!busId||busId.includes("/"))fail("Select a valid bus.","invalid-argument");
    if(![...TYPES,"checks"].includes(type))fail("Invalid task type.","invalid-argument");
    if(!["start","release","complete","checks","unavailable","priority","handover","acknowledge"].includes(action))fail("Invalid action.","invalid-argument");
    if(["priority","acknowledge"].includes(action)&&!person.manager)fail("Fleet Manager access is required.","permission-denied");
    const busRef=db.collection("buses").doc(busId),stateRef=db.collection("yardFleet").doc(busId),recordRef=db.collection("yardRecords").doc();
    const files=Array.isArray(input.photos)?input.photos:[];
    if(files.length&&!["complete","checks"].includes(action))fail("Photos can only accompany completion or daily checks.","invalid-argument");
    let photos=[];
    try{
      photos=await savePhotos(files,recordRef.id,person);
      await db.runTransaction(async(tx)=>{
        const [busSnap,stateSnap]=await Promise.all([tx.get(busRef),tx.get(stateRef)]);
        if(!busSnap.exists||busSnap.data().deleted===true||String(busSnap.data().status || "").toLowerCase()==="inactive")fail("This bus is no longer in the active fleet.");
        const bus=busSnapshot(busSnap.data(),busId),state=stateSnap.exists?stateSnap.data():{},current=state[type]||{};
        const patch={...state,busId,updatedAt:stamp(),updatedBy:actor(person)};
        let record=activity(person,action,busId,{type,fleetNumber:bus.fleetNumber,depot:bus.depot});
        const reason=text(input.notes);
        if(action==="start"){
          if(!TYPES.includes(type))fail("Choose a cleaning task.");
          if(current.active)fail(`This task is already in progress by ${current.active.name}.`);
          patch[type]={...current,handover:null,active:{...actor(person),startedAt:stamp()}};
        }else if(action==="release"||action==="handover"){
          if(!TYPES.includes(type))fail("Choose a cleaning task.");
          if(!current.active||(!person.manager&&current.active.uid!==person.uid))fail("Only the person working on this task or a manager can release it.","permission-denied");
          if(!reason)fail("Enter the reason for releasing this task.");
          patch[type]={...current,active:null,handover:action==="handover"?{...actor(person),notes:reason,createdAt:stamp()}:null};record.notes=reason;
        }else if(action==="complete"){
          if(!TYPES.includes(type)||!current.active||current.active.uid!==person.uid)fail("Start this task under your own account before completing it.","permission-denied");
          const checklist=CHECKLISTS[type];
          if(!Array.isArray(input.checklist)||checklist.some((item)=>!input.checklist.includes(item)))fail("Complete every cleaning checklist item.");
          const completedDate=dateValue(input.completedDate,today(now()));
          record={...record,status:"Completed",performedDate:completedDate,checklist,notes:reason,photos,startedAt:current.active.startedAt};
          patch[type]={...current,active:null,pending:null,handover:null,priority:false};
          if(!current.lastDate||completedDate>=current.lastDate)Object.assign(patch[type],{lastDate:completedDate,lastRecordId:recordRef.id,lastBy:actor(person)});
        }else if(action==="checks"){
          if(type!=="checks")fail("Invalid daily check task.");
          const checks=validateChecks(input,bus),performedDate=dateValue(input.completedDate,today(now()));
          record={...record,status:"Needs Review",performedDate,...checks,photos};
          // Retain the most recent report for each date. Backdated reports remain in history.
          if(!current.performedDate||performedDate>=current.performedDate)patch.checks={id:recordRef.id,performedDate,...checks,actor:actor(person),createdAt:stamp(),reviewed:false};
        }else if(action==="unavailable"){
          if(!reason)fail("Add a reason the bus is unavailable.");
          patch.availability={unavailable:true,notes:reason,performedDate:today(now()),actor:actor(person)};record.notes=reason;
        }else if(action==="priority"){
          if(!TYPES.includes(type))fail("Select a cleaning type for the priority.");
          patch[type]={...current,priority:input.urgent===true,priorityNotes:reason};record.notes=reason;
        }else{
          if(typeof input.recordId!=="string"||!input.recordId||input.recordId.includes("/"))fail("Select a valid completion record.");
          const targetRef=db.collection("yardRecords").doc(input.recordId),targetSnap=await tx.get(targetRef);
          if(!targetSnap.exists)fail("Completion record no longer exists.");
          const target=targetSnap.data();
          if(target.busId!==busId||target.type!==type)fail("Record does not match this bus and task.");
          if(action==="acknowledge"){
            if(type!=="checks"||target.status!=="Needs Review")fail("This check has already been reviewed.");
            tx.update(targetRef,{status:"Reviewed",review:{...actor(person),notes:reason,reviewedAt:stamp()}});
            if(current.id===input.recordId)patch.checks={...current,reviewed:true};
          }
          record={...record,notes:reason,targetRecordId:input.recordId};
        }
        // All reads above precede writes; task ownership and review are serialised per bus.
        if(["start","complete","checks"].includes(action))patch.availability=null;
        tx.set(stateRef,patch);tx.set(recordRef,record);
      });
      return {saved:true,recordId:recordRef.id};
    }catch(error){await removePhotos(photos);throw error;}
  }
  return {board,history,update};
}
module.exports={createService};
