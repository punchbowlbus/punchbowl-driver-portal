import { saveEmployee } from "./db.js";

async function runEmployeeTest() {
  try {
    await saveEmployee({
      employeeNumber: "963",
      firstName: "NALIN ANURUDDHA",
      lastName: "RAJAPAKSHA MOHOTTIGE ALLIAS KANKANIGE",
      displayName: "N RAJAPAKSHA",
      email: "nalin@punchbowlbus.com.au",
      phoneNumber: "0423 955 025",
      department: "Administration",
      role: "Admin",
      employmentType: "Full Time",
      accessLevel: "Super Admin",
      status: "Active"
    });

    console.log("Employee saved successfully.");
  } catch (err) {
    console.error("Error saving employee:", err);
  }
}

runEmployeeTest();