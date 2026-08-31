// Keep Pre RMS Check separate from the tracked 90 Day Safety Check job type.
const jobType = document.getElementById("jobType");

if (jobType) {
  [...jobType.options]
    .filter((o) => o.value === "Safety Inspection")
    .forEach((o) => o.remove());

  const insertBeforeOther = (value, label) => {
    if ([...jobType.options].some((o) => o.value === value)) return;
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    const other = [...jobType.options].find((o) => o.value === "Other");
    if (other) jobType.insertBefore(option, other);
    else jobType.appendChild(option);
  };

  insertBeforeOther("90 Day Safety Check", "90 Day Safety Check");
  insertBeforeOther("Pre RMS Check", "Pre RMS Check");
}
