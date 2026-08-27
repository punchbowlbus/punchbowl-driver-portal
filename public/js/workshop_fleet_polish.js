// Professional Fleet Register presentation: keep the front list clean and open vehicle details from the row.

function polishFleetList() {
  const table = document.querySelector('#fleetView table');
  const tbody = document.getElementById('fleetTableBody');
  if (!table || !tbody) return;

  table.classList.add('wf-clean-table');

  const headRow = table.querySelector('thead tr');
  if (headRow) {
    const cells = [...headRow.children];
    if (cells.length >= 8) cells[cells.length - 1].style.display = 'none';
  }

  [...tbody.querySelectorAll('tr')].forEach((row) => {
    const cells = [...row.children];
    if (!cells.length) return;

    // Hide the actions column on the fleet list. All actions remain inside the full bus record.
    if (cells.length >= 8) cells[cells.length - 1].style.display = 'none';

    if (row.dataset.wfPolished === '1') return;
    row.dataset.wfPolished = '1';
    row.classList.add('wf-clean-row');

    const firstCell = cells[0];
    if (firstCell) {
      const hint = document.createElement('span');
      hint.className = 'wf-row-open-hint';
      hint.textContent = 'Open record';
      firstCell.appendChild(hint);
    }
  });
}

function injectFleetPolishStyles() {
  if (document.getElementById('wfFleetPolishStyles')) return;
  const style = document.createElement('style');
  style.id = 'wfFleetPolishStyles';
  style.textContent = `
    #fleetView .table-panel {
      border-radius: 16px;
      overflow: hidden;
      border: 1px solid #dfe5ec;
      background: #fff;
    }

    #fleetView .wf-clean-table {
      min-width: 980px;
    }

    #fleetView .wf-clean-table thead th {
      background: #f7f9fc;
      color: #475467;
      font-size: 11px;
      letter-spacing: .06em;
      font-weight: 900;
      padding-top: 13px;
      padding-bottom: 13px;
      border-bottom: 1px solid #dfe5ec;
    }

    #fleetView .wf-clean-row {
      cursor: pointer;
      transition: background .15s ease, box-shadow .15s ease;
    }

    #fleetView .wf-clean-row:hover {
      background: #f8fbff !important;
      box-shadow: inset 3px 0 0 #c62828;
    }

    #fleetView .wf-clean-row td {
      padding-top: 15px;
      padding-bottom: 15px;
      vertical-align: middle;
    }

    #fleetView .wf-clean-row td:first-child {
      min-width: 110px;
      font-weight: 900;
    }

    #fleetView .wf-row-open-hint {
      display: block;
      margin-top: 4px;
      color: #667085;
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: .04em;
      text-decoration: none;
    }

    #fleetView .wf-clean-row:hover .wf-row-open-hint {
      color: #c62828;
    }

    #fleetView .wf-hint {
      margin: 4px 0 14px;
      padding: 9px 12px;
      background: #f8fafc;
      border: 1px solid #e4e7ec;
      border-radius: 10px;
      color: #667085;
      font-size: 12px;
    }

    #fleetView .wf-toolbar {
      gap: 10px;
    }

    #fleetView .wf-toolbar .button {
      min-height: 42px;
    }

    #fleetView .wf-toolbar .search-input {
      min-height: 42px;
    }
  `;
  document.head.appendChild(style);
}

injectFleetPolishStyles();

const observer = new MutationObserver(polishFleetList);
observer.observe(document.documentElement, { childList: true, subtree: true });

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', polishFleetList);
} else {
  polishFleetList();
}
