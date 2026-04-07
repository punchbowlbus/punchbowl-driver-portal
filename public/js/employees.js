// Import necessary Firebase and UI modules
import { listenEmployees, saveEmployee } from "./db.js";
import { els, showError } from "./ui.js";

// Function to render the employee page
export function renderEmployeesPage() {
  showError("");  // Ensure showError is correctly called

  // HTML for the employee page
  els.contentArea.innerHTML = `
    <h2 style="margin-top:0">Employees</h2>

    <div class="card">
      <div style="display:flex; gap:10px; flex-wrap:wrap; margin-bottom:12px;">
        <button id="addEmployeeBtn">Add Employee</button>
        <button id="editEmployeeBtn">Edit Selected</button>
        <input id="employeeSearch" type="text" placeholder="Search employee..." style="max-width:260px"/>
      </div>

      <div id="employeeFormWrap" style="display:none; margin-bottom:16px; padding:14px; border:1px solid #ddd; border-radius:12px; background:#fff;">
        <h3 id="employeeFormTitle" style="margin-top:0">Add Employee</h3>

        <div style="display:grid; grid-template-columns:repeat(2, minmax(220px, 1fr)); gap:10px;">
          <!-- Employee general information form -->
          <input id="empNo" type="text" placeholder="Employee Number" />
          <input id="empDisplayName" type="text" placeholder="Display Name" />
          <input id="empFirstName" type="text" placeholder="First Name" />
          <input id="empLastName" type="text" placeholder="Last Name" />
          <input id="empEmail" type="email" placeholder="Email" />
          <input id="empPhone" type="text" placeholder="Phone Number" />
          <select id="empDepartment">
            <option value="">Select Department</option>
            <option value="Operations">Operations</option>
            <option value="Administration">Administration</option>
            <option value="Workshop">Workshop</option>
            <option value="Accounts">Accounts</option>
            <option value="Management">Management</option>
          </select>
          <select id="empRole">
            <option value="">Select Role</option>
            <option value="Driver">Driver</option>
            <option value="Admin">Admin</option>
            <option value="Mechanic">Mechanic</option>
            <option value="Dispatcher">Dispatcher</option>
            <option value="Accounts">Accounts</option>
            <option value="Manager">Manager</option>
          </select>
          <select id="empEmploymentType">
            <option value="">Employment Type</option>
            <option value="Full Time">Full Time</option>
            <option value="Part Time">Part Time</option>
            <option value="Casual">Casual</option>
            <option value="Contract">Contract</option>
          </select>
          <select id="empAccessLevel">
            <option value="">Access Level</option>
            <option value="Driver">Driver</option>
            <option value="Admin">Admin</option>
            <option value="Super Admin">Super Admin</option>
          </select>
          <select id="empStatus">
            <option value="Active">Active</option>
            <option value="Inactive">Inactive</option>
            <option value="On Leave">On Leave</option>
          </select>
        </div>

        <!-- Driver-specific details form -->
        <div id="driverFieldsWrap" style="display:none; margin-top:16px; padding-top:14px; border-top:1px solid #eee;">
          <h4 style="margin:0 0 12px 0">Driver Details</h4>
          <div style="display:grid; grid-template-columns:repeat(2, minmax(220px, 1fr)); gap:10px;">
            <input id="empLicenceNumber" type="text" placeholder="Licence Number" />
            <input id="empLicenceExpiry" type="date" />
            <input id="empDANumber" type="text" placeholder="DA Number" />
            <input id="empDAExpiry" type="date" />
            <input id="empWWCCNumber" type="text" placeholder="WWCC Number" />
            <input id="empWWCCExpiry" type="date" />
            <label class="muted" style="margin-top:6px;">Medical Expiry</label>
            <input id="empMedicalExpiry" type="date" />
            <select id="empFatigueCategory">
              <option value="">Fatigue Category</option>
              <option value="Standard">Standard</option>
              <option value="BFM">BFM</option>
              <option value="AFM">AFM</option>
            </select>
            <select id="empHomeDepot">
              <option value="">Home Depot</option>
              <option value="Hannans">Hannans</option>
              <option value="Bounds">Bounds</option>
              <option value="Olympic Park">Olympic Park</option>
            </select>
          </div>
        </div>

        <div style="display:flex; gap:10px; margin-top:12px;">
          <button id="saveEmployeeBtn">Save Employee</button>
          <button id="cancelEmployeeBtn" type="button">Cancel</button>
        </div>
      </div>

      <table style="width:100%; border-collapse:collapse">
        <thead>
          <tr style="text-align:left; border-bottom:1px solid #ddd">
            <th>Emp No</th>
            <th>Display Name</th>
            <th>Role</th>
            <th>Employment</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody id="employeesTableBody"></tbody>
      </table>
    </div>
  `;

  // Variables for accessing elements and employee data
  const tbody = document.getElementById("employeesTableBody");
  const searchInput = document.getElementById("employeeSearch");
  const formWrap = document.getElementById("employeeFormWrap");
  const formTitle = document.getElementById("employeeFormTitle");
  const addBtn = document.getElementById("addEmployeeBtn");
  const editBtn = document.getElementById("editEmployeeBtn");
  const cancelBtn = document.getElementById("cancelEmployeeBtn");
  const saveBtn = document.getElementById("saveEmployeeBtn");
  const roleEl = document.getElementById("empRole");
  const driverFieldsWrap = document.getElementById("driverFieldsWrap");

  let employeesCache = [];
  let selectedEmployee = null;
  let editMode = false;

  // Function to toggle the visibility of driver fields based on role selection
  function toggleDriverFields() {
    const role = document.getElementById("empRole").value;
    driverFieldsWrap.style.display = role === "Driver" ? "block" : "none";
  }

  // Function to clear driver-specific fields
  function clearDriverFields() {
    document.getElementById("empLicenceNumber").value = "";
    document.getElementById("empLicenceExpiry").value = "";
    document.getElementById("empDANumber").value = "";
    document.getElementById("empDAExpiry").value = "";
    document.getElementById("empWWCCNumber").value = "";
    document.getElementById("empWWCCExpiry").value = "";
    document.getElementById("empMedicalExpiry").value = "";
    document.getElementById("empFatigueCategory").value = "";
    document.getElementById("empHomeDepot").value = "";
  }

  // Function to clear all form fields
  function clearForm() {
    document.getElementById("empNo").value = "";
    document.getElementById("empDisplayName").value = "";
    document.getElementById("empFirstName").value = "";
    document.getElementById("empLastName").value = "";
    document.getElementById("empEmail").value = "";
    document.getElementById("empPhone").value = "";
    document.getElementById("empDepartment").value = "";
    document.getElementById("empRole").value = "";
    document.getElementById("empEmploymentType").value = "";
    document.getElementById("empAccessLevel").value = "";
    document.getElementById("empStatus").value = "Active";

    clearDriverFields();
    toggleDriverFields();
  }

  // Function to fill the form with employee data (including driver data if applicable)
  function fillForm(employee) {
    document.getElementById("empNo").value = employee.employeeNumber || "";
    document.getElementById("empDisplayName").value = employee.displayName || "";
    document.getElementById("empFirstName").value = employee.firstName || "";
    document.getElementById("empLastName").value = employee.lastName || "";
    document.getElementById("empEmail").value = employee.email || "";
    document.getElementById("empPhone").value = employee.phoneNumber || "";
    document.getElementById("empDepartment").value = employee.department || "";
    document.getElementById("empRole").value = employee.role || "";
    document.getElementById("empEmploymentType").value = employee.employmentType || "";
    document.getElementById("empAccessLevel").value = employee.accessLevel || "";
    document.getElementById("empStatus").value = employee.status || "Active";

    document.getElementById("empLicenceNumber").value = employee.licenceNumber || "";
    document.getElementById("empLicenceExpiry").value = employee.licenceExpiry || "";
    document.getElementById("empDANumber").value = employee.daNumber || "";
    document.getElementById("empDAExpiry").value = employee.daExpiry || "";
    document.getElementById("empWWCCNumber").value = employee.wwccNumber || "";
    document.getElementById("empWWCCExpiry").value = employee.wwccExpiry || "";
    document.getElementById("empMedicalExpiry").value = employee.medicalExpiry || "";
    document.getElementById("empFatigueCategory").value = employee.fatigueCategory || "";
    document.getElementById("empHomeDepot").value = employee.homeDepot || "";

    toggleDriverFields();
  }

  // Function to render the employee table
  function renderTable(list) {
    tbody.innerHTML = list
      .map(
        (e) => ` 
          <tr data-id="${e.employeeNumber}" style="border-bottom:1px solid #eee; cursor:pointer">
            <td>${e.employeeNumber || ""}</td>
            <td>${e.displayName || ""}</td>
            <td>${e.role || ""}</td>
            <td>${e.employmentType || ""}</td>
            <td>${e.status || ""}</td>
          </tr>
        `
      )
      .join("");

    [...tbody.querySelectorAll("tr")].forEach((row) => {
      row.onclick = () => {
        selectedEmployee = row.getAttribute("data-id");
        [...tbody.querySelectorAll("tr")].forEach((r) => {
          r.style.background = "";
        });
        row.style.background = "#fdecec";
      };
    });
  }

  // Listen for employees from the database
  listenEmployees(
    (employees) => {
      employeesCache = employees || [];
      renderTable(employeesCache);
    },
    (err) => {
      console.error("Employees error:", err);
      showError(err?.message || "Failed to load employees");
    }
  );

  // Search function for employee filtering
  searchInput.oninput = () => {
    const q = (searchInput.value || "").toLowerCase().trim();

    const filtered = employeesCache.filter((e) =>
      String(e.employeeNumber || "").toLowerCase().includes(q) ||
      String(e.displayName || "").toLowerCase().includes(q) ||
      String(e.firstName || "").toLowerCase().includes(q) ||
      String(e.lastName || "").toLowerCase().includes(q) ||
      String(e.email || "").toLowerCase().includes(q)
    );

    renderTable(filtered);
  };

  // Role change triggers
  roleEl.onchange = () => {
    toggleDriverFields();
  };

  // Add Employee button click
  addBtn.onclick = () => {
    editMode = false;
    formTitle.textContent = "Add Employee";
    clearForm();
    document.getElementById("empNo").disabled = false;
    formWrap.style.display = "block";
  };

  // Edit Employee button click
  editBtn.onclick = () => {
    if (!selectedEmployee) {
      alert("Please select an employee first.");
      return;
    }

    const employee = employeesCache.find(
      (e) => String(e.employeeNumber) === String(selectedEmployee)
    );

    if (!employee) {
      alert("Selected employee not found.");
      return;
    }

    editMode = true;
    formTitle.textContent = "Edit Employee";
    fillForm(employee);
    document.getElementById("empNo").disabled = true;
    formWrap.style.display = "block";
  };

  // Cancel Employee form action
  cancelBtn.onclick = () => {
    formWrap.style.display = "none";
    clearForm();
    editMode = false;
    document.getElementById("empNo").disabled = false;
  };

  // Save Employee button click
  saveBtn.onclick = async () => {
    try {
      const role = document.getElementById("empRole").value;

      const employee = {
        employeeNumber: document.getElementById("empNo").value.trim(),
        displayName: document.getElementById("empDisplayName").value.trim(),
        firstName: document.getElementById("empFirstName").value.trim(),
        lastName: document.getElementById("empLastName").value.trim(),
        email: document.getElementById("empEmail").value.trim(),
        phoneNumber: document.getElementById("empPhone").value.trim(),
        department: document.getElementById("empDepartment").value,
        role,
        employmentType: document.getElementById("empEmploymentType").value,
        accessLevel: document.getElementById("empAccessLevel").value,
        status: document.getElementById("empStatus").value,

        licenceNumber: role === "Driver" ? document.getElementById("empLicenceNumber").value.trim() : "",
        licenceExpiry: role === "Driver" ? document.getElementById("empLicenceExpiry").value : "",
        daNumber: role === "Driver" ? document.getElementById("empDANumber").value.trim() : "",
        daExpiry: role === "Driver" ? document.getElementById("empDAExpiry").value : "",
        wwccNumber: role === "Driver" ? document.getElementById("empWWCCNumber").value.trim() : "",
        wwccExpiry: role === "Driver" ? document.getElementById("empWWCCExpiry").value : "",
        medicalExpiry: role === "Driver" ? document.getElementById("empMedicalExpiry").value : "",
        fatigueCategory: role === "Driver" ? document.getElementById("empFatigueCategory").value : "",
        homeDepot: role === "Driver" ? document.getElementById("empHomeDepot").value : ""
      };

      if (!employee.employeeNumber) {
        alert("Employee Number is required.");
        return;
      }

      if (!employee.displayName) {
        alert("Display Name is required.");
        return;
      }

      const wasEditMode = editMode;

      await saveEmployee(employee);

      formWrap.style.display = "none";
      clearForm();
      editMode = false;
      document.getElementById("empNo").disabled = false;

      alert(wasEditMode ? "Employee updated successfully." : "Employee saved successfully.");
    } catch (err) {
      console.error(err);
      alert(err?.message || "Failed to save employee.");
    }
  };
}