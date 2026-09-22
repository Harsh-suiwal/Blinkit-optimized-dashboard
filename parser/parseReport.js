const XLSX = require('xlsx');
const columnMap = require('./columnMap');

/**
 * Turns a raw cell value into a clean number.
 * Handles blanks, dashes, commas, and text-formatted numbers.
 */
function toNumber(value) {
  if (value === undefined || value === null || value === '') return 0;
  if (typeof value === 'number') return value;
  const cleaned = String(value).replace(/,/g, '').trim();
  if (cleaned === '' || cleaned === '-' || cleaned === '--') return 0;
  const n = Number(cleaned);
  return Number.isNaN(n) ? 0 : n;
}

/**
 * Finds the row index that holds the real column headers.
 * Blinkit's export has a group header row above it ("Product details",
 * "Warehouse details" ...), so we can't assume headers are always row 0.
 * We look for the row that contains "Item ID".
 */
function findHeaderRowIndex(rows) {
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].some((cell) => String(cell).trim() === 'Item ID')) {
      return i;
    }
  }
  return -1;
}

/**
 * Parses the uploaded Excel file into clean, mapped row objects.
 * Throws a descriptive error if the file doesn't look like a Blinkit
 * "Stock On Hand" export.
 */
function parseReport(filePath) {
  const workbook = XLSX.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];

  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '' });

  const headerRowIndex = findHeaderRowIndex(rows);
  if (headerRowIndex === -1) {
    throw new Error(
      "Couldn't find the column headers (looking for 'Item ID'). Is this a Blinkit Stock On Hand export?"
    );
  }

  const headerRow = rows[headerRowIndex].map((h) => String(h).trim());

  // Check every required column is present before we go further.
  const missing = columnMap.REQUIRED_RAW_COLUMNS.filter((col) => !headerRow.includes(col));
  if (missing.length > 0) {
    throw new Error(`Missing expected column(s): ${missing.join(', ')}`);
  }

  const dataRows = rows.slice(headerRowIndex + 1);

  const parsed = [];
  for (const row of dataRows) {
    // Skip fully blank rows / stray total rows
    const itemIdIdx = headerRow.indexOf('Item ID');
    if (row[itemIdIdx] === '' || row[itemIdIdx] === undefined) continue;

    const record = {};
    headerRow.forEach((rawHeader, idx) => {
      const key = columnMap[rawHeader];
      if (!key) return; // unmapped column, ignore
      record[key] = row[idx];
    });

    parsed.push({
      itemId: String(record.itemId).trim(),
      productName: String(record.productName || '').trim(),
      brandName: String(record.brandName || '').trim(),
      warehouseId: String(record.warehouseId).trim(),
      warehouseName: String(record.warehouseName || '').trim(),

      netScheduledInventory: toNumber(record.netScheduledInventory),
      incomingScheduledInventory: toNumber(record.incomingScheduledInventory),
      recalledInventory: toNumber(record.recalledInventory),

      totalSellable: toNumber(record.totalSellable),
      totalUnsellable: toNumber(record.totalUnsellable),

      unitsSold7: toNumber(record.unitsSold7),
      unitsSold15: toNumber(record.unitsSold15),
      unitsSold30: toNumber(record.unitsSold30),

      // Derived fields, per the accountant's export spec
      totalStockAvailable: toNumber(record.totalSellable),
      incomingInventory: toNumber(record.netScheduledInventory),
    });
  }

  return parsed;
}

module.exports = { parseReport, toNumber };
