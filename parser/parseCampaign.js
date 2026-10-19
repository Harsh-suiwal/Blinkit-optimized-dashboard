const path = require('path');
const XLSX = require('xlsx');
const columnMap = require('./columnMap');
const { resolveBrand, loadAliases } = require('./brandResolver');
const { todayDateString } = require('./snapshotHistory');

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const SHEET_PRODUCT_BOOSTING = 'PRODUCT_BOOSTING';
const SHEET_PRODUCT_RECOMMENDATION = 'PRODUCT_RECOMMENDATION';

function toNumber(value) {
  if (value === undefined || value === null || value === '') return 0;
  if (typeof value === 'number') return value;
  const cleaned = String(value).replace(/,/g, '').trim();
  if (cleaned === '' || cleaned === '-' || cleaned === '--') return 0;
  const n = Number(cleaned);
  return Number.isNaN(n) ? 0 : n;
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(toNumber(value) * factor) / factor;
}

/**
 * Blinkit writes dates as "DD-MM-YYYY" strings. Split them by hand:
 * new Date("01-09-2026") would read that as 9 January. Excel serial numbers
 * are accepted too. Returns "YYYY-MM-DD" or null.
 */
function parseDate(value) {
  if (value === undefined || value === null || value === '') return null;

  if (typeof value === 'number') {
    const parts = XLSX.SSF.parse_date_code(value);
    if (!parts) return null;
    return `${parts.y}-${String(parts.m).padStart(2, '0')}-${String(parts.d).padStart(2, '0')}`;
  }

  const text = String(value).trim();
  let m = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (m) return isoDate(Number(m[3]), Number(m[2]), Number(m[1]));
  m = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return isoDate(Number(m[1]), Number(m[2]), Number(m[3]));
  return null;
}

