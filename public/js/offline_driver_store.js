// Local, read-only copies. This module has no Firebase imports and performs no network writes.
export const OFFLINE_KEY = 'pbc-driver-offline-v1';
export const OWNER_KEY = 'pbc-driver-offline-owner-v1';
export const MAX_AGE_MS = 72 * 60 * 60 * 1000;
const DUTY_FIELDS = ['id','serviceDate','driverEmployeeNumber','driverName','dutyNumber','dutyType','startMin','endMin','assignedBus','dispatchStatus','driverAcknowledgment','routeNumber','startLocation','endLocation'];
const pick = (item, fields) => Object.fromEntries(fields.filter(key => ['string','number','boolean'].includes(typeof item?.[key])).map(key => [key,item[key]]));
export function dutyCopy(duty) {
  return {...pick(duty,DUTY_FIELDS),breaks:(Array.isArray(duty.breaks)?duty.breaks:[]).map(b=>pick(b,['type','location','startMin','endMin']))};
}
export function createOfflineStore(storage, now = () => Date.now()) {
  let uid = '', employeeNumber = '';
  function clear() { employeeNumber='';try { storage.removeItem(OFFLINE_KEY); storage.removeItem(OWNER_KEY); } catch {} }
  function ownsDevice() { try { return !!employeeNumber && storage.getItem(OWNER_KEY)===uid; } catch { return false; } }
  function read() {
    try {
      const raw=storage.getItem(OFFLINE_KEY);
      if(!raw)return null;
      const data = JSON.parse(raw);
      if (data?.version !== 1 || !data.uid || storage.getItem(OWNER_KEY)!==data.uid || !data.employeeNumber || !Array.isArray(data.duties) || !data.details || typeof data.details!=='object' ||
          !Number.isFinite(data.savedAt) || now()-data.savedAt > MAX_AGE_MS || data.savedAt > now()+60000) { storage.removeItem(OFFLINE_KEY); return null; }
      return data;
    } catch { try { storage.removeItem(OFFLINE_KEY); } catch {} return null; }
  }
  function write(data) {
    try {
      const json=JSON.stringify(data);
      if(json.length>750000) { clear(); return false; }
      storage.setItem(OFFLINE_KEY,json);return true;
    } catch { clear();return false; }
  }
  return {
    read, clear,
    setUser(nextUid) {
      uid=String(nextUid||'');employeeNumber='';
      const old=read();if(!uid || old && old.uid!==uid)clear();
    },
    identify(nextUid, employee, allowed) {
      if(!allowed || !uid || uid!==nextUid || !employee?.employeeNumber){clear();employeeNumber='';return;}
      employeeNumber=String(employee.employeeNumber).trim();
      const old=read();if(old && old.employeeNumber!==employeeNumber)clear();
      employeeNumber=String(employee.employeeNumber).trim();
      try { storage.setItem(OWNER_KEY,uid); } catch { employeeNumber=''; }
    },
    saveRoster(duties, metadata) {
      if(!uid || !ownsDevice() || metadata?.fromCache!==false || metadata?.hasPendingWrites!==false)return false;
      const rows=duties.filter(d=>String(d.driverEmployeeNumber).trim()===employeeNumber && !d.deleted &&
        ['Assigned','Cancelled'].includes(d.dispatchStatus) && d.id && /^\d{4}-\d{2}-\d{2}$/.test(d.serviceDate)).map(dutyCopy);
      if(rows.length>200){clear();return false;}
      const old=read();const details={};
      for(const row of rows) {
        const previous=old?.duties.find(d=>d.id===row.id);
        if(old?.uid===uid && JSON.stringify(previous)===JSON.stringify(row) && old.details?.[row.id] && now()-old.details[row.id].savedAt<=MAX_AGE_MS)details[row.id]=old.details[row.id];
      }
      return write({version:1,uid,employeeNumber,savedAt:now(),duties:rows,details});
    },
    saveSheet(duty, jobs) {
      const data=read();
      if(!uid || !ownsDevice() || data?.uid!==uid || data.employeeNumber!==employeeNumber || !Array.isArray(jobs))return false;
      const row=data.duties.find(d=>d.id===duty.id);
      if(!row || row.dispatchStatus==='Cancelled' || JSON.stringify(row)!==JSON.stringify(dutyCopy(duty)))return false;
      // The caller supplies only the resolved jobs for this duty, never fleet-wide blocks.
      const savedJobs=jobs.map(job=>({...pick(job,['id','name','direction','from','to','startMin','endMin']),
        stops:(Array.isArray(job.stops)?job.stops:[]).map(stop=>pick(stop,['from','to','startMin','endMin']))}));
      if(savedJobs.length>200)return false;
      data.details[duty.id]={savedAt:now(),jobs:savedJobs};
      return write(data);
    }
  };
}
