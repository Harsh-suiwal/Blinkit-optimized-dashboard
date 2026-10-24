// Builds the Brand Overview page data: one brand's headline sales, inventory and
// advertising figures plus its monthly revenue trend. Pure: server.js passes in the
// already brand-filtered rows, so this file never reads storage itself.
const {
  listPeriods,
  selectRows,
  aggregateTotals,
  aggregateByCampaign,
} = require('./campaignStore');

const round2 = (n) => Math.round(n * 100) / 100;
const TOP_N = 5;

/**
 * @param {object} input
 * @param {string} input.brand
 * @param {object[]} input.cityRows      combined city rows for the brand (combineCityRows output)
 * @param {object[]} input.productRows   product sales rows for the brand (salesByProduct)
 * @param {{date:string,fileName:string}|null} input.salesUpload
 * @param {object[]} input.inventoryRows inventory rows (product x warehouse) for the brand
 * @param {{date:string,fileName:string}|null} input.inventoryUpload
 * @param {object} input.campaignStore   loadCampaignStore() result
 * @param {object[]} input.months        salesMonthly listMonths(brand) result
 */
function buildBrandOverview(input) {
  return {
    brand: input.brand,
    sales: salesSection(input.cityRows || [], input.productRows || [], input.salesUpload || null),
    inventory: inventorySection(input.inventoryRows || [], input.inventoryUpload || null),
    campaign: campaignSection(input.campaignStore, input.brand),
    months: input.months || [],
  };
}

function salesSection(cityRows, productRows, upload) {
  if (!cityRows.length) return null;
  const totalRevenue = cityRows.reduce((sum, c) => sum + c.revenue, 0);
  const totalUnits = cityRows.reduce((sum, c) => sum + c.units, 0);
  const totalOrders = cityRows.reduce((sum, c) => sum + (c.orderCount || 0), 0);
  const share = (revenue) => (totalRevenue > 0 ? Math.round((revenue / totalRevenue) * 1000) / 10 : 0);
  return {
    date: upload ? upload.date : null,
    fileName: upload ? upload.fileName : null,
    totalRevenue: round2(totalRevenue),
    totalUnits,
    totalOrders,
    avgOrderValue: totalOrders > 0 ? round2(totalRevenue / totalOrders) : 0,
    cityCount: cityRows.length,
    productCount: productRows.length,
    topCities: [...cityRows]
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, TOP_N)
      .map((c) => ({ city: c.city, revenue: round2(c.revenue), sharePct: share(c.revenue) })),
    topProducts: [...productRows]
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, TOP_N)
      .map((p) => ({ productName: p.productName, revenue: round2(p.revenue), units: p.units, sharePct: share(p.revenue) })),
  };
}

function inventorySection(rows, upload) {
  if (!rows.length) return null;
  const byProduct = new Map();
  for (const r of rows) {
    if (!byProduct.has(r.productName)) byProduct.set(r.productName, { productName: r.productName, unitsSold30: 0, stock: 0 });
    const p = byProduct.get(r.productName);
    p.unitsSold30 += r.unitsSold30 || 0;
    p.stock += r.totalStockAvailable || 0;
  }
  return {
    date: upload ? upload.date : null,
    fileName: upload ? upload.fileName : null,
    productCount: byProduct.size,
    listingCount: rows.length,
    totalStock: rows.reduce((sum, r) => sum + (r.totalStockAvailable || 0), 0),
    unitsSold30: rows.reduce((sum, r) => sum + (r.unitsSold30 || 0), 0),
    outOfStock: rows.filter((r) => r.stockStatus === 'out').length,
    lowStock: rows.filter((r) => r.stockStatus === 'low').length,
    topSellers: Array.from(byProduct.values())
      .sort((a, b) => b.unitsSold30 - a.unitsSold30)
      .slice(0, TOP_N),
  };
}

/** The brand's most recent campaign month, both sheet types together. */
function campaignSection(store, brand) {
  if (!store || !Array.isArray(store.rows) || !brand) return null;
  const want = String(brand).toLowerCase();
  const brandRows = store.rows.filter((r) => String(r.brandName || '').toLowerCase() === want);
  if (!brandRows.length) return null;
  const periodKey = brandRows.reduce((latest, r) => (r.periodKey > latest ? r.periodKey : latest), brandRows[0].periodKey);
  const rows = selectRows(store, { periodKey, brand, sheetType: '' });
  const totals = aggregateTotals(rows);
  const campaigns = aggregateByCampaign(rows);
  const ranked = campaigns.filter((c) => c.adSpend > 0 && c.roas !== null);
  const best = ranked.length ? ranked.reduce((a, b) => (b.roas > a.roas ? b : a)) : null;
  const period = listPeriods(store).find((p) => p.periodKey === periodKey);
  return {
    periodKey,
    periodLabel: period ? period.periodLabel : periodKey,
    adSpend: totals.adSpend,
    sales: totals.sales,
    roas: totals.roas,
    roiPct: totals.roiPct,
    campaignCount: campaigns.length,
    bestCampaign: best ? { name: best.campaignName, roas: best.roas } : null,
  };
}

module.exports = { buildBrandOverview };