function isoDate(year, month, day) {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function periodLabelFor(periodKey) {
  const [year, month] = periodKey.split('-');
  return `${MONTH_NAMES[Number(month) - 1]} ${year}`;
}

/** Decides the sheet type from its header row; null if it isn't a campaign sheet. */
function detectSheetType(headers) {
  const has = (cols) => cols.every((c) => headers.includes(c));
  if (has(columnMap.REQUIRED_CAMPAIGN_PB_COLUMNS)) return SHEET_PRODUCT_BOOSTING;
  if (has(columnMap.REQUIRED_CAMPAIGN_RC_COLUMNS)) return SHEET_PRODUCT_RECOMMENDATION;
  return null;
}

/**
 * Parses a Blinkit campaign export (.xls or .xlsx). Every sheet is read
 * independently; each data row is one day x campaign x targeting value.
 *
 * @param {string} filePath
 * @param {{ fileName?: string, defaultBrand?: string }} [options]
 *   defaultBrand is used (as the "explicit" brand) for campaigns whose name
 *   can't be resolved; otherwise the upload's file name is tried before
 *   falling back to "Unknown".
 * @returns {{ uploads: object[], rows: object[] }}
 */
function parseCampaignFile(filePath, options = {}) {
  const { fileName = '', defaultBrand = '' } = options;
  const workbook = XLSX.readFile(filePath);
  const aliases = loadAliases();
  const fileBrand = resolveBrand(path.parse(fileName).name, '', aliases);
  const brandCache = new Map();

  const brandFor = (campaignName) => {
    if (brandCache.has(campaignName)) return brandCache.get(campaignName);
    let result = resolveBrand(campaignName, '', aliases);
    if (result.brand === 'Unknown') {
      if (defaultBrand.trim()) result = resolveBrand('', defaultBrand, aliases);
      else if (fileBrand.brand !== 'Unknown') result = { brand: fileBrand.brand, confidence: 'parsed' };
    }
    brandCache.set(campaignName, result.brand);
    return result.brand;
  };

  const rows = [];
  const unrecognised = [];

  for (const sheetName of workbook.SheetNames) {
    const grid = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, raw: true, defval: '' });
    if (grid.length === 0) continue;

    const headers = grid[0].map((h) => String(h).trim());
    const sheetType = detectSheetType(headers);
    if (!sheetType) {
      unrecognised.push(sheetName);
      continue;
    }

    const map = sheetType === SHEET_PRODUCT_BOOSTING ? columnMap.CAMPAIGN_PB_COLUMNS : columnMap.CAMPAIGN_RC_COLUMNS;

    for (const raw of grid.slice(1)) {
      const record = {};
      headers.forEach((header, idx) => {
        const key = map[header];
        if (key) record[key] = raw[idx];
      });

      const date = parseDate(record.date);
      const campaignName = String(record.campaignName ?? '').trim();
      if (!date || record.campaignId === '' || record.campaignId === undefined || !campaignName) continue;

      const isPb = sheetType === SHEET_PRODUCT_BOOSTING;
      rows.push({
        periodKey: date.slice(0, 7),
        sheetType,
        date,
        campaignId: String(record.campaignId).trim(),
        campaignName,
        brandName: brandFor(campaignName),
        targetingType: String(record.targetingType ?? '').trim(),
        targetingValue: isPb ? String(record.targetingValue ?? '').trim() : '',
        matchType: isPb ? String(record.matchType ?? '').trim() : '',
        mostViewedPosition: isPb ? toNumber(record.mostViewedPosition) : null,
        pacingType: String(record.pacingType ?? '').trim(),
        cpm: round(record.cpm),
        impressions: toNumber(record.impressions),
        directAtc: toNumber(record.directAtc),
        indirectAtc: toNumber(record.indirectAtc),
        directQtySold: toNumber(record.directQtySold),
        indirectQtySold: toNumber(record.indirectQtySold),
        directSales: round(record.directSales),
        indirectSales: round(record.indirectSales),
        newUsersAcquired: toNumber(record.newUsersAcquired),
        estimatedBudgetConsumed: round(record.estimatedBudgetConsumed),
        directRoas: round(record.directRoas),
        totalRoas: round(record.totalRoas),
      });
    }
  }

  if (unrecognised.length && rows.length === 0) {
    throw new Error(
      `Sheet(s) ${unrecognised.map((s) => `"${s}"`).join(', ')} don't look like a Blinkit campaign export ` +
      '(expected Date, Campaign ID, Campaign Name, Targeting Type, ... columns).'
    );
  }
  if (rows.length === 0) {
    throw new Error('No campaign data rows were found in this file.');
  }

  return { uploads: summariseUploads(rows, fileName), rows };
}

/** One upload entry per (periodKey, sheetType) present in the parsed rows. */
function summariseUploads(rows, fileName) {
  const groups = new Map();
  for (const row of rows) {
    const key = `${row.periodKey}|${row.sheetType}`;
    if (!groups.has(key)) {
      groups.set(key, { periodKey: row.periodKey, sheetType: row.sheetType, from: row.date, to: row.date, rowCount: 0 });
    }
    const g = groups.get(key);
    if (row.date < g.from) g.from = row.date;
    if (row.date > g.to) g.to = row.date;
    g.rowCount += 1;
  }

  const uploadedAt = new Date().toISOString();
  return Array.from(groups.values())
    .sort((a, b) => a.periodKey.localeCompare(b.periodKey) || a.sheetType.localeCompare(b.sheetType))
    .map((g) => ({
      uploadId: `${uploadedAt}|${g.periodKey}|${g.sheetType}`,
      fileName,
      uploadedDate: todayDateString(),
      dateRange: { from: g.from, to: g.to },
      periodKey: g.periodKey,
      periodLabel: periodLabelFor(g.periodKey),
      sheetType: g.sheetType,
      rowCount: g.rowCount,
    }));
}

module.exports = {
  parseCampaignFile,
  parseDate,
  periodLabelFor,
  toNumber,
  SHEET_PRODUCT_BOOSTING,
  SHEET_PRODUCT_RECOMMENDATION,
};
