const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const url=s=>'data:text/javascript;base64,'+Buffer.from(s).toString('base64');
const helperSource=fs.readFile(path.join(__dirname,'../public/js/workshop_signoff.js'),'utf8');
const helpers=helperSource.then(s=>import(url(s)));
const employee={employeeNumber:'99001',email:'workshop-manager@example.com',firstName:'Test',lastName:'Manager',displayName:'Test Manager Workshop Manager',department:'Workshop',role:'Manager',status:'Active',accessLevel:'Manager'};
const user={uid:'manager-uid',email:employee.email,displayName:'Google account name'};
const job={id:'job1',jobNumber:'JC-1',status:'Waiting Approval',busId:'bus1',fleetNumber:'MO007',jobType:'Defect Repair',jobCard:{workCompleted:'Repair completed',safeToReturn:'Yes',currentOdometer:50000},mechanicName:'Mechanic A'};
const decision={returnToService:true,vehicleStatus:'Active',comments:'Reviewed',inspectionCompletedDate:''};

test('employee identity and signing role are captured instead of Google display name',async()=>{
 const h=await helpers;const signer=h.resolveWorkshopApprover(user,employee);
 assert.equal(signer.name,'Test Manager');assert.equal(signer.role,'Fleet Manager');assert.equal(signer.employeeNumber,'99001');assert.equal(signer.uid,'manager-uid');assert.equal(signer.employeeRole,'Manager');
 assert.throws(()=>h.resolveWorkshopApprover(user,{...employee,status:'Inactive'}),/active employee/);
 assert.throws(()=>h.resolveWorkshopApprover(user,{...employee,role:'Mechanic'}),/not authorised/);
 assert.throws(()=>h.resolveWorkshopApprover({...user,email:'other@example.com'},employee),/linked/);
});
test('explicit consent and Waiting Approval status are necessary for a new signature',async()=>{
 const h=await helpers;const args={job,approver:h.resolveWorkshopApprover(user,employee),decision,consent:true,approvalId:'approval1',timestamp:'2026-10-12T02:05:00Z'};
 await assert.rejects(()=>h.createWorkshopElectronicApproval({...args,consent:false}),/declaration/);
 await assert.rejects(()=>h.createWorkshopElectronicApproval({...args,job:{...job,status:'Closed'}}),/retrospectively/);
 await assert.rejects(()=>h.createWorkshopElectronicApproval({...args,job:{...job,jobCard:{safeToReturn:'No'}}}),/NOT safe/);
});
test('approval hash binds identity, job contents and the release decision',async()=>{
 const h=await helpers;const args={job,approver:h.resolveWorkshopApprover(user,employee),decision,consent:true,approvalId:'approval1',timestamp:'2026-10-12T02:05:00Z'};
 const signed=await h.createWorkshopElectronicApproval(args);
 assert.match(signed.signedRecordHash,/^[a-f0-9]{64}$/);assert.equal(signed.signedRecordHash,await h.approvalHash(signed.signedRecordSnapshot));
 const changed=await h.createWorkshopElectronicApproval({...args,decision:{...decision,returnToService:false}});
 assert.notEqual(changed.signedRecordHash,signed.signedRecordHash);
 const record={...job,status:'Closed',fleetManagerApproval:signed};
 assert.equal(h.workshopApprovalRecord(record).kind,'signed');assert.equal(h.workshopApprovalRecord(record).recordChanged,false);
 assert.equal(h.workshopApprovalRecord({...record,jobCard:{...job.jobCard,workCompleted:'Altered later'}}).recordChanged,true);
});
test('legacy closed jobs preserve original approver and time without inventing a signer or role',async()=>{
 const h=await helpers;const legacy={status:'Closed',closedByEmail:'original@example.com',closedAt:'2026-09-01T01:00:00Z'};
 const before=JSON.stringify(legacy),record=h.workshopApprovalRecord(legacy),html=h.workshopApprovalHtml(legacy);
 assert.equal(record.kind,'legacy');assert.equal(record.name,'original@example.com');assert.equal(record.role,'Not recorded');assert.match(html,/Legacy approval record/);assert.match(html,/no retrospective signature/);assert.doesNotMatch(html,/Test Manager|Electronically approved by/);assert.equal(JSON.stringify(legacy),before);
});
test('saved approval is escaped and includes identity, role and decision in print-ready HTML',async()=>{
 const h=await helpers;const signed=await h.createWorkshopElectronicApproval({job,approver:{...h.resolveWorkshopApprover(user,employee),name:'<script>bad</script>'},decision,consent:true,approvalId:'approval1',timestamp:'2026-10-12T02:05:00Z'});
 const html=h.workshopApprovalHtml({...job,status:'Closed',fleetManagerApproval:signed});
 assert.match(html,/Fleet Manager/);assert.match(html,/99001/);assert.match(html,/Approved/);assert.match(html,/approval1/);assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>bad/);
});

