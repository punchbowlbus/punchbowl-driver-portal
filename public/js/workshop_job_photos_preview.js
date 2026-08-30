import {
  collection,
  onSnapshot,
  orderBy,
  query
} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";
import { db } from "./firebase.js";

const RETENTION_DAYS = 180;
let jobs = [];

function esc(v) {
  return String(v ?? "").replace(/[&<>'\"]/g, (m) => ({
    "&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'\"':"&quot;"
  }[m]));
}

function currentReviewJob() {
  const subtitle = document.getElementById("wmReviewSubtitle")?.textContent || "";
  const jobNumber = subtitle.split("·")[0]?.trim() || "";
  if (!jobNumber) return null;
  return jobs.find((job) => String(job.jobNumber || job.id) === jobNumber) || null;
}

function isExpired(photo) {
  const expiresAt = photo?.expiresAt ? new Date(photo.expiresAt) : null;
  if (expiresAt && !Number.isNaN(expiresAt.getTime())) return expiresAt.getTime() <= Date.now();
  const uploadedAt = photo?.uploadedAt ? new Date(photo.uploadedAt) : null;
  if (uploadedAt && !Number.isNaN(uploadedAt.getTime())) {
    return uploadedAt.getTime() + RETENTION_DAYS * 86400000 <= Date.now();
  }
  return false;
}

function photoSection(job) {
  const photos = Array.isArray(job?.workshopPhotos) ? job.workshopPhotos.filter((p) => p?.url) : [];
  if (!photos.length) {
    return `<div class="wm-review-box wm-full wm-photo-review"><div class="wm-review-label">Job Photos</div><div class="wm-review-value">No photos attached.</div></div>`;
  }

  const live = photos.filter((p) => !isExpired(p));
  const expiredCount = photos.length - live.length;

  return `<div class="wm-review-box wm-full wm-photo-review">
    <div class="wm-review-label">Job Photos</div>
    ${live.length ? `<div class="wm-photo-grid">${live.map((photo, index) => `
      <a class="wm-photo-card" href="${esc(photo.url)}" target="_blank" rel="noopener" title="Open photo ${index + 1}">
        <img src="${esc(photo.url)}" alt="Workshop job photo ${index + 1}" loading="lazy" />
        <span>Photo ${index + 1}</span>
      </a>`).join("")}</div>` : ""}
    ${expiredCount ? `<div class="wm-photo-expired">${expiredCount} photo${expiredCount === 1 ? "" : "s"} expired after 6 months.</div>` : ""}
  </div>`;
}

function syncReviewPhotos() {
  const body = document.getElementById("wmReviewBody");
  if (!body) return;
  const job = currentReviewJob();
  if (!job) return;

  const existing = body.querySelector(".wm-photo-review");
  const holder = document.createElement("div");
  holder.innerHTML = photoSection(job);
  const next = holder.firstElementChild;
  if (!next) return;

  if (existing) {
    if (existing.innerHTML !== next.innerHTML) existing.replaceWith(next);
    return;
  }

  const grid = body.querySelector(".wm-review-grid");
  if (grid) grid.appendChild(next);
}

function injectStyles() {
  if (document.getElementById("workshopPhotoPreviewStyles")) return;
  const style = document.createElement("style");
  style.id = "workshopPhotoPreviewStyles";
  style.textContent = `
    .wm-photo-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:10px;margin-top:8px}
    .wm-photo-card{display:block;text-decoration:none;color:#1f2937;border:1px solid #d9e1ea;border-radius:10px;overflow:hidden;background:#fff}
    .wm-photo-card img{display:block;width:100%;height:110px;object-fit:cover;background:#f3f4f6}
    .wm-photo-card span{display:block;padding:7px 9px;font-size:12px;font-weight:800}
    .wm-photo-expired{margin-top:10px;color:#667085;font-size:12px;font-weight:700}
  `;
  document.head.appendChild(style);
}

onSnapshot(
  query(collection(db, "workshopJobs"), orderBy("createdAt", "desc")),
  (snap) => {
    jobs = snap.docs.map((d) => ({ id:d.id, ...d.data() }));
    syncReviewPhotos();
  },
  (error) => console.error("Workshop photo preview listener failed", error)
);

document.addEventListener("click", () => setTimeout(syncReviewPhotos, 40), true);

injectStyles();
