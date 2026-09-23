const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const { parseReport } = require('./parser/parseReport');
const { appendSnapshot, computeExtendedWindows, todayDateString } = require('./parser/snapshotHistory');
const { parseSalesRows, aggregateByCity, assignPerformanceTiers } = require('./parser/parseSales');
const { appendCitySnapshot, attachTrend, clearHistory, removeCityFromHistory } = require('./parser/salesHistory');
const { parseCampaignSheet, assignPerformanceTiers: assignCampaignTiers } = require('./parser/parseCampaign');
const {
  loadStore: loadCampaignStore,
  upsertPeriods,
  getLatestPeriodKey,
  listPeriods,
} = require('./parser/campaignStore');

const app = express();
const PORT = process.env.PORT || 3000;

const UPLOAD_DIR = path.join(__dirname, 'uploads');
const DATA_PATH = path.join(__dirname, 'data', 'latest.json');
const SALES_DATA_PATH = path.join(__dirname, 'data', 'salesLatest.json');
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

/** Builds the Inventory worksheet, or null if nothing has been uploaded. */
function buildInventoryWorksheet() {
  const latest = loadLatest();
  if (!latest) return null;

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

  const ws = XLSX.utils.aoa_to_sheet([headers, ...dataRows]);
  ws['!cols'] = [{ wch: 45 }, { wch: 30 }, { wch: 18 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 16 }];
  return { ws, date: latest.date };
}

app.get('/api/export', (req, res) => {
  const built = buildInventoryWorksheet();
  if (!built) return res.status(400).json({ error: 'No report uploaded yet.' });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, built.ws, 'Consolidated Report');

  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Disposition', `attachment; filename="Consolidated_Inventory_Report_${built.date}.xlsx"`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buffer);
});

// --- Sales / City Performance -------------------------------------------

function saveSalesLatest(cityRows, date, fileName) {
  fs.writeFileSync(SALES_DATA_PATH, JSON.stringify({ date, fileName, cityRows }, null, 2));
}

function loadSalesLatest() {
  if (!fs.existsSync(SALES_DATA_PATH)) return null;
  return JSON.parse(fs.readFileSync(SALES_DATA_PATH, 'utf-8'));
}

app.post('/api/sales-upload', upload.single('report'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded.' });
  }

  try {
    const salesRows = parseSalesRows(req.file.path);
    const date = todayDateString();

    const cityAgg = aggregateByCity(salesRows);

    // Log today's per-city totals BEFORE computing trend, so this
    // upload becomes available as a comparison point for the next one.
    appendCitySnapshot(cityAgg, date);

    const withTrend = attachTrend(cityAgg, date);
    const withTiers = assignPerformanceTiers(withTrend);

    // Highest revenue first by default
    withTiers.sort((a, b) => b.revenue - a.revenue);

    saveSalesLatest(withTiers, date, req.file.originalname);

    res.json({ ok: true, date, cityCount: withTiers.length, orderRowCount: salesRows.length });
  } catch (err) {
    res.status(400).json({ error: err.message });
  } finally {
    fs.unlink(req.file.path, () => {});
  }
});

app.get('/api/city-performance', (req, res) => {
  const latest = loadSalesLatest();
  if (!latest) return res.json({ date: null, cityRows: [] });
  res.json(latest);
});

// Wipes the current sales snapshot AND the trend history log.
app.delete('/api/sales-history', (req, res) => {
  if (fs.existsSync(SALES_DATA_PATH)) fs.unlinkSync(SALES_DATA_PATH);
  clearHistory();
  res.json({ ok: true });
});

// Removes one city row from the current view and purges its history
// so it doesn't resurface as a "previous" comparison point later.
app.delete('/api/city-performance/:city', (req, res) => {
  const { city } = req.params;
  const latest = loadSalesLatest();
  if (!latest) return res.status(404).json({ error: 'No sales data to delete from.' });

  const withoutCity = latest.cityRows.filter((c) => c.city !== city);
  if (withoutCity.length === latest.cityRows.length) {
    return res.status(404).json({ error: `City "${city}" not found.` });
  }

  saveSalesLatest(withoutCity, latest.date, latest.fileName);
  removeCityFromHistory(city);

  res.json({ ok: true, cityCount: withoutCity.length });
});

