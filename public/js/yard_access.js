// Yard permission supplements an employee's primary role; it never grants manager access.
const norm=value=>String(value||'').trim().toLowerCase();
const active=employee=>norm(employee?.status)==='active'&&employee?.deleted!==true;
export function hasYardAccess(employee){return active(employee)&&(employee.yardAccess===true||[employee.role,employee.accessLevel].some(value=>norm(value)==='yard man'));}
export function hasDriverAccess(employee){return active(employee)&&[employee.role,employee.accessLevel].some(value=>norm(value)==='driver');}
export function isYardOnly(employee){return hasYardAccess(employee)&&!hasDriverAccess(employee);}
