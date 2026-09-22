const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const { parseReport } = require('./parser/parseReport');
const { appendSnapshot, computeExtendedWindows, todayDateString } = require('./parser/snapshotHistory');

const app = express();
const PORT = process.env.PORT || 3000;

const UPLOAD_DIR = path.join(__dirname, 'uploads');
const DATA_PATH = path.join(__dirname, 'data', 'latest.json');
const LOW_STOCK_THRESHOLD = 10; // change this one number to adjust the "low stock" line

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
if (!fs.existsSync(path.join(__dirname, 'data'))) fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });

const upload = multer({ dest: UPLOAD_DIR });

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

/**
 * Builds the full consolidated product list: today's parsed rows plus
 * the 45/60 day figures pulled from snapshot history.
 */
function buildConsolidatedRows(parsedRows, date) {
  return parsedRows.map((row) => {
    const { unitsSold45, unitsSold60 } = computeExtendedWindows({
      itemId: row.itemId,
      warehouseId: row.warehouseId,
      latestDate: date,
      latestUnitsSold30: row.unitsSold30,
    });

    const stockStatus =
      row.totalStockAvailable <= 0 ? 'out' : row.totalStockAvailable <= LOW_STOCK_THRESHOLD ? 'low' : 'ok';

    return {
      productName: row.productName,
      warehouseName: row.warehouseName,
      totalStockAvailable: row.totalStockAvailable,
      unitsSold7: row.unitsSold7,
      unitsSold15: row.unitsSold15,
      unitsSold30: row.unitsSold30,
      unitsSold45, // number, or null if not enough history yet
      unitsSold60, // number, or null if not enough history yet
      incomingInventory: row.incomingInventory,
      stockStatus,
    };
  });
}

function saveLatest(rows, date, fileName) {
  fs.writeFileSync(DATA_PATH, JSON.stringify({ date, fileName, rows }, null, 2));
}

function loadLatest() {
  if (!fs.existsSync(DATA_PATH)) return null;
  return JSON.parse(fs.readFileSync(DATA_PATH, 'utf-8'));
}

// --- Upload -----------------------------------------------------------

app.post('/api/upload', upload.single('report'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded.' });
  }

  try {
    const parsedRows = parseReport(req.file.path);
    const date = todayDateString();

    // Save this upload into the history log BEFORE computing 45/60 day
    // windows for it, so today's own snapshot is available for future uploads.
    appendSnapshot(parsedRows, date);

    const rows = buildConsolidatedRows(parsedRows, date);
    saveLatest(rows, date, req.file.originalname);

    res.json({ ok: true, date, rowCount: rows.length });
  } catch (err) {
    res.status(400).json({ error: err.message });
  } finally {
    fs.unlink(req.file.path, () => {});
  }
});

// --- Read APIs ----------------------------------------------------------

app.get('/api/products', (req, res) => {
  const latest = loadLatest();
  if (!latest) return res.json({ date: null, rows: [] });
  res.json(latest);
});

app.get('/api/summary', (req, res) => {
  const latest = loadLatest();
  if (!latest) {
    return res.json({ totalUnitsSold30: 0, totalStock: 0, productCount: 0, lowOrOutCount: 0 });
  }

  const totalUnitsSold30 = latest.rows.reduce((sum, r) => sum + r.unitsSold30, 0);
  const totalStock = latest.rows.reduce((sum, r) => sum + r.totalStockAvailable, 0);
  const productCount = new Set(latest.rows.map((r) => r.productName)).size;
  const lowOrOutCount = latest.rows.filter((r) => r.stockStatus !== 'ok').length;

  res.json({ date: latest.date, totalUnitsSold30, totalStock, productCount, lowOrOutCount });
});

// --- Export ---------------------------------------------------------------

app.get('/api/export', (req, res) => {
  const latest = loadLatest();
  if (!latest) return res.status(400).json({ error: 'No report uploaded yet.' });

  const headers = [
    'Product Name',
    'Warehouse Name',
    'Total Stock Available',
    'Units Sold - 7 Days',
    'Units Sold - 15 Days',
    'Units Sold - 30 Days',
    'Units Sold - 45 Days',
    'Units Sold - 60 Days',
    'Incoming Inventory',
  ];

  const dataRows = latest.rows.map((r) => [
    r.productName,
    r.warehouseName,
    r.totalStockAvailable,
    r.unitsSold7,
    r.unitsSold15,
    r.unitsSold30,
    r.unitsSold45 === null ? 'Insufficient data' : r.unitsSold45,
    r.unitsSold60 === null ? 'Insufficient data' : r.unitsSold60,
    r.incomingInventory,
  ]);

  const sheetData = [headers, ...dataRows];
  const ws = XLSX.utils.aoa_to_sheet(sheetData);
  ws['!cols'] = [{ wch: 45 }, { wch: 30 }, { wch: 18 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 16 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Consolidated Report');

  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Disposition', `attachment; filename="Consolidated_Inventory_Report_${latest.date}.xlsx"`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buffer);
});

app.listen(PORT, () => {
  console.log(`Blinkit dashboard running at http://localhost:${PORT}`);
});
