import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-auth.js";
import { auth } from "./firebase.js";
import { ADMIN_EMAILS } from "./config.js";
import { getEmployeeByEmail } from "./db.js";

const link = document.getElementById("backToWorkshopManagement");
const norm = (v) => String(v || "").trim().toLowerCase();
const isSuperAdmin = (email) => ADMIN_EMAILS.map(norm).includes(norm(email));
const openedFromWorkshop = new URLSearchParams(window.location.search).get("from") === "workshop";

function canReturnToWorkshop(employee) {
  if (!employee) return false;
  if (norm(employee.status) !== "active") return false;
  const role = norm(employee.role);
  const accessLevel = norm(employee.accessLevel);
  if (accessLevel === "super admin") return true;
  return role === "manager" || role === "fleet manager";
}

onAuthStateChanged(auth, async (user) => {
  if (!link) return;
  link.hidden = true;

  // The return link is contextual, not a general mechanic-page navigation link.
  // It is only available when an authorised manager entered this page from
  // Workshop Management using mechanic.html?from=workshop.
  if (!user || !openedFromWorkshop) return;

  if (isSuperAdmin(user.email)) {
    link.hidden = false;
    return;
  }

  try {
    const employee = await getEmployeeByEmail(user.email);
    link.hidden = !canReturnToWorkshop(employee);
  } catch (error) {
    console.error("Unable to verify Workshop return access", error);
    link.hidden = true;
  }
});
