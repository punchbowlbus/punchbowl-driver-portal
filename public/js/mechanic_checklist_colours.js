function applyChecklistColour(select) {
  if (!select?.matches?.('#jobChecklist select[data-check-key]')) return;
  select.classList.remove('check-result-select','check-result-pass','check-result-attention','check-result-na');
  const value = String(select.value || '').trim();
  if (value === 'Pass') select.classList.add('check-result-pass');
  else if (value === 'Attention') select.classList.add('check-result-attention');
  else if (value === 'N/A') select.classList.add('check-result-na');
  else select.classList.add('check-result-select');
}

function applyAllChecklistColours() {
  document.querySelectorAll('#jobChecklist select[data-check-key]').forEach(applyChecklistColour);
}

document.addEventListener('change', (event) => {
  const select = event.target.closest?.('#jobChecklist select[data-check-key]');
  if (select) applyChecklistColour(select);
});

document.addEventListener('click', () => setTimeout(applyAllChecklistColours, 40), true);
setTimeout(applyAllChecklistColours, 150);