async function integration(overrides={}) {
 const h=await helpers;
 const helperUrl=url(await helperSource);
 let source=await fs.readFile(path.join(__dirname,'../public/js/workshop_manager_approval.js'),'utf8');
 source=source.replace(/^import[\s\S]*?;\s*/gm,'');source=source.slice(0,source.lastIndexOf('\nensureDialogs();'));
 const setup={user,employee,job,...overrides};
 const code=`import {WORKSHOP_SIGNOFF_DECLARATION,resolveWorkshopApprover,workshopJobRevision,approvalHash,createWorkshopElectronicApproval,workshopApprovalHtml} from '${helperUrl}';
 const seed=${JSON.stringify(setup)};
 const auth={currentUser:{...seed.user,getIdToken:async()=>"test-token"}};const db={};const ADMIN_EMAILS=[];const DEFECT_STATUS={COMPLETED:"Completed"};
 export const writes=[];
 const nodes=Object.fromEntries(['wmSignoffConsent','wmSignoffIdentity','wmApproveClose','wmReturnToService','wmVehicleStatus','wmManagerComments','wmInspectionCompletedDate','wmReviewMessage','fleetManagerReviewDialog','status'].map(id=>[id,{checked:true,value:'',textContent:'',dataset:{verified:'true'},scrollIntoView(){},close(){this.closed=true}}]));
 nodes.wmReturnToService.value=seed.returnToService || 'Yes';nodes.wmInspectionCompletedDate.value=seed.inspectionDate || '';nodes.wmVehicleStatus.value='Active';nodes.wmManagerComments.value='Reviewed';nodes.wmSignoffConsent.checked=seed.consent!==false;
 const document={getElementById:id=>nodes[id]};const window={};
 const collection=(db,name)=>({name});const where=()=>({});const query=ref=>ref;
 const doc=(...args)=>args.length===1 ? {name:args[0].name,id:'generated'} : {name:args[1],id:args[2]};
 const getDocs=async()=>({docs:[{id:'99001',data:()=>seed.employee}]});
 const serverTimestamp=()=>({serverTimestamp:true});
 const runTransaction=async(db,fn)=>fn({get:async ref=>({exists:()=>true,data:()=>ref.name==='workshopJobs' ? seed.latestJob || seed.job : ref.name==='employees' ? seed.latestEmployee || seed.employee : {currentOdometer:49000}}),update:(ref,data)=>writes.push({type:'update',ref,data}),set:(ref,data)=>writes.push({type:'set',ref,data})});
 ${source}
 selectedJob=seed.job; jobs=[seed.job];buses=[{id:'bus1',fleetNumber:'MO007'}];
 preparedApprover={jobId:seed.job.id,identity:resolveWorkshopApprover(auth.currentUser,seed.employee)};
 if(seed.accountChanged)preparedApprover.identity={...preparedApprover.identity,uid:'other-uid'};
 export {approveAndClose};export const message=()=>nodes.wmReviewMessage.textContent;
 `;
 return import(url(code));
}
test('closure transaction saves signature and audit together and keeps fleet updates',async()=>{
 const m=await integration();await m.approveAndClose();
 const saved=m.writes.find(w=>w.ref.name==='workshopJobs').data;
 assert.equal(saved.status,'Closed');assert.equal(saved.fleetManagerApproval.approvedByName,'Test Manager');assert.equal(saved.fleetManagerApproval.approvedByRole,'Fleet Manager');assert.equal(saved.fleetManagerApproval.electronicConsent,true);
 assert.ok(Object.keys(saved).some(k=>k.startsWith('approvalAudit.')));assert.ok(m.writes.some(w=>w.ref.name==='buses'));
});
test('missing consent cannot write any closure or fleet data',async()=>{
 const m=await integration({consent:false});await m.approveAndClose();assert.equal(m.writes.length,0);
});
test('closed historical job cannot acquire a new signature through the closure action',async()=>{
 const m=await integration({job:{...job,status:'Closed'}});await m.approveAndClose();assert.equal(m.writes.length,0);
});
test('job edited after review blocks signing and all downstream writes',async()=>{
 const m=await integration({latestJob:{...job,jobCard:{...job.jobCard,workCompleted:'Changed after review'}}});await m.approveAndClose();assert.equal(m.writes.length,0);assert.match(m.message(),/changed after you opened/);
});
test('employee deactivated during review cannot approve',async()=>{
 const m=await integration({latestEmployee:{...employee,status:'Inactive'}});await m.approveAndClose();assert.equal(m.writes.length,0);assert.match(m.message(),/active employee/);
});
test('changed account cannot sign against another officer shown in the dialog',async()=>{
 const m=await integration({accountChanged:true});await m.approveAndClose();assert.equal(m.writes.length,0);assert.match(m.message(),/identity changed/);
});


