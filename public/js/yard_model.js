export const TASK_LABELS={exterior:"Exterior Wash",interior:"Interior Clean + Mop",checks:"Daily Checks"};
export const clean=(value)=>String(value || "").trim();
export function dateAdd(date,days){const value=new Date(`${date}T12:00:00Z`);value.setUTCDate(value.getUTCDate()+days);return value.toISOString().slice(0,10);}
export function cleaningState(state={},today){
  if(state.active)return {label:"In progress",tone:"info",due:false};
  if(state.pending)return {label:"Waiting approval",tone:"warn",due:false};
  if(state.priority)return {label:"Priority",tone:"bad",due:true};
  if(!state.lastDate)return {label:"Not recorded",tone:"warn",due:true};
  const due=dateAdd(state.lastDate,7);
  return due<today?{label:"Overdue",tone:"bad",due:true}:due===today?{label:"Due today",tone:"warn",due:true}:{label:"Up to date",tone:"good",due:false};
}
export function checkState(check={},today){
  if(check.performedDate!==today)return {label:"Not checked today",tone:"warn",due:true};
  if(check.problem)return {label:"Problem reported",tone:"bad",due:false};
  if(check.incomplete)return {label:"Check incomplete",tone:"warn",due:true};
  return {label:"Checked today",tone:"good",due:false};
}
export function fleetFilter(fleet,{search="",depot="",show="all",today}){
  return fleet.filter((bus)=>!depot||bus.depot===depot).filter((bus)=>[bus.fleetNumber,bus.rego,bus.depot].join(" ").toLowerCase().includes(search.toLowerCase())).filter((bus)=>{
    if(show==="all")return true;
    if(show==="problems")return bus.yard.checks?.problem===true;
    if(show==="approval")return bus.yard.exterior?.pending||bus.yard.interior?.pending;
    return cleaningState(bus.yard.exterior,today).due||cleaningState(bus.yard.interior,today).due||checkState(bus.yard.checks,today).due;
  }).sort((a,b)=>a.fleetNumber.localeCompare(b.fleetNumber,undefined,{numeric:true}));
}
