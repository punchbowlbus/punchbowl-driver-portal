// public/js/modals.js

export function openLegModal(shiftId) {
  const from = prompt("From location:");
  if (!from) return;

  const to = prompt("To location:");
  if (!to) return;

  console.log("New leg for shift:", shiftId, from, to);

  // You can later connect this to Firestore addDoc
}