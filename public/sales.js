let allRows = [];
let sortKey = 'revenue';
let sortAsc = false;
let pendingDeleteCity = null;
let pendingDeleteTimer = null;
let undoStack = [];
const UNDO_LIMIT = 15; // { cityRow, index, historySnapshots } - for Ctrl+Z undo
let isFocusMode = false;
let focusProductName = '';

const tableBody = document.getElementById('cityTableBody');
const emptyState = document.getElementById('emptyState');
const uploadStatus = document.getElementById('uploadStatus');
const lastUpdated = document.getElementById('lastUpdated');

async function fetchCityPerformance() {
  focusProductName = window.getFocusProduct ? window.getFocusProduct() : '';
  isFocusMode = Boolean(focusProductName);

  if (isFocusMode) {
    const res = await fetch(`/api/product-sales?product=${encodeURIComponent(focusProductName)}`);
    const data = await res.json();
    allRows = (data.row && data.row.cities) || [];
    lastUpdated.textContent = data.date
      ? `Last updated: ${data.date} - showing "${focusProductName}" across cities`
      : `No sales data yet for "${focusProductName}"`;
    render();
    return;
  }

  const res = await fetch('/api/city-performance');
  const data = await res.json();
  allRows = data.cityRows || [];
  lastUpdated.textContent = data.date ? `Last updated: ${data.date}` : 'No report uploaded yet';
  render();
}

async function fetchSalesSummary() {
  if (isFocusMode) {
    const res = await fetch(`/api/product-sales?product=${encodeURIComponent(focusProductName)}`);
    const data = await res.json();
    const row = data.row;
    document.getElementById('kpiRevenue').textContent = row ? `\u20B9${row.revenue.toLocaleString('en-IN')}` : '-';
    document.getElementById('kpiUnits').textContent = row ? row.units : '-';
    document.getElementById('kpiOrders').textContent = row ? row.orderCount : '-';
    document.getElementById('kpiTopCity').textContent = row ? row.topCity || '-' : '-';
    return;
  }

  const res = await fetch('/api/sales-summary');
  const s = await res.json();
  document.getElementById('kpiRevenue').textContent = s.totalRevenue ? `\u20B9${s.totalRevenue.toLocaleString('en-IN')}` : '-';
  document.getElementById('kpiUnits').textContent = s.totalUnits ?? '-';
  document.getElementById('kpiOrders').textContent = s.totalOrders ?? '-';
  document.getElementById('kpiTopCity').textContent = s.topCity || '-';
}

function tierClass(tier) {
  if (tier === 'top') return 'row-top';
  if (tier === 'low') return 'row-low';
  return '';
}

function trendLabel(row) {
  if (row.revenueChangePct === null || row.revenueChangePct === undefined) {
    return '<span class="na">First upload</span>';
  }
  const pct = row.revenueChangePct;
  const cls = pct > 0 ? 'trend-up' : pct < 0 ? 'trend-down' : 'trend-flat';
  const arrow = pct > 0 ? '\u2191' : pct < 0 ? '\u2193' : '\u2192';
  return `<span class="${cls}">${arrow} ${Math.abs(pct)}%</span>`;
}

function render() {
  let rows = [...allRows];

  rows.sort((a, b) => {
    const va = a[sortKey];
    const vb = b[sortKey];
    if (va === vb) return 0;
    if (va === undefined || va === null) return 1;
    if (vb === undefined || vb === null) return -1;
    const result = typeof va === 'string' ? va.localeCompare(vb) : va - vb;
    return sortAsc ? result : -result;
  });

  emptyState.style.display = rows.length === 0 ? 'block' : 'none';
  emptyState.textContent = isFocusMode
    ? `No sales recorded for "${focusProductName}".`
    : 'No sales data yet. Upload sales_summary.xlsx to get started.';

  if (isFocusMode) {
    // Product focus: this is a derived per-city breakdown for one
    // product, not the underlying city-aggregate store, so most of the
    // city-table's columns (orders, avg order value, best-seller, trend)
    // don't apply here, and rows aren't individually deletable.
    tableBody.innerHTML = rows
      .map(
        (r, idx) => `
      <tr>
        <td>${idx + 1}</td>
        <td>${r.city}</td>
        <td>\u20B9${r.revenue.toLocaleString('en-IN')}</td>
        <td>${r.units}</td>
        <td><span class="na">n/a</span></td>
        <td><span class="na">n/a</span></td>
        <td><span class="na">n/a</span></td>
        <td><span class="na">Focused view</span></td>
        <td></td>
      </tr>`
      )
      .join('');
    return;
  }

  tableBody.innerHTML = rows
    .map(
      (r, idx) => `
    <tr class="${tierClass(r.tier)}">
      <td>${idx + 1}</td>
      <td>${r.city}</td>
      <td>\u20B9${r.revenue.toLocaleString('en-IN')}</td>
      <td>${r.units}</td>
      <td>${r.orderCount}</td>
      <td>\u20B9${r.avgOrderValue.toLocaleString('en-IN')}</td>
      <td>${r.topProduct ? r.topProduct : '<span class="na">No data</span>'}</td>
      <td>${trendLabel(r)}</td>
      <td>${deleteButtonHtml(r.city)}</td>
    </tr>`
    )
    .join('');
}

