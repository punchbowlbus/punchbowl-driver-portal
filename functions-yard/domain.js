const TYPES = ["exterior", "interior"];
const CHECKLISTS = {
  exterior: ["Exterior body washed", "Exterior windows and mirrors cleaned", "Wheels and lower panels cleaned"],
  interior: ["Floors swept and rubbish removed", "Seats cleaned and stains checked", "Handrails and surfaces wiped", "Inside windows cleaned", "Floors mopped", "Damage or problems recorded"]
};
const ADMIN_EMAILS = ["nalin.rajapaksha82@gmail.com"];
const norm = (v) => String(v || "").trim().toLowerCase();
function fail(message, code = "failed-precondition") {const error = new Error(message);error.code = code;throw error;}
function text(value, max = 2000) {if(typeof value !== "string")return "";if(value.length>max)fail(`Text exceeds ${max} characters.`,"invalid-argument");return value.trim();}
function today(date = new Date()) {return new Intl.DateTimeFormat("en-CA",{timeZone:"Australia/Sydney",year:"numeric",month:"2-digit",day:"2-digit"}).format(date);}
function dateValue(value, currentDate = today()) {
  const parsed=new Date(`${value}T12:00:00Z`);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value || "") || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0,10)!==value)fail("Enter a valid completion date.","invalid-argument");
  if(value>currentDate)fail("Completion date cannot be in the future.","invalid-argument");return value;
}
function identity(auth, employee) {
  if(!auth?.uid || auth.token?.email_verified!==true)fail("Sign in with your verified employee account.","unauthenticated");
  const email=norm(auth.token.email);
  const superAdmin=ADMIN_EMAILS.includes(email);
  const active=norm(employee?.status)==="active" && employee?.deleted!==true;
  const manager=superAdmin || (active && (["admin","super admin"].includes(norm(employee.accessLevel)) || norm(employee.role)==="admin" || (norm(employee.department)==="workshop" && ["manager","fleet manager"].includes(norm(employee.role)))));
  const worker=active && [employee.role,employee.accessLevel].some((v)=>norm(v)==="yard man");
  if(!manager&&!worker)fail("An active Yard Man or Fleet Manager employee account is required.","permission-denied");
  return {uid:auth.uid,email,manager,name:employee?.displayName || `${employee?.firstName || ""} ${employee?.lastName || ""}`.trim() || auth.token.name || email,employeeNumber:String(employee?.employeeNumber || employee?.id || "")};
}
function busSnapshot(bus, id) {
  return {id,fleetNumber:String(bus.fleetNumber || bus.busNumber || bus.number || id),rego:String(bus.rego || bus.registration || ""),depot:String(bus.depot || bus.homeDepot || ""),electric:/\bev\b|electric/i.test(`${bus.fuelType || ""} ${bus.fuel || ""} ${bus.serviceProgram || ""}`),oilCheckApplicable:bus.yardOilCheckApplicable!==false&&!/\bev\b|electric/i.test(`${bus.fuelType || ""} ${bus.fuel || ""} ${bus.serviceProgram || ""}`),coolantCheckApplicable:bus.yardCoolantCheckApplicable!==false};
}
function validateChecks(data, bus) {
  const levels=["OK","Low","Unable to check"];
  const oil=bus.oilCheckApplicable?data.oilLevel:"N/A",coolant=bus.coolantCheckApplicable?data.coolantLevel:"N/A";
  if(bus.oilCheckApplicable&&!levels.includes(oil))fail("Record the oil level.","invalid-argument");
  if(bus.coolantCheckApplicable&&!levels.includes(coolant))fail("Record the coolant level.","invalid-argument");
  if(!["OK","Problem","Unable to check"].includes(data.tyres))fail("Record the tyre check.","invalid-argument");
  let charge=null,chargingStatus="N/A";
  if(bus.electric){
    if(data.charge===null||data.charge===""||!Number.isFinite(Number(data.charge))||Number(data.charge)<0||Number(data.charge)>100)fail("Enter EV charge between 0 and 100%.","invalid-argument");
    charge=Number(data.charge);chargingStatus=data.chargingStatus;
    if(!["Charging","Not connected","Charge complete","Unable to check"].includes(chargingStatus))fail("Select charging status.","invalid-argument");
  }
  const notes=text(data.notes);
  const problem=oil==="Low"||coolant==="Low"||data.tyres==="Problem";
  const incomplete=oil==="Unable to check"||coolant==="Unable to check"||data.tyres==="Unable to check"||chargingStatus==="Unable to check";
  if((problem||incomplete)&&!notes)fail("Add details about the problem or check you could not complete.","invalid-argument");
  return {oilLevel:oil,coolantLevel:coolant,tyres:data.tyres,charge,chargingStatus,notes,problem,incomplete};
}
function dueState(lastDate, currentDate=today()) {
  if(!lastDate)return {label:"Not recorded",tone:"warn",due:true};
  const age=Math.round((Date.parse(currentDate+"T12:00:00Z")-Date.parse(lastDate+"T12:00:00Z"))/86400000);
  if(age>7)return {label:"Overdue",tone:"bad",due:true};
  if(age===7)return {label:"Due today",tone:"warn",due:true};
  return {label:"Up to date",tone:"good",due:false};
}
module.exports={TYPES,CHECKLISTS,norm,fail,text,today,dateValue,identity,busSnapshot,validateChecks,dueState};
