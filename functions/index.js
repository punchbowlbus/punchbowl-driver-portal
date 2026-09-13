/**
 * Punchbowl Bus — Charter Quotation Cloud Functions
 *
 * 1. sendCharterQuotation  — callable: generate PDF, email via Brevo, create token
 * 2. processQuotationResponse — HTTP: validate token, accept/reject, redirect
 */
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onRequest } = require("firebase-functions/v2/https");
const { defineString } = require("firebase-functions/params");
const admin = require("firebase-admin");
const { getFirestore, FieldValue, Timestamp } = require("firebase-admin/firestore");
const nodemailer = require("nodemailer");
const { v4: uuidv4 } = require("uuid");
const { buildQuotationEmail, buildResponsePage } = require("./email_template");

admin.initializeApp();
const db = getFirestore();
const bucket = admin.storage().bucket();

// ── Brevo SMTP config (set via firebase functions:config or .env) ──
const BREVO_SMTP_USER = defineString("BREVO_SMTP_USER", { default: "" });
const BREVO_SMTP_PASS = defineString("BREVO_SMTP_PASS", { default: "" });
const SENDER_EMAIL = defineString("SENDER_EMAIL", { default: "charters@punchbowlbus.com.au" });
const SENDER_NAME = defineString("SENDER_NAME", { default: "Punchbowl Bus Company" });

// Company branding (mirrors config.js on the client)
const COMPANY = {
  name: "Punchbowl Bus Company",
  abn: "XX XXX XXX XXX",
  address: "Your Address, Sydney NSW 2196",
  phone: "(02) XXXX XXXX",
  email: "charters@punchbowlbus.com.au",
  website: "www.punchbowlbus.com.au"
};

function money(amount) {
  return new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(Number(amount || 0));
}

/* =========================================================
   1. sendCharterQuotation — Callable from the admin portal
========================================================= */
exports.sendCharterQuotation = onCall({
  region: "australia-southeast1",
  maxInstances: 10
}, async (request) => {
  // ── Auth check ──
  if (!request.auth?.uid) {
    throw new HttpsError("unauthenticated", "You must be signed in to send quotations.");
  }

  const { bookingId } = request.data;
  if (!bookingId) {
    throw new HttpsError("invalid-argument", "bookingId is required.");
  }

  // ── Load booking ──
  const bookingRef = db.collection("charterBookings").doc(bookingId);
  const bookingSnap = await bookingRef.get();
  if (!bookingSnap.exists) {
    throw new HttpsError("not-found", "Charter booking not found.");
  }
  const booking = { id: bookingSnap.id, ...bookingSnap.data() };

  // ── Validate ──
  if (!booking.contactEmail) {
    throw new HttpsError("failed-precondition", "Customer contact email is required before sending.");
  }
  const pricing = booking.pricing || {};
  if (!pricing.total || pricing.total <= 0) {
    throw new HttpsError("failed-precondition", "Quotation total must be greater than $0.");
  }
  if (!booking.quoteExpiryDate) {
    throw new HttpsError("failed-precondition", "Quote expiry date is required.");
  }

  // ── Generate secure token ──
  const token = uuidv4();
  const expiresAt = new Date(`${booking.quoteExpiryDate}T23:59:59+11:00`); // AEST end of day

  await db.collection("quotationTokens").doc(token).set({
    bookingId: booking.id,
    bookingNumber: booking.bookingNumber || "",
    customerEmail: booking.contactEmail,
    expiresAt: Timestamp.fromDate(expiresAt),
    used: false,
    usedAt: null,
    action: null,
    createdAt: FieldValue.serverTimestamp()
  });

  // ── Build accept/reject URLs ──
  const isEmulator = process.env.FUNCTIONS_EMULATOR === "true";
  const baseUrl = isEmulator
    ? "http://127.0.0.1:5001/punchbowl-driver-portal/australia-southeast1/processQuotationResponse"
    : `https://${process.env.GCLOUD_PROJECT || "punchbowl-driver-portal"}.web.app/quotation-response.html`;

  const acceptUrl = `${baseUrl}?token=${token}&action=accept`;
  const rejectUrl = `${baseUrl}?token=${token}&action=reject`;

  // ── Build email ──
  const emailHtml = buildQuotationEmail(booking, acceptUrl, rejectUrl, COMPANY);

  // ── Send via Brevo API ──
  const smtpUser = process.env.BREVO_SMTP_USER || BREVO_SMTP_USER.value();
  const smtpPass = process.env.BREVO_SMTP_PASS || BREVO_SMTP_PASS.value();

  if (!smtpUser || !smtpPass || smtpUser === "YOUR_BREVO_LOGIN_EMAIL_HERE") {
    throw new HttpsError("failed-precondition",
      "Brevo API key not configured correctly in .env");
  }

  const payload = {
    sender: {
      name: SENDER_NAME.value(),
      email: SENDER_EMAIL.value()
    },
    to: [
      { email: booking.contactEmail }
    ],
    subject: `Charter Quotation ${booking.bookingNumber || ""} — ${COMPANY.name}`,
    htmlContent: emailHtml
  };

  try {
    const response = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "accept": "application/json",
        "api-key": smtpPass, // The v3 API key
        "content-type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const responseData = await response.json().catch(() => ({}));

    if (!response.ok) {
      console.error("Brevo API error:", responseData);
      throw new Error(responseData.message || "Unknown Brevo API Error");
    }
  } catch (emailError) {
    console.error("Email send failed:", emailError);
    throw new HttpsError("internal", `Failed to send email: ${emailError.message}`);
  }

  // ── Update booking status ──
  const now = FieldValue.serverTimestamp();
  await bookingRef.update({
    status: "Sent",
    quotationSentAt: now,
    quotationSentByEmail: request.auth.token?.email || "",
    quotationSentByName: request.auth.token?.name || request.auth.token?.email || "Portal user",
    quotationToken: token,
    updatedAt: now,
    updatedByUid: request.auth.uid,
    updatedByEmail: request.auth.token?.email || ""
  });

  // ── Add history entry ──
  await bookingRef.collection("history").add({
    action: "sent",
    summary: `Quotation emailed to ${booking.contactEmail}`,
    createdAt: now,
    createdByEmail: request.auth.token?.email || "",
    createdByName: request.auth.token?.name || request.auth.token?.email || "Portal user",
    metadata: {
      recipientEmail: booking.contactEmail,
      bookingNumber: booking.bookingNumber,
      total: pricing.total,
      quoteExpiryDate: booking.quoteExpiryDate,
      token
    }
  });

  return {
    success: true,
    message: `Quotation sent to ${booking.contactEmail}`,
    token
  };
});