app.get('/api/sales-summary', (req, res) => {
  const latest = loadSalesLatest();
  if (!latest) {
    return res.json({ totalRevenue: 0, totalUnits: 0, totalOrders: 0, cityCount: 0, topCity: null });
  }

  const totalRevenue = latest.cityRows.reduce((sum, c) => sum + c.revenue, 0);
  const totalUnits = latest.cityRows.reduce((sum, c) => sum + c.units, 0);
  const totalOrders = latest.cityRows.reduce((sum, c) => sum + c.orderCount, 0);
  const topCity = latest.cityRows[0] ? latest.cityRows[0].city : null;

  res.json({
    date: latest.date,
    totalRevenue: Math.round(totalRevenue * 100) / 100,
    totalUnits,
    totalOrders,
    cityCount: latest.cityRows.length,
    topCity,
  });
});

/** Builds the Sales by City worksheet, or null if nothing has been uploaded. */
function buildSalesWorksheet() {
  const latest = loadSalesLatest();
  if (!latest) return null;

  const headers = [
    'City', 'Revenue', 'Units Sold', 'Order Count', 'Avg Order Value',
    'Best-Selling Product', 'Best-Selling Product Revenue',
    'Performance Tier', 'Revenue Change % (vs last upload)', 'Previous Revenue',
  ];

  const dataRows = latest.cityRows.map((c) => [
    c.city,
    c.revenue,
    c.units,
    c.orderCount,
    c.avgOrderValue,
    c.topProduct || 'No data',
    c.topProductRevenue ?? 0,
    c.tier,
    c.revenueChangePct === null || c.revenueChangePct === undefined ? 'No prior data' : c.revenueChangePct,
    c.previousRevenue === null || c.previousRevenue === undefined ? 'No prior data' : c.previousRevenue,
  ]);

  const ws = XLSX.utils.aoa_to_sheet([headers, ...dataRows]);
  ws['!cols'] = [{ wch: 22 }, { wch: 14 }, { wch: 12 }, { wch: 12 }, { wch: 16 }, { wch: 40 }, { wch: 22 }, { wch: 14 }, { wch: 22 }, { wch: 16 }];
  return { ws, date: latest.date };
}

// --- Campaign Analysis ----------------------------------------------------

