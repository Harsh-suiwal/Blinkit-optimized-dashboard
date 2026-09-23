let allRows = [];
let periods = [];
let selectedPeriodKey = null;
let sortKey = 'roas';
let sortAsc = false;

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
  render();
  await fetchSummary();
}

async function fetchSummary() {
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

function render() {
  const query = document.getElementById('searchBox').value.trim().toLowerCase();
  let rows = allRows.filter((r) =>
    String(r.campaignName).toLowerCase().includes(query) ||
    String(r.campaignDetail).toLowerCase().includes(query) ||
    String(r.status).toLowerCase().includes(query)
  );

  rows.sort((a, b) => {
    const result = compare(a, b, sortKey);
    return sortAsc ? result : -result;
  });

  emptyState.style.display = rows.length === 0 ? 'block' : 'none';
  tableBody.innerHTML = rows.map((r, idx) => `
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
