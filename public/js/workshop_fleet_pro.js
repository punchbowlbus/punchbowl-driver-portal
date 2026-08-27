import {
  collection,
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch
} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";

import { auth, db } from "./firebase.js";

const $ = (id) => document.getElementById(id);
const esc = (v) => String(v ?? "").replace(/[&<>'"]/g, (m) => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[m]));
const norm = (v) => String(v || "").trim().toLowerCase();
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const fleetNo = (b) => String(b?.fleetNumber || b?.busNumber || b?.number || b?.id || "").trim();
const fmtKm = (v) => { const n = num(v); return n == null ? "—" : `${Math.round(n).toLocaleString("en-AU")} km`; };
const fmtDateTime = (v) => {
  if (!v) return "—";
  const d = typeof v?.toDate === "function" ? v.toDate() : new Date(v);
  return Number.isNaN(d.getTime()) ? String(v) : new Intl.DateTimeFormat("en-AU", {day:"2-digit", month:"short", year:"numeric", hour:"numeric", minute:"2-digit"}).format(d);
};

let buses = [];
let defects = [];
let jobs = [];
let history = [];
let selectedBus = null;
let tableObserver = null;

function toast(message, type = "success") {
  const status = $("status");
  if (!status) return;
  status.className = `status ${type}`;
  status.textContent = message;
  status.scrollIntoView({ behavior:"smooth", block:"nearest" });
}

function injectStyles() {
  if ($("workshopFleetProStyles")) return;
  const style = document.createElement("style");
  style.id = "workshopFleetProStyles";
  style.textContent = `
    #fleetView .page-head{align-items:center}
    .wf-toolbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:flex-end}
    .wf-toolbar .search-input{min-width:260px}
    .wf-hint{font-size:12px;color:#667085;margin:8px 0 12px}
    #fleetTableBody tr.wf-openable{cursor:pointer}
    #fleetTableBody tr.wf-openable:hover{background:#f5f9ff}
    #fleetTableBody tr.wf-openable td:first-child strong{text-decoration:underline;text-decoration-style:dotted;text-underline-offset:3px}
    .wf-dialog{width:min(1180px,calc(100vw - 28px));max-height:92vh;border:0;border-radius:18px;padding:0;box-shadow:0 24px 80px rgba(15,23,42,.3)}
    .wf-dialog::backdrop{background:rgba(15,23,42,.58)}
    .wf-shell{padding:20px;max-height:92vh;overflow:auto}
    .wf-head{display:flex;justify-content:space-between;gap:14px;align-items:flex-start;border-bottom:1px solid #e5e7eb;padding-bottom:14px;margin-bottom:16px}
    .wf-title{margin:0;font-size:28px}.wf-sub{color:#667085;margin-top:4px}
    .wf-badges{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
    .wf-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
    .wf-card{border:1px solid #dfe5ec;border-radius:13px;padding:14px;background:#fff}
    .wf-card h3{margin:0 0 10px;font-size:15px}.wf-card.wide{grid-column:span 2}.wf-card.full{grid-column:1/-1}
    .wf-kv{display:grid;grid-template-columns:150px 1fr;gap:6px 12px;font-size:13px}.wf-kv span:nth-child(odd){color:#667085}.wf-kv span:nth-child(even){font-weight:700;overflow-wrap:anywhere}
    .wf-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:16px;padding-top:14px;border-top:1px solid #e5e7eb}
    .wf-list{display:grid;gap:8px}.wf-item{border:1px solid #e5e7eb;border-radius:10px;padding:10px}.wf-item strong{display:block;margin-bottom:4px}.wf-meta{font-size:12px;color:#667085}
    .wf-empty{color:#667085;font-size:13px;padding:8px 0}
    .wf-form{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.wf-form label{display:grid;gap:5px;font-size:12px;font-weight:800;color:#667085}.wf-form input,.wf-form select,.wf-form textarea{width:100%;border:1px solid #cfd6dd;border-radius:9px;padding:10px;background:#fff;color:#1f2933}.wf-form textarea{min-height:86px}.wf-full{grid-column:1/-1}
    .wf-section-title{grid-column:1/-1;font-size:14px;font-weight:900;color:#1f2933;border-bottom:1px solid #e5e7eb;padding:8px 0 5px;margin-top:4px}
    .wf-file{display:none}
    @media(max-width:900px){.wf-grid{grid-template-columns:1fr}.wf-card.wide{grid-column:auto}.wf-form{grid-template-columns:1fr}.wf-full,.wf-section-title{grid-column:auto}.wf-kv{grid-template-columns:120px 1fr}}
  `;
  document.head.appendChild(style);
}

function ensureDialogs() {
  injectStyles();
  if (!$("wfBusDialog")) {
    const d = document.createElement("dialog");
    d.id = "wfBusDialog";
    d.className = "wf-dialog";
    d.innerHTML = `<div class="wf-shell"><div id="wfBusBody"></div></div>`;
    document.body.appendChild(d);
  }
  if (!$("wfEditDialog")) {
    const d = document.createElement("dialog");
    d.id = "wfEditDialog";
    d.className = "wf-dialog";
    d.innerHTML = `<form id="wfEditForm" class="wf-shell"><div id="wfEditBody"></div></form>`;
    document.body.appendChild(d);
    $("wfEditForm").addEventListener("submit", saveVehicle);
  }
}

function busDefects(bus) {
  const f = norm(fleetNo(bus));
  return defects.filter((d) => d.deleted !== true && (d.busId === bus.id || norm(d.fleetNumber || d.busNumber) === f));
}
function busJobs(bus) {
  const f = norm(fleetNo(bus));
  return jobs.filter((j) => j.busId === bus.id || norm(j.fleetNumber) === f);
}
function busHistory(bus) {
  const f = norm(fleetNo(bus));
  return history.filter((h) => h.busId === bus.id || norm(h.fleetNumber) === f);
}

function statusBadge(value) {
  const v = String(value || "Active");
  const cls = /out of service/i.test(v) ? "bad" : /workshop|restricted/i.test(v) ? "warn" : "good";
  return `<span class="badge ${cls}">${esc(v)}</span>`;
}

function serviceSummary(bus) {
  const type = bus.nextServiceType || "Not set";
  const dueKm = bus.nextServiceOdometer ?? bus.nextServiceKm;
  const dueDate = bus.nextServiceDate || "";
  return `${esc(type)}${dueKm != null ? ` · ${esc(fmtKm(dueKm))}` : ""}${dueDate ? ` · ${esc(dueDate)}` : ""}`;
}

function openBus(bus) {
  ensureDialogs();
  selectedBus = bus;
  const openDefects = busDefects(bus).filter((d) => !["completed","closed"].includes(norm(d.status)));
  const openJobs = busJobs(bus).filter((j) => !["completed","closed","cancelled"].includes(norm(j.status)));
  const completedJobs = busJobs(bus).filter((j) => ["completed","closed"].includes(norm(j.status))).slice(0,8);
  const vehicleHistory = busHistory(bus).slice(0,10);
  const defectHtml = openDefects.length ? openDefects.slice(0,8).map((d) => `<div class="wf-item"><strong>${esc(d.reportNumber || d.id)} · ${esc(d.category || "Defect")}</strong><div>${esc(d.description || "")}</div><div class="wf-meta">${esc(d.status || "New")} · Safe to drive: ${esc(d.safeToDrive || "—")} · ${esc(fmtDateTime(d.createdAt || d.reportedAtIso))}</div></div>`).join("") : `<div class="wf-empty">No open driver defects.</div>`;
  const jobHtml = openJobs.length ? openJobs.slice(0,8).map((j) => `<div class="wf-item"><strong>${esc(j.jobNumber || j.id)} · ${esc(j.jobType || "Workshop Job")}</strong><div>${esc(j.reportedFault || "")}</div><div class="wf-meta">${esc(j.status || "New")} · ${esc(j.assignedMechanic || "Unassigned")}</div></div>`).join("") : `<div class="wf-empty">No open workshop jobs.</div>`;
  const completedHtml = completedJobs.length ? completedJobs.map((j) => `<div class="wf-item"><strong>${esc(j.jobNumber || j.id)} · ${esc(j.jobType || "Workshop Job")}</strong><div class="wf-meta">${esc(j.status)} · ${esc(fmtDateTime(j.closedAt || j.updatedAt))}</div></div>`).join("") : `<div class="wf-empty">No completed job cards yet.</div>`;
  const historyHtml = vehicleHistory.length ? vehicleHistory.map((h) => `<div class="wf-item"><strong>${esc(h.title || h.eventType || "Vehicle event")}</strong><div>${esc(h.description || "")}</div><div class="wf-meta">${esc(fmtDateTime(h.createdAt))}</div></div>`).join("") : `<div class="wf-empty">No permanent vehicle-history events yet.</div>`;

  $("wfBusBody").innerHTML = `
    <div class="wf-head">
      <div><h2 class="wf-title">${esc(fleetNo(bus))}</h2><div class="wf-sub">${esc(bus.rego || "No registration")} · ${esc([bus.make,bus.model].filter(Boolean).join(" ") || "Vehicle details")}</div><div class="wf-badges">${statusBadge(bus.status)}<span class="badge info">${esc(bus.fuelType || "Fuel not set")}</span><span class="badge">${esc(bus.depot || "Depot not set")}</span></div></div>
      <button type="button" class="icon-button" id="wfCloseBus">×</button>
    </div>
    <div class="wf-grid">
      <section class="wf-card"><h3>Vehicle Identity</h3><div class="wf-kv">
        <span>Fleet number</span><span>${esc(fleetNo(bus))}</span><span>Registration</span><span>${esc(bus.rego || "—")}</span><span>Year</span><span>${esc(bus.year || "—")}</span><span>Make</span><span>${esc(bus.make || "—")}</span><span>Model</span><span>${esc(bus.model || "—")}</span><span>VIN / chassis</span><span>${esc(bus.vin || "—")}</span><span>Body</span><span>${esc([bus.bodyBy,bus.bodyModel].filter(Boolean).join(" ") || "—")}</span><span>Colour</span><span>${esc(bus.colour || "—")}</span><span>Rego expiry</span><span>${esc(bus.regoExpiry || "—")}</span>
      </div></section>
      <section class="wf-card"><h3>Operating Specifications</h3><div class="wf-kv">
        <span>Fuel</span><span>${esc(bus.fuelType || "—")}</span><span>Access</span><span>${esc(bus.accessType || "—")}</span><span>Euro</span><span>${esc(bus.euro || "—")}</span><span>AdBlue</span><span>${esc(bus.adblue || "—")}</span><span>Air conditioned</span><span>${esc(bus.airConditioned || "—")}</span><span>Rear door</span><span>${esc(bus.rearDoor || "—")}</span><span>Seats</span><span>${esc(bus.seatCount ?? "—")}</span><span>Standing</span><span>${esc(bus.standCount ?? "—")}</span><span>CCTV</span><span>${esc(bus.cctvCount ?? "—")}</span><span>Fire suppression</span><span>${esc(bus.fireSuppression || "—")}</span><span>Luggage bins</span><span>${esc(bus.luggageBins || "—")}</span><span>Tare / GVM</span><span>${esc(bus.tare || "—")} / ${esc(bus.gvm || "—")}</span>
      </div></section>
      <section class="wf-card"><h3>Workshop & Service</h3><div class="wf-kv">
        <span>Odometer</span><span>${esc(fmtKm(bus.currentOdometer ?? bus.odometer ?? bus.odometerKm))}</span><span>Last service</span><span>${esc(bus.lastServiceType || "—")}</span><span>Last service km</span><span>${esc(fmtKm(bus.lastServiceOdometer))}</span><span>Last service date</span><span>${esc(bus.lastServiceDate || "—")}</span><span>Next service</span><span>${serviceSummary(bus)}</span><span>Service sequence</span><span>${/ev|electric/i.test(bus.fuelType || "") ? "Small → Large" : "Small → Medium → Large"}</span><span>Open defects</span><span>${openDefects.length}</span><span>Open jobs</span><span>${openJobs.length}</span>
      </div></section>
      <section class="wf-card wide"><h3>Open Driver Defects</h3><div class="wf-list">${defectHtml}</div></section>
      <section class="wf-card"><h3>Open Workshop Jobs</h3><div class="wf-list">${jobHtml}</div></section>
      <section class="wf-card wide"><h3>Completed Job Cards</h3><div class="wf-list">${completedHtml}</div></section>
      <section class="wf-card"><h3>Recent Vehicle History</h3><div class="wf-list">${historyHtml}</div></section>
      <section class="wf-card full"><h3>Notes</h3><div>${esc(bus.notes || "No vehicle notes recorded.")}</div></section>
    </div>
    <div class="wf-actions">
      <button class="button primary" type="button" id="wfEditBus">Edit Vehicle</button>
      <button class="button secondary" type="button" id="wfUpdateKm">Update km</button>
      <button class="button secondary" type="button" id="wfServiceSetup">Service setup</button>
      <button class="button secondary" type="button" id="wfHistory">View history</button>
      <button class="button secondary" type="button" id="wfCloseBus2">Close</button>
    </div>`;

  $("wfCloseBus").onclick = () => $("wfBusDialog").close();
  $("wfCloseBus2").onclick = () => $("wfBusDialog").close();
  $("wfEditBus").onclick = () => openEditor(bus);
  $("wfUpdateKm").onclick = () => triggerRowAction(bus, "Update km");
  $("wfServiceSetup").onclick = () => triggerRowAction(bus, "Service setup");
  $("wfHistory").onclick = () => triggerRowAction(bus, "View history");
  $("wfBusDialog").showModal();
}

function triggerRowAction(bus, label) {
  $("wfBusDialog").close();
  const row = findRow(bus);
  const btn = row ? [...row.querySelectorAll("button")].find((b) => b.textContent.trim() === label) : null;
  if (btn) btn.click();
  else toast(`${label} is not available for this vehicle yet.`, "error");
}

function findRow(bus) {
  return [...document.querySelectorAll("#fleetTableBody tr")].find((row) => norm(row.cells?.[0]?.textContent) === norm(fleetNo(bus)));
}

function editorFields(bus = {}) {
  const opt = (value, items) => items.map((x) => `<option value="${esc(x)}" ${String(value||"")===x?"selected":""}>${esc(x)}</option>`).join("");
  return `
    <div class="wf-head"><div><h2 class="wf-title">${bus.id ? `Edit ${esc(fleetNo(bus))}` : "Add Vehicle"}</h2><div class="wf-sub">Full fleet master record used by Operations and Workshop.</div></div><button type="button" class="icon-button" id="wfCloseEdit">×</button></div>
    <div class="wf-form">
      <div class="wf-section-title">Vehicle identity</div>
      <label>Fleet number<input id="wfFleetNumber" required value="${esc(fleetNo(bus))}" ${bus.id?"readonly":""}></label>
      <label>Registration<input id="wfRego" value="${esc(bus.rego || "")}"></label>
      <label>Year<input id="wfYear" type="number" value="${esc(bus.year || "")}"></label>
      <label>Make<input id="wfMake" value="${esc(bus.make || "")}"></label>
      <label>Model<input id="wfModel" value="${esc(bus.model || "")}"></label>
      <label>VIN / chassis<input id="wfVin" value="${esc(bus.vin || "")}"></label>
      <label>Body manufacturer<input id="wfBodyBy" value="${esc(bus.bodyBy || "")}"></label>
      <label>Body model<input id="wfBodyModel" value="${esc(bus.bodyModel || "")}"></label>
      <label>Colour<input id="wfColour" value="${esc(bus.colour || "")}"></label>
      <label>Registration expiry<input id="wfRegoExpiry" value="${esc(bus.regoExpiry || "")}"></label>
      <div class="wf-section-title">Operating details</div>
      <label>Access type<select id="wfAccessType"><option value="">Select</option>${opt(bus.accessType,["STEPS","WHEEL CHAIR","LOW FLOOR"])}</select></label>
      <label>Fuel type<select id="wfFuelType"><option value="">Select</option>${opt(bus.fuelType,["Diesel","EV","Hybrid"])}</select></label>
      <label>Euro standard<input id="wfEuro" value="${esc(bus.euro || "")}"></label>
      <label>AdBlue<select id="wfAdblue"><option value=""></option>${opt(bus.adblue,["YES","NO"])}</select></label>
      <label>Air conditioned<select id="wfAirConditioned"><option value=""></option>${opt(bus.airConditioned,["YES","NO"])}</select></label>
      <label>Rear door<select id="wfRearDoor"><option value=""></option>${opt(bus.rearDoor,["YES","NO"])}</select></label>
      <label>Seat capacity<input id="wfSeatCount" type="number" min="0" value="${esc(bus.seatCount ?? "")}"></label>
      <label>Standing capacity<input id="wfStandCount" type="number" min="0" value="${esc(bus.standCount ?? "")}"></label>
      <label>CCTV count<input id="wfCctvCount" type="number" min="0" value="${esc(bus.cctvCount ?? "")}"></label>
      <label>Tare<input id="wfTare" value="${esc(bus.tare || "")}"></label>
      <label>GVM<input id="wfGvm" value="${esc(bus.gvm || "")}"></label>
      <label>Fire suppression<select id="wfFireSuppression"><option value=""></option>${opt(bus.fireSuppression,["YES","NO"])}</select></label>
      <label>Luggage bins<select id="wfLuggageBins"><option value=""></option>${opt(bus.luggageBins,["YES","NO"])}</select></label>
      <div class="wf-section-title">Allocation and status</div>
      <label>Depot<select id="wfDepot"><option value="">Select</option>${opt(bus.depot,["Hannans","Bounds","Olympic Park"])}</select></label>
      <label>Vehicle status<select id="wfStatus">${opt(bus.status || "Active",["Active","In Service","Restricted","Workshop","Out of Service","Inactive"])}</select></label>
      <label class="wf-full">Notes<textarea id="wfNotes">${esc(bus.notes || "")}</textarea></label>
    </div>
    <div class="wf-actions"><button class="button secondary" type="button" id="wfCancelEdit">Cancel</button><button class="button primary" type="submit">${bus.id ? "Save Vehicle" : "Create Vehicle"}</button></div>`;
}

function openEditor(bus = null) {
  ensureDialogs();
  selectedBus = bus || null;
  $("wfEditBody").innerHTML = editorFields(bus || {});
  $("wfCloseEdit").onclick = () => $("wfEditDialog").close();
  $("wfCancelEdit").onclick = () => $("wfEditDialog").close();
  if ($("wfBusDialog")?.open) $("wfBusDialog").close();
  $("wfEditDialog").showModal();
}

function val(id) { return String($(id)?.value || "").trim(); }
function nullableNumber(id) { const v = val(id); return v === "" ? null : Number(v); }

async function saveVehicle(event) {
  event.preventDefault();
  const creating = !selectedBus?.id;
  const fleetNumber = val("wfFleetNumber");
  if (!fleetNumber) return toast("Fleet number is required.", "error");
  const existing = buses.find((b) => norm(fleetNo(b)) === norm(fleetNumber));
  if (creating && existing) return toast(`Fleet number ${fleetNumber} already exists.`, "error");
  if (!window.confirm(`${creating ? "Create" : "Save changes to"} vehicle ${fleetNumber}?`)) return;

  const payload = {
    fleetNumber,
    rego:val("wfRego"), year:nullableNumber("wfYear"), make:val("wfMake"), model:val("wfModel"), vin:val("wfVin"), bodyBy:val("wfBodyBy"), bodyModel:val("wfBodyModel"), colour:val("wfColour"), regoExpiry:val("wfRegoExpiry"),
    accessType:val("wfAccessType"), fuelType:val("wfFuelType"), euro:val("wfEuro"), adblue:val("wfAdblue"), airConditioned:val("wfAirConditioned"), rearDoor:val("wfRearDoor"), seatCount:nullableNumber("wfSeatCount"), standCount:nullableNumber("wfStandCount"), cctvCount:nullableNumber("wfCctvCount"), tare:val("wfTare"), gvm:val("wfGvm"), fireSuppression:val("wfFireSuppression"), luggageBins:val("wfLuggageBins"),
    depot:val("wfDepot"), status:val("wfStatus") || "Active", notes:val("wfNotes"), updatedAt:serverTimestamp(), updatedByEmail:norm(auth.currentUser?.email)
  };

  try {
    if (creating) {
      payload.createdAt = serverTimestamp();
      payload.createdByEmail = norm(auth.currentUser?.email);
      await setDoc(doc(db,"buses",fleetNumber), payload, { merge:true });
    } else {
      await updateDoc(doc(db,"buses",selectedBus.id), payload);
    }
    $("wfEditDialog").close();
    toast(`✓ Vehicle ${fleetNumber} ${creating ? "created" : "updated"} successfully.`);
  } catch (e) { toast(e?.message || "Unable to save vehicle.", "error"); }
}

function csvSplit(line) {
  const out=[]; let cur="", quote=false;
  for (let i=0;i<line.length;i++) { const c=line[i]; if(c==='"'){ if(quote&&line[i+1]==='"'){cur+='"';i++;} else quote=!quote; } else if(c===','&&!quote){out.push(cur.trim());cur="";} else cur+=c; }
  out.push(cur.trim()); return out;
}
function headerKey(v) { return norm(v).replace(/[^a-z0-9]+/g,""); }
function pick(row, map, names) { for (const n of names) { const idx=map[headerKey(n)]; if(idx!=null) return String(row[idx]||"").trim(); } return ""; }

async function importCsv(file) {
  const text = await file.text();
  const lines = text.split(/\r?\n/).filter((x) => x.trim());
  if (lines.length < 2) return toast("CSV has no vehicle rows.", "error");
  const headers = csvSplit(lines[0]); const map={}; headers.forEach((h,i)=>map[headerKey(h)]=i);
  const rows = lines.slice(1).map(csvSplit);
  if (!window.confirm(`Import/update ${rows.length} vehicle rows from ${file.name}? Existing fleet numbers will be updated, not duplicated.`)) return;
  const batch = writeBatch(db); let count=0;
  rows.forEach((r) => {
    const fn = pick(r,map,["Fleet Number","Fleet","Bus Number","Number"]); if(!fn) return;
    const existing = buses.find((b)=>norm(fleetNo(b))===norm(fn)); const ref=doc(db,"buses",existing?.id||fn);
    const payload={fleetNumber:fn, rego:pick(r,map,["Registration","Rego"]), year:Number(pick(r,map,["Year"]))||null, make:pick(r,map,["Make"]), model:pick(r,map,["Model"]), vin:pick(r,map,["VIN","Chassis","VIN / chassis number"]), accessType:pick(r,map,["Access Type","Access"]), fuelType:pick(r,map,["Fuel Type","Fuel"]), euro:pick(r,map,["Euro","Euro Standard"]), adblue:pick(r,map,["AdBlue"]), airConditioned:pick(r,map,["Air Conditioned","Aircon"]), rearDoor:pick(r,map,["Rear Door"]), seatCount:Number(pick(r,map,["Seat Count","Seats"]))||null, standCount:Number(pick(r,map,["Stand Count","Standing"]))||null, bodyBy:pick(r,map,["Body By","Body Manufacturer"]), bodyModel:pick(r,map,["Body Model"]), colour:pick(r,map,["Colour","Color"]), cctvCount:Number(pick(r,map,["CCTV Count","CCTV"]))||null, fireSuppression:pick(r,map,["Fire Suppression"]), luggageBins:pick(r,map,["Luggage Bins"]), tare:pick(r,map,["Tare"]), gvm:pick(r,map,["GVM"]), regoExpiry:pick(r,map,["Rego Expiry","Registration Expiry"]), depot:pick(r,map,["Depot"]), status:pick(r,map,["Status"])||"Active", notes:pick(r,map,["Notes"]), updatedAt:serverTimestamp(), updatedByEmail:norm(auth.currentUser?.email)};
    batch.set(ref,payload,{merge:true}); count++;
  });
  try { await batch.commit(); toast(`✓ ${count} vehicle records imported/updated successfully.`); } catch(e){ toast(e?.message||"CSV import failed.","error"); }
}

function ensureToolbar() {
  const fleetView = $("fleetView"); if (!fleetView) return;
  const head = fleetView.querySelector(".page-head"); if (!head || head.querySelector(".wf-toolbar")) return;
  const search = $("fleetSearch");
  const toolbar = document.createElement("div"); toolbar.className="wf-toolbar";
  if (search) toolbar.appendChild(search);
  const add = document.createElement("button"); add.type="button"; add.className="button primary"; add.textContent="+ Add Vehicle"; add.onclick=()=>openEditor(null); toolbar.appendChild(add);
  const imp = document.createElement("button"); imp.type="button"; imp.className="button secondary"; imp.textContent="Import CSV"; toolbar.appendChild(imp);
  const input=document.createElement("input"); input.type="file"; input.accept=".csv,text/csv"; input.className="wf-file"; input.onchange=()=>{if(input.files?.[0]) importCsv(input.files[0]); input.value="";}; toolbar.appendChild(input); imp.onclick=()=>input.click();
  head.appendChild(toolbar);
  const hint=document.createElement("div"); hint.className="wf-hint"; hint.textContent="Double-click any vehicle row to open the full fleet record, workshop status, defects, jobs and history."; head.insertAdjacentElement("afterend",hint);
}

function enhanceRows() {
  ensureToolbar();
  const tbody=$("fleetTableBody"); if(!tbody) return;
  [...tbody.querySelectorAll("tr")].forEach((row)=>{
    if(row.dataset.wfReady) return;
    const fn=String(row.cells?.[0]?.textContent||"").trim(); const bus=buses.find((b)=>norm(fleetNo(b))===norm(fn)); if(!bus) return;
    row.dataset.wfReady="1"; row.classList.add("wf-openable"); row.title="Double-click to open full vehicle record";
    row.addEventListener("dblclick",(e)=>{if(e.target.closest("button,a,input,select")) return; openBus(bus);});
    const actions=row.cells?.[7]; if(actions&&!actions.querySelector("[data-wf-open]")){ const btn=document.createElement("button"); btn.type="button"; btn.className="button secondary"; btn.dataset.wfOpen="1"; btn.textContent="Open"; btn.onclick=()=>openBus(bus); actions.appendChild(btn); }
  });
}

function watchTable() {
  ensureDialogs(); ensureToolbar();
  const tbody=$("fleetTableBody"); if(!tbody){setTimeout(watchTable,250);return;}
  if(tableObserver) tableObserver.disconnect(); tableObserver=new MutationObserver(enhanceRows); tableObserver.observe(tbody,{childList:true,subtree:true}); enhanceRows();
}

onSnapshot(collection(db,"buses"),(s)=>{buses=s.docs.map((d)=>({id:d.id,...d.data()})); enhanceRows();});
onSnapshot(collection(db,"defectReports"),(s)=>{defects=s.docs.map((d)=>({id:d.id,...d.data()}));});
onSnapshot(collection(db,"workshopJobs"),(s)=>{jobs=s.docs.map((d)=>({id:d.id,...d.data()}));});
onSnapshot(collection(db,"vehicleHistory"),(s)=>{history=s.docs.map((d)=>({id:d.id,...d.data()})).sort((a,b)=>(b.createdAt?.toMillis?.()||0)-(a.createdAt?.toMillis?.()||0));},()=>{});

watchTable();
