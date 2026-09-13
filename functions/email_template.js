/**
 * Charter Quotation Email Template
 * HTML email with Accept / Reject buttons sent to the customer.
 */

const BRAND = {
  primary: "#c62828",
  primaryDark: "#9f1f23",
  green: "#16a34a",
  greenDark: "#166534",
  redBtn: "#dc2626",
  ink: "#142033",
  muted: "#64748b",
  bg: "#f8fafc",
  line: "#dce3ec"
};

function money(amount) {
  return new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(Number(amount || 0));
}

function displayDate(date) {
  if (!date) return "Date pending";
  const parsed = new Date(`${date}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? date :
    new Intl.DateTimeFormat("en-AU", { day: "2-digit", month: "long", year: "numeric" }).format(parsed);
}

/**
 * @param {object} booking — the charter booking document
 * @param {string} acceptUrl — full URL with token for accept
 * @param {string} rejectUrl — full URL with token for reject
 * @param {object} company — company branding info
 * @returns {string} HTML email body
 */
function buildQuotationEmail(booking, acceptUrl, rejectUrl, company) {
  const pricing = booking.pricing || {};
  const stops = Array.isArray(booking.stops) ? booking.stops : [];

  const stopsHtml = stops.map((s, i) => `
    <tr style="border-bottom:1px solid ${BRAND.line};">
      <td style="padding:8px 12px;text-align:center;font-weight:bold;color:${BRAND.primary};">${i + 1}</td>
      <td style="padding:8px 12px;">${s.type || "Stop"}</td>
      <td style="padding:8px 12px;">${s.name || "—"}</td>
      <td style="padding:8px 12px;text-align:center;">${s.arrivalTime || "—"}</td>
      <td style="padding:8px 12px;text-align:center;">${s.departureTime || "—"}</td>
    </tr>
  `).join("");

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Quotation – ${booking.bookingNumber || ""}</title>
</head>
<body style="margin:0;padding:0;background:${BRAND.bg};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;margin:0 auto;background:#fff;border:1px solid ${BRAND.line};border-radius:12px;overflow:hidden;">

    <!-- Header -->
    <tr>
      <td style="background:${BRAND.primary};padding:24px 30px;">
        <h1 style="margin:0;color:#fff;font-size:22px;">${company.name}</h1>
        <p style="margin:4px 0 0;color:rgba(255,255,255,0.85);font-size:12px;">
          ABN: ${company.abn} &nbsp;|&nbsp; ${company.phone} &nbsp;|&nbsp; ${company.email}
        </p>
      </td>
    </tr>

    <!-- Greeting -->
    <tr>
      <td style="padding:28px 30px 0;">
        <h2 style="margin:0 0 6px;color:${BRAND.ink};font-size:18px;">Charter Quotation</h2>
        <p style="margin:0;color:${BRAND.muted};font-size:14px;">
          Reference: <strong style="color:${BRAND.primary};">${booking.bookingNumber || "—"}</strong>
        </p>
      </td>
    </tr>

    <!-- Summary -->
    <tr>
      <td style="padding:20px 30px;">
        <table width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.bg};border:1px solid ${BRAND.line};border-radius:8px;">
          <tr>
            <td style="padding:14px 16px;width:50%;">
              <div style="font-size:10px;color:${BRAND.muted};font-weight:bold;text-transform:uppercase;">Service Date</div>
              <div style="font-size:14px;color:${BRAND.ink};font-weight:600;margin-top:3px;">${displayDate(booking.serviceDate)}</div>
            </td>
            <td style="padding:14px 16px;width:50%;">
              <div style="font-size:10px;color:${BRAND.muted};font-weight:bold;text-transform:uppercase;">Passengers</div>
              <div style="font-size:14px;color:${BRAND.ink};font-weight:600;margin-top:3px;">${booking.passengerCount || "—"} passengers</div>
            </td>
          </tr>
          <tr>
            <td style="padding:0 16px 14px;width:50%;">
              <div style="font-size:10px;color:${BRAND.muted};font-weight:bold;text-transform:uppercase;">Journey Type</div>
              <div style="font-size:14px;color:${BRAND.ink};margin-top:3px;">${booking.journeyType || "One Way"}</div>
            </td>
            <td style="padding:0 16px 14px;width:50%;">
              <div style="font-size:10px;color:${BRAND.muted};font-weight:bold;text-transform:uppercase;">Vehicle</div>
              <div style="font-size:14px;color:${BRAND.ink};margin-top:3px;">${booking.vehicleType || "To be recommended"}</div>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    ${stops.length ? `
    <!-- Itinerary -->
    <tr>
      <td style="padding:0 30px 16px;">
        <h3 style="margin:0 0 10px;color:${BRAND.ink};font-size:14px;">Itinerary</h3>
        <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${BRAND.line};border-radius:8px;overflow:hidden;">
          <tr style="background:${BRAND.primary};">
            <th style="padding:8px 12px;color:#fff;font-size:11px;text-align:center;">#</th>
            <th style="padding:8px 12px;color:#fff;font-size:11px;text-align:left;">Type</th>
            <th style="padding:8px 12px;color:#fff;font-size:11px;text-align:left;">Location</th>
            <th style="padding:8px 12px;color:#fff;font-size:11px;text-align:center;">Arrive</th>
            <th style="padding:8px 12px;color:#fff;font-size:11px;text-align:center;">Depart</th>
          </tr>
          ${stopsHtml}
        </table>
      </td>
    </tr>
    ` : ""}

    <!-- Pricing -->
    <tr>
      <td style="padding:0 30px 16px;">
        <h3 style="margin:0 0 10px;color:${BRAND.ink};font-size:14px;">Pricing</h3>
        <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${BRAND.line};border-radius:8px;overflow:hidden;">
          <tr style="background:${BRAND.bg};border-bottom:1px solid ${BRAND.line};">
            <td style="padding:10px 16px;font-size:13px;">Vehicle / Base charge</td>
            <td style="padding:10px 16px;font-size:13px;text-align:right;font-weight:600;">${money(pricing.baseCharge)}</td>
          </tr>
          <tr style="border-bottom:1px solid ${BRAND.line};">
            <td style="padding:10px 16px;font-size:13px;">Distance charge</td>
            <td style="padding:10px 16px;font-size:13px;text-align:right;font-weight:600;">${money(pricing.distanceCharge)}</td>
          </tr>
          <tr style="background:${BRAND.bg};border-bottom:1px solid ${BRAND.line};">
            <td style="padding:10px 16px;font-size:13px;">Waiting / Driver charge</td>
            <td style="padding:10px 16px;font-size:13px;text-align:right;font-weight:600;">${money(pricing.waitingCharge)}</td>
          </tr>
          ${pricing.additionalCharge > 0 ? `
          <tr style="border-bottom:1px solid ${BRAND.line};">
            <td style="padding:10px 16px;font-size:13px;">Additional charges</td>
            <td style="padding:10px 16px;font-size:13px;text-align:right;font-weight:600;">${money(pricing.additionalCharge)}</td>
          </tr>` : ""}
          ${pricing.discount > 0 ? `
          <tr style="background:${BRAND.bg};border-bottom:1px solid ${BRAND.line};">
            <td style="padding:10px 16px;font-size:13px;color:${BRAND.green};">Discount</td>
            <td style="padding:10px 16px;font-size:13px;text-align:right;font-weight:600;color:${BRAND.green};">− ${money(pricing.discount)}</td>
          </tr>` : ""}
          <tr style="border-bottom:1px solid ${BRAND.line};">
            <td style="padding:10px 16px;font-size:13px;">Subtotal (ex GST)</td>
            <td style="padding:10px 16px;font-size:13px;text-align:right;font-weight:600;">${money(pricing.subtotal)}</td>
          </tr>
          <tr style="background:${BRAND.bg};border-bottom:1px solid ${BRAND.line};">
            <td style="padding:10px 16px;font-size:13px;">GST (10%)</td>
            <td style="padding:10px 16px;font-size:13px;text-align:right;font-weight:600;">${money(pricing.gst)}</td>
          </tr>
          <tr style="background:${BRAND.primary};">
            <td style="padding:14px 16px;font-size:15px;color:#fff;font-weight:bold;">TOTAL (inc GST)</td>
            <td style="padding:14px 16px;font-size:17px;color:#fff;text-align:right;font-weight:bold;">${money(pricing.total)}</td>
          </tr>
        </table>
      </td>
    </tr>

    ${booking.quoteExpiryDate ? `
    <!-- Expiry -->
    <tr>
      <td style="padding:0 30px 12px;">
        <div style="padding:10px 14px;background:#fff9f9;border:1px dashed #f0a0a3;border-radius:6px;font-size:12px;color:${BRAND.primaryDark};">
          ⏰ This quotation is valid until <strong>${displayDate(booking.quoteExpiryDate)}</strong>. After this date, the quote will expire automatically.
        </div>
      </td>
    </tr>` : ""}

    ${booking.quoteNotes ? `
    <!-- Notes -->
    <tr>
      <td style="padding:0 30px 16px;">
        <h4 style="margin:0 0 4px;font-size:12px;color:${BRAND.ink};">Notes</h4>
        <p style="margin:0;font-size:12px;color:${BRAND.muted};">${booking.quoteNotes}</p>
      </td>
    </tr>` : ""}

    <!-- Accept / Reject Buttons -->
    <tr>
      <td style="padding:16px 30px 24px;">
        <p style="margin:0 0 14px;font-size:13px;color:${BRAND.ink};">
          Please confirm your booking by clicking one of the buttons below:
        </p>
        <table cellpadding="0" cellspacing="0">
          <tr>
            <td style="padding-right:12px;">
              <a href="${acceptUrl}" target="_blank" style="display:inline-block;padding:14px 32px;background:${BRAND.green};color:#fff;text-decoration:none;font-size:15px;font-weight:bold;border-radius:8px;">
                ✓ Accept Quotation
              </a>
            </td>
            <td>
              <a href="${rejectUrl}" target="_blank" style="display:inline-block;padding:14px 32px;background:${BRAND.redBtn};color:#fff;text-decoration:none;font-size:15px;font-weight:bold;border-radius:8px;">
                ✗ Decline Quotation
              </a>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <!-- Footer -->
    <tr>
      <td style="padding:20px 30px;background:${BRAND.bg};border-top:1px solid ${BRAND.line};">
        <p style="margin:0;font-size:11px;color:${BRAND.muted};">
          ${company.name} &nbsp;|&nbsp; ${company.address}<br>
          ${company.phone} &nbsp;|&nbsp; ${company.email} &nbsp;|&nbsp; ${company.website}
        </p>
        <p style="margin:8px 0 0;font-size:10px;color:#94a3b8;">
          This email was sent regarding charter quotation ${booking.bookingNumber || "—"}. If you did not request this quotation, please disregard this email.
        </p>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/**
 * Build a simple thank-you / result HTML page for the response endpoint.
 */
function buildResponsePage(title, message, type, company) {
  const color = type === "success" ? BRAND.green : type === "expired" ? "#f59e0b" : BRAND.primary;
  const icon = type === "success" ? "✓" : type === "expired" ? "⏰" : "✗";

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title} – ${company.name}</title>
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { min-height:100vh; display:grid; place-items:center; background:${BRAND.bg}; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; padding:20px; }
    .card { max-width:480px; width:100%; background:#fff; border-radius:16px; box-shadow:0 12px 40px rgba(0,0,0,.08); overflow:hidden; text-align:center; }
    .header { background:${BRAND.primary}; padding:24px; color:#fff; }
    .header h1 { font-size:20px; }
    .icon { width:64px; height:64px; border-radius:50%; background:${color}; color:#fff; font-size:28px; display:grid; place-items:center; margin:-32px auto 0; border:4px solid #fff; }
    .body { padding:40px 30px 30px; }
    .body h2 { font-size:22px; color:${BRAND.ink}; margin-bottom:8px; }
    .body p { font-size:14px; color:${BRAND.muted}; line-height:1.6; }
    .footer { padding:16px; background:${BRAND.bg}; border-top:1px solid ${BRAND.line}; font-size:11px; color:${BRAND.muted}; }
  </style>
</head>
<body>
  <div class="card">
    <div class="header"><h1>${company.name}</h1></div>
    <div class="icon">${icon}</div>
    <div class="body">
      <h2>${title}</h2>
      <p>${message}</p>
    </div>
    <div class="footer">${company.name} &nbsp;|&nbsp; ${company.phone} &nbsp;|&nbsp; ${company.email}</div>
  </div>
</body>
</html>`;
}

module.exports = { buildQuotationEmail, buildResponsePage };
