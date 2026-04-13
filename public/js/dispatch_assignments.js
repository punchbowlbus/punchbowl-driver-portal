import { updateBlock, addDutySpan } from "./db.js";

export async function assignBlockToDriver({
  block,
  serviceDate,
  driverEmployeeNumber,
  driverName,
  createDutySpan = true
}) {
  if (!block?.id) {
    throw new Error("Block id is required.");
  }

  if (!driverEmployeeNumber) {
    throw new Error("Driver employee number is required.");
  }

console.log("assignBlockToDriver()", {
  blockId: block?.id,
  driverEmployeeNumber,
  driverName,
  serviceDate,
  createDutySpan
});

  await updateBlock(block.id, {
    assignedDriverEmployeeNumber: String(driverEmployeeNumber).trim(),
    assignedDriverName: String(driverName || "").trim(),
    dispatchStatus: "Assigned"
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
    dispatchStatus: "Pending"
  });

  return true;
}