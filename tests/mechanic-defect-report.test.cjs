const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');

function harness() {
  const elements=new Map(), events={}, writes=[], uploads=[], deleted=[], reports=new Map();
  let serial=0;
  function element(id='') {
    return {id,value:'',hidden:false,disabled:false,files:[],open:false,textContent:'',className:'',
      addEventListener(name,fn){this[name]=fn;},
      set innerHTML(html){for(const match of html.matchAll(/id="([^"]+)"/g))elements.set(match[1],element(match[1]));},
      showModal(){this.open=true;},close(){this.open=false;this.closeEvent?.();},
      reset(){for(const e of elements.values()){e.value='';e.files=[];}},
      replaceChildren(...options){this.options=options;},
      querySelectorAll(){return [...elements.values()];}
    };
  }
  for(const id of ['reportDefectBtn','status'])elements.set(id,element(id));
  const actor={uid:'m1',email:'mechanic@example.com',name:'Mechanic One',employeeNumber:'123'};
  const state={employees:[{id:'mech2',displayName:'Mechanic Two',employeeNumber:'456',email:'two@example.com',status:'Active',department:'Workshop',role:'Mechanic'},{id:'mech3',displayName:'Mechanic Three',employeeNumber:'789',email:'three@example.com',status:'Active',department:'Workshop',role:'Mechanic'},{id:'inactiveMechanic',status:'Inactive',department:'Workshop',role:'Mechanic'},{id:'driver',status:'Active',department:'Operations',role:'Driver'},{id:'manager',status:'Active',department:'Workshop',role:'Manager'}],fleet:[{id:'bus1',fleetNumber:'M001',rego:'ABC123',status:'Active',depot:'Punchbowl'},{id:'inactive',status:'Inactive'}]};
  const context={console,Date,Promise,Option:function(text,value){this.text=text;this.value=value;},CustomEvent:function(type,init){this.type=type;this.detail=init?.detail;},
    window:{currentWorkshopMechanic:actor,addEventListener:(name,fn)=>events[name]=fn,dispatchEvent:e=>{state.event=e;}},
    document:{getElementById:id=>elements.get(id),createElement:()=>element(),body:{appendChild:el=>elements.set(el.id,el)}},
    auth:{currentUser:{uid:actor.uid,email:actor.email}},db:{},storage:{},
    collection:(_,name)=>({name}),doc:col=>({id:`report${++serial}`,collection:col.name}),
    getDocs:async ref=>{if(state.employeeLoadError && ref.name==='employees')throw Error('Mechanics unavailable');return {docs:(ref.name==='employees'?state.employees:state.fleet).map(b=>({id:b.id,data:()=>b}))};},
    setDoc:async(ref,data)=>{if(state.saveError)throw Error('Save rejected');if(state.saveGate)await state.saveGate;writes.push({ref,data});reports.set(ref.id,data);},serverTimestamp:()=>null,
    ref:(_,fullPath)=>({fullPath}),uploadBytes:async(ref,file)=>{uploads.push({ref,file});state.uploadHook?.();},
    getDownloadURL:async ref=>{if(state.urlError)throw Error('URL failed');return 'https://test/'+ref.fullPath;},
    deleteObject:async ref=>deleted.push(ref),onAuthStateChanged:()=>{}
  };
  vm.createContext(context);
  const load=name=>vm.runInContext(fs.readFileSync(path.join(__dirname,'../public/js/',name),'utf8').replace(/^import .*;\n/gm,''),context);
  load('mechanic_defect_report.js');
  const el=id=>elements.get(id);
  const run=code=>vm.runInContext(code,context);
  const open=()=>run('openReport()');
  const fill=()=>{el('mechanicReportReporter').value='mech2';el('mechanicReportBus').value='bus1';el('mechanicReportDate').value='2026-01-01';el('mechanicReportCategory').value='Brakes';el('mechanicReportSafe').value='No';el('mechanicReportDescription').value='Brake noise';};
  const submit=job=>run(`submitReport({preventDefault(){},submitter:{value:${JSON.stringify(job?'job':'save')}}})`);
  return {context,state,el,run,open,fill,submit,writes,uploads,deleted,reports,events,load};
}
test('reporting requires verified current workshop identity and excludes inactive buses',async()=>{
  const h=harness();await h.open();assert.equal(h.el('reportDefectBtn').hidden,false);assert.equal(h.el('mechanicReportBus').options.length,2);
  h.context.window.currentWorkshopMechanic=null;h.run('syncAccess()');assert.equal(h.el('reportDefectBtn').hidden,true);assert.equal(h.el('mechanicReportDialog').open,false);
  await h.open();assert.equal(h.el('mechanicReportDialog').open,false);
});
test('mechanic report preserves reporter, bus and critical safety details before requesting conversion',async()=>{
  const h=harness();await h.open();h.fill();h.el('mechanicReportPhotos').files=[{name:'brake photo.png',type:'image/png',size:100}];await h.submit(true);
  const r=h.writes[0].data;assert.equal(r.source,'Mechanic');assert.equal(r.reportedByUid,'m1');assert.equal(r.reportedByName,'Mechanic Two');assert.equal(r.reportedByEmployeeNumber,'456');assert.equal(r.reportedByEmployeeId,'mech2');assert.equal(r.reportedByEmployeeEmail,'two@example.com');assert.equal(r.submittedByEmail,'mechanic@example.com');assert.equal(r.submittedByUid,'m1');assert.equal(r.busId,'bus1');assert.equal(r.rego,'ABC123');assert.equal(r.priority,'Critical');assert.equal(r.status,'New');assert.equal(r.photoCount,1);assert.match(r.photos[0].storagePath,/^defect-reports\/report1\//);
  assert.equal(h.state.event.type,'mechanic-create-job-from-defect');assert.equal(h.state.event.detail.id,'report1');assert.equal(h.el('mechanicReportDialog').open,false);
});
test('save-only leaves a recoverable report without requesting a job card',async()=>{
  const h=harness();await h.open();h.fill();h.el('mechanicReportSafe').value='Yes';await h.submit(false);assert.equal(h.writes[0].data.priority,'Medium');assert.equal(h.state.event,undefined);assert.match(h.el('status').textContent,/Open Defect Reports/);
});
test('invalid fields, future dates, inactive bus and invalid photo files do not write or upload',async()=>{
  for(const change of [h=>h.el('mechanicReportReporter').value='',h=>h.el('mechanicReportReporter').value='inactiveMechanic',h=>h.el('mechanicReportReporter').value='driver',h=>h.el('mechanicReportDescription').value=' ',h=>h.el('mechanicReportDate').value='2999-01-01',h=>h.el('mechanicReportBus').value='inactive',h=>h.el('mechanicReportSafe').value='',h=>h.el('mechanicReportPhotos').files=[{type:'text/plain',size:1}],h=>h.el('mechanicReportPhotos').files=[{type:'image/png',size:9*1024*1024}],h=>h.el('mechanicReportPhotos').files=Array(4).fill({type:'image/png',size:1})]){
    const h=harness();await h.open();h.fill();change(h);await h.submit();assert.equal(h.writes.length,0);assert.equal(h.uploads.length,0);assert.equal(h.el('mechanicReportMessage').className,'status error');
  }
});
test('failed writes and URL lookups clean uploaded files and permit retry',async()=>{
  for(const failure of ['saveError','urlError']){
    const h=harness();await h.open();h.fill();h.el('mechanicReportPhotos').files=[{name:'fault.png',type:'image/png',size:1}];h.state[failure]=true;await h.submit();assert.equal(h.deleted.length,1);assert.equal(h.writes.length,0);assert.equal(h.el('mechanicReportDialog').open,true);assert.equal(h.el('mechanicReportDescription').disabled,false);
    h.state[failure]=false;await h.submit();assert.equal(h.writes.length,1);
  }
});
test('account changes during upload cannot save as the previous mechanic',async()=>{
  const h=harness();await h.open();h.fill();h.el('mechanicReportPhotos').files=[{name:'fault.png',type:'image/png',size:1}];h.state.uploadHook=()=>h.context.auth.currentUser={uid:'other',email:'other@example.com'};await h.submit(true);assert.equal(h.writes.length,0);assert.equal(h.deleted.length,1);assert.equal(h.state.event,undefined);assert.equal(h.el('reportDefectBtn').hidden,true);
});
test('repeat submit while saving creates one defect only',async()=>{
  const h=harness();await h.open();h.fill();let release;h.state.saveGate=new Promise(resolve=>release=resolve);const first=h.submit();await Promise.resolve();await h.submit();release();await first;assert.equal(h.writes.length,1);
});
test('mechanic and driver defects convert transactionally with original source and no automatic release',async()=>{
  for(const source of ['Mechanic',undefined]){
    const h=harness();await h.open();h.fill();await h.submit();const report=h.writes[0].data;
    // Load the existing job-card workflow with its real transaction callback.
    h.context.installStableInnerHtml=()=>{};h.context.onSnapshot=()=>{};h.context.DEFECT_STATUS={ASSIGNED:'Assigned'};h.context.isDefectCompleted=r=>r.status==='Completed';h.context.normalizeDefectStatus=r=>r;
    h.context.collection=(_,name)=>({name});h.context.doc=(db,name,id)=>({id:id||'job1',collection:typeof name==='string'?name:db.name});
    const txWrites=[];const record={...report,source};h.context.runTransaction=async(_,fn)=>fn({get:async ref=>({exists:()=>true,data:()=>ref.collection==='employees'?h.state.employees[0]:record}),set:(ref,data)=>txWrites.push({ref,data})});
    h.load('mechanic_driver_defects_today.js');h.context.report={...record,id:'defect1'};h.run('openJobCreation(report)');await h.run('createAndAssignJob({preventDefault(){}})');
    assert.equal(txWrites.length,2);const job=txWrites[0].data;assert.equal(job.source,source==='Mechanic'?'Mechanic Defect':'Driver Defect');assert.equal(job.sourceDefectId,'defect1');assert.equal(job.assignedMechanicEmail,source==='Mechanic'?'two@example.com':'mechanic@example.com');assert.equal(job.createdByEmail,'mechanic@example.com');assert.equal(job.returnToServiceApproved,false);assert.equal(job.status,'Assigned');assert.equal(txWrites[1].data.workshopJobId,'job1');
    record.workshopJobId='existing';h.run('openJobCreation(report)');await h.run('createAndAssignJob({preventDefault(){}})');assert.equal(txWrites.length,2,'existing job is not duplicated');assert.match(h.el('mechanicDefectJobMessage').textContent,/already exists/);
  }
});

test('shared tablet requires a fresh name selection for every report and keeps both identities',async()=>{
  const h=harness();await h.open();assert.equal(h.el('mechanicReportReporter').options.length,3,'only active workshop mechanics are listed');assert.equal(h.el('mechanicReportReporter').value,'');h.fill();await h.submit();await h.open();assert.equal(h.el('mechanicReportReporter').value,'','previous person must not remain selected');h.fill();h.el('mechanicReportReporter').value='mech3';await h.submit();assert.equal(h.writes[0].data.reportedByName,'Mechanic Two');assert.equal(h.writes[1].data.reportedByName,'Mechanic Three');assert.equal(h.writes[0].data.submittedByUid,h.writes[1].data.submittedByUid);
});
test('mechanic list load failures cannot fall back to the shared account name',async()=>{
  const h=harness();h.state.employeeLoadError=true;await h.open();h.fill();await h.submit();assert.equal(h.writes.length,0);assert.match(h.el('mechanicReportMessage').textContent,/Select the mechanic/);
});
test('conversion refuses a mechanic who has become inactive before the job is created',async()=>{
  const h=harness();await h.open();h.fill();await h.submit();h.context.installStableInnerHtml=()=>{};h.context.onSnapshot=()=>{};h.context.DEFECT_STATUS={ASSIGNED:'Assigned'};h.context.isDefectCompleted=()=>false;h.context.normalizeDefectStatus=r=>r;
  h.context.collection=(_,name)=>({name});h.context.doc=(db,name,id)=>({id:id||'job1',collection:typeof name==='string'?name:db.name});let writes=0;
  h.context.runTransaction=async(_,fn)=>fn({get:async ref=>({exists:()=>true,data:()=>ref.collection==='employees'?{...h.state.employees[0],status:'Inactive'}:h.writes[0].data}),set:()=>writes++});
  h.load('mechanic_driver_defects_today.js');h.context.report={...h.writes[0].data,id:'defect1'};h.run('openJobCreation(report)');assert.equal(h.el('mechanicDefectJobAssignee').value,'Mechanic Two');await h.run('createAndAssignJob({preventDefault(){}})');assert.equal(writes,0);assert.match(h.el('mechanicDefectJobMessage').textContent,/no longer an active workshop mechanic/);
});
