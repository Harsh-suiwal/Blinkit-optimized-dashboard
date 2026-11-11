// What is uploaded for each brand (the admin Uploads panel). Pure: server.js passes in the stored
// upload details, so this file never reads storage itself.
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];

const brandKey = (brand) => String(brand || 'Unknown').trim().toLowerCase();
const monthLabel = (monthKey) => `${MONTH_NAMES[Number(monthKey.slice(5, 7)) - 1]} ${monthKey.slice(0, 4)}`;
const newer = (a, b) => (b >= a ? b : a);

/**
 * @param {object} input
 * @param {Record<string, {date, fileName}>} input.stockUploads   latest.brandUploads
 * @param {Record<string, {date, fileName, from, to}>} input.salesUploads   salesLatest.brandUploads
 * @param {object[]} input.monthlySlots   salesMonthly slots (any brand, any platform)
 * @param {object[]} input.campaignUploads   campaignData.uploads
 * @param {{periodKey: string, periodLabel: string}[]} input.campaignPeriods
 * @param {{brandName, fileName, uploadedAt, productCount}[]} input.costs   one entry per brand with a cost sheet
 * @param {object[]} input.undo   uploads that can be undone (uploadUndo.listUndo)
 */
function buildUploadsOverview(input) {
  const rows = new Map();
  const rowFor = (name) => {
    const key = brandKey(name);
    if (!rows.has(key)) {
      rows.set(key, { brand: String(name || 'Unknown').trim() || 'Unknown', stock: null, sales: null, monthly: null, advertising: null, costs: null });
    }
    return rows.get(key);
  };

  for (const [name, u] of Object.entries(input.stockUploads || {})) {
    rowFor(name).stock = { fileName: u.fileName || '', date: u.date || '' };
  }
  for (const [name, u] of Object.entries(input.salesUploads || {})) {
    rowFor(name).sales = { fileName: u.fileName || '', date: u.date || '', from: u.from || null, to: u.to || null };
  }

  const slotsByBrand = new Map();
  for (const slot of input.monthlySlots || []) {
    const key = brandKey(slot.brandName);
    if (!slotsByBrand.has(key)) slotsByBrand.set(key, { name: slot.brandName, slots: [] });
    slotsByBrand.get(key).slots.push(slot);
  }
  for (const { name, slots } of slotsByBrand.values()) {
    const months = Array.from(new Set(slots.map((s) => s.monthKey))).sort();
    const latest = slots.reduce((a, b) => (newer(a.uploadedAt || '', b.uploadedAt || '') === (b.uploadedAt || '') ? b : a));
    rowFor(name).monthly = {
      months: months.length,
      first: monthLabel(months[0]),
      last: monthLabel(months[months.length - 1]),
      fileName: latest.fileName || '',
      date: latest.uploadedAt || '',
    };
  }

  const periodLabels = new Map((input.campaignPeriods || []).map((p) => [p.periodKey, p.periodLabel]));
  const adsByBrand = new Map();
  for (const upload of input.campaignUploads || []) {
    if (!upload.brandName) continue;
    const key = brandKey(upload.brandName);
    if (!adsByBrand.has(key)) adsByBrand.set(key, { name: upload.brandName, uploads: [] });
    adsByBrand.get(key).uploads.push(upload);
  }
  for (const { name, uploads } of adsByBrand.values()) {
    const periodKeys = Array.from(new Set(uploads.map((u) => u.periodKey))).sort();
    const latest = uploads.reduce((a, b) => ((b.uploadedDate || '') >= (a.uploadedDate || '') ? b : a));
    rowFor(name).advertising = {
      periods: periodKeys.map((key) => periodLabels.get(key) || key),
      fileName: latest.fileName || '',
      date: latest.uploadedDate || '',
    };
  }

  for (const entry of input.costs || []) {
    if (!entry.productCount) continue;
    rowFor(entry.brandName).costs = { fileName: entry.fileName || '', date: entry.uploadedAt || '', productCount: entry.productCount };
  }

  return {
    brands: Array.from(rows.values()).sort((a, b) => a.brand.localeCompare(b.brand)),
    undo: input.undo || [],
  };
}

module.exports = { buildUploadsOverview };
