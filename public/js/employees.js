import {
  deactivateEmployee,
  getEmployee,
  listenEmployees,
  saveEmployee
} from "./db.js";
import { els, showError } from "./ui.js";
import { escapeHtml } from "./utils.js";

let employeesUnsub = null;

const DEPARTMENTS = ["Operations", "Administration", "Workshop", "Accounts", "Management"];
const ROLES = ["Driver", "Admin", "Mechanic", "Dispatcher", "Accounts", "Manager"];
const EMPLOYMENT_TYPES = ["Full Time", "Part Time", "Casual", "Contract"];
const ACCESS_LEVELS = ["Driver", "Admin", "Super Admin"];
const STATUSES = ["Active", "Inactive", "On Leave"];

function options(items, placeholder) {
  return [
    `<option value="">${escapeHtml(placeholder)}</option>`,
    ...items.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`)
  ].join("");
}

function expiryState(value) {
  if (!value) return "none";
  const expiry = new Date(`${value}T23:59:59`);
  if (Number.isNaN(expiry.getTime())) return "none";
  const days = Math.ceil((expiry.getTime() - Date.now()) / 86400000);
  if (days < 0) return "expired";
  if (days <= 60) return "warning";
  return "valid";
}

function employeeComplianceState(employee) {
  if (employee.role !== "Driver") return "none";
  const states = [
    employee.licenceExpiry,
    employee.daExpiry,
    employee.wwccExpiry,
    employee.medicalExpiry
  ].map(expiryState);
  if (states.includes("expired")) return "expired";
  if (states.includes("warning")) return "warning";
  return states.includes("valid") ? "valid" : "none";
}

function statusClass(status) {
  const value = String(status || "").toLowerCase();
  if (value === "active") return "active";
  if (value === "on leave") return "leave";
  return "inactive";
}

export function renderEmployeesPage() {
  showError("");

  if (employeesUnsub) {
    employeesUnsub();
    employeesUnsub = null;
  }

  els.contentArea.innerHTML = `
    <div id="employeesPage" class="employees-page">
      <header class="employees-hero">
        <div class="employees-hero-title">
          <span><i data-lucide="users-round"></i></span>
          <div>
            <div class="employees-eyebrow">Workforce management</div>
            <h2>Employees</h2>
            <p>Manage employee records, portal access and driver compliance.</p>
          </div>
        </div>
        <button id="addEmployeeBtn" type="button" class="employees-primary-btn">
          <i data-lucide="user-plus"></i> Add Employee
        </button>
      </header>

      <div id="employeePageMessage" class="employees-message" hidden></div>

      <section id="employeeFormWrap" class="card employees-form-card" hidden>
        <div class="employees-form-heading">
          <div>
            <div class="employees-form-kicker" id="employeeFormKicker">New employee</div>
            <h3 id="employeeFormTitle">Add Employee</h3>
            <p id="employeeFormSubtitle">Create an employee record and assign portal access.</p>
          </div>
          <button id="closeEmployeeFormBtn" type="button" class="employees-icon-btn" aria-label="Close employee form">
            <i data-lucide="x"></i>
          </button>
        </div>

        <div id="employeeFormMessage" class="employees-form-message" hidden></div>

        <div class="employees-form-section">
          <div class="employees-section-heading"><span>1</span><div><h4>Personal information</h4><p>Core identity and contact information.</p></div></div>
          <div class="employees-form-grid">
            <label class="employees-field"><span>Employee number <b>*</b></span><input id="empNo" type="text" maxlength="30" autocomplete="off" /></label>
            <label class="employees-field"><span>Display name <b>*</b></span><input id="empDisplayName" type="text" maxlength="120" /></label>
            <label class="employees-field"><span>First name</span><input id="empFirstName" type="text" maxlength="80" /></label>
            <label class="employees-field"><span>Last name</span><input id="empLastName" type="text" maxlength="80" /></label>
            <label class="employees-field"><span>Email address</span><input id="empEmail" type="email" maxlength="180" autocomplete="email" /></label>
            <label class="employees-field"><span>Phone number</span><input id="empPhone" type="tel" maxlength="40" autocomplete="tel" /></label>
          </div>
        </div>

        <div class="employees-form-section">
          <div class="employees-section-heading"><span>2</span><div><h4>Employment and access</h4><p>Assign operational responsibility and portal permissions.</p></div></div>
          <div class="employees-form-grid">
            <label class="employees-field"><span>Department <b>*</b></span><select id="empDepartment">${options(DEPARTMENTS, "Select department")}</select></label>
            <label class="employees-field"><span>Role <b>*</b></span><select id="empRole">${options(ROLES, "Select role")}</select></label>
            <label class="employees-field"><span>Employment type <b>*</b></span><select id="empEmploymentType">${options(EMPLOYMENT_TYPES, "Select employment type")}</select></label>
            <label class="employees-field"><span>Access level <b>*</b></span><select id="empAccessLevel">${options(ACCESS_LEVELS, "Select access level")}</select></label>
            <label class="employees-field"><span>Employee status <b>*</b></span><select id="empStatus">${STATUSES.map((status) => `<option value="${status}">${status}</option>`).join("")}</select></label>
          </div>
          <div id="employeeAccessHint" class="employees-access-hint"></div>
        </div>

        <div id="driverFieldsWrap" class="employees-form-section" hidden>
          <div class="employees-section-heading"><span>3</span><div><h4>Driver compliance</h4><p>Licence, authority, working-with-children and fatigue records.</p></div></div>
          <div class="employees-form-grid">
            <label class="employees-field"><span>Licence number</span><input id="empLicenceNumber" type="text" maxlength="80" /></label>
            <label class="employees-field"><span>Licence expiry</span><input id="empLicenceExpiry" type="date" /></label>
            <label class="employees-field"><span>Driver Authority number</span><input id="empDANumber" type="text" maxlength="80" /></label>
            <label class="employees-field"><span>Driver Authority expiry</span><input id="empDAExpiry" type="date" /></label>
            <label class="employees-field"><span>WWCC number</span><input id="empWWCCNumber" type="text" maxlength="80" /></label>
            <label class="employees-field"><span>WWCC expiry</span><input id="empWWCCExpiry" type="date" /></label>
            <label class="employees-field"><span>Medical expiry</span><input id="empMedicalExpiry" type="date" /></label>
            <label class="employees-field"><span>Fatigue category</span><select id="empFatigueCategory">${options(["Standard", "BFM", "AFM"], "Select fatigue category")}</select></label>
            <label class="employees-field employees-full"><span>Home depot</span><select id="empHomeDepot">${options(["Hannans", "Bounds", "Olympic Park"], "Select home depot")}</select></label>
          </div>
        </div>

        <div class="employees-form-actions">
          <button id="saveEmployeeBtn" type="button" class="employees-primary-btn">Save Employee</button>
          <button id="cancelEmployeeBtn" type="button" class="btn">Cancel</button>
          <button id="deactivateEmployeeBtn" type="button" class="employees-danger-btn" hidden>Deactivate Employee</button>
        </div>
      </section>

      <section class="card employees-directory">
        <div class="employees-directory-heading">
          <div><h3>Employee Directory</h3><p id="employeeResultCount">Loading employees…</p></div>
          <button id="editEmployeeBtn" type="button" class="btn" disabled><i data-lucide="pencil"></i> Edit Selected</button>
        </div>

        <div class="employees-filters">
          <label class="employees-search"><span>Search</span><div><i data-lucide="search"></i><input id="employeeSearch" type="search" placeholder="Number, name, email or department" /></div></label>
          <label><span>Role</span><select id="employeeRoleFilter"><option value="">All roles</option>${ROLES.map((role) => `<option value="${role}">${role}</option>`).join("")}</select></label>
          <label><span>Status</span><select id="employeeStatusFilter"><option value="">All statuses</option>${STATUSES.map((status) => `<option value="${status}">${status}</option>`).join("")}</select></label>
          <button id="clearEmployeeFilters" type="button" class="btn">Clear filters</button>
        </div>

        <div class="employees-table-wrap">
          <table class="employees-table">
            <thead><tr><th>Employee</th><th>Department</th><th>Role</th><th>Employment</th><th>Status</th><th>Compliance</th></tr></thead>
            <tbody id="employeesTableBody"><tr><td colspan="6"><div class="employees-empty">Loading employees…</div></td></tr></tbody>
          </table>
        </div>
        <div id="employeesMobileList" class="employees-mobile-list"></div>
      </section>
    </div>
  `;

  window.lucide?.createIcons?.();

  const tbody = document.getElementById("employeesTableBody");
  const mobileList = document.getElementById("employeesMobileList");
  const searchInput = document.getElementById("employeeSearch");
  const roleFilter = document.getElementById("employeeRoleFilter");
  const statusFilter = document.getElementById("employeeStatusFilter");
  const countEl = document.getElementById("employeeResultCount");
  const formWrap = document.getElementById("employeeFormWrap");
  const formTitle = document.getElementById("employeeFormTitle");
  const formKicker = document.getElementById("employeeFormKicker");
  const formSubtitle = document.getElementById("employeeFormSubtitle");
  const formMessage = document.getElementById("employeeFormMessage");
  const pageMessage = document.getElementById("employeePageMessage");
  const addBtn = document.getElementById("addEmployeeBtn");
  const editBtn = document.getElementById("editEmployeeBtn");
  const saveBtn = document.getElementById("saveEmployeeBtn");
  const cancelBtn = document.getElementById("cancelEmployeeBtn");
  const closeBtn = document.getElementById("closeEmployeeFormBtn");
  const deactivateBtn = document.getElementById("deactivateEmployeeBtn");
  const roleEl = document.getElementById("empRole");
  const accessEl = document.getElementById("empAccessLevel");
  const driverFieldsWrap = document.getElementById("driverFieldsWrap");
  const accessHint = document.getElementById("employeeAccessHint");

  let employeesCache = [];
  let selectedEmployeeNumber = "";
  let editingEmployee = null;
  let editMode = false;
  let formDirty = false;

  const field = (id) => document.getElementById(id);

  function showPageMessage(message, type = "success") {
    if (!pageMessage) return;
    pageMessage.textContent = message;
    pageMessage.className = `employees-message ${type}`;
    pageMessage.hidden = !message;
  }

  function showFormMessage(message, type = "error") {
    if (!formMessage) return;
    formMessage.textContent = message;
    formMessage.className = `employees-form-message ${type}`;
    formMessage.hidden = !message;
    if (message) formMessage.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function updateAccessHint() {
    const role = roleEl?.value || "";
    const access = accessEl?.value || "";
    if (!accessHint) return;
    if (!role || !access) {
      accessHint.textContent = "Select a role and access level to configure portal permissions.";
      accessHint.className = "employees-access-hint";
      return;
    }

    const dualAccess = role === "Driver" && access.includes("Admin");
    accessHint.textContent = dualAccess ?
      "This employee will have both Driver and Admin capabilities. Confirm this is intentional." :
      `${role} role with ${access} portal access.`;
    accessHint.className = `employees-access-hint ${dualAccess ? "warning" : ""}`;
  }

  function toggleDriverFields() {
    if (!driverFieldsWrap) return;
    driverFieldsWrap.hidden = roleEl?.value !== "Driver";
    updateAccessHint();
  }

  function clearDriverFields() {
    ["empLicenceNumber", "empLicenceExpiry", "empDANumber", "empDAExpiry", "empWWCCNumber", "empWWCCExpiry", "empMedicalExpiry", "empFatigueCategory", "empHomeDepot"]
      .forEach((id) => { if (field(id)) field(id).value = ""; });
  }

  function clearForm() {
    ["empNo", "empDisplayName", "empFirstName", "empLastName", "empEmail", "empPhone", "empDepartment", "empRole", "empEmploymentType", "empAccessLevel"]
      .forEach((id) => { if (field(id)) field(id).value = ""; });
    if (field("empStatus")) field("empStatus").value = "Active";
    clearDriverFields();
    toggleDriverFields();
    formDirty = false;
    showFormMessage("");
  }

  function fillForm(employee) {
    const values = {
      empNo: employee.employeeNumber,
      empDisplayName: employee.displayName,
      empFirstName: employee.firstName,
      empLastName: employee.lastName,
      empEmail: employee.email,
      empPhone: employee.phoneNumber,
      empDepartment: employee.department,
      empRole: employee.role,
      empEmploymentType: employee.employmentType,
      empAccessLevel: employee.accessLevel,
      empStatus: employee.status || "Active",
      empLicenceNumber: employee.licenceNumber,
      empLicenceExpiry: employee.licenceExpiry,
      empDANumber: employee.daNumber,
      empDAExpiry: employee.daExpiry,
      empWWCCNumber: employee.wwccNumber,
      empWWCCExpiry: employee.wwccExpiry,
      empMedicalExpiry: employee.medicalExpiry,
      empFatigueCategory: employee.fatigueCategory,
      empHomeDepot: employee.homeDepot
    };
    Object.entries(values).forEach(([id, value]) => {
      if (field(id)) field(id).value = value || "";
    });
    toggleDriverFields();
    formDirty = false;
  }

  function openAddForm() {
    editMode = false;
    editingEmployee = null;
    clearForm();
    field("empNo").disabled = false;
    formKicker.textContent = "New employee";
    formTitle.textContent = "Add Employee";
    formSubtitle.textContent = "Create an employee record and assign portal access.";
    saveBtn.textContent = "Save Employee";
    deactivateBtn.hidden = true;
    formWrap.hidden = false;
    formWrap.scrollIntoView({ behavior: "smooth", block: "start" });
    setTimeout(() => field("empNo")?.focus(), 250);
  }

  function openEditForm() {
    if (!selectedEmployeeNumber) {
      showPageMessage("Select an employee before editing.", "error");
      return;
    }
    const employee = employeesCache.find(
      (item) => String(item.employeeNumber) === String(selectedEmployeeNumber)
    );
    if (!employee) {
      showPageMessage("The selected employee could not be found. Refresh the directory and try again.", "error");
      return;
    }

    editMode = true;
    editingEmployee = employee;
    fillForm(employee);
    field("empNo").disabled = true;
    formKicker.textContent = `Employee ${employee.employeeNumber}`;
    formTitle.textContent = `Edit ${employee.displayName || employee.employeeNumber}`;
    formSubtitle.textContent = "Update employee information, access and compliance details.";
    saveBtn.textContent = "Save Changes";
    deactivateBtn.hidden = employee.status === "Inactive";
    formWrap.hidden = false;
    formWrap.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function closeForm(force = false) {
    if (!force && formDirty && !confirm("Discard your unsaved employee changes?")) return;
    formWrap.hidden = true;
    clearForm();
    editMode = false;
    editingEmployee = null;
    field("empNo").disabled = false;
  }

  function currentFilteredEmployees() {
    const search = String(searchInput?.value || "").trim().toLowerCase();
    const role = roleFilter?.value || "";
    const status = statusFilter?.value || "";
    return employeesCache.filter((employee) => {
      if (role && employee.role !== role) return false;
      if (status && employee.status !== status) return false;
      if (!search) return true;
      return [
        employee.employeeNumber,
        employee.displayName,
        employee.firstName,
        employee.lastName,
        employee.email,
        employee.department,
        employee.role
      ].filter(Boolean).join(" ").toLowerCase().includes(search);
    });
  }

  function complianceBadge(employee) {
    const state = employeeComplianceState(employee);
    if (state === "expired") return `<span class="employees-compliance expired">Expired</span>`;
    if (state === "warning") return `<span class="employees-compliance warning">Due soon</span>`;
    if (state === "valid") return `<span class="employees-compliance valid">Current</span>`;
    return `<span class="employees-compliance none">—</span>`;
  }

  function selectEmployee(employeeNumber) {
    selectedEmployeeNumber = String(employeeNumber || "");
    editBtn.disabled = !selectedEmployeeNumber;
    showPageMessage("");
    renderDirectory();
  }

  function renderDirectory() {
    const list = currentFilteredEmployees();
    if (countEl) countEl.textContent = `${list.length} of ${employeesCache.length} employees`;

    if (!list.some((item) => String(item.employeeNumber) === selectedEmployeeNumber)) {
      selectedEmployeeNumber = "";
      editBtn.disabled = true;
    }

    if (!list.length) {
      tbody.innerHTML = `<tr><td colspan="6"><div class="employees-empty">No employees match these filters.</div></td></tr>`;
      mobileList.innerHTML = `<div class="employees-empty">No employees match these filters.</div>`;
      return;
    }

    tbody.innerHTML = list.map((employee) => {
      const selected = String(employee.employeeNumber) === selectedEmployeeNumber;
      return `
        <tr data-employee-select="${escapeHtml(employee.employeeNumber)}" class="${selected ? "selected" : ""}">
          <td><div class="employees-name-cell"><strong>${escapeHtml(employee.displayName || "Unnamed employee")}</strong><small>${escapeHtml(employee.employeeNumber || "")} ${employee.email ? `· ${escapeHtml(employee.email)}` : ""}</small></div></td>
          <td>${escapeHtml(employee.department || "—")}</td>
          <td><span class="employees-role-badge">${escapeHtml(employee.role || "—")}</span></td>
          <td>${escapeHtml(employee.employmentType || "—")}</td>
          <td><span class="employees-status ${statusClass(employee.status)}">${escapeHtml(employee.status || "Inactive")}</span></td>
          <td>${complianceBadge(employee)}</td>
        </tr>
      `;
    }).join("");

    mobileList.innerHTML = list.map((employee) => {
      const selected = String(employee.employeeNumber) === selectedEmployeeNumber;
      return `
        <article data-employee-select="${escapeHtml(employee.employeeNumber)}" class="employees-mobile-card ${selected ? "selected" : ""}">
          <div class="employees-mobile-head"><div><strong>${escapeHtml(employee.displayName || "Unnamed employee")}</strong><small>Employee ${escapeHtml(employee.employeeNumber || "")}</small></div><span class="employees-status ${statusClass(employee.status)}">${escapeHtml(employee.status || "Inactive")}</span></div>
          <div class="employees-mobile-meta"><span>${escapeHtml(employee.role || "No role")}</span><span>${escapeHtml(employee.department || "No department")}</span><span>${escapeHtml(employee.employmentType || "—")}</span></div>
          ${employee.email ? `<div class="employees-mobile-email">${escapeHtml(employee.email)}</div>` : ""}
          <div>${complianceBadge(employee)}</div>
        </article>
      `;
    }).join("");

    document.querySelectorAll("[data-employee-select]").forEach((element) => {
      element.onclick = () => selectEmployee(element.getAttribute("data-employee-select"));
      element.ondblclick = () => {
        selectedEmployeeNumber = element.getAttribute("data-employee-select") || "";
        openEditForm();
      };
    });
  }

  function readEmployeeForm() {
    const role = roleEl.value;
    return {
      employeeNumber: field("empNo").value.trim(),
      displayName: field("empDisplayName").value.trim(),
      firstName: field("empFirstName").value.trim(),
      lastName: field("empLastName").value.trim(),
      email: field("empEmail").value.trim(),
      phoneNumber: field("empPhone").value.trim(),
      department: field("empDepartment").value,
      role,
      employmentType: field("empEmploymentType").value,
      accessLevel: field("empAccessLevel").value,
      status: field("empStatus").value,
      licenceNumber: role === "Driver" ? field("empLicenceNumber").value.trim() : "",
      licenceExpiry: role === "Driver" ? field("empLicenceExpiry").value : "",
      daNumber: role === "Driver" ? field("empDANumber").value.trim() : "",
      daExpiry: role === "Driver" ? field("empDAExpiry").value : "",
      wwccNumber: role === "Driver" ? field("empWWCCNumber").value.trim() : "",
      wwccExpiry: role === "Driver" ? field("empWWCCExpiry").value : "",
      medicalExpiry: role === "Driver" ? field("empMedicalExpiry").value : "",
      fatigueCategory: role === "Driver" ? field("empFatigueCategory").value : "",
      homeDepot: role === "Driver" ? field("empHomeDepot").value : ""
    };
  }

  function validateEmployee(employee) {
    if (!employee.employeeNumber) return "Employee number is required.";
    if (!/^[a-zA-Z0-9-]+$/.test(employee.employeeNumber)) return "Employee number can contain only letters, numbers and hyphens.";
    if (!employee.displayName) return "Display name is required.";
    if (employee.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(employee.email)) return "Enter a valid email address.";
    if (!employee.department) return "Department is required.";
    if (!employee.role) return "Role is required.";
    if (!employee.employmentType) return "Employment type is required.";
    if (!employee.accessLevel) return "Access level is required.";
    if (!employee.status) return "Employee status is required.";
    return "";
  }

  employeesUnsub = listenEmployees(
    (employees) => {
      if (!document.getElementById("employeesPage")) {
        employeesUnsub?.();
        employeesUnsub = null;
        return;
      }
      employeesCache = employees || [];
      renderDirectory();
    },
    (error) => {
      console.error("Employees error", error);
      showPageMessage(error?.message || "Failed to load employees.", "error");
    }
  );

  document.querySelectorAll("#employeeFormWrap input, #employeeFormWrap select").forEach((element) => {
    element.addEventListener("input", () => { formDirty = true; });
    element.addEventListener("change", () => { formDirty = true; });
  });

  roleEl.onchange = toggleDriverFields;
  accessEl.onchange = updateAccessHint;
  addBtn.onclick = openAddForm;
  editBtn.onclick = openEditForm;
  cancelBtn.onclick = () => closeForm();
  closeBtn.onclick = () => closeForm();

  [searchInput, roleFilter, statusFilter].forEach((element) => {
    element?.addEventListener(element === searchInput ? "input" : "change", renderDirectory);
  });

  document.getElementById("clearEmployeeFilters").onclick = () => {
    searchInput.value = "";
    roleFilter.value = "";
    statusFilter.value = "";
    selectedEmployeeNumber = "";
    editBtn.disabled = true;
    renderDirectory();
  };

  saveBtn.onclick = async () => {
    showFormMessage("");
    const employee = readEmployeeForm();
    const validationError = validateEmployee(employee);
    if (validationError) return showFormMessage(validationError);

    try {
      if (!editMode) {
        const existing = await getEmployee(employee.employeeNumber);
        if (existing) {
          showFormMessage(`Employee ${employee.employeeNumber} already exists. Select that employee and use Edit Selected.`);
          return;
        }
      }

      if (
        editMode &&
        editingEmployee?.role === "Driver" &&
        employee.role !== "Driver" &&
        [editingEmployee.licenceNumber, editingEmployee.daNumber, editingEmployee.wwccNumber].some(Boolean) &&
        !confirm("Changing this employee from Driver will clear their driver compliance fields. Continue?")
      ) return;

      const wasEditMode = editMode;
      saveBtn.disabled = true;
      cancelBtn.disabled = true;
      saveBtn.textContent = "Saving…";

      await saveEmployee(employee);
      const message = wasEditMode ?
        `${employee.displayName} was updated successfully.` :
        `${employee.displayName} was created successfully.`;
      selectedEmployeeNumber = employee.employeeNumber;
      closeForm(true);
      showPageMessage(message, "success");
    } catch (error) {
      console.error("Failed to save employee", error);
      showFormMessage(error?.message || "Unable to save the employee. Please try again.");
    } finally {
      saveBtn.disabled = false;
      cancelBtn.disabled = false;
      saveBtn.textContent = editMode ? "Save Changes" : "Save Employee";
    }
  };

  deactivateBtn.onclick = async () => {
    if (!editingEmployee) return;
    if (!confirm(`Deactivate ${editingEmployee.displayName || editingEmployee.employeeNumber}? They will lose active portal access.`)) return;

    const employeeBeingDeactivated = editingEmployee;

    deactivateBtn.disabled = true;
    deactivateBtn.textContent = "Deactivating…";
    try {
      await deactivateEmployee(employeeBeingDeactivated.employeeNumber);
      closeForm(true);
      showPageMessage(`${employeeBeingDeactivated.displayName || employeeBeingDeactivated.employeeNumber} was deactivated.`, "success");
    } catch (error) {
      console.error("Failed to deactivate employee", error);
      showFormMessage(error?.message || "Unable to deactivate the employee.");
    } finally {
      deactivateBtn.disabled = false;
      deactivateBtn.textContent = "Deactivate Employee";
    }
  };

  updateAccessHint();
}
