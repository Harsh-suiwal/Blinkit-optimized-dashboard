let allRows = [];
let sortKey = 'revenue';
let sortAsc = false;
let pendingDeleteCity = null;
let pendingDeleteTimer = null;

const tableBody = document.getElementById('cityTableBody');
const emptyState = document.getElementById('emptyState');
const uploadStatus = document.getElementById('uploadStatus');
const lastUpdated = document.getElementById('lastUpdated');

async function fetchCityPerformance() {
  const res = await fetch('/api/city-performance');
  const data = await res.json();
  allRows = data.cityRows || [];
  lastUpdated.textContent = data.date ? `Last updated: ${data.date}` : 'No report uploaded yet';
  render();
}

async function fetchSalesSummary() {
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
    const result = typeof va === 'string' ? va.localeCompare(vb) : va - vb;
    return sortAsc ? result : -result;
  });

  emptyState.style.display = rows.length === 0 ? 'block' : 'none';

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

    allRows = allRows.filter((r) => r.city !== city);
    render();
    await fetchSalesSummary();
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
