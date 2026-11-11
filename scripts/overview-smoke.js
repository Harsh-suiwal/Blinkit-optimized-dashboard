// Offline test for the Brand Overview builder, month and no-month (no database, no .env).
// Usage: node scripts/overview-smoke.js
const assert = require('assert');

// The builder reads campaign figures through campaignStore, which touches storage only when asked to.
const kvPath = require.resolve('../store/kv');
require.cache[kvPath] = { id: kvPath, filename: kvPath, loaded: true, exports: { peek: (k, f = null) => f, get: (k, f = null) => f } };
const { buildBrandOverview } = require('../parser/brandOverview');

const row = (periodKey, sheetType, campaignId, spend, sales) => ({
  periodKey, sheetType, date: `${periodKey}-05`, campaignId, campaignName: `Campaign ${campaignId}`, brandName: 'Demo Brand',
  estimatedBudgetConsumed: spend, directSales: sales, indirectSales: 0, impressions: 1000,
  directAtc: 0, indirectAtc: 0, directQtySold: 1, indirectQtySold: 0, newUsersAcquired: 0,
});
const store = { uploads: [], rows: [row('2026-09', 'PRODUCT_BOOSTING', 'a', 100, 400), row('2026-10', 'PRODUCT_BOOSTING', 'b', 200, 1200), row('2026-10', 'PRODUCT_RECOMMENDATION', 'c', 100, 300)] };
const slot = (monthKey, products, cities, totals) => ({
  brandName: 'Demo Brand', platform: 'blinkit', monthKey, from: `${monthKey}-01`, to: `${monthKey}-30`, fileName: `${monthKey}.xlsx`, uploadedAt: '2026-11-02',
  totals, cities, products,
});
const months = [
  { monthKey: '2026-09', label: 'September 2026', from: '2026-09-01', to: '2026-09-30', partial: false, revenue: 1000, orderCount: 8 },
  { monthKey: '2026-10', label: 'October 2026', from: '2026-10-01', to: '2026-10-20', partial: true, revenue: 2000, orderCount: 16 },
];
const octSlot = slot('2026-10',
  [{ productName: 'P1', revenue: 1200, units: 6, orderCount: 5 }, { productName: 'P2', revenue: 500, units: 3, orderCount: 3 }, { productName: 'P3', revenue: 300, units: 2, orderCount: 2 }],
  [{ city: 'Jaipur', revenue: 1300, units: 7, orderCount: 6 }, { city: 'Delhi', revenue: 700, units: 4, orderCount: 4 }],
  { revenue: 2000, units: 11, orderCount: 10 });
const base = {
  brand: 'Demo Brand',
  cityRows: [{ city: 'Jaipur', revenue: 900, units: 4, orderCount: 3 }],
  productRows: [{ productName: 'P1', revenue: 900, units: 4 }],
  salesUpload: { date: '2026-11-01', fileName: 'latest.xlsx', from: '2026-10-01', to: '2026-10-20' },
  inventoryRows: [{ productName: 'P1', unitsSold30: 10, totalStockAvailable: 5, stockStatus: 'low' }],
  inventoryUpload: { date: '2026-11-01', fileName: 'stock.xlsx' },
  campaignStore: store,
  months,
};

// 1. No month: exactly today's behaviour (latest upload, the brand's latest campaign month).
const latest = buildBrandOverview(base);
assert.deepStrictEqual(Object.keys(latest), ['brand', 'sales', 'inventory', 'campaign', 'months']);
assert.strictEqual(latest.sales.totalRevenue, 900);
assert.strictEqual(latest.sales.fileName, 'latest.xlsx');
assert.strictEqual('monthKey' in latest.sales, false, 'no new fields without a month');
assert.strictEqual(latest.campaign.periodKey, '2026-10');
assert.strictEqual(latest.campaign.adSpend, 300);
const withEmptyMonth = buildBrandOverview({ ...base, month: '' , monthSlots: [octSlot] });
assert.deepStrictEqual(withEmptyMonth, latest, 'an empty month behaves like no month');

// 2. A month with sales and ads: sales come from the month's slot, campaign from that month.
const oct = buildBrandOverview({ ...base, month: '2026-10', monthSlots: [octSlot] });
assert.deepStrictEqual(Object.keys(oct), ['brand', 'sales', 'inventory', 'campaign', 'months']);
assert.strictEqual(oct.sales.monthKey, '2026-10');
assert.strictEqual(oct.sales.partial, true);
assert.strictEqual(oct.sales.from, '2026-10-01');
assert.strictEqual(oct.sales.to, '2026-10-30');
assert.strictEqual(oct.sales.totalRevenue, 2000);
assert.strictEqual(oct.sales.totalUnits, 11);
assert.strictEqual(oct.sales.totalOrders, 10);
assert.strictEqual(oct.sales.avgOrderValue, 200);
assert.strictEqual(oct.sales.cityCount, 2);
assert.strictEqual(oct.sales.productCount, 3);
assert.deepStrictEqual(oct.sales.topCities, [{ city: 'Jaipur', revenue: 1300, sharePct: 65 }, { city: 'Delhi', revenue: 700, sharePct: 35 }]);
assert.deepStrictEqual(oct.sales.topProducts[0], { productName: 'P1', revenue: 1200, units: 6, sharePct: 60 });
assert.strictEqual(oct.campaign.periodKey, '2026-10');
assert.strictEqual(oct.inventory.totalStock, 5, 'stock is always the current snapshot');
assert.deepStrictEqual(oct.months, months, 'months list is unchanged');

// 3. A month with sales but no campaign rows: campaign is null. Another month with ads, no sales: sales null.
const sepOnlySales = buildBrandOverview({ ...base, month: '2026-08', monthSlots: [] });
assert.strictEqual(sepOnlySales.sales, null);
assert.strictEqual(sepOnlySales.campaign, null, 'no campaign rows in August');
const noAds = buildBrandOverview({ ...base, campaignStore: { uploads: [], rows: [row('2026-09', 'PRODUCT_BOOSTING', 'a', 100, 400)] }, month: '2026-10', monthSlots: [octSlot] });
assert.strictEqual(noAds.campaign, null);
assert.strictEqual(noAds.sales.totalRevenue, 2000);
const sepAds = buildBrandOverview({ ...base, month: '2026-09', monthSlots: [] });
assert.strictEqual(sepAds.sales, null);
assert.strictEqual(sepAds.campaign.periodKey, '2026-09');
assert.strictEqual(sepAds.campaign.adSpend, 100);
assert.strictEqual(sepAds.campaign.roas, 4);

console.log('overview smoke test passed');
