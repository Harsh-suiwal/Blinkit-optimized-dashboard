
let allRows = [];
let periods = [];
let selectedPeriodKey = null;
let sortKey = 'roas';
let sortAsc = false;
let pendingDeleteKey = null;
let pendingDeleteTimer = null;
let undoStack = []; // array of { periodKey, storeIndex, campaign } - for Ctrl+Z undo
const UNDO_LIMIT = 15;

const tableBody = document.getElementById('campaignTableBody');
const emptyState = document.getElementById('emptyState');
const uploadStatus = document.getElementById('uploadStatus');
const lastUpdated = document.getElementById('lastUpdated');
const periodSelect = document.getElementById('periodSelect');

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function fmtNumber(value, digits = 0) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '<span class="na">n/a</span>';
  return Number(value).toLocaleString('en-IN', { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

function fmtMoney(value) {
  if (value === null || value === undefined) return '<span class="na">n/a</span>';
  return `₹${Number(value).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

function fmtPct(value) {
  if (value === null || value === undefined) return '<span class="na">n/a</span>';
  return `${Number(value).toLocaleString('en-IN', { maximumFractionDigits: 1 })}%`;
}

function fmtRoas(value) {
  if (value === null || value === undefined) return '<span class="na">n/a</span>';
  return `${Number(value).toLocaleString('en-IN', { maximumFractionDigits: 2 })}x`;
}

function tierClass(tier) {
  if (tier === 'top') return 'row-top';
  if (tier === 'low') return 'row-low';
  return '';
}

function populatePeriods() {
  periodSelect.innerHTML = periods.map((p) =>
    `<option value="${escapeHtml(p.periodKey)}">${escapeHtml(p.periodLabel)}</option>`
  ).join('');
  if (selectedPeriodKey && periods.some((p) => p.periodKey === selectedPeriodKey)) {
    periodSelect.value = selectedPeriodKey;
  } else if (periods.length) {
    selectedPeriodKey = periods[periods.length - 1].periodKey;
    periodSelect.value = selectedPeriodKey;
  }
}

function getCampaignBrand(r) {
  if (r.brandName && typeof r.brandName === 'string' && r.brandName.trim()) {
    return r.brandName.trim();
  }
  const name = r.campaignName || '';
  if (!name || typeof name !== 'string') return '';
  const clean = name.trim();
  if (clean.toLowerCase().includes('oicia')) return 'Oicia';
  if (clean.toLowerCase().includes('smarteez')) return 'Smarteez';
  const match = clean.match(/^([A-Za-z0-9&'-]+)/);
  if (!match) return '';
  let b = match[1];
  if (b.includes('_')) b = b.split('_')[0];
  if (b.includes('-')) b = b.split('-')[0];
  return b.charAt(0).toUpperCase() + b.slice(1).toLowerCase();
}

async function fetchCampaignData(periodKey = null) {
  const url = periodKey ? `/api/campaign-analysis?periodKey=${encodeURIComponent(periodKey)}` : '/api/campaign-analysis';
  const res = await fetch(url);
  if (!res.ok) throw new Error('Could not load campaign data.');
  const data = await res.json();
  periods = data.periods || [];
  selectedPeriodKey = data.periodKey || data.latestPeriodKey || null;
  allRows = data.rows || [];
  lastUpdated.textContent = data.date ? `Last updated: ${data.date}` : 'No campaign report uploaded yet';
  populatePeriods();

  // Group brands from currently displayed campaigns and populate dropdown
  const displayedBrands = [...new Set(allRows.map((r) => getCampaignBrand(r)).filter(Boolean))].sort();
  if (displayedBrands.length > 0 && window.populateBrandDropdown) {
    window.populateBrandDropdown(displayedBrands);
  }

  render();
  await fetchSummary();
}

async function fetchSummary() {
  const focusProduct = window.getFocusProduct ? window.getFocusProduct() : '';
  const focusBrand = window.getBrandFilter ? window.getBrandFilter() : '';

  if (!selectedPeriodKey) {
    document.getElementById('kpiAdSpend').textContent = '-';
    document.getElementById('kpiSales').textContent = '-';
    document.getElementById('kpiRoas').textContent = '-';
    document.getElementById('kpiRoi').textContent = '-';
    document.getElementById('kpiUnits').textContent = '-';
    document.getElementById('kpiActive').textContent = '-';
    document.getElementById('bestCampaign').textContent = '-';
    document.getElementById('bestCampaignMetric').innerHTML = '-';
    document.getElementById('worstCampaign').textContent = '-';
    document.getElementById('worstCampaignMetric').innerHTML = '-';
    return;
  }

  // If focus is active, we compute summary locally from allRows.
  // We need to apply the same filter used in render() first.
  if (focusProduct || focusBrand) {
    let filteredRows = allRows;
    
    if (focusBrand) {
      const needle = focusBrand.toLowerCase();
      const matched = filteredRows.filter(
        (r) =>
          getCampaignBrand(r).toLowerCase() === needle ||
          String(r.campaignName).toLowerCase().includes(needle) ||
          String(r.campaignDetail).toLowerCase().includes(needle)
      );
      if (matched.length > 0) filteredRows = matched;
    }
    
    if (focusProduct) {
      const needle = focusProduct.toLowerCase();
      const matched = filteredRows.filter(
        (r) => String(r.campaignName).toLowerCase().includes(needle) || String(r.campaignDetail).toLowerCase().includes(needle)
      );
      if (matched.length > 0) filteredRows = matched;
    }

    const totalAdSpend = filteredRows.reduce((s, c) => s + c.adSpend, 0);
    const totalSales = filteredRows.reduce((s, c) => s + c.sales, 0);
    const totalUnits = filteredRows.reduce((s, c) => s + c.qtySold, 0);
    const totalImpressions = filteredRows.reduce((s, c) => s + c.impressions, 0);
    const totalAtc = filteredRows.reduce((s, c) => s + c.atc, 0);
    const activeCampaigns = filteredRows.filter((c) => c.status.toLowerCase() === 'active').length;
    
    const overallRoas = totalAdSpend > 0 ? Math.round((totalSales / totalAdSpend) * 100) / 100 : null;
    const roiPct = totalAdSpend > 0 ? Math.round(((totalSales - totalAdSpend) / totalAdSpend) * 1000) / 10 : null;

    const ranked = filteredRows.filter((c) => c.adSpend > 0 && c.roas !== null);
    const best = ranked.length ? ranked.reduce((a, b) => (b.roas > a.roas ? b : a)) : null;
    const worst = ranked.length ? ranked.reduce((a, b) => (b.roas < a.roas ? b : a)) : null;

    document.getElementById('kpiAdSpend').innerHTML = fmtMoney(totalAdSpend);
    document.getElementById('kpiSales').innerHTML = fmtMoney(totalSales);
    document.getElementById('kpiRoas').innerHTML = fmtRoas(overallRoas);
    document.getElementById('kpiRoi').innerHTML = fmtPct(roiPct);
    document.getElementById('kpiUnits').innerHTML = fmtNumber(totalUnits, 2);
    document.getElementById('kpiActive').textContent = `${activeCampaigns}/${filteredRows.length}`;

    document.getElementById('bestCampaign').textContent = best ? best.campaignName : '-';
    document.getElementById('bestCampaignMetric').innerHTML = best ? `ROAS ${fmtRoas(best.roas)}` : '-';
    document.getElementById('worstCampaign').textContent = worst ? worst.campaignName : '-';
    document.getElementById('worstCampaignMetric').innerHTML = worst ? `ROAS ${fmtRoas(worst.roas)}` : '-';

    document.getElementById('funnelImpressions').textContent = fmtNumber(totalImpressions);
    document.getElementById('funnelAtc').textContent = fmtNumber(totalAtc);
    document.getElementById('funnelUnits').textContent = fmtNumber(totalUnits, 2);
    return;
  }

  const res = await fetch(`/api/campaign-summary?periodKey=${encodeURIComponent(selectedPeriodKey)}`);
  if (!res.ok) throw new Error('Could not load campaign summary.');
  const s = await res.json();

  document.getElementById('kpiAdSpend').innerHTML = fmtMoney(s.totalAdSpend);
  document.getElementById('kpiSales').innerHTML = fmtMoney(s.totalSales);
  document.getElementById('kpiRoas').innerHTML = fmtRoas(s.overallRoas);
  document.getElementById('kpiRoi').innerHTML = fmtPct(s.roiPct);
  document.getElementById('kpiUnits').innerHTML = fmtNumber(s.totalUnits, 2);
  document.getElementById('kpiActive').textContent = `${s.activeCampaigns}/${s.totalCampaigns}`;

  document.getElementById('bestCampaign').textContent = s.bestCampaign?.name || '-';
  document.getElementById('bestCampaignMetric').innerHTML = s.bestCampaign ? `ROAS ${fmtRoas(s.bestCampaign.roas)}` : '-';
  document.getElementById('worstCampaign').textContent = s.worstCampaign?.name || '-';
  document.getElementById('worstCampaignMetric').innerHTML = s.worstCampaign ? `ROAS ${fmtRoas(s.worstCampaign.roas)}` : '-';

  document.getElementById('funnelImpressions').textContent = fmtNumber(s.totalImpressions);
  document.getElementById('funnelAtc').textContent = fmtNumber(s.totalAtc);
  document.getElementById('funnelUnits').textContent = fmtNumber(s.totalUnits, 2);
}

function compare(a, b, key) {
  const va = a[key];
  const vb = b[key];
  if (va === vb) return 0;
  if (va === null || va === undefined) return 1;
  if (vb === null || vb === undefined) return -1;
  return typeof va === 'string' ? va.localeCompare(vb) : va - vb;
}

function deleteKeyFor(r) {
  return `${selectedPeriodKey}::${r.storeIndex}`;
}

function deleteButtonHtml(r) {
  const key = deleteKeyFor(r);
  if (pendingDeleteKey === key) {
    return `<button class="delete-btn confirming" data-store-index="${r.storeIndex}">Confirm?</button>`;
  }
  return `<button class="delete-btn" data-store-index="${r.storeIndex}" title="Delete this campaign">&#128465;&#65039;</button>`;
}

function render() {
  const query = document.getElementById('searchBox').value.trim().toLowerCase();
  const focusProduct = window.getFocusProduct ? window.getFocusProduct() : '';
  const focusBrand = window.getBrandFilter ? window.getBrandFilter() : '';

  let rows = allRows.filter((r) =>
    String(r.campaignName).toLowerCase().includes(query) ||
    String(r.campaignDetail).toLowerCase().includes(query) ||
    String(r.status).toLowerCase().includes(query)
  );

  let focusMatchedNone = false;
  
  if (focusBrand) {
    const needle = focusBrand.toLowerCase();
    const matched = rows.filter(
      (r) =>
        getCampaignBrand(r).toLowerCase() === needle ||
        String(r.campaignName).toLowerCase().includes(needle) ||
        String(r.campaignDetail).toLowerCase().includes(needle)
    );
    if (matched.length > 0) {
      rows = matched;
    } else {
      focusMatchedNone = rows.length > 0;
    }
  }

  if (focusProduct) {
    const needle = focusProduct.toLowerCase();
    const matched = rows.filter(
      (r) => String(r.campaignName).toLowerCase().includes(needle) || String(r.campaignDetail).toLowerCase().includes(needle)
    );
    if (matched.length > 0) {
      rows = matched;
    } else {
      focusMatchedNone = rows.length > 0;
    }
  }

  rows.sort((a, b) => {
    const result = compare(a, b, sortKey);
    return sortAsc ? result : -result;
  });

  emptyState.style.display = rows.length === 0 ? 'block' : 'none';

  let note = '';
  if (focusProduct && focusBrand) {
    note = focusMatchedNone
      ? `<tr><td colspan="13" class="muted" style="white-space:normal;">No campaign explicitly mentions brand "${escapeHtml(focusBrand)}" and product "${escapeHtml(focusProduct)}" - showing fallback campaigns for this period.</td></tr>`
      : `<tr><td colspan="13" class="muted" style="white-space:normal;">Showing campaigns matching brand "${escapeHtml(focusBrand)}" and product "${escapeHtml(focusProduct)}".</td></tr>`;
  } else if (focusProduct) {
    note = focusMatchedNone
      ? `<tr><td colspan="13" class="muted" style="white-space:normal;">No campaign explicitly mentions "${escapeHtml(focusProduct)}" - showing all campaigns for this period instead.</td></tr>`
      : `<tr><td colspan="13" class="muted" style="white-space:normal;">Showing campaigns matching "${escapeHtml(focusProduct)}".</td></tr>`;
  } else if (focusBrand) {
    note = focusMatchedNone
      ? `<tr><td colspan="13" class="muted" style="white-space:normal;">No campaign explicitly mentions "${escapeHtml(focusBrand)}" - showing all campaigns for this period instead.</td></tr>`
      : `<tr><td colspan="13" class="muted" style="white-space:normal;">Showing campaigns matching "${escapeHtml(focusBrand)}".</td></tr>`;
  }

  tableBody.innerHTML = note + rows.map((r, idx) => `
    <tr class="${tierClass(r.tier)}">
      <td>${idx + 1}</td>
      <td title="${escapeHtml(r.campaignName)}">${escapeHtml(r.campaignName)}</td>
      <td>${escapeHtml(r.campaignDetail)}</td>
      <td><span class="status-pill ${String(r.status).toLowerCase() === 'active' ? 'status-ok' : 'status-low'}">${escapeHtml(r.status)}</span></td>
      <td>${fmtMoney(r.adSpend)}</td>
      <td>${fmtMoney(r.sales)}</td>
      <td>${fmtRoas(r.roas)}</td>
      <td>${fmtPct(r.roiPct)}</td>
      <td>${fmtMoney(r.rosPerUnit)}</td>
      <td>${fmtNumber(r.impressions)}</td>
      <td>${fmtNumber(r.atc)}</td>
      <td>${fmtNumber(r.qtySold, 2)}</td>
      <td>${deleteButtonHtml(r)}</td>
    </tr>
  `).join('');
}

document.getElementById('searchBox').addEventListener('input', render);

periodSelect.addEventListener('change', async (e) => {
  try {
    selectedPeriodKey = e.target.value;
    await fetchCampaignData(selectedPeriodKey);
  } catch (err) {
    uploadStatus.textContent = err.message;
    uploadStatus.className = 'upload-status error';
  }
});

document.querySelectorAll('#campaignTable th[data-key]').forEach((th) => {
  th.addEventListener('click', () => {
    const key = th.dataset.key;
    sortAsc = sortKey === key ? !sortAsc : false;
    sortKey = key;
    render();
  });
});

// --- Delete (with a "click again to confirm" pattern) -----------------

async function handleRowDelete(row, btn) {
  const key = deleteKeyFor(row);

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
    const res = await fetch('/api/campaign-analysis', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ periodKey: selectedPeriodKey, storeIndex: row.storeIndex }),
    });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error || 'Delete failed');

    allRows = allRows.filter((r) => r.storeIndex !== row.storeIndex);
    undoStack.push({ periodKey: selectedPeriodKey, storeIndex: row.storeIndex, campaign: result.removed || row });
    if (undoStack.length > UNDO_LIMIT) undoStack.shift();

    render();
    await fetchSummary();
    uploadStatus.textContent = 'Campaign deleted. Press Ctrl+Z to undo.';
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
  const storeIndex = Number(btn.dataset.storeIndex);
  const row =
    allRows.find((r) => r.storeIndex === storeIndex) ||
    (undoStack.find(u => u.storeIndex === storeIndex) ? { ...undoStack.find(u => u.storeIndex === storeIndex).campaign, storeIndex } : null);
  if (row) handleRowDelete(row, btn);
});

