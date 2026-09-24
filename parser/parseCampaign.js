const XLSX = require('xlsx');

const MONTH_NAMES = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];

function toNumber(value) {
  if (value === undefined || value === null || value === '') return 0;
  if (typeof value === 'number') return value;
  const cleaned = String(value).replace(/,/g, '').trim();
  if (cleaned === '' || cleaned === '-' || cleaned === '--') return 0;
  const n = Number(cleaned);
  return Number.isNaN(n) ? 0 : n;
}

/**
 * Turns a period label like "1st June - 30th June 2026" into a sortable
 * key like "2026-06", using the first month name found plus the year.
 */
function derivePeriodKey(periodLabel) {
  const lower = String(periodLabel).toLowerCase();
  const yearMatch = lower.match(/(\d{4})/);
  const year = yearMatch ? yearMatch[1] : 'unknown';
  const monthIdx = MONTH_NAMES.findIndex((m) => lower.includes(m));
  const month = monthIdx >= 0 ? String(monthIdx + 1).padStart(2, '0') : '00';
  return `${year}-${month}`;
}

/**
 * Parses the Oicia Campaign Sheet. The file stacks one "period block" per
 * month vertically down column A. Inside each block, campaigns run across
 * COLUMNS (not rows) under a "Campaign Performance" header, with each
 * metric (Budget Spent, Impressions, ATC, Qty Sold, Sales, ROAS) as its
 * own row underneath.
 */
function parseCampaignSheet(filePath) {
  const workbook = XLSX.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '' });

  // A new period block starts on any row where column A is non-empty.
  const blockStarts = [];
  rows.forEach((row, idx) => {
    if (String(row[0]).trim() !== '') blockStarts.push(idx);
  });

  if (blockStarts.length === 0) {
    throw new Error("Couldn't find any period blocks - is this the Oicia Campaign Sheet?");
  }

  const periods = [];

  blockStarts.forEach((startIdx, i) => {
    const endIdx = i + 1 < blockStarts.length ? blockStarts[i + 1] : rows.length;
    const block = rows.slice(startIdx, endIdx);

    const periodLabel = String(block[0][0]).trim();
    const periodKey = derivePeriodKey(periodLabel);

    const nameRowIdx = block.findIndex((r) => String(r[1]).trim() === 'Campaign Performance');
    if (nameRowIdx === -1) return; // no campaign table in this block, skip rather than fail the whole upload

    const nameRow = block[nameRowIdx];
    const campaignCols = [];
    for (let c = 3; c < nameRow.length; c++) {
      if (String(nameRow[c]).trim() !== '') campaignCols.push(c);
    }

    const findRow = (label) =>
      block.find((row, idx) => idx > nameRowIdx && String(row[2]).trim().toLowerCase() === label) || [];

    const detailRow = findRow('campaign detail');
    const durationRow = findRow('duration');
    const statusRow = findRow('status');
    const spendRow = findRow('budget spent');
    const impressionsRow = findRow('impressions');
    const atcRow = findRow('atc');
    const salesRow = findRow('sales');
    const roasRow = findRow('roas');
    // "Qty Sold" appears as both "Qty Sold" and "Qty. Sold" across blocks
    const qtyRow =
      block.find(
        (row, idx) => idx > nameRowIdx && String(row[2]).trim().toLowerCase().replace(/\./g, '') === 'qty sold'
      ) || [];

    const campaigns = campaignCols.map((c) => {
      const adSpend = toNumber(spendRow[c]);
      const sales = toNumber(salesRow[c]);
      const qtySold = toNumber(qtyRow[c]);
      const roas = roasRow[c] === '' || roasRow[c] === undefined ? null : toNumber(roasRow[c]);

      return {
        periodKey,
        periodLabel,
        campaignName: String(nameRow[c] || '').trim(),
        campaignDetail: String(detailRow[c] || '').trim(),
        duration: String(durationRow[c] || '').trim(),
        status: String(statusRow[c] || '').trim(),
        adSpend,
        impressions: toNumber(impressionsRow[c]),
        atc: toNumber(atcRow[c]),
        qtySold,
        sales,
        roas,
        // ROI% and ROS/unit aren't given directly - derived from spend/sales/units
        roiPct: adSpend > 0 ? Math.round(((sales - adSpend) / adSpend) * 1000) / 10 : null,
        rosPerUnit: qtySold > 0 ? Math.round((sales / qtySold) * 100) / 100 : null,
      };
    });

    periods.push({ periodKey, periodLabel, campaigns });
  });

  return periods;
}

/**
 * Ranks campaigns by ROAS within a period and tags each as 'top' (top 25%),
 * 'low' (bottom 25%) or 'mid'. Campaigns with no spend (and so no real ROAS)
 * are left out of the ranking entirely rather than skewing it.
 */
function assignPerformanceTiers(campaigns) {
  const ranked = campaigns.filter((c) => c.adSpend > 0 && c.roas !== null);
  const sorted = [...ranked].sort((a, b) => b.roas - a.roas);
  const n = sorted.length;
  const cutoff = Math.max(1, Math.ceil(n * 0.25));

  const tierByName = new Map();
  sorted.forEach((c, idx) => {
    let tier = 'mid';
    if (idx < cutoff) tier = 'top';
    else if (idx >= n - cutoff) tier = 'low';
    tierByName.set(c.campaignName, tier);
  });

  return campaigns.map((c) => ({ ...c, tier: tierByName.get(c.campaignName) || 'mid' }));
}

module.exports = { parseCampaignSheet, assignPerformanceTiers, toNumber, derivePeriodKey };
