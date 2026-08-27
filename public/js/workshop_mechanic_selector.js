import { collection, onSnapshot } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";
import { db } from "./firebase.js";

const select = document.getElementById("jobMechanic");

function norm(v) {
  return String(v || "").trim().toLowerCase();
}

function esc(v) {
  return String(v ?? "").replace(/[&<>'\"]/g, (m) => ({
    "&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'\"':"&quot;"
  }[m]));
}

function employeeNumber(employee, id) {
  return String(
    employee.employeeNumber ||
    employee.employeeNo ||
    employee.empNo ||
    employee.number ||
    id ||
    ""
  ).trim();
}

function employeeName(employee) {
  const fullName = [employee.firstName, employee.lastName].filter(Boolean).join(" ").trim();
  return String(
    employee.displayName ||
    employee.name ||
    employee.fullName ||
    fullName ||
    employee.email ||
    "Mechanic"
  ).trim();
}

function isActiveWorkshopMechanic(employee) {
  return norm(employee.status) === "active" &&
    norm(employee.department) === "workshop" &&
    norm(employee.role) === "mechanic";
}

if (select) {
  onSnapshot(collection(db, "employees"), (snap) => {
    const current = select.value;
    const mechanics = snap.docs
      .map((d) => ({ id:d.id, ...d.data() }))
      .filter(isActiveWorkshopMechanic)
      .sort((a,b) => employeeName(a).localeCompare(employeeName(b), undefined, { sensitivity:"base" }));

    select.innerHTML = `
      <option value="">Unassigned — Shared Workshop Queue</option>
      ${mechanics.map((employee) => {
        const name = employeeName(employee);
        const number = employeeNumber(employee, employee.id);
        return `<option value="${esc(name)}" data-employee-number="${esc(number)}" data-employee-email="${esc(employee.email || "")}">${esc(name)}${number ? ` — ${esc(number)}` : ""}</option>`;
      }).join("")}`;

    if ([...select.options].some((option) => option.value === current)) {
      select.value = current;
    } else {
      select.value = "";
    }
  }, (error) => {
    console.error("Unable to load Workshop mechanics from Employees", error);
    select.innerHTML = `<option value="">Unassigned — Shared Workshop Queue</option>`;
  });
}
