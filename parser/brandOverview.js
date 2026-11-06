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
 * @param {string} [input.month]      'YYYY-MM': sales and campaign for that month instead of the latest upload
 * @param {object[]} [input.monthSlots] the brand's monthly slots (any months; the requested one is used)
 */
function buildBrandOverview(input) {
  const month = input.month || '';
  return {
    brand: input.brand,
    sales: month
      ? monthSalesSection(input.monthSlots || [], month, input.months || [])
      : salesSection(input.cityRows || [], input.productRows || [], input.salesUpload || null),
    // Stock is always the current snapshot, never month-specific.
    inventory: inventorySection(input.inventoryRows || [], input.inventoryUpload || null),
    campaign: campaignSection(input.campaignStore, input.brand, month),
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
    from: upload && upload.from ? upload.from : null,
    to: upload && upload.to ? upload.to : null,
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

/** Sales for one calendar month from its stored monthly slot(s); null when the brand has none. */
function monthSalesSection(slots, monthKey, months) {
  const own = slots.filter((s) => s.monthKey === monthKey);
  if (!own.length) return null;
  const cities = new Map();
  const products = new Map();
  let revenue = 0;
  let units = 0;
  let orders = 0;
  let from = own[0].from;
  let to = own[0].to;
  for (const s of own) {
    revenue += s.totals.revenue;
    units += s.totals.units;
    orders += s.totals.orderCount;
    if (s.from < from) from = s.from;
    if (s.to > to) to = s.to;
    for (const c of s.cities || []) cities.set(c.city, (cities.get(c.city) || 0) + c.revenue);
    for (const p of s.products || []) {
      const row = products.get(p.productName) || { productName: p.productName, revenue: 0, units: 0 };
      row.revenue += p.revenue;
      row.units += p.units;
      products.set(p.productName, row);
    }
  }
  const info = months.find((m) => m.monthKey === monthKey);
  const share = (value) => (revenue > 0 ? Math.round((value / revenue) * 1000) / 10 : 0);
  return {
    date: own[0].uploadedAt || null,
    fileName: own[0].fileName || null,
    monthKey,
    from,
    to,
    partial: info ? info.partial : false,
    totalRevenue: round2(revenue),
    totalUnits: units,
    totalOrders: orders,
    avgOrderValue: orders > 0 ? round2(revenue / orders) : 0,
    cityCount: cities.size,
    productCount: products.size,
    topCities: Array.from(cities, ([city, value]) => ({ city, revenue: round2(value), sharePct: share(value) }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, TOP_N),
    topProducts: Array.from(products.values())
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

/** The brand's campaign month (the most recent one, or `month` when given), both sheet types together. */
function campaignSection(store, brand, month) {
  if (!store || !Array.isArray(store.rows) || !brand) return null;
  const want = String(brand).toLowerCase();
  const brandRows = store.rows.filter((r) => String(r.brandName || '').toLowerCase() === want);
  if (!brandRows.length) return null;
  const periodKey = month || brandRows.reduce((latest, r) => (r.periodKey > latest ? r.periodKey : latest), brandRows[0].periodKey);
  const rows = selectRows(store, { periodKey, brand, sheetType: '' });
  if (!rows.length) return null; // no campaign rows in the requested month
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
