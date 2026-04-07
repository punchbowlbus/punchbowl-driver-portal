// Import necessary Firebase and UI modules
import { listenBuses, saveBus } from "./db.js";
import { els, showError } from "./ui.js";

// Function to render the buses page
export function renderBusesPage() {
  showError("");

  els.contentArea.innerHTML = `
    <h2 style="margin-top:0">Fleet Management</h2>

    <div class="card">
      <div style="display:flex; gap:10px; flex-wrap:wrap; margin-bottom:12px;">
        <button id="addBusBtn">Add Bus</button>
        <button id="editBusBtn">Edit Selected</button>
        <button id="importBusesBtn" type="button">Import CSV</button>
        <input id="importBusesFile" type="file" accept=".csv" style="display:none" />
        <input id="busSearch" type="text" placeholder="Search bus..." style="max-width:260px"/>
      </div>

      <div id="busFormWrap" style="display:none; margin-bottom:16px; padding:14px; border:1px solid #ddd; border-radius:12px; background:#fff;">
        <h3 id="busFormTitle" style="margin-top:0">Add Bus</h3>

        <div style="display:grid; grid-template-columns:repeat(2, minmax(220px, 1fr)); gap:10px;">
          <input id="busFleetNumber" type="text" placeholder="Fleet Number" />
          <input id="busRego" type="text" placeholder="Rego" />

          <select id="busAccessType">
            <option value="">Access Type</option>
            <option value="STEPS">STEPS</option>
            <option value="WHEEL CHAIR">WHEEL CHAIR</option>
            <option value="LOW FLOOR">LOW FLOOR</option>
          </select>

          <input id="busYear" type="text" placeholder="Year" />
          <input id="busMake" type="text" placeholder="Make" />
          <input id="busModel" type="text" placeholder="Model" />
          <input id="busEuro" type="text" placeholder="Euro #" />

          <select id="busAdblue">
            <option value="">AdBlue</option>
            <option value="YES">YES</option>
            <option value="NO">NO</option>
          </select>

          <select id="busFuelType">
            <option value="">Fuel Type</option>
            <option value="Diesel">Diesel</option>
            <option value="EV">EV</option>
            <option value="Hybrid">Hybrid</option>
          </select>

          <input id="busVin" type="text" placeholder="VIN / Chassis No." />

          <select id="busAirConditioned">
            <option value="">Air Conditioned</option>
            <option value="YES">YES</option>
            <option value="NO">NO</option>
          </select>

          <input id="busTare" type="text" placeholder="Tare" />
          <input id="busGvm" type="text" placeholder="GVM" />
          <input id="busRegoExpiry" type="text" placeholder="Date of Rego / Expiry" />

          <select id="busRearDoor">
            <option value="">Rear Door</option>
            <option value="YES">YES</option>
            <option value="NO">NO</option>
          </select>

          <input id="busSeatCount" type="text" placeholder="Seat Count" />
          <input id="busStandCount" type="text" placeholder="Stand Count" />
          <input id="busBodyBy" type="text" placeholder="Body By" />
          <input id="busBodyModel" type="text" placeholder="Body Model" />
          <input id="busColour" type="text" placeholder="Colour" />
          <input id="busCctvCount" type="text" placeholder="CCTV Count" />

          <select id="busFireSuppression">
            <option value="">Fire Suppression</option>
            <option value="YES">YES</option>
            <option value="NO">NO</option>
          </select>

          <select id="busLuggageBins">
            <option value="">Luggage Bins</option>
            <option value="YES">YES</option>
            <option value="NO">NO</option>
          </select>

          <select id="busDepot">
            <option value="">Depot</option>
            <option value="Hannans">Hannans</option>
            <option value="Bounds">Bounds</option>
            <option value="Olympic Park">Olympic Park</option>
          </select>

          <select id="busStatus">
            <option value="Active">Active</option>
            <option value="In Service">In Service</option>
            <option value="Workshop">Workshop</option>
            <option value="Out of Service">Out of Service</option>
            <option value="Inactive">Inactive</option>
          </select>
        </div>

        <div style="margin-top:10px;">
          <textarea id="busNotes" placeholder="Notes" style="width:100%; min-height:80px; padding:10px; border:1px solid #ddd; border-radius:8px;"></textarea>
        </div>

        <div style="display:flex; gap:10px; margin-top:12px;">
          <button id="saveBusBtn">Save Bus</button>
          <button id="cancelBusBtn" type="button">Cancel</button>
        </div>
      </div>

      <table style="width:100%; border-collapse:collapse; background:#fff; border-radius:10px; overflow:hidden; box-shadow:0 1px 4px rgba(0,0,0,0.08);">
        <thead>
          <tr style="text-align:left; border-bottom:1px solid #ddd; background:#f5f5f5">
            <th style="padding:10px">Fleet No</th>
            <th style="padding:10px">Rego</th>
            <th style="padding:10px">Type</th>
            <th style="padding:10px">Make / Model</th>
            <th style="padding:10px">Seats</th>
            <th style="padding:10px">Depot</th>
            <th style="padding:10px">Status</th>
          </tr>
        </thead>
        <tbody id="busesTableBody"></tbody>
      </table>
    </div>
  `;

  const tbody = document.getElementById("busesTableBody");
  const searchInput = document.getElementById("busSearch");
  const formWrap = document.getElementById("busFormWrap");
  const formTitle = document.getElementById("busFormTitle");
  const addBtn = document.getElementById("addBusBtn");
  const editBtn = document.getElementById("editBusBtn");
  const cancelBtn = document.getElementById("cancelBusBtn");
  const saveBtn = document.getElementById("saveBusBtn");
  const importBtn = document.getElementById("importBusesBtn");
  const importFile = document.getElementById("importBusesFile");

  let busesCache = [];
  let selectedBus = null;
  let editMode = false;

  function clearForm() {
    document.getElementById("busFleetNumber").value = "";
    document.getElementById("busRego").value = "";
    document.getElementById("busAccessType").value = "";
    document.getElementById("busYear").value = "";
    document.getElementById("busMake").value = "";
    document.getElementById("busModel").value = "";
    document.getElementById("busEuro").value = "";
    document.getElementById("busAdblue").value = "";
    document.getElementById("busFuelType").value = "";
    document.getElementById("busVin").value = "";
    document.getElementById("busAirConditioned").value = "";
    document.getElementById("busTare").value = "";
    document.getElementById("busGvm").value = "";
    document.getElementById("busRegoExpiry").value = "";
    document.getElementById("busRearDoor").value = "";
    document.getElementById("busSeatCount").value = "";
    document.getElementById("busStandCount").value = "";
    document.getElementById("busBodyBy").value = "";
    document.getElementById("busBodyModel").value = "";
    document.getElementById("busColour").value = "";
    document.getElementById("busCctvCount").value = "";
    document.getElementById("busFireSuppression").value = "";
    document.getElementById("busLuggageBins").value = "";
    document.getElementById("busDepot").value = "";
    document.getElementById("busStatus").value = "Active";
    document.getElementById("busNotes").value = "";
  }

  function fillForm(bus) {
    document.getElementById("busFleetNumber").value = bus.fleetNumber || "";
    document.getElementById("busRego").value = bus.rego || "";
    document.getElementById("busAccessType").value = bus.accessType || "";
    document.getElementById("busYear").value = bus.year || "";
    document.getElementById("busMake").value = bus.make || "";
    document.getElementById("busModel").value = bus.model || "";
    document.getElementById("busEuro").value = bus.euro || "";
    document.getElementById("busAdblue").value = bus.adblue || "";
    document.getElementById("busFuelType").value = bus.fuelType || "";
    document.getElementById("busVin").value = bus.vin || "";
    document.getElementById("busAirConditioned").value = bus.airConditioned || "";
    document.getElementById("busTare").value = bus.tare || "";
    document.getElementById("busGvm").value = bus.gvm || "";
    document.getElementById("busRegoExpiry").value = bus.regoExpiry || "";
    document.getElementById("busRearDoor").value = bus.rearDoor || "";
    document.getElementById("busSeatCount").value = bus.seatCount || "";
    document.getElementById("busStandCount").value = bus.standCount || "";
    document.getElementById("busBodyBy").value = bus.bodyBy || "";
    document.getElementById("busBodyModel").value = bus.bodyModel || "";
    document.getElementById("busColour").value = bus.colour || "";
    document.getElementById("busCctvCount").value = bus.cctvCount || "";
    document.getElementById("busFireSuppression").value = bus.fireSuppression || "";
    document.getElementById("busLuggageBins").value = bus.luggageBins || "";
    document.getElementById("busDepot").value = bus.depot || "";
    document.getElementById("busStatus").value = bus.status || "Active";
    document.getElementById("busNotes").value = bus.notes || "";
  }

  function parseCsvLine(line) {
    const result = [];
    let current = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const ch = line[i];

      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === "," && !inQuotes) {
        result.push(current.trim());
        current = "";
      } else {
        current += ch;
      }
    }

    result.push(current.trim());
    return result;
  }

  function normalizeYesNo(value) {
    const v = String(value || "").trim().toUpperCase();
    if (v === "YES" || v === "Y") return "YES";
    if (v === "NO" || v === "N") return "NO";
    return String(value || "").trim();
  }

  function renderTable(list) {
    tbody.innerHTML = list
      .map(
        (b) => `
          <tr data-id="${b.fleetNumber}" style="border-bottom:1px solid #eee; cursor:pointer">
            <td style="padding:10px">${b.fleetNumber || ""}</td>
            <td style="padding:10px">${b.rego || ""}</td>
            <td style="padding:10px">${b.accessType || ""}</td>
            <td style="padding:10px">${[b.make || "", b.model || ""].filter(Boolean).join(" ")}</td>
            <td style="padding:10px">${b.seatCount || ""}</td>
            <td style="padding:10px">${b.depot || ""}</td>
            <td style="padding:10px">${b.status || ""}</td>
          </tr>
        `
      )
      .join("");

    [...tbody.querySelectorAll("tr")].forEach((row) => {
      row.onclick = () => {
        selectedBus = row.getAttribute("data-id");
        [...tbody.querySelectorAll("tr")].forEach((r) => {
          r.style.background = "";
          r.style.fontWeight = "400";
        });
        row.style.background = "#ffe5e5";
        row.style.fontWeight = "600";
      };
    });
  }

  listenBuses(
    (buses) => {
      busesCache = buses || [];
      renderTable(busesCache);
    },
    (err) => {
      console.error("Buses error:", err);
      showError(err?.message || "Failed to load buses");
    }
  );

  searchInput.oninput = () => {
    const q = (searchInput.value || "").toLowerCase().trim();

    const filtered = busesCache.filter((b) =>
      String(b.fleetNumber || "").toLowerCase().includes(q) ||
      String(b.rego || "").toLowerCase().includes(q) ||
      String(b.make || "").toLowerCase().includes(q) ||
      String(b.model || "").toLowerCase().includes(q) ||
      String(b.accessType || "").toLowerCase().includes(q)
    );

    renderTable(filtered);
  };

  importBtn.onclick = () => {
    importFile.value = "";
    importFile.click();
  };

  importFile.onchange = async (e) => {
    try {
      const file = e.target.files?.[0];
      if (!file) return;

      const text = await file.text();
      const lines = text
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);

      if (lines.length < 2) {
        alert("CSV file is empty or missing data.");
        return;
      }

      const headers = parseCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
      const rows = lines.slice(1);
      let savedCount = 0;

      for (const line of rows) {
        const cols = parseCsvLine(line);

        const row = {};
        headers.forEach((h, i) => {
          row[h] = cols[i] || "";
        });

        const bus = {
          fleetNumber: (row["fleetnumber"] || row["fleet number"] || row["bus no."] || row["bus no"] || "").trim(),
          rego: (row["rego"] || "").trim(),
          accessType: (row["accesstype"] || row["access type"] || "").trim().toUpperCase(),
          year: (row["year"] || "").trim(),
          make: (row["make"] || "").trim(),
          model: (row["model"] || row["year & model"] || "").trim(),
          euro: (row["euro"] || row["euro #"] || "").trim(),
          adblue: normalizeYesNo(row["adblue"]),
          fuelType: (row["fueltype"] || row["fuel type"] || "").trim(),
          vin: (row["vin"] || row["vin/chassis no."] || row["vin / chassis no."] || "").trim(),
          airConditioned: normalizeYesNo(row["air conditioned"]),
          tare: (row["tare"] || "").trim(),
          gvm: (row["gvm"] || "").trim(),
          regoExpiry: (row["date of rego"] || row["date of rego / expiry"] || row["rego expiry"] || "").trim(),
          rearDoor: normalizeYesNo(row["rear door"]),
          seatCount: (row["seat"] || row["seat count"] || "").trim(),
          standCount: (row["stand"] || row["stand count"] || "").trim(),
          bodyBy: (row["body by"] || "").trim(),
          bodyModel: (row["body model"] || "").trim(),
          colour: (row["colour"] || row["color"] || "").trim(),
          cctvCount: (row["cctv"] || row["cctv count"] || "").trim(),
          fireSuppression: normalizeYesNo(row["fire supp"] || row["fire suppression"]),
          luggageBins: normalizeYesNo(row["luggage bins"] || row["luggage"]),
          depot: (row["depot"] || "").trim(),
          status: (row["status"] || "Active").trim(),
          notes: (row["notes"] || "").trim()
        };

        if (!bus.fleetNumber) continue;

        if (!bus.rego) {
          bus.rego = bus.fleetNumber;
        }

        if (!bus.fuelType) {
          if (String(bus.euro).toUpperCase() === "EV") {
            bus.fuelType = "EV";
          } else {
            bus.fuelType = "Diesel";
          }
        }

        await saveBus(bus);
        savedCount++;
      }

      alert(`${savedCount} bus(es) imported successfully.`);
    } catch (err) {
      console.error(err);
      alert(err?.message || "Failed to import CSV.");
    }
  };

  addBtn.onclick = () => {
    editMode = false;
    formTitle.textContent = "Add Bus";
    clearForm();
    document.getElementById("busFleetNumber").disabled = false;
    formWrap.style.display = "block";
  };

  editBtn.onclick = () => {
    if (!selectedBus) {
      alert("Please select a bus first.");
      return;
    }

    const bus = busesCache.find(
      (b) => String(b.fleetNumber) === String(selectedBus)
    );

    if (!bus) {
      alert("Selected bus not found.");
      return;
    }

    editMode = true;
    formTitle.textContent = "Edit Bus";
    fillForm(bus);
    document.getElementById("busFleetNumber").disabled = true;
    formWrap.style.display = "block";
  };

  cancelBtn.onclick = () => {
    formWrap.style.display = "none";
    clearForm();
    editMode = false;
    document.getElementById("busFleetNumber").disabled = false;
  };

  saveBtn.onclick = async () => {
    try {
      const bus = {
        fleetNumber: document.getElementById("busFleetNumber").value.trim(),
        rego: document.getElementById("busRego").value.trim(),
        accessType: document.getElementById("busAccessType").value,
        year: document.getElementById("busYear").value.trim(),
        make: document.getElementById("busMake").value.trim(),
        model: document.getElementById("busModel").value.trim(),
        euro: document.getElementById("busEuro").value.trim(),
        adblue: document.getElementById("busAdblue").value,
        fuelType: document.getElementById("busFuelType").value,
        vin: document.getElementById("busVin").value.trim(),
        airConditioned: document.getElementById("busAirConditioned").value,
        tare: document.getElementById("busTare").value.trim(),
        gvm: document.getElementById("busGvm").value.trim(),
        regoExpiry: document.getElementById("busRegoExpiry").value.trim(),
        rearDoor: document.getElementById("busRearDoor").value,
        seatCount: document.getElementById("busSeatCount").value.trim(),
        standCount: document.getElementById("busStandCount").value.trim(),
        bodyBy: document.getElementById("busBodyBy").value.trim(),
        bodyModel: document.getElementById("busBodyModel").value.trim(),
        colour: document.getElementById("busColour").value.trim(),
        cctvCount: document.getElementById("busCctvCount").value.trim(),
        fireSuppression: document.getElementById("busFireSuppression").value,
        luggageBins: document.getElementById("busLuggageBins").value,
        depot: document.getElementById("busDepot").value,
        status: document.getElementById("busStatus").value,
        notes: document.getElementById("busNotes").value.trim()
      };

      if (!bus.fleetNumber) {
        alert("Fleet Number is required.");
        return;
      }

      const wasEditMode = editMode;

      await saveBus(bus);

      selectedBus = bus.fleetNumber;
      formWrap.style.display = "none";
      clearForm();
      editMode = false;
      document.getElementById("busFleetNumber").disabled = false;

      alert(wasEditMode ? "Bus updated successfully." : "Bus saved successfully.");
    } catch (err) {
      console.error(err);
      alert(err?.message || "Failed to save bus.");
    }
  };
}