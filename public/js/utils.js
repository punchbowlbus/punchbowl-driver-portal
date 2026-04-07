export function escapeHtml(s) {
  return String(s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function normalizeEmail(v) {
  return (v || "").trim().toLowerCase();
}

export function getActor(auth) {
  const u = auth.currentUser;
  return { uid: u?.uid || null, email: normalizeEmail(u?.email || "") };
}

export function fmtDate(iso) {
  if (!iso) return "-";
  const p = iso.split("-");
  if (p.length !== 3) return iso;
  const [y, m, d] = p;
  return `${d.padStart(2, "0")}-${m.padStart(2, "0")}-${y}`;
}

export function parseCSV(text) {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map(h => h.trim());
  return lines.slice(1).map(line => {
    const cols = line.split(",").map(c => c.trim());
    const row = {};
    headers.forEach((h, i) => (row[h] = cols[i] ?? ""));
    return row;
  });
}

export function toPdfLinks(row) {
  // supports both old csv pdfLink and new pdfLink1/2/3
  const one = (row.pdfLink || "").trim();
  const links = [
    (row.pdfLink1 || "").trim(),
    (row.pdfLink2 || "").trim(),
    (row.pdfLink3 || "").trim()
  ].filter(Boolean);

  if (links.length) return links;
  return one ? [one] : [];
}