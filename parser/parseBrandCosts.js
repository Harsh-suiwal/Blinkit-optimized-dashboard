// Reads a brand's cost sheet (one row per product) for the Profit tab.
// Pure helpers: no database, so they can be tested on their own (scripts/profit-smoke.js).
//
// Expected columns (any order, extra columns are ignored):
//   Product Name | MRP | Selling Price | Tax % | Selling Price Excl. Tax | Product COGS |
//   Blinkit Inward Fee | Blinkit Storage Fee | Blinkit Fulfilment Fee | Blinkit Commission Fee
// Fees are rupees PER UNIT SOLD. The commission fee is converted to a % of the selling price,
// because the real selling price of an order can differ from the list price.

const FIELD_BY_HEADER = {
  productname: 'productName',
  mrp: 'mrp',
  sellingprice: 'sellingPrice',
  tax: 'taxPct',
  productcogs: 'cogs',
  cogs: 'cogs',
  blinkitinwardfee: 'inwardFee',
  inwardfee: 'inwardFee',
  blinkitstoragefee: 'storageFee',
  storagefee: 'storageFee',
  blinkitfulfilmentfee: 'fulfilmentFee',
  blinkitfulfillmentfee: 'fulfilmentFee',
  fulfilmentfee: 'fulfilmentFee',
  fulfillmentfee: 'fulfilmentFee',
  blinkitcommissionfee: 'commissionFee',
  commissionfee: 'commissionFee',
};

// [field, label shown in the error message]
const REQUIRED = [
  ['productName', 'Product Name'],
  ['sellingPrice', 'Selling Price'],
  ['taxPct', 'Tax %'],
  ['cogs', 'Product COGS'],
];

const round = (n, digits = 2) => {
  const factor = 10 ** digits;
  return Math.round(n * factor) / factor;
};

const normalizeHeader = (h) => String(h ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** Matches a sales product name to a cost row: case, spaces and punctuation are ignored. */
const productKey = (name) => String(name ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

function toNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const cleaned = String(value ?? '').replace(/[,\u20B9%\s]/g, '');
  if (cleaned === '' || cleaned === '-' || cleaned === '--') return 0;
  const n = Number(cleaned);
  return Number.isNaN(n) ? 0 : n;
}

// Excel stores 18% as 0.18; a typed "18%" or 18 is read as 18.
function toPercent(value) {
  if (typeof value === 'number') return value > 0 && value < 1 ? round(value * 100, 4) : value;
  return toNumber(value);
}

function findHeaderRow(grid) {
  for (let i = 0; i < Math.min(grid.length, 10); i += 1) {
    if (grid[i].map(normalizeHeader).includes('productname')) return i;
  }
  return -1;
}

/**
 * grid = sheet rows as arrays (XLSX sheet_to_json with header: 1). Returns
 * { products, skippedRows }. Throws a readable Error when the sheet is not a cost sheet.
 */
function parseCostRows(grid) {
  const missingText = REQUIRED.map(([, label]) => label).join(', ');
  const headerIndex = findHeaderRow(grid);
  if (headerIndex === -1) throw new Error(`Missing expected column(s): ${missingText}`);

  const columns = {};
  grid[headerIndex].forEach((cell, index) => {
    const field = FIELD_BY_HEADER[normalizeHeader(cell)];
    if (field && columns[field] === undefined) columns[field] = index;
  });
  const missing = REQUIRED.filter(([field]) => columns[field] === undefined).map(([, label]) => label);
  if (missing.length) throw new Error(`Missing expected column(s): ${missing.join(', ')}`);

  const cell = (row, field) => (columns[field] === undefined ? '' : row[columns[field]]);
  const products = [];
  const seen = new Set();
  let skippedRows = 0;

  for (const row of grid.slice(headerIndex + 1)) {
    if (row.every((c) => c === '' || c === null || c === undefined)) continue;
    const productName = String(cell(row, 'productName') ?? '').trim();
    const sellingPrice = toNumber(cell(row, 'sellingPrice'));
    const key = productKey(productName);
    // A row without a name or a selling price cannot be priced; a repeated product keeps its first row.
    if (!productName || sellingPrice <= 0 || seen.has(key)) { skippedRows += 1; continue; }
    seen.add(key);

    const commissionFee = toNumber(cell(row, 'commissionFee'));
    products.push({
      productName,
      mrp: toNumber(cell(row, 'mrp')),
      sellingPrice,
      taxPct: toPercent(cell(row, 'taxPct')),
      cogs: toNumber(cell(row, 'cogs')),
      inwardFee: toNumber(cell(row, 'inwardFee')),
      storageFee: toNumber(cell(row, 'storageFee')),
      fulfilmentFee: toNumber(cell(row, 'fulfilmentFee')),
      commissionFee,
      commissionPct: round((commissionFee / sellingPrice) * 100, 4),
    });
  }

  if (!products.length) throw new Error('No product rows were found in the cost sheet.');
  return { products, skippedRows };
}

/** One unit sold at the list price: price without tax, and profit before ad spend. */
function unitEconomics(p) {
  const netPrice = p.sellingPrice / (1 + p.taxPct / 100);
  const fixedFees = p.inwardFee + p.storageFee + p.fulfilmentFee;
  return {
    netPrice: round(netPrice),
    profit: round(netPrice - p.cogs - p.commissionFee - fixedFees),
  };
}

/** Reads the first sheet that looks like a cost sheet. xlsx is loaded here so the helpers above need no packages. */
function parseCostFile(filePath) {
  const XLSX = require('xlsx');
  const workbook = XLSX.readFile(filePath);
  let firstError = null;
  for (const sheetName of workbook.SheetNames) {
    const grid = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, raw: true, defval: '' });
    try {
      return parseCostRows(grid);
    } catch (err) {
      firstError = firstError || err;
    }
  }
  throw firstError || new Error('The uploaded file has no sheets.');
}

module.exports = { parseCostRows, parseCostFile, unitEconomics, productKey };
