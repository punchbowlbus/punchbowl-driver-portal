// Keep Fleet Manager Review truthful for jobs that have not been completed yet.
// The legacy review renderer falls back to updatedAt for "Mechanic completed",
// which makes a newly-created/assigned job look completed on the creation date.

function reviewStatus() {
  const subtitle = document.getElementById("wmReviewSubtitle")?.textContent || "";
  const parts = subtitle.split("·").map((v) => v.trim()).filter(Boolean);
  return parts.at(-1) || "";
}

function setReviewVisibility() {
  const dialog = document.getElementById("fleetManagerReviewDialog");
  if (!dialog) return;

  const status = reviewStatus();
  const completedStatuses = new Set(["Waiting Approval", "Completed", "Closed"]);
  const waitingApproval = status === "Waiting Approval";

  const labels = [...dialog.querySelectorAll(".wm-review-label")];
  const completedLabel = labels.find((el) => el.textContent.trim().toLowerCase() === "mechanic completed");
  const completedValue = completedLabel?.parentElement?.querySelector(".wm-review-value");

  if (completedValue && !completedStatuses.has(status)) {
    completedValue.textContent = "Not completed";
  }

  const decisionTitle = [...dialog.querySelectorAll(".section-title")]
    .find((el) => el.textContent.trim() === "Fleet Manager Decision");
  const decisionForm = decisionTitle?.nextElementSibling;

  if (decisionTitle) decisionTitle.hidden = !waitingApproval;
  if (decisionForm) decisionForm.hidden = !waitingApproval;

  const returnBtn = document.getElementById("wmReturnMechanic");
  const closeBtn = document.getElementById("wmApproveClose");
  if (returnBtn) returnBtn.style.display = waitingApproval ? "" : "none";
  if (closeBtn) closeBtn.style.display = waitingApproval ? "" : "none";
}

const observer = new MutationObserver(() => setReviewVisibility());
observer.observe(document.documentElement, { childList:true, subtree:true, characterData:true });

document.addEventListener("click", () => setTimeout(setReviewVisibility, 0), true);
setReviewVisibility();