app.post('/api/campaign-upload', upload.single('report'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded.' });
  }

  try {
    const parsedPeriods = parseCampaignSheet(req.file.path);
    if (parsedPeriods.length === 0) {
      throw new Error('No campaign period blocks were found in this file.');
    }

    const uploadedDate = todayDateString();
    const store = upsertPeriods(parsedPeriods, req.file.originalname, uploadedDate);
    const latestPeriodKey = getLatestPeriodKey(store);
    const latestCampaigns = store.periods[latestPeriodKey].campaigns;

    res.json({
      ok: true,
      periodCount: Object.keys(store.periods).length,
      campaignCount: latestCampaigns.length,
      latestPeriodKey,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  } finally {
    fs.unlink(req.file.path, () => {});
  }
});

app.get('/api/campaign-analysis', (req, res) => {
  const store = loadCampaignStore();
  const periods = listPeriods(store);
  const latestPeriodKey = getLatestPeriodKey(store);
  const periodKey =
    req.query.periodKey && store.periods[req.query.periodKey] ? req.query.periodKey : latestPeriodKey;

  if (!periodKey) {
    return res.json({ date: null, periods: [], periodKey: null, latestPeriodKey: null, rows: [] });
  }

  const rows = assignCampaignTiers(store.periods[periodKey].campaigns);

  res.json({ date: store.uploadedDate, periods, periodKey, latestPeriodKey, rows });
});

app.get('/api/campaign-summary', (req, res) => {
  const store = loadCampaignStore();
  const latestPeriodKey = getLatestPeriodKey(store);
  const periodKey =
    req.query.periodKey && store.periods[req.query.periodKey] ? req.query.periodKey : latestPeriodKey;

  if (!periodKey) {
    return res.json({
      totalAdSpend: 0,
      totalSales: 0,
      overallRoas: null,
      roiPct: null,
      totalUnits: 0,
      activeCampaigns: 0,
      totalCampaigns: 0,
      bestCampaign: null,
      worstCampaign: null,
      totalImpressions: 0,
      totalAtc: 0,
    });
  }

  const campaigns = store.periods[periodKey].campaigns;
  const totalAdSpend = campaigns.reduce((s, c) => s + c.adSpend, 0);
  const totalSales = campaigns.reduce((s, c) => s + c.sales, 0);
  const totalUnits = campaigns.reduce((s, c) => s + c.qtySold, 0);
  const totalImpressions = campaigns.reduce((s, c) => s + c.impressions, 0);
  const totalAtc = campaigns.reduce((s, c) => s + c.atc, 0);
  const activeCampaigns = campaigns.filter((c) => c.status.toLowerCase() === 'active').length;

  const ranked = campaigns.filter((c) => c.adSpend > 0 && c.roas !== null);
  const best = ranked.length ? ranked.reduce((a, b) => (b.roas > a.roas ? b : a)) : null;
  const worst = ranked.length ? ranked.reduce((a, b) => (b.roas < a.roas ? b : a)) : null;

  res.json({
    totalAdSpend: Math.round(totalAdSpend * 100) / 100,
    totalSales: Math.round(totalSales * 100) / 100,
    overallRoas: totalAdSpend > 0 ? Math.round((totalSales / totalAdSpend) * 100) / 100 : null,
    roiPct: totalAdSpend > 0 ? Math.round(((totalSales - totalAdSpend) / totalAdSpend) * 1000) / 10 : null,
    totalUnits,
    activeCampaigns,
    totalCampaigns: campaigns.length,
    bestCampaign: best ? { name: best.campaignName, roas: best.roas } : null,
    worstCampaign: worst ? { name: worst.campaignName, roas: worst.roas } : null,
    totalImpressions,
    totalAtc,
  });
});

/** Builds the Campaign Analysis worksheet for a period, or null if nothing has been uploaded. */
function buildCampaignWorksheet(requestedPeriodKey) {
  const store = loadCampaignStore();
  const latestPeriodKey = getLatestPeriodKey(store);
  const periodKey = requestedPeriodKey && store.periods[requestedPeriodKey] ? requestedPeriodKey : latestPeriodKey;
  if (!periodKey) return null;

  const campaigns = store.periods[periodKey].campaigns;
  const headers = [
    'Campaign', 'Type', 'Status', 'Ad Spend', 'Sales', 'ROAS', 'ROI %', 'ROS / Unit', 'Impressions', 'ATC', 'Qty Sold',
  ];
  const dataRows = campaigns.map((c) => [
    c.campaignName, c.campaignDetail, c.status, c.adSpend, c.sales, c.roas, c.roiPct, c.rosPerUnit, c.impressions, c.atc, c.qtySold,
  ]);

  const ws = XLSX.utils.aoa_to_sheet([headers, ...dataRows]);
  ws['!cols'] = [
    { wch: 45 }, { wch: 20 }, { wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 10 }, { wch: 10 }, { wch: 14 }, { wch: 14 }, { wch: 10 }, { wch: 10 },
  ];
  return { ws, periodKey };
}

app.get('/api/export-campaign', (req, res) => {
  const built = buildCampaignWorksheet(req.query.periodKey);
  if (!built) return res.status(400).json({ error: 'No campaign report uploaded yet.' });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, built.ws, 'Campaign Analysis');

  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Disposition', `attachment; filename="Campaign_Analysis_${built.periodKey}.xlsx"`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buffer);
});

// --- Full report: all sheets in one workbook -------------------------------

app.get('/api/export-all', (req, res) => {
  const inventory = buildInventoryWorksheet();
  const sales = buildSalesWorksheet();
  const campaign = buildCampaignWorksheet(req.query.periodKey);

  if (!inventory && !sales && !campaign) {
    return res.status(400).json({ error: 'Nothing to export yet — upload at least one report first.' });
  }

  const wb = XLSX.utils.book_new();
  if (inventory) XLSX.utils.book_append_sheet(wb, inventory.ws, 'Inventory');
  if (sales) XLSX.utils.book_append_sheet(wb, sales.ws, 'Sales by City');
  if (campaign) XLSX.utils.book_append_sheet(wb, campaign.ws, 'Campaign Analysis');

  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const dateStamp = inventory?.date || sales?.date || todayDateString();
  res.setHeader('Content-Disposition', `attachment; filename="Full_Report_${dateStamp}.xlsx"`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buffer);
});

app.listen(PORT, () => {
  console.log(`Blinkit dashboard running at http://localhost:${PORT}`);
});
