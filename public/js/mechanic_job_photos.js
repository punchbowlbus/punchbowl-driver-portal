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

const MAX_PHOTOS = 6;
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
  const atLimit = photos.length >= MAX_PHOTOS;
  if (button) {
    button.disabled = uploading || removingPhoto || !editable || atLimit;
    button.textContent = atLimit ? `Photo limit reached (${MAX_PHOTOS})` : "Take / Add Photo";
  }
  if (input) input.disabled = uploading || removingPhoto || !editable || atLimit;

  if (!photos.length) {
    wrap.innerHTML = `<div class="job-photo-empty">No photos added. Photos are optional. Maximum ${MAX_PHOTOS} photos, automatically compressed before upload.</div>`;
    return;
  }

  wrap.innerHTML = photos.map((photo, index) => `
    <div class="job-photo-card" style="position:relative">
      <a href="${esc(photo.url)}" target="_blank" rel="noopener" title="Open photo ${index + 1}" style="display:block;color:inherit;text-decoration:none">
        <img src="${esc(photo.url)}" alt="Workshop job photo ${index + 1}" loading="lazy" />
        <span>Photo ${index + 1}</span>
      </a>
      ${editable ? `<button class="button secondary job-photo-remove" type="button" data-remove-photo="${index}" style="margin-top:8px;width:100%;border-color:#efc2bf;color:#a51d16">Remove Photo</button>` : ""}
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
  if (!job) throw new Error("Open a job card before adding a photo.");
  if (!photosEditable(job)) throw new Error("Photos are locked after the Job Card is submitted for approval.");
  if (!file?.type?.startsWith("image/")) throw new Error("Please choose an image file.");
  if (photoList(job).length >= MAX_PHOTOS) throw new Error(`Maximum ${MAX_PHOTOS} photos per job card.`);

  const compressed = await compressImage(file);
  const stamp = Date.now();
  const filename = `${safeFileName(file.name)}.jpg`;
  const storagePath = `workshopJobs/${job.id}/photos/${stamp}_${filename}`;
  const storageRef = ref(storage, storagePath);
  const uploadedAt = new Date();
  const expiresAt = new Date(uploadedAt.getTime() + RETENTION_DAYS * 24 * 60 * 60 * 1000);

  const snapshot = await uploadBytes(storageRef, compressed, {
    contentType: "image/jpeg",
    customMetadata: {
      workshopJobId: job.id,
      jobNumber: String(job.jobNumber || job.id),
      retentionDays: String(RETENTION_DAYS),
      expiresAt: expiresAt.toISOString(),
      originalBytes: String(file.size || 0),
      compressedBytes: String(compressed.size || 0)
    }
  });
  const url = await getDownloadURL(snapshot.ref);

  const photo = {
    url,
    storagePath,
    fileName: filename,
    uploadedAt: uploadedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    retentionDays: RETENTION_DAYS,
    originalBytes: file.size || 0,
    compressedBytes: compressed.size || 0,
    uploadedBy: auth.currentUser?.email || ""
  };

  await updateDoc(doc(db, "workshopJobs", job.id), {
    workshopPhotos: arrayUnion(photo)
  });
}

async function removePhoto(index) {
  if (uploading || removingPhoto) return;
  const job = currentJob();
  if (!job) return setMessage("Open a job card before removing a photo.", "error");
  if (!photosEditable(job)) return setMessage("Photos are locked after the Job Card is submitted for approval.", "error");

  const photos = photoList(job);
  const photo = photos[index];
  if (!photo) return setMessage("Photo could not be found.", "error");
  if (!window.confirm(`Remove Photo ${index + 1}? You can take another photo after removing it.`)) return;

  removingPhoto = true;
  renderPhotos();
  setMessage(`Removing Photo ${index + 1}...`);

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
    setMessage("Photo removed. You can take another photo now.", "success");
  } catch (error) {
    console.error("Workshop photo removal failed", error);
    setMessage(error?.message || "Unable to remove photo.", "error");
  } finally {
    removingPhoto = false;
    renderPhotos();
  }
}

async function handleFiles(files) {
  if (uploading || removingPhoto) return;
  const job = currentJob();
  if (!job) return setMessage("Open a job card before adding a photo.", "error");
  if (!photosEditable(job)) return setMessage("Photos are locked after the Job Card is submitted for approval.", "error");

  const remaining = Math.max(0, MAX_PHOTOS - photoList(job).length);
  const list = [...(files || [])].slice(0, remaining);
  if (!list.length) return setMessage(`Maximum ${MAX_PHOTOS} photos per job card.`, "error");

  uploading = true;
  renderPhotos();
  setMessage(`Compressing and uploading ${list.length === 1 ? "photo" : `${list.length} photos`}...`);

  try {
    for (const file of list) await uploadSelected(file);
    setMessage(list.length === 1 ? "Photo compressed and added to job card." : `${list.length} photos compressed and added to job card.`, "success");
  } catch (error) {
    console.error("Workshop photo upload failed", error);
    setMessage(error?.message || "Photo upload failed.", "error");
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