function deleteButtonHtml(city) {
  const escapedCity = city.replace(/"/g, '&quot;');
  if (pendingDeleteCity === city) {
    return `<button class="delete-btn confirming" data-city="${escapedCity}">Confirm?</button>`;
  }
  return `<button class="delete-btn" data-city="${escapedCity}" title="Delete this city">&#128465;&#65039;</button>`;
}

async function handleRowDelete(city, btn) {
  if (pendingDeleteCity !== city) {
    // First click: arm the confirm state, auto-revert after 3s.
    pendingDeleteCity = city;
    clearTimeout(pendingDeleteTimer);
    pendingDeleteTimer = setTimeout(() => {
      pendingDeleteCity = null;
      render();
    }, 3000);
    render();
    return;
  }

  // Second click within the window: actually delete.
  clearTimeout(pendingDeleteTimer);
  pendingDeleteCity = null;
  btn.disabled = true;
  btn.textContent = 'Deleting...';

  try {
    const res = await fetch(`/api/city-performance/${encodeURIComponent(city)}`, { method: 'DELETE' });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error || 'Delete failed');

    const index = allRows.findIndex((r) => r.city === city);
    allRows = allRows.filter((r) => r.city !== city);

    lastDeleted = {
      cityRow: result.removedRow,
      index: typeof result.index === 'number' ? result.index : index,
      historySnapshots: result.removedHistorySnapshots || [],
    };

    render();
    await fetchSalesSummary();
    uploadStatus.textContent = 'City deleted. Press Ctrl+Z to undo.';
    uploadStatus.className = 'upload-status success';
  } catch (err) {
    uploadStatus.textContent = err.message;
    uploadStatus.className = 'upload-status error';
    render();
  }
}

tableBody.addEventListener('click', (e) => {
  const btn = e.target.closest('.delete-btn');
  if (!btn) return;
  handleRowDelete(btn.dataset.city, btn);
});

// --- Undo (Ctrl+Z / Cmd+Z) ---------------------------------------------

async function undoLastDelete() {
  if (!lastDeleted || isFocusMode) return;
  const { cityRow, index, historySnapshots } = lastDeleted;
  lastDeleted = null;

  try {
    const res = await fetch('/api/city-performance/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cityRow, index, historySnapshots }),
    });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error || 'Undo failed');

    const clampedIndex = Math.max(0, Math.min(index, allRows.length));
    allRows.splice(clampedIndex, 0, cityRow);

    render();
    await fetchSalesSummary();
    uploadStatus.textContent = 'Restored.';
    uploadStatus.className = 'upload-status success';
  } catch (err) {
    uploadStatus.textContent = err.message;
    uploadStatus.className = 'upload-status error';
  }
}

document.addEventListener('keydown', (e) => {
  const isUndoCombo = (e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z';
  if (!isUndoCombo) return;
  const tag = e.target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable) return;
  e.preventDefault();
  undoLastDelete();
});

document.querySelectorAll('#cityTable th[data-key]').forEach((th) => {
  th.addEventListener('click', () => {
    const key = th.dataset.key;
    sortAsc = sortKey === key ? !sortAsc : false;
    sortKey = key;
    render();
  });
});

document.getElementById('fileInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  uploadStatus.textContent = 'Uploading...';
  uploadStatus.className = 'upload-status';

  const formData = new FormData();
  formData.append('report', file);

  try {
    const res = await fetch('/api/sales-upload', { method: 'POST', body: formData });
    const result = await res.json();

    if (!res.ok) throw new Error(result.error || 'Upload failed');

    uploadStatus.textContent = `Uploaded successfully - ${result.cityCount} cities, ${result.orderRowCount} order rows processed.`;
    uploadStatus.className = 'upload-status success';

    await fetchCityPerformance();
    await fetchSalesSummary();
  } catch (err) {
    uploadStatus.textContent = err.message;
    uploadStatus.className = 'upload-status error';
  } finally {
    e.target.value = '';
  }
});

document.getElementById('wipeAllBtn').addEventListener('click', async () => {
  const confirmed = confirm(
    'This permanently deletes the current sales upload AND all trend history. This cannot be undone. Continue?'
  );
  if (!confirmed) return;

  try {
    const res = await fetch('/api/sales-history', { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed to clear data.');

    allRows = [];
    pendingDeleteCity = null;
    lastDeleted = null;
    clearTimeout(pendingDeleteTimer);
    render();
    await fetchSalesSummary();
    lastUpdated.textContent = 'No report uploaded yet';
    uploadStatus.textContent = 'All sales data and history cleared.';
    uploadStatus.className = 'upload-status success';
  } catch (err) {
    uploadStatus.textContent = err.message;
    uploadStatus.className = 'upload-status error';
  }
});

fetchCityPerformance();
fetchSalesSummary();
