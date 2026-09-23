let allRows = [];
let sortKey = null;
let sortAsc = true;

const tableBody = document.getElementById('productTableBody');
const emptyState = document.getElementById('emptyState');
const uploadStatus = document.getElementById('uploadStatus');
const lastUpdated = document.getElementById('lastUpdated');

async function fetchProducts() {
  const res = await fetch('/api/products');
  const data = await res.json();
  allRows = data.rows || [];
  lastUpdated.textContent = data.date ? `Last updated: ${data.date}` : 'No report uploaded yet';
  render();
}

async function fetchSummary() {
  const res = await fetch('/api/summary');
  const s = await res.json();
  document.getElementById('kpiUnitsSold').textContent = s.totalUnitsSold30 ?? '-';
  document.getElementById('kpiStock').textContent = s.totalStock ?? '-';
  document.getElementById('kpiProducts').textContent = s.productCount ?? '-';
  document.getElementById('kpiLowStock').textContent = s.lowOrOutCount ?? '-';
}

function statusPill(status) {
  const map = { ok: ['OK', 'status-ok'], low: ['Low', 'status-low'], out: ['Out', 'status-out'] };
  const [label, cls] = map[status] || ['-', ''];
  return `<span class="status-pill ${cls}">${label}</span>`;
}

function fmt(val) {
  return val === null || val === undefined ? '<span class="na">n/a</span>' : val;
}

function render() {
  const query = document.getElementById('searchBox').value.trim().toLowerCase();

  let rows = allRows.filter(
    (r) =>
      r.productName.toLowerCase().includes(query) || r.warehouseName.toLowerCase().includes(query)
  );

  if (sortKey) {
    rows = [...rows].sort((a, b) => {
      const va = a[sortKey];
      const vb = b[sortKey];
      if (va === vb) return 0;
      if (va === null) return 1;
      if (vb === null) return -1;
      const result = typeof va === 'string' ? va.localeCompare(vb) : va - vb;
      return sortAsc ? result : -result;
    });
  }

  emptyState.style.display = rows.length === 0 ? 'block' : 'none';

  tableBody.innerHTML = rows
    .map(
      (r) => `
    <tr>
      <td>${r.productName}</td>
      <td>${r.warehouseName}</td>
      <td>${r.totalStockAvailable}</td>
      <td>${r.unitsSold7}</td>
      <td>${r.unitsSold15}</td>
      <td>${r.unitsSold30}</td>
      <td>${fmt(r.unitsSold45)}</td>
      <td>${fmt(r.unitsSold60)}</td>
      <td>${r.incomingInventory}</td>
      <td>${statusPill(r.stockStatus)}</td>
    </tr>`
    )
    .join('');
}

document.getElementById('searchBox').addEventListener('input', render);

document.querySelectorAll('#productTable th[data-key]').forEach((th) => {
  th.addEventListener('click', () => {
    const key = th.dataset.key;
    sortAsc = sortKey === key ? !sortAsc : true;
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
    const res = await fetch('/api/upload', { method: 'POST', body: formData });
    const result = await res.json();

    if (!res.ok) throw new Error(result.error || 'Upload failed');

    uploadStatus.textContent = `Uploaded successfully - ${result.rowCount} rows processed.`;
    uploadStatus.className = 'upload-status success';

    await fetchProducts();
    await fetchSummary();
  } catch (err) {
    uploadStatus.textContent = err.message;
    uploadStatus.className = 'upload-status error';
  } finally {
    e.target.value = '';
  }
});

document.getElementById('exportBtn').addEventListener('click', () => {
  window.location.href = '/api/export';
});

document.getElementById('exportAllBtn').addEventListener('click', () => {
  window.location.href = '/api/export-all';
});

fetchProducts();
fetchSummary();
