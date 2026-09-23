import {
  addDoc,
  collection,
  doc,
  getDoc,
  runTransaction,
  serverTimestamp,
  updateDoc
} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";
import { auth, db } from "./firebase.js";
import { getRequirementTemplate } from "./workshop_service_requirements.js";
import { DEFECT_STATUS, isDefectCompleted } from "./workshop_status.js";

const $ = (id) => document.getElementById(id);

function esc(v) {
  return String(v ?? "").replace(/[&<>'"]/g, (m) => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[m]));
}

function num(v) {
  if (v === "" || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function normalizeEmail(v) {
  return String(v || "").trim().toLowerCase();
}

function fleetNo(bus, fallback = "") {
  return String(bus?.fleetNumber || bus?.busNumber || bus?.number || fallback || "").trim();
}

function currentOdo(bus) {
  return num(bus?.currentOdometer ?? bus?.odometer ?? bus?.odometerKm);
}

function isEv(bus) {
  return /\b(ev|electric)\b/i.test(String(bus?.fuelType || bus?.fuel || bus?.serviceProgram || ""));
}

function serviceInterval(bus, type) {
  if (type === "Small") return num(bus?.serviceSmallIntervalKm ?? bus?.serviceIntervalKm);
  if (type === "Medium") return num(bus?.serviceMediumIntervalKm);
  if (type === "Large") return num(bus?.serviceLargeIntervalKm);
  return null;
}

function showStatus(message, type = "success") {
  const status = $("status");
  if (!status) return;
  status.className = `status ${type}`;
  status.textContent = message;
}

function ensureCategoryUi() {
  if ($("jobCategoryWrap")) return;
  const jobType = $("jobType");
  if (!jobType) return;

  const wrap = document.createElement("div");
  wrap.id = "jobCategoryWrap";
  wrap.className = "full job-category-wrap";
  wrap.hidden = true;
  wrap.innerHTML = `
    <div class="job-category-card">
      <div class="job-category-head">
        <div>
          <strong id="jobCategoryTitle">Job category</strong>
          <span id="jobCategoryHelp">Select the work category to assign.</span>
        </div>
        <span id="jobVehicleTypeBadge" class="badge info">Vehicle</span>
      </div>
      <div class="form-grid">
        <label id="jobCategorySelectWrap">Category
          <select id="jobCategory"></select>
        </label>
        <label id="jobNextDueWrap">Service due
          <input id="jobNextDue" readonly />
        </label>
      </div>
      <div id="jobCategoryNote" class="hint" style="margin-top:8px"></div>
    </div>`;

  const jobTypeLabel = jobType.closest("label");
  jobTypeLabel?.insertAdjacentElement("afterend", wrap);

  const style = document.createElement("style");
  style.textContent = `
    .job-category-wrap{grid-column:1/-1}
    .job-category-card{border:1px solid #d0d5dd;background:#f8fafc;border-radius:12px;padding:14px}
    .job-category-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;margin-bottom:12px}
    .job-category-head strong{display:block;font-size:14px;color:#101828;margin-bottom:3px}
    .job-category-head span:not(.badge){display:block;font-size:12px;color:#667085}
    @media(max-width:700px){.job-category-head{flex-direction:column}.job-category-card .form-grid{grid-template-columns:1fr}}
  `;
  document.head.appendChild(style);

  jobType.addEventListener("change", refreshCategoryUi);
  $("jobBus")?.addEventListener("change", refreshCategoryUi);
  $("jobCategory")?.addEventListener("change", refreshDuePreview);
}

async function selectedBus() {
  const id = $("jobBus")?.value || "";
  if (!id) return null;
  try {
    const snap = await getDoc(doc(db, "buses", id));
    return snap.exists() ? { id:snap.id, ...snap.data() } : null;
  } catch {
    return null;
  }
}

async function refreshCategoryUi() {
  ensureCategoryUi();
  const wrap = $("jobCategoryWrap");
  const select = $("jobCategory");
  if (!wrap || !select) return;

  const type = $("jobType")?.value || "";
  const safeToDriveWrap = $("jobSafeToDriveWrap");
  const safeToDrive = $("jobSafeToDrive");
  if (safeToDriveWrap) safeToDriveWrap.hidden = type !== "Defect Repair";
  if (safeToDrive) safeToDrive.required = type === "Defect Repair";
  const bus = await selectedBus();
  const vehicleIsEv = isEv(bus);

  if (bus && type === "Air Conditioning Service" && !$("jobDueDate")?.value && bus.nextAirConditioningServiceDate) {
    $("jobDueDate").value = bus.nextAirConditioningServiceDate;
  }
  if (bus && type === "Fire Suppression Check" && !$("jobDueDate")?.value && bus.nextFireSuppressionCheckDate) {
    $("jobDueDate").value = bus.nextFireSuppressionCheckDate;
  }
  if (bus && type === "Intercooler / Radiator Wash" && !$("jobDueDate")?.value && bus.nextRadiatorWashDate) {
    $("jobDueDate").value = bus.nextRadiatorWashDate;
  }

  if (!bus || type !== "Scheduled Service") {
    wrap.hidden = true;
    select.required = false;
    select.innerHTML = "";
    return;
  }

  wrap.hidden = false;
  select.required = true;
  $("jobVehicleTypeBadge").textContent = vehicleIsEv ? "Electric (EV)" : "Diesel";
  $("jobCategoryTitle").textContent = "Service category";
  $("jobCategoryHelp").textContent = "Choose the service level to assign to the mechanic.";
  const categories = vehicleIsEv ? ["Small", "Large"] : ["Small", "Medium", "Large"];
  const suggested = categories.includes(bus.nextServiceType) ? bus.nextServiceType : categories[0];
  select.innerHTML = categories.map((x) => `<option value="${x}" ${x === suggested ? "selected" : ""}>${x} Service</option>`).join("");
  $("jobNextDueWrap").hidden = false;
  $("jobCategoryNote").textContent = vehicleIsEv
    ? "EV sequence: Small → Large → Small."
    : "Diesel sequence: Small → Medium → Large → Small.";
  refreshDuePreview(bus);
}

async function refreshDuePreview(busArg = null) {
  const bus = busArg || await selectedBus();
  if (!bus || $("jobType")?.value !== "Scheduled Service") return;
  const category = $("jobCategory")?.value || bus.nextServiceType || "Small";
  const current = currentOdo(bus);
  const savedDue = num(bus.nextServiceOdometer);
  const interval = serviceInterval(bus, category);

  let text = "Not configured";
  if (bus.nextServiceType === category && savedDue != null) {
    text = `${savedDue.toLocaleString("en-AU")} km`;
  } else if (current != null && interval != null) {
    text = `${(current + interval).toLocaleString("en-AU")} km`;
  } else if (interval != null) {
    text = `Every ${interval.toLocaleString("en-AU")} km`;
  }
  if ($("jobNextDue")) $("jobNextDue").value = text;
}

function templateKey(bus, jobType, category) {
  if (jobType === "Air Conditioning Service") return "aircon-annual";
  if (jobType === "Fire Suppression Check") return "fire-suppression-annual";
  if (jobType === "Intercooler / Radiator Wash") return "radiator-wash-6month";
  const prefix = isEv(bus) ? "ev" : "diesel";
  if (jobType === "Scheduled Service") return `${prefix}-${String(category || "").toLowerCase()}`;
  if (jobType === "90 Day Safety Check") return `${prefix}-90day`;
  return "";
}

async function createJobWithCategory(event) {
  const form = event.target;
  if (form?.id !== "jobForm") return;

  event.preventDefault();
  event.stopImmediatePropagation();

  const bus = await selectedBus();
  if (!bus) return showStatus("Select a bus for this job.", "error");

  const jobType = $("jobType")?.value || "";
  const sourceDefect = window.workshopPendingSourceDefect || null;
  const categoryRequired = jobType === "Scheduled Service";
  const category = categoryRequired ? String($("jobCategory")?.value || "").trim() : "";
  if (categoryRequired && !category) return showStatus("Select the service category to assign.", "error");
  const safeToDrive = jobType === "Defect Repair" ? String($("jobSafeToDrive")?.value || sourceDefect?.safeToDrive || "").trim() : "";
  if (jobType === "Defect Repair" && !safeToDrive) return showStatus("Confirm whether the vehicle is safe to drive.", "error");

  const fault = String($("jobFault")?.value || "").trim();
  if (!fault) return showStatus("Describe the work required.", "error");

  const now = Date.now();
  const jobNumber = `WJ-${new Date().getFullYear()}-${String(now).slice(-6)}`;
  const assignedMechanic = String($("jobMechanic")?.value || "").trim();
  const mechanicOption = $("jobMechanic")?.selectedOptions?.[0];
  const assignedMechanicEmployeeNumber = assignedMechanic ? String(mechanicOption?.dataset.employeeNumber || "").trim() : "";
  const assignedMechanicEmail = assignedMechanic ? normalizeEmail(mechanicOption?.dataset.employeeEmail) : "";
  const vehicleIsEv = isEv(bus);
  const interval = jobType === "Scheduled Service" ? serviceInterval(bus, category) : null;
  const requirementKey = templateKey(bus, jobType, category);
  const requirementTemplate = requirementKey ? getRequirementTemplate(requirementKey) : null;
  const assignedChecklist = requirementTemplate ? {
    templateKey: requirementKey,
    templateTitle: requirementTemplate.title,
    templateSource: requirementTemplate.source,
    schedule: requirementTemplate.schedule || "",
    assignedAtIso: new Date().toISOString(),
    items: requirementTemplate.items.map((item, index) => ({
      id: `${requirementKey}-${index + 1}`,
      section: item.section || "General",
      item: item.item || "",
      action: item.action || "",
      description: item.description || "",
      mandatory: item.mandatory !== false,
      requiresReading:item.requiresReading === true
    }))
  } : null;

  const payload = {
    jobNumber,
    busId:bus.id,
    fleetNumber:fleetNo(bus, bus.id),
    rego:bus.rego || "",
    jobType,
    jobCategory:category,
    serviceType:jobType === "Scheduled Service" ? category : "",
    inspectionType:jobType === "90 Day Safety Check" ? "90 Day Safety Check" : "",
    serviceProgram:jobType === "Scheduled Service" ? (vehicleIsEv ? "EV" : "Diesel") : "",
    serviceTemplateKey:requirementKey,
    assignedChecklist,
    serviceIntervalKm:interval,
    serviceDueOdometer:jobType === "Scheduled Service" && bus.nextServiceType === category ? num(bus.nextServiceOdometer) : null,
    priority:$("jobPriority")?.value || "Normal",
    status:assignedMechanic ? "Assigned" : "New",
    assignedMechanic,
    assignedMechanicName:assignedMechanic,
    assignedMechanicEmployeeNumber,
    assignedMechanicEmail,
    dueDate:$("jobDueDate")?.value || "",
    source:sourceDefect ? "Driver Defect" : (jobType === "Defect Repair" ? "Fleet Manager Defect" : "Fleet Manager"),
    sourceDefectId:sourceDefect?.id || "",
    sourceDefectNumber:sourceDefect?.reportNumber || "",
    defectCategory:sourceDefect?.category || (jobType === "Defect Repair" ? "Mechanical" : ""),
    defectSafeToDrive:safeToDrive,
    reportedFault:fault,
    managerNotes:String($("jobManagerNotes")?.value || "").trim(),
    odometerStart:currentOdo(bus),
    diagnosis:"",
    workCompleted:"",
    partsUsed:[],
    labourEntries:[],
    returnToServiceApproved:false,
    createdByEmail:normalizeEmail(auth.currentUser?.email),
    createdAt:serverTimestamp(),
    updatedAt:serverTimestamp(),
    schemaVersion:3
  };

  const editingJob = window.workshopEditingJob || null;
  const submitBtn = form.querySelector('button[type="submit"]');
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = editingJob ? "Saving..." : "Creating...";
  }

  try {
    if (editingJob) {
      const jobRef = doc(db, "workshopJobs", editingJob.id);
      const currentSnap = await getDoc(jobRef);
      if (!currentSnap.exists()) throw new Error("This workshop job no longer exists.");
      const current = currentSnap.data();
      const canEdit = ["New", "Assigned"].includes(current.status || "New")
        && !current.startedAt
        && !current.jobCard?.labourStart;
      if (!canEdit) throw new Error("This job is locked because mechanic work has already started.");

      const jobUpdate = {
        busId:payload.busId,
        fleetNumber:payload.fleetNumber,
        rego:payload.rego,
        jobType:payload.jobType,
        jobCategory:payload.jobCategory,
        serviceType:payload.serviceType,
        inspectionType:payload.inspectionType,
        serviceProgram:payload.serviceProgram,
        serviceTemplateKey:payload.serviceTemplateKey,
        assignedChecklist:payload.assignedChecklist,
        serviceIntervalKm:payload.serviceIntervalKm,
        serviceDueOdometer:payload.serviceDueOdometer,
        priority:payload.priority,
        status:payload.status,
        assignedMechanic:payload.assignedMechanic,
        assignedMechanicName:payload.assignedMechanicName,
        assignedMechanicEmployeeNumber:payload.assignedMechanicEmployeeNumber,
        assignedMechanicEmail:payload.assignedMechanicEmail,
        defectSafeToDrive:payload.defectSafeToDrive,
        dueDate:payload.dueDate,
        reportedFault:payload.reportedFault,
        managerNotes:payload.managerNotes,
        updatedAt:serverTimestamp(),
        updatedByEmail:normalizeEmail(auth.currentUser?.email)
      };
      if (current.sourceDefectId) {
        const defectRef = doc(db, "defectReports", current.sourceDefectId);
        await runTransaction(db, async (tx) => {
          const [latestJob, defectSnap] = await Promise.all([tx.get(jobRef), tx.get(defectRef)]);
          if (!latestJob.exists()) throw new Error("This workshop job no longer exists.");
          if (!defectSnap.exists()) throw new Error("The linked defect report no longer exists.");
          tx.update(jobRef, jobUpdate);
          tx.set(defectRef, {
            status:DEFECT_STATUS.ASSIGNED,
            safeToDrive,
            description:payload.reportedFault,
            priority:payload.priority === "Safety Critical" ? "Critical" : payload.priority,
            assignedMechanic,
            assignedMechanicEmployeeNumber,
            assignedMechanicEmail,
            workshopJobStatus:payload.status,
            adminNotes:payload.managerNotes,
            updatedAt:serverTimestamp()
          }, {merge:true});
        });
      } else {
        await updateDoc(jobRef, jobUpdate);
      }
    } else if (sourceDefect) {
      const defectRef = doc(db, "defectReports", sourceDefect.id);
      const jobRef = doc(collection(db, "workshopJobs"));
      await runTransaction(db, async (tx) => {
        const defectSnap = await tx.get(defectRef);
        if (!defectSnap.exists()) throw new Error("This defect report no longer exists.");
        const current = defectSnap.data();
        if (current.workshopJobId || current.workshopJobNumber) throw new Error(`A job card already exists: ${current.workshopJobNumber || current.workshopJobId}`);
        if (isDefectCompleted(current)) throw new Error("A completed defect cannot be converted into a new job card.");
        tx.set(jobRef, payload);
        tx.set(defectRef, {
          status:DEFECT_STATUS.ASSIGNED,
          safeToDrive,
          assignedMechanic,
          assignedMechanicEmployeeNumber,
          assignedMechanicEmail,
          workshopJobStatus:payload.status,
          workshopJobId:jobRef.id,
          workshopJobNumber:jobNumber,
          convertedToJobAt:serverTimestamp(),
          convertedToJobByUid:auth.currentUser?.uid || "",
          convertedToJobByEmail:normalizeEmail(auth.currentUser?.email),
          updatedAt:serverTimestamp()
        }, {merge:true});
      });
    } else if (jobType === "Defect Repair") {
      const jobRef = doc(collection(db, "workshopJobs"));
      const defectRef = doc(collection(db, "defectReports"));
      const reportNumber = `DR-${new Date().toISOString().slice(0,10).replaceAll("-","")}-${defectRef.id.slice(0,6).toUpperCase()}`;
      payload.sourceDefectId = defectRef.id;
      payload.sourceDefectNumber = reportNumber;
      await runTransaction(db, async (tx) => {
        tx.set(jobRef, payload);
        tx.set(defectRef, {
          reportNumber,
          status:DEFECT_STATUS.ASSIGNED,
          priority:payload.priority === "Safety Critical" ? "Critical" : payload.priority,
          defectDate:new Date().toLocaleDateString("en-CA"),
          category:"Mechanical",
          safeToDrive,
          description:fault,
          busId:bus.id,
          fleetNumber:fleetNo(bus, bus.id),
          rego:bus.rego || "",
          depot:bus.depot || "",
          photos:[],
          photoCount:0,
          reportedByUid:auth.currentUser?.uid || "",
          reportedByEmail:auth.currentUser?.email || "",
          reportedByName:auth.currentUser?.displayName || auth.currentUser?.email || "Fleet Manager",
          reportedByEmployeeNumber:"",
          reportedAtIso:new Date().toISOString(),
          reportedSource:"Fleet Manager",
          assignedMechanic,
          assignedMechanicEmployeeNumber,
          assignedMechanicEmail,
          workshopJobStatus:payload.status,
          workshopJobId:jobRef.id,
          workshopJobNumber:jobNumber,
          convertedToJobAt:serverTimestamp(),
          convertedToJobByUid:auth.currentUser?.uid || "",
          convertedToJobByEmail:normalizeEmail(auth.currentUser?.email),
          adminNotes:payload.managerNotes,
          deleted:false,
          createdAt:serverTimestamp(),
          updatedAt:serverTimestamp()
        });
      });
    } else {
      await addDoc(collection(db, "workshopJobs"), payload);
    }
    form.reset();
    $("jobCategoryWrap").hidden = true;
    $("jobDialog")?.close();
    const categoryText = category ? ` · ${category}` : "";
    const checklistText = assignedChecklist ? ` · ${assignedChecklist.items.length} checklist items assigned` : "";
    showStatus(editingJob
      ? `✓ Workshop job ${editingJob.jobNumber || editingJob.id} updated.`
      : `✓ Workshop job ${jobNumber} created${categoryText}${checklistText}.`);
    window.workshopEditingJob = null;
    window.workshopPendingSourceDefect = null;
  } catch (err) {
    showStatus(err?.message || "Unable to create workshop job.", "error");
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = window.workshopEditingJob ? "Save Changes" : "Create Job Card";
    }
  }
}

ensureCategoryUi();
refreshCategoryUi();

document.addEventListener("submit", createJobWithCategory, true);