// --- Undo (Ctrl+Z / Cmd+Z) ---------------------------------------------

async function undoLastDelete() {
  if (undoStack.length === 0 || undoStack[undoStack.length - 1].periodKey !== selectedPeriodKey) return;
  const { periodKey, storeIndex, campaign } = undoStack.pop();

  try {
    const res = await fetch('/api/campaign-analysis/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ periodKey, storeIndex, campaign }),
    });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error || 'Undo failed');

    // Re-fetch rather than splice locally: restoring shifts every later
    // campaign's storeIndex in that period, so a full reload keeps
    // storeIndex values (which the delete/undo buttons rely on) correct.
    await fetchCampaignData(periodKey);
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
    const res = await fetch('/api/campaign-upload', { method: 'POST', body: formData });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error || 'Upload failed');

    uploadStatus.textContent = `Uploaded successfully - ${result.periodCount} periods, ${result.campaignCount} campaigns in latest period.`;
    uploadStatus.className = 'upload-status success';
    await fetchCampaignData(result.latestPeriodKey);
  } catch (err) {
    uploadStatus.textContent = err.message;
    uploadStatus.className = 'upload-status error';
  } finally {
    e.target.value = '';
  }
});

document.getElementById('campaignExportBtn').addEventListener('click', () => {
  if (!selectedPeriodKey) {
    uploadStatus.textContent = 'Upload a campaign report first.';
    uploadStatus.className = 'upload-status error';
    return;
  }
  window.location.href = `/api/export-campaign?periodKey=${encodeURIComponent(selectedPeriodKey)}`;
});

(async function init() {
  try {
    await fetchCampaignData();
  } catch (err) {
    uploadStatus.textContent = err.message;
    uploadStatus.className = 'upload-status error';
  }
})();
