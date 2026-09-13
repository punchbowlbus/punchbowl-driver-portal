/**
 * Charter PDF — In-browser quotation PDF generation using jsPDF.
 * Generates a branded quotation document and renders a preview.
 */
import { COMPANY } from "./config.js";
import { getStaticMapUrl } from "./charter_map.js";
import { jsPDF } from "https://esm.sh/jspdf@2.5.2";
import autoTable from "https://esm.sh/jspdf-autotable@3.8.4";

const COLORS = {
  red: [198, 40, 40],
  redDark: [159, 31, 35],
  ink: [20, 32, 51],
  muted: [100, 116, 139],
  line: [220, 227, 236],
  bg: [248, 250, 252],
  white: [255, 255, 255]
};

const money = (amount) =>
  new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(Number(amount || 0));

function displayDate(date) {
  if (!date) return "Date pending";
  const parsed = new Date(`${date}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? date :
    new Intl.DateTimeFormat("en-AU", { day: "2-digit", month: "long", year: "numeric" }).format(parsed);
}

/* =========================================================
   Generate quotation PDF
========================================================= */
export function generateQuotationPDF(booking) {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 18;
  const contentWidth = pageWidth - margin * 2;
  let y = 15;

  // ===== HEADER BAR =====
  doc.setFillColor(...COLORS.red);
  doc.rect(0, 0, pageWidth, 38, "F");

  // Company name
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.setTextColor(...COLORS.white);
  doc.text(COMPANY.name, margin, 16);

  // Company details
  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");
  doc.text(`ABN: ${COMPANY.abn}  |  ${COMPANY.phone}  |  ${COMPANY.email}`, margin, 23);
  doc.text(COMPANY.address, margin, 28);

  // QUOTATION label
  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.text("QUOTATION", pageWidth - margin, 16, { align: "right" });

  // Reference
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.text(booking.bookingNumber || "—", pageWidth - margin, 23, { align: "right" });

  y = 46;

  // ===== BOOKING DETAILS SECTION =====
  doc.setFillColor(...COLORS.bg);
  doc.roundedRect(margin, y, contentWidth, 42, 3, 3, "F");
  doc.setDrawColor(...COLORS.line);
  doc.roundedRect(margin, y, contentWidth, 42, 3, 3, "S");

  const colLeft = margin + 5;
  const colRight = margin + contentWidth / 2 + 5;

  doc.setFontSize(7);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...COLORS.muted);

  // Left column
  y += 8;
  doc.text("CUSTOMER", colLeft, y);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...COLORS.ink);
  doc.setFontSize(10);
  y += 5;
  doc.text(booking.organisationName || "—", colLeft, y);

  doc.setFontSize(7);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...COLORS.muted);
  y += 7;
  doc.text("CONTACT", colLeft, y);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...COLORS.ink);
  doc.setFontSize(9);
  y += 5;
  doc.text(`${booking.contactName || "—"}  •  ${booking.contactPhone || "—"}`, colLeft, y);
  doc.text(booking.contactEmail || "—", colLeft, y + 4);

  // Right column
  let ry = 46 + 8;
  doc.setFontSize(7);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...COLORS.muted);
  doc.text("SERVICE DATE", colRight, ry);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...COLORS.ink);
  doc.setFontSize(10);
  ry += 5;
  doc.text(displayDate(booking.serviceDate), colRight, ry);

  doc.setFontSize(7);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...COLORS.muted);
  ry += 7;
  doc.text("PASSENGERS / JOURNEY", colRight, ry);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...COLORS.ink);
  doc.setFontSize(9);
  ry += 5;
  doc.text(`${booking.passengerCount || "—"} passengers  •  ${booking.journeyType || "One Way"}`, colRight, ry);
  doc.text(`${booking.vehicleType || "To be recommended"}  •  ${booking.busCount || 1} bus(es)`, colRight, ry + 4);

  y = 46 + 42 + 8;

  // ===== ITINERARY TABLE =====
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(...COLORS.ink);
  doc.text("Itinerary", margin, y);
  y += 3;

  const stops = Array.isArray(booking.stops) ? booking.stops : [];
  if (stops.length) {
    autoTable(doc, {
      startY: y,
      margin: { left: margin, right: margin },
      headStyles: {
        fillColor: COLORS.red,
        textColor: COLORS.white,
        fontStyle: "bold",
        fontSize: 8
      },
      bodyStyles: {
        fontSize: 8,
        textColor: COLORS.ink
      },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      head: [["#", "Type", "Location", "Arrive", "Depart", "Buffer"]],
      body: stops.map((s, i) => [
        String(i + 1),
        s.type || "Stop",
        s.name || "—",
        s.arrivalTime || "—",
        s.departureTime || "—",
        s.bufferMinutes ? `${s.bufferMinutes} min` : "—"
      ]),
      columnStyles: {
        0: { cellWidth: 10, halign: "center" },
        1: { cellWidth: 22 },
        2: { cellWidth: "auto" },
        3: { cellWidth: 20, halign: "center" },
        4: { cellWidth: 20, halign: "center" },
        5: { cellWidth: 20, halign: "center" }
      }
    });
    y = doc.lastAutoTable.finalY + 6;
  } else {
    y += 5;
    doc.setFontSize(9);
    doc.setFont("helvetica", "italic");
    doc.setTextColor(...COLORS.muted);
    doc.text("No itinerary stops recorded.", margin, y);
    y += 8;
  }

  // Route summary if available
  const route = booking.routeSnapshot;
  if (route?.distanceKm) {
    doc.setFillColor(255, 249, 249);
    doc.roundedRect(margin, y, contentWidth, 12, 2, 2, "F");
    doc.setDrawColor(240, 160, 163);
    doc.roundedRect(margin, y, contentWidth, 12, 2, 2, "S");
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...COLORS.redDark);
    doc.text(`Route: ${route.distanceKm} km  •  Estimated ${route.durationMinutes} minutes`, margin + 5, y + 7.5);
    y += 18;
  }

  // ===== PRICING TABLE =====
  const pricing = booking.pricing || {};

  // Check if we need a new page
  if (y > 220) {
    doc.addPage();
    y = 20;
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(...COLORS.ink);
  doc.text("Quotation Pricing", margin, y);
  y += 3;

  const pricingRows = [
    ["Vehicle / Base charge", money(pricing.baseCharge)],
    ["Distance charge", money(pricing.distanceCharge)],
    ["Waiting / Driver charge", money(pricing.waitingCharge)],
    ["Additional charges", money(pricing.additionalCharge)]
  ];
  if (pricing.discount > 0) {
    pricingRows.push(["Discount", `− ${money(pricing.discount)}`]);
  }
  pricingRows.push(
    ["Subtotal (ex GST)", money(pricing.subtotal)],
    ["GST (10%)", money(pricing.gst)]
  );

  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    headStyles: {
      fillColor: COLORS.red,
      textColor: COLORS.white,
      fontStyle: "bold",
      fontSize: 8
    },
    bodyStyles: {
      fontSize: 9,
      textColor: COLORS.ink
    },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    head: [["Description", "Amount"]],
    body: pricingRows,
    columnStyles: {
      0: { cellWidth: "auto" },
      1: { cellWidth: 40, halign: "right", fontStyle: "bold" }
    }
  });

  // Total row
  y = doc.lastAutoTable.finalY;
  doc.setFillColor(...COLORS.red);
  doc.roundedRect(margin, y, contentWidth, 14, 0, 0, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(...COLORS.white);
  doc.text("TOTAL (inc GST)", margin + 5, y + 9.5);
  doc.text(money(pricing.total), pageWidth - margin - 5, y + 9.5, { align: "right" });
  y += 20;

  // ===== QUOTE EXPIRY =====
  if (booking.quoteExpiryDate) {
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...COLORS.redDark);
    doc.text(`This quotation is valid until: ${displayDate(booking.quoteExpiryDate)}`, margin, y);
    y += 7;
  }

  // ===== QUOTE NOTES =====
  if (booking.quoteNotes) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(...COLORS.ink);
    doc.text("Notes:", margin, y);
    y += 5;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...COLORS.muted);
    const noteLines = doc.splitTextToSize(booking.quoteNotes, contentWidth);
    doc.text(noteLines, margin, y);
    y += noteLines.length * 4 + 5;
  }

  // ===== SPECIAL INSTRUCTIONS =====
  if (booking.specialInstructions) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(...COLORS.ink);
    doc.text("Special Instructions:", margin, y);
    y += 5;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...COLORS.muted);
    const instrLines = doc.splitTextToSize(booking.specialInstructions, contentWidth);
    doc.text(instrLines, margin, y);
    y += instrLines.length * 4 + 5;
  }

  // ===== TERMS AND CONDITIONS =====
  if (y > 240) { doc.addPage(); y = 20; }

  doc.setFillColor(...COLORS.bg);
  doc.roundedRect(margin, y, contentWidth, 30, 2, 2, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(...COLORS.ink);
  doc.text("Terms & Conditions", margin + 4, y + 6);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(...COLORS.muted);
  const terms = [
    "• Prices include GST unless otherwise stated.",
    "• Booking confirmation required within the validity period of this quotation.",
    "• Cancellations within 48 hours of service may incur a cancellation fee.",
    "• Additional waiting time beyond quoted may be charged at the applicable rate.",
    "• Passenger counts exceeding the quoted number may require additional vehicles."
  ];
  doc.text(terms, margin + 4, y + 11);

  // ===== FOOTER =====
  const pageCount = doc.internal.getNumberOfPages();
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p);
    doc.setFontSize(7);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...COLORS.muted);
    doc.text(
      `${COMPANY.name}  |  ${COMPANY.website}  |  Page ${p} of ${pageCount}`,
      pageWidth / 2, 290, { align: "center" }
    );
    doc.setDrawColor(...COLORS.line);
    doc.line(margin, 287, pageWidth - margin, 287);
  }

  // Return blob and data URL
  const blob = doc.output("blob");
  const dataUrl = doc.output("datauristring");

  return { doc, blob, dataUrl };
}

/* =========================================================
   Render preview in container
========================================================= */
export function renderPdfPreview(dataUrl, containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;

  container.innerHTML = `
    <iframe
      src="${dataUrl}"
      style="width:100%;height:600px;border:1px solid #dce3ec;border-radius:10px;"
      title="Quotation preview"
    ></iframe>`;
}

/* =========================================================
   Download PDF
========================================================= */
export function downloadPdf(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename || "quotation.pdf";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
