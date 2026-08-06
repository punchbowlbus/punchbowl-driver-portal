import { updateBlock, addDutySpan, getEmployee } from "./db.js";

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
      totalSpanMinutes: (block.endMin || 0) - (block.startMin || 0)
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