/* =========================================================
   2. processQuotationResponse — Public HTTP endpoint
========================================================= */
exports.processQuotationResponse = onRequest({
  region: "australia-southeast1",
  maxInstances: 10
}, async (req, res) => {
  const { token, action, confirmed } = req.query;

  if (!token || !action) {
    res.status(400).send(buildResponsePage(
      "Invalid Link",
      "This link is missing required parameters. Please use the links provided in your quotation email.",
      "error", COMPANY
    ));
    return;
  }

  if (!["accept", "reject"].includes(action)) {
    res.status(400).send(buildResponsePage(
      "Invalid Action",
      "The action must be either 'accept' or 'reject'.",
      "error", COMPANY
    ));
    return;
  }

  // ── Load token ──
  const tokenRef = db.collection("quotationTokens").doc(token);
  const tokenSnap = await tokenRef.get();

  if (!tokenSnap.exists) {
    res.status(404).send(buildResponsePage(
      "Link Not Found",
      "This quotation link is invalid or has already been removed. Please contact us if you need assistance.",
      "error", COMPANY
    ));
    return;
  }

  const tokenData = tokenSnap.data();

  // ── Already used ──
  if (tokenData.used) {
    const pastAction = tokenData.action === "accepted" ? "accepted" : "declined";
    res.status(200).send(buildResponsePage(
      "Already Responded",
      `You have already ${pastAction} this quotation. If you need to make changes, please contact us directly at ${COMPANY.phone}.`,
      "expired", COMPANY
    ));
    return;
  }

  // ── Check expiry ──
  const now = new Date();
  const expiresAt = tokenData.expiresAt?.toDate?.() || new Date(0);

  if (now > expiresAt) {
    // Auto-reject on expiry
    const bookingRef = db.collection("charterBookings").doc(tokenData.bookingId);
    const ts = FieldValue.serverTimestamp();

    await tokenRef.update({ used: true, usedAt: ts, action: "expired" });
    await bookingRef.update({
      status: "Cancelled",
      customerResponseAt: ts,
      customerResponseAction: "expired",
      updatedAt: ts
    });
    await bookingRef.collection("history").add({
      action: "expired",
      summary: "Quotation expired — auto-rejected",
      createdAt: ts,
      createdByEmail: tokenData.customerEmail || "",
      createdByName: "System (auto-expiry)",
      metadata: { expiresAt: tokenData.expiresAt }
    });

    res.status(200).send(buildResponsePage(
      "Quotation Expired",
      `This quotation expired on ${expiresAt.toLocaleDateString("en-AU", { day: "2-digit", month: "long", year: "numeric" })}. Please contact us at ${COMPANY.phone} if you would like a new quotation.`,
      "expired", COMPANY
    ));
    return;
  }

  // ── Confirmation step: show confirmation page first ──
  if (confirmed !== "yes") {
    const verb = action === "accept" ? "accept" : "decline";
    const color = action === "accept" ? "#16a34a" : "#dc2626";
    const confirmUrl = `?token=${token}&action=${action}&confirmed=yes`;

    res.status(200).send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Confirm ${verb} – ${COMPANY.name}</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box;}
    body{min-height:100vh;display:grid;place-items:center;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;padding:20px;}
    .card{max-width:500px;width:100%;background:#fff;border-radius:16px;box-shadow:0 12px 40px rgba(0,0,0,.08);overflow:hidden;text-align:center;}
    .header{background:#c62828;padding:20px;color:#fff;}
    .header h1{font-size:18px;}
    .body{padding:32px 28px;}
    .body h2{font-size:20px;color:#142033;margin-bottom:10px;}
    .body p{font-size:14px;color:#64748b;line-height:1.6;margin-bottom:20px;}
    .ref{display:inline-block;padding:6px 14px;background:#f1f5f9;border-radius:6px;font-weight:700;color:#c62828;margin-bottom:16px;}
    .btn{display:inline-block;padding:14px 36px;border-radius:8px;color:#fff;text-decoration:none;font-size:15px;font-weight:700;margin:0 6px;}
    .btn-confirm{background:${color};}
    .btn-cancel{background:#94a3b8;}
    .footer{padding:14px;background:#f8fafc;border-top:1px solid #dce3ec;font-size:11px;color:#94a3b8;}
  </style>
</head>
<body>
  <div class="card">
    <div class="header"><h1>${COMPANY.name}</h1></div>
    <div class="body">
      <h2>Confirm your response</h2>
      <div class="ref">${tokenData.bookingNumber || "Charter Quotation"}</div>
      <p>You are about to <strong>${verb}</strong> this charter quotation. This action cannot be undone.</p>
      <a class="btn btn-confirm" href="${confirmUrl}">Yes, ${verb} quotation</a>
      <a class="btn btn-cancel" href="javascript:window.close()">Cancel</a>
    </div>
    <div class="footer">${COMPANY.name} | ${COMPANY.phone}</div>
  </div>
</body>
</html>`);
    return;
  }

  // ── Process the response ──
  const bookingRef = db.collection("charterBookings").doc(tokenData.bookingId);
  const ts = FieldValue.serverTimestamp();
  const newStatus = action === "accept" ? "Confirmed" : "Cancelled";
  const responseAction = action === "accept" ? "accepted" : "rejected";

  await tokenRef.update({
    used: true,
    usedAt: ts,
    action: responseAction
  });

  await bookingRef.update({
    status: newStatus,
    customerResponseAt: ts,
    customerResponseAction: responseAction,
    customerResponseIp: req.ip || "",
    updatedAt: ts
  });

  await bookingRef.collection("history").add({
    action: responseAction,
    summary: `Customer ${responseAction} the quotation`,
    createdAt: ts,
    createdByEmail: tokenData.customerEmail || "",
    createdByName: tokenData.customerEmail || "Customer",
    metadata: {
      action: responseAction,
      ip: req.ip || "",
      userAgent: req.headers["user-agent"] || ""
    }
  });

  if (action === "accept") {
    res.status(200).send(buildResponsePage(
      "Quotation Accepted!",
      `Thank you for accepting the charter quotation. Our team will be in touch shortly to confirm the operational details. If you have any questions, please call us at ${COMPANY.phone}.`,
      "success", COMPANY
    ));
  } else {
    res.status(200).send(buildResponsePage(
      "Quotation Declined",
      `The quotation has been declined. If you'd like to discuss alternative options or receive a revised quote, please contact us at ${COMPANY.phone} or email ${COMPANY.email}.`,
      "error", COMPANY
    ));
  }
});
