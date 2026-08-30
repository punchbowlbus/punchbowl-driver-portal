// Adds the workshop's manual Pre RMS Check as a selectable Workshop job type.
const jobType = document.getElementById("jobType");
if (jobType && ![...jobType.options].some((o) => o.value === "Pre RMS Check")) {
  const option = document.createElement("option");
  option.value = "Pre RMS Check";
  option.textContent = "Pre RMS Check";
  const other = [...jobType.options].find((o) => o.value === "Other");
  if (other) jobType.insertBefore(option, other);
  else jobType.appendChild(option);
}
