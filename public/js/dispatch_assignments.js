import { calculateFatigue } from "./dispatch_fatigue.js";
import { refreshRosterFatigue, shiftServiceDate } from "./fatigue_schedule.js";
import { updateBlock, addDutySpan, getEmployee, getDutySpansByDriverAndDate } from "./db.js";

export async function assignBlockToDriver({
  block,
  serviceDate,
  driverEmployeeNumber,
  driverName,
  dutySpanId = "",
  createDutySpan = true
}) {
  if (!block?.id) {
    throw new Error("Block id is required.");
  }

  if (!driverEmployeeNumber) {
    throw new Error("Driver employee number is required.");
  }

  const driver = await getEmployee(driverEmployeeNumber);
  const driverEmail = String(driver?.email || "").trim().toLowerCase();

  if (!driverEmail) {
    throw new Error("Driver email not found for selected employee.");
  }

  console.log("assignBlockToDriver()", {
    blockId: block?.id,
    driverEmployeeNumber,
    driverName,
    serviceDate,
    dutySpanId,
    createDutySpan
  });

  let fatigue = null;
  if (createDutySpan) {
    if(block.startMin == null || block.endMin == null || String(block.startMin).trim() === "" || String(block.endMin).trim() === "" || !Number.isFinite(Number(block.startMin)) || !Number.isFinite(Number(block.endMin)) || Number(block.endMin)<=Number(block.startMin))throw new Error("Duty start/end times are missing or invalid. Assignment not completed.");
    const candidate = {id:"automatic-candidate",serviceDate,driverEmployeeNumber,startMin:block.startMin,endMin:block.endMin,breaks:[]};
    const surrounding=(await Promise.all([-3,-2,-1,0,1,2,3].map(offset=>getDutySpansByDriverAndDate(driverEmployeeNumber,shiftServiceDate(serviceDate,offset))))).flat();
    fatigue={...calculateFatigue({...candidate,fatigueCategory:driver?.fatigueCategory || "Unknown"}),...refreshRosterFatigue([...surrounding,candidate],[{...driver,employeeNumber:driverEmployeeNumber}]).find(d=>d.id===candidate.id)};
  }
  await updateBlock(block.id, {
    assignedDriverEmployeeNumber: String(driverEmployeeNumber).trim(),
    assignedDriverName: String(driverName || "").trim(),
    dutySpanId: String(dutySpanId || "").trim(),
    dispatchStatus: "Assigned"
  });

  console.log("ABOUT TO CREATE SHIFT", {
    serviceDate,
    driverEmail,
    driverName,
    driverEmployeeNumber
  });

  if (createDutySpan) {
    await addDutySpan({
      serviceDate,
      driverEmployeeNumber,
      driverName,
      startMin: block.startMin,
      endMin: block.endMin,
      startLocation: block.from,
      endLocation: block.to,
      dispatchStatus: "Assigned",
      totalSpanMinutes: fatigue.totalSpanMinutes,
      unpaidMinutes: fatigue.unpaidMinutes,
      paidMinutes: fatigue.paidMinutes,
      fatigueStatus: fatigue.fatigueStatus,
      fatigueWarning: fatigue.fatigueWarning
    });
  }

  return true;
}

export async function unassignBlockFromDriver(blockId) {
  if (!blockId) {
    throw new Error("Block id is required.");
  }

  console.log("unassignBlockFromDriver()", { blockId });

  await updateBlock(blockId, {
    assignedDriverEmployeeNumber: "",
    assignedDriverName: "",
    dutySpanId: "",
    dispatchStatus: "Pending"
  });

  return true;
}