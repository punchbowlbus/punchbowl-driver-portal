import {
  arrayUnion,
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  updateDoc
} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";
import {
  deleteObject,
  getDownloadURL,
  ref,
  uploadBytes
} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-storage.js";
import { auth, db, storage } from "./firebase.js";

const MAX_ATTACHMENTS = 6;
const MAX_PDF_BYTES = 10 * 1024 * 1024;
const MAX_DIMENSION = 1600;
const JPEG_QUALITY = 0.78;
const RETENTION_DAYS = 180;
const PHOTO_EDITABLE_STATUSES = new Set(["New", "Assigned", "In Progress", "Waiting Parts"]);

let jobs = [];
let uploading = false;
let removingPhoto = false;

function esc(v) {
  return String(v ?? "").replace(/[&<>'\"]/g, (m) => ({
    "&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'\"':"&quot;"
  }[m]));
}

function currentJobNumber() {
  const title = document.getElementById("jobCardTitle")?.textContent || "";
  return title.split("·")[0]?.trim() || "";
}

function currentJob() {
  const jobNumber = currentJobNumber();
  if (!jobNumber) return null;
  return jobs.find((job) => String(job.jobNumber || job.id) === jobNumber) || null;
}

function setMessage(message, type = "") {
  const el = document.getElementById("jobPhotoStatus");
  if (!el) return;
  el.textContent = message || "";
  el.dataset.type = type;
}

function photoList(job) {
  return Array.isArray(job?.workshopPhotos) ? job.workshopPhotos.filter((p) => p?.url) : [];
}

function isPdf(photo) {
  return photo?.attachmentType === "pdf" || photo?.contentType === "application/pdf" || /\.pdf$/i.test(photo?.fileName || "");
}

function photosEditable(job) {
  return PHOTO_EDITABLE_STATUSES.has(String(job?.status || ""));
}

function renderPhotos() {
  const wrap = document.getElementById("jobPhotoGallery");
  const input = document.getElementById("jobPhotoInput");
  const button = document.getElementById("jobPhotoButton");
  if (!wrap) return;

  const job = currentJob();
  if (!job) {
    wrap.innerHTML = `<div class="hint">Open a job card to add photos.</div>`;
    if (button) button.disabled = true;
    return;
  }

  const photos = photoList(job);
  const editable = photosEditable(job);
  const atLimit = photos.length >= MAX_ATTACHMENTS;
  if (button) {
    button.disabled = uploading || removingPhoto || !editable || atLimit;
    button.textContent = atLimit ? `Attachment limit reached (${MAX_ATTACHMENTS})` : "Add Photo / PDF";
  }
  if (input) input.disabled = uploading || removingPhoto || !editable || atLimit;

  if (!photos.length) {
    wrap.innerHTML = `<div class="job-photo-empty">No photos or PDF documents added. Maximum ${MAX_ATTACHMENTS} attachments. Images are automatically compressed; PDFs can be up to 10 MB.</div>`;
    return;
  }

  wrap.innerHTML = photos.map((photo, index) => `
    <div class="job-photo-card" style="position:relative">
      <a href="${esc(photo.url)}" target="_blank" rel="noopener" title="Open ${isPdf(photo) ? "PDF" : "photo"} ${index + 1}" style="display:block;color:inherit;text-decoration:none">
        ${isPdf(photo) ? `<div class="job-pdf-preview"><strong>PDF</strong><small>Open document</small></div>` : `<img src="${esc(photo.url)}" alt="Workshop job photo ${index + 1}" loading="lazy" />`}
        <span>${esc(photo.originalFileName || photo.fileName || `${isPdf(photo) ? "PDF" : "Photo"} ${index + 1}`)}</span>
      </a>
      ${editable ? `<button class="button secondary job-photo-remove" type="button" data-remove-photo="${index}" style="margin-top:8px;width:100%;border-color:#efc2bf;color:#a51d16">Remove ${isPdf(photo) ? "PDF" : "Photo"}</button>` : ""}
    </div>`).join("");

  wrap.querySelectorAll("[data-remove-photo]").forEach((btn) => {
    btn.addEventListener("click", () => removePhoto(Number(btn.dataset.removePhoto)));
  });
}

function safeFileName(name) {
  return String(name || "photo.jpg")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/\.[^.]+$/, "")
    .slice(-70) || "photo";
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Unable to read this image."));
    };
    img.src = url;
  });
}

async function compressImage(file) {
  const img = await loadImage(file);
  const longest = Math.max(img.naturalWidth || img.width, img.naturalHeight || img.height);
  const scale = longest > MAX_DIMENSION ? MAX_DIMENSION / longest : 1;
  const width = Math.max(1, Math.round((img.naturalWidth || img.width) * scale));
  const height = Math.max(1, Math.round((img.naturalHeight || img.height) * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Photo compression is not available on this device.");
  ctx.drawImage(img, 0, 0, width, height);

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY));
  if (!blob) throw new Error("Unable to compress this photo.");
  return blob;
}

async function uploadSelected(file) {
  const job = currentJob();
  if (!job) throw new Error("Open a job card before adding an attachment.");
  if (!photosEditable(job)) throw new Error("Attachments are locked after the Job Card is submitted for approval.");
  const pdf = file?.type === "application/pdf" || /\.pdf$/i.test(file?.name || "");
  const image = file?.type?.startsWith("image/");
  if (!image && !pdf) throw new Error("Please choose an image or PDF file.");
  if (pdf && file.size > MAX_PDF_BYTES) throw new Error("PDF files must be 10 MB or smaller.");
  if (photoList(job).length >= MAX_ATTACHMENTS) throw new Error(`Maximum ${MAX_ATTACHMENTS} attachments per job card.`);

  const uploadBody = pdf ? file : await compressImage(file);
  const stamp = Date.now();
  const filename = `${safeFileName(file.name)}.${pdf ? "pdf" : "jpg"}`;
  const storagePath = `workshopJobs/${job.id}/photos/${stamp}_${filename}`;
  const storageRef = ref(storage, storagePath);
  const uploadedAt = new Date();
  const expiresAt = new Date(uploadedAt.getTime() + RETENTION_DAYS * 24 * 60 * 60 * 1000);

  const contentType = pdf ? "application/pdf" : "image/jpeg";
  const snapshot = await uploadBytes(storageRef, uploadBody, {
    contentType,
    customMetadata: {
      workshopJobId: job.id,
      jobNumber: String(job.jobNumber || job.id),
      retentionDays: String(RETENTION_DAYS),
      expiresAt: expiresAt.toISOString(),
      originalBytes: String(file.size || 0),
      uploadedBytes: String(uploadBody.size || 0),
      attachmentType: pdf ? "pdf" : "image"
    }
  });
  const url = await getDownloadURL(snapshot.ref);

  const photo = {
    url,
    storagePath,
    fileName: filename,
    originalFileName: file.name || filename,
    contentType,
    attachmentType: pdf ? "pdf" : "image",
    uploadedAt: uploadedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    retentionDays: RETENTION_DAYS,
    originalBytes: file.size || 0,
    compressedBytes: uploadBody.size || 0,
    uploadedBy: auth.currentUser?.email || ""
  };

  await updateDoc(doc(db, "workshopJobs", job.id), {
    workshopPhotos: arrayUnion(photo)
  });
}

async function removePhoto(index) {
  if (uploading || removingPhoto) return;
  const job = currentJob();
  if (!job) return setMessage("Open a job card before removing an attachment.", "error");
  if (!photosEditable(job)) return setMessage("Attachments are locked after the Job Card is submitted for approval.", "error");

  const photos = photoList(job);
  const photo = photos[index];
  if (!photo) return setMessage("Photo could not be found.", "error");
  if (!window.confirm(`Remove ${isPdf(photo) ? "PDF document" : `Photo ${index + 1}`}?`)) return;

  removingPhoto = true;
  renderPhotos();
  setMessage(`Removing ${isPdf(photo) ? "PDF document" : `Photo ${index + 1}`}...`);

  try {
    if (photo.storagePath) {
      try {
        await deleteObject(ref(storage, photo.storagePath));
      } catch (error) {
        if (error?.code !== "storage/object-not-found") throw error;
      }
    }

    const remaining = Array.isArray(job.workshopPhotos)
      ? job.workshopPhotos.filter((p) => p !== photo && p?.storagePath !== photo.storagePath)
      : [];

    await updateDoc(doc(db, "workshopJobs", job.id), {
      workshopPhotos: remaining
    });
    setMessage("Attachment removed.", "success");
  } catch (error) {
    console.error("Workshop photo removal failed", error);
    setMessage(error?.message || "Unable to remove attachment.", "error");
  } finally {
    removingPhoto = false;
    renderPhotos();
  }
}

async function handleFiles(files) {
  if (uploading || removingPhoto) return;
  const job = currentJob();
  if (!job) return setMessage("Open a job card before adding an attachment.", "error");
  if (!photosEditable(job)) return setMessage("Attachments are locked after the Job Card is submitted for approval.", "error");

  const remaining = Math.max(0, MAX_ATTACHMENTS - photoList(job).length);
  const list = [...(files || [])].slice(0, remaining);
  if (!list.length) return setMessage(`Maximum ${MAX_ATTACHMENTS} attachments per job card.`, "error");

  uploading = true;
  renderPhotos();
  setMessage(`Preparing and uploading ${list.length === 1 ? "attachment" : `${list.length} attachments`}...`);

  try {
    for (const file of list) await uploadSelected(file);
    setMessage(list.length === 1 ? "Attachment added to job card." : `${list.length} attachments added to job card.`, "success");
  } catch (error) {
    console.error("Workshop attachment upload failed", error);
    setMessage(error?.message || "Attachment upload failed.", "error");
  } finally {
    uploading = false;
    const input = document.getElementById("jobPhotoInput");
    if (input) input.value = "";
    renderPhotos();
  }
}

function wirePhotoControls() {
  const input = document.getElementById("jobPhotoInput");
  const button = document.getElementById("jobPhotoButton");
  if (!input || !button || button.dataset.wired === "1") return;

  button.dataset.wired = "1";
  button.addEventListener("click", () => input.click());
  input.addEventListener("change", () => handleFiles(input.files));
}

onSnapshot(
  query(collection(db, "workshopJobs"), orderBy("createdAt", "desc")),
  (snap) => {
    jobs = snap.docs.map((d) => ({ id:d.id, ...d.data() }));
    wirePhotoControls();
    renderPhotos();
  },
  (error) => console.error("Workshop photo listener failed", error)
);

document.addEventListener("click", () => setTimeout(() => {
  wirePhotoControls();
  renderPhotos();
}, 30), true);

wirePhotoControls();
renderPhotos();
