// Adds Workshop Management to the current Administration menu without changing the rest of the portal UI.

function installWorkshopLink() {
  const adminNavArea = document.getElementById("adminNavArea");
  if (!adminNavArea) return;

  const administrationBody = adminNavArea.querySelector('[data-menu-body="administration"]');
  if (!administrationBody) return;

  if (administrationBody.querySelector('[data-workshop-management-link]')) return;

  const existingFleetButton = administrationBody.querySelector('button[data-nav="adminBuses"]');

  const button = document.createElement("button");
  button.type = "button";
  button.className = "navBtn";
  button.setAttribute("data-workshop-management-link", "true");
  button.innerHTML = '<i data-lucide="wrench"></i><span>Workshop Management</span>';
  button.addEventListener("click", () => {
    window.location.href = "./workshop.html";
  });

  if (existingFleetButton) {
    existingFleetButton.replaceWith(button);
  } else {
    const settingsButton = administrationBody.querySelector('button[data-nav="settings"]');
    if (settingsButton) administrationBody.insertBefore(button, settingsButton);
    else administrationBody.appendChild(button);
  }

  if (window.lucide) window.lucide.createIcons();
}

const observer = new MutationObserver(() => installWorkshopLink());
observer.observe(document.documentElement, { childList: true, subtree: true });

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", installWorkshopLink);
} else {
  installWorkshopLink();
}
