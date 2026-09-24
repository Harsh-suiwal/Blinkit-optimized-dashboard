
let allRows = [];
let sortKey = null;
let sortAsc = true;
let pendingDeleteKey = null;
let pendingDeleteTimer = null;
let undoStack = []; // array of { row, index } - for Ctrl+Z undo, capped at 15
const UNDO_LIMIT = 15;

const tableBody = document.getElementById('productTableBody');
const emptyState = document.getElementById('emptyState');
const uploadStatus = document.getElementById('uploadStatus');
const lastUpdated = document.getElementById('lastUpdated');

function rowKey(r) {
  return `${r.productName}::${r.warehouseName}`;
}

function getRowBrand(r) {
  if (r.brandName && typeof r.brandName === 'string' && r.brandName.trim()) {
    return r.brandName.trim();
  }
  if (!r.productName || typeof r.productName !== 'string') return '';
  const clean = r.productName.trim();
  if (clean.toLowerCase().includes('oicia')) return 'Oicia';
  if (clean.toLowerCase().includes('smarteez')) return 'Smarteez';
  const match = clean.match(/^([A-Za-z0-9&'-]+)/);
  if (!match) return '';
  let b = match[1];
  if (b.includes('_')) b = b.split('_')[0];
  if (b.includes('-')) b = b.split('-')[0];
  return b.charAt(0).toUpperCase() + b.slice(1).toLowerCase();
}

async function fetchProducts() {
  const res = await fetch('/api/products');
  const data = await res.json();
  allRows = data.rows || [];
  lastUpdated.textContent = data.date ? `Last updated: ${data.date}` : 'No report uploaded yet';

  // Group brands from currently displayed data and populate dropdown
  const displayedBrands = [...new Set(allRows.map((r) => getRowBrand(r)).filter(Boolean))].sort();
  if (window.populateBrandDropdown) {
    window.populateBrandDropdown(displayedBrands);
  }

  render();
}

async function fetchSummary() {
  const focusProduct = window.getFocusProduct ? window.getFocusProduct() : '';
  const focusBrand = window.getBrandFilter ? window.getBrandFilter() : '';

  if (focusProduct || focusBrand) {
    // Under product/brand focus, KPIs describe just that selection, computed
    // client-side from the (already-focused) rows.
    let rows = allRows;
    if (focusBrand) {
      rows = rows.filter((r) => getRowBrand(r).toLowerCase() === focusBrand.toLowerCase());
    }
    if (focusProduct) {
      rows = rows.filter((r) => r.productName === focusProduct);
    }

    const totalUnitsSold30 = rows.reduce((sum, r) => sum + r.unitsSold30, 0);
    const totalStock = rows.reduce((sum, r) => sum + r.totalStockAvailable, 0);
    const lowOrOutCount = rows.filter((r) => r.stockStatus !== 'ok').length;
    const uniqueProducts = new Set(rows.map(r => r.productName)).size;

    document.getElementById('kpiUnitsSold').textContent = totalUnitsSold30;
    document.getElementById('kpiStock').textContent = totalStock;
    document.getElementById('kpiProducts').textContent = uniqueProducts;
    document.getElementById('kpiLowStock').textContent = lowOrOutCount;
    return;
  }

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

function deleteButtonHtml(r) {
  const key = rowKey(r);
  if (pendingDeleteKey === key) {
    return `<button class="delete-btn confirming" data-key="${key}">Confirm?</button>`;
  }
  return `<button class="delete-btn" data-key="${key}" title="Delete this row">&#128465;&#65039;</button>`;
}

function render() {
  const query = document.getElementById('searchBox').value.trim().toLowerCase();
  const focusProduct = window.getFocusProduct ? window.getFocusProduct() : '';
  const focusBrand = window.getBrandFilter ? window.getBrandFilter() : '';

  let rows = allRows.filter(
    (r) =>
      r.productName.toLowerCase().includes(query) || r.warehouseName.toLowerCase().includes(query)
  );

  if (focusBrand) {
    rows = rows.filter((r) => getRowBrand(r).toLowerCase() === focusBrand.toLowerCase());
  }
  
  if (focusProduct) {
    rows = rows.filter((r) => r.productName === focusProduct);
  }

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
  if (rows.length === 0) {
    if (focusProduct && focusBrand) {
      emptyState.textContent = `No warehouse rows found for product "${focusProduct}" and brand "${focusBrand}".`;
    } else if (focusProduct) {
      emptyState.textContent = `No warehouse rows found for product "${focusProduct}".`;
    } else if (focusBrand) {
      emptyState.textContent = `No warehouse rows found for brand "${focusBrand}".`;
    } else {
      emptyState.textContent = 'No data yet. Upload a report to get started.';
    }
  }

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
      <td>${deleteButtonHtml(r)}</td>
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

// --- Delete (with a "click again to confirm" pattern) -----------------

async function handleRowDelete(row, btn) {
  const key = rowKey(row);

  if (pendingDeleteKey !== key) {
    pendingDeleteKey = key;
    clearTimeout(pendingDeleteTimer);
    pendingDeleteTimer = setTimeout(() => {
      pendingDeleteKey = null;
      render();
    }, 3000);
    render();
    return;
  }

  clearTimeout(pendingDeleteTimer);
  pendingDeleteKey = null;
  btn.disabled = true;
  btn.textContent = 'Deleting...';

  try {
    const url = `/api/products?productName=${encodeURIComponent(row.productName)}&warehouseName=${encodeURIComponent(row.warehouseName)}`;
    const res = await fetch(url, { method: 'DELETE' });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error || 'Delete failed');

    const index = allRows.findIndex((r) => rowKey(r) === key);
    if (index !== -1) allRows.splice(index, 1);

    undoStack.push({ row: result.removedRow || row, index: typeof result.index === 'number' ? result.index : index });
    if (undoStack.length > UNDO_LIMIT) undoStack.shift();

    render();
    await fetchSummary();
    uploadStatus.textContent = 'Row deleted. Press Ctrl+Z to undo.';
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
  const key = btn.dataset.key;
  const row = allRows.find((r) => rowKey(r) === key) || (undoStack.find(u => rowKey(u.row) === key)?.row || null);
  if (row) handleRowDelete(row, btn);
});

// --- Undo (Ctrl+Z / Cmd+Z) ---------------------------------------------

async function undoLastDelete() {
  if (undoStack.length === 0) return;
  const { row, index } = undoStack.pop();

  try {
    const res = await fetch('/api/products/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ row, index }),
    });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error || 'Undo failed');

    const clampedIndex = Math.max(0, Math.min(index, allRows.length));
    allRows.splice(clampedIndex, 0, row);

    render();
    await fetchSummary();
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
