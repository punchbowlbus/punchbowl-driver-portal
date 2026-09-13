/**
 * Quotation Response — Client-side logic for the public response page.
 * Reads token + action from URL, calls the Cloud Function HTTP endpoint.
 *
 * NOTE: The actual processing happens server-side in the Cloud Function.
 * This page just redirects to the Cloud Function URL which returns
 * the confirmation page and result page directly.
 */

const body = document.getElementById("responseBody");
const params = new URLSearchParams(window.location.search);
const token = params.get("token");
const action = params.get("action");

function showResult(icon, iconClass, title, message) {
  body.innerHTML = `
    <div class="response-icon ${iconClass}">${icon}</div>
    <h2>${title}</h2>
    <p>${message}</p>
  `;
}

if (!token || !action) {
  showResult("?", "error", "Invalid Link",
    "This link is missing required information. Please use the buttons in your quotation email.");
} else if (!["accept", "reject"].includes(action)) {
  showResult("?", "error", "Invalid Action",
    "The action in this link is not valid. Please use the Accept or Reject buttons from your email.");
} else {
  // Redirect to the Cloud Function endpoint which handles everything server-side
  // The Cloud Function returns the confirmation page and processes the response
  const functionRegion = "australia-southeast1";
  const projectId = "punchbowl-driver-portal";
  const functionUrl = `https://${functionRegion}-${projectId}.cloudfunctions.net/processQuotationResponse`;

  window.location.href = `${functionUrl}?token=${encodeURIComponent(token)}&action=${encodeURIComponent(action)}`;
}
