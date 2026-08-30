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
  getDownloadURL,
  ref,
  uploadBytes
} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-storage.js";
import { auth, db, storage } from "./firebase.js";

let jobs = [];
let uploading = false;

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

  const locked = ["Completed", "Closed"].includes(job.status);
  if (button) button.disabled = uploading || locked;
  if (input) input.disabled = uploading || locked;

  const photos = photoList(job);
  if (!photos.length) {
    wrap.innerHTML = `<div class="job-photo-empty">No photos added. Photos are optional and can be taken from the tablet camera when required.</div>`;
    return;
  }

  wrap.innerHTML = photos.map((photo, index) => `
    <a class="job-photo-card" href="${esc(photo.url)}" target="_blank" rel="noopener" title="Open photo ${index + 1}">
      <img src="${esc(photo.url)}" alt="Workshop job photo ${index + 1}" loading="lazy" />
      <span>Photo ${index + 1}</span>
    </a>`).join("");
}

function safeFileName(name) {
  return String(name || "photo.jpg")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .slice(-80);
}

async function uploadSelected(file) {
  const job = currentJob();
  if (!job) throw new Error("Open a job card before adding a photo.");
  if (!file?.type?.startsWith("image/")) throw new Error("Please choose an image file.");
  if (file.size > 10 * 1024 * 1024) throw new Error("Photo is too large. Maximum size is 10 MB.");
  if (photoList(job).length >= 12) throw new Error("Maximum 12 photos per job card.");

  const stamp = Date.now();
  const filename = safeFileName(file.name);
  const storagePath = `workshopJobs/${job.id}/photos/${stamp}_${filename}`;
  const storageRef = ref(storage, storagePath);

  const snapshot = await uploadBytes(storageRef, file, {
    contentType: file.type || "image/jpeg",
    customMetadata: {
      workshopJobId: job.id,
      jobNumber: String(job.jobNumber || job.id)
    }
  });
  const url = await getDownloadURL(snapshot.ref);

  const photo = {
    url,
    storagePath,
    fileName: filename,
    uploadedAt: new Date().toISOString(),
    uploadedBy: auth.currentUser?.email || ""
  };

  await updateDoc(doc(db, "workshopJobs", job.id), {
    workshopPhotos: arrayUnion(photo)
  });
}

async function handleFiles(files) {
  if (uploading) return;
  const list = [...(files || [])];
  if (!list.length) return;

  uploading = true;
  renderPhotos();
  setMessage(`Uploading ${list.length === 1 ? "photo" : `${list.length} photos`}...`);

  try {
    for (const file of list) await uploadSelected(file);
    setMessage(list.length === 1 ? "Photo added to job card." : `${list.length} photos added to job card.`, "success");
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