test('manager date correction is included in the signed snapshot without a false change warning',async()=>{
 const inspection={...job,jobType:'Safety Inspection',inspectionType:'90 Day Safety Check',inspectionCompletedDate:'2026-10-10',jobCard:{...job.jobCard,inspectionCompletedDate:'2026-10-10'}};
 const m=await integration({job:inspection,inspectionDate:'2026-10-11'});await m.approveAndClose();
 const saved=m.writes.find(w=>w.ref.name==='workshopJobs').data;
 assert.equal(saved.inspectionCompletedDate,'2026-10-11');assert.equal(saved.inspectionDateAudit[0].previousDate,'2026-10-10');
 const h=await helpers;assert.equal(h.workshopApprovalRecord({...inspection,...saved}).recordChanged,false);
});
test('signing a No decision does not override an unsafe mechanic assessment',async()=>{
 const unsafe={...job,jobCard:{...job.jobCard,safeToReturn:'No'}};
 const m=await integration({job:unsafe,returnToService:'No'});await m.approveAndClose();
 assert.equal(m.writes.find(w=>w.ref.name==='workshopJobs').data.fleetManagerApproval.returnToService,false);
});
test('same-page printing retains saved legacy block instead of inventing the current form decision',async()=>{
 const source=await fs.readFile(path.join(__dirname,'../public/js/workshop_print_fix.js'),'utf8');
 let output='';const frameDoc={readyState:'loading',open(){},write(html){output=html;},close(){}};
 const frame={style:{},setAttribute(){},contentDocument:frameDoc,contentWindow:{},remove(){}};
 const fields={fleetManagerReviewDialog:{},wmReviewBody:{innerHTML:'<section class="wm-electronic-signoff">Legacy approval record: original@example.com</section>',querySelector:()=>({})},wmReviewSubtitle:{textContent:'Legacy Job'},wmManagerComments:{value:'Changed form text'},wmReturnToService:{value:'Yes'},wmVehicleStatus:{value:'Active'}};
 const document={getElementById:id=>fields[id],createElement:()=>frame,body:{appendChild(){}}};
 const fn=new Function('document','setTimeout',source.slice(0,source.indexOf('document.addEventListener'))+';return printCurrentReview;')(document,()=>{});
 assert.equal(fn(),true);assert.match(output,/Legacy approval record: original@example.com/);assert.doesNotMatch(output,/Fleet Manager Decision|Changed form text/);
});
