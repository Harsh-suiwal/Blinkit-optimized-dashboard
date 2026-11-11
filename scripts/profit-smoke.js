// Offline test for the Profit tab maths (no database, no .env). Usage: node scripts/profit-smoke.js
const assert = require('assert');
const { parseCostRows, unitEconomics } = require('../parser/parseBrandCosts');
const { buildBrandProfit } = require('../parser/brandProfit');

const near = (actual, expected, label, tolerance = 0.011) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: got ${actual}, expected ${expected}`);

// A cost sheet laid out like the real one, with made-up products and numbers (the first row is a group row).
const header = ['Product Name', 'MRP', 'Selling Price', 'Tax %', 'Selling Price Excl. Tax', 'Product COGS',
  'Blinkit Inward Fee', 'Blinkit Storage Fee', 'Blinkit Fulfilment Fee', 'Blinkit Commission Fee'];
const rows = [
  ['Demo Alpha Spoon Set (Box)', 450, 400, '18%', 338.98, 150, 4, 20, 45, 20],
  ['Demo Beta Fork Set (Box)', 300, 250, 0.18, 211.86, 230, 4, '-', 45, 5],
  ['Demo Gamma Knife (Box)', 500, 440, 18, 372.88, 160, 4, '-', 45, 17.6],
  ['Demo Delta Cleaver, Large (Box)', 600, 520, '18%', 440.68, 190, 4, '-', 45, 41.6],
  ['Demo Epsilon Brush Set (Pack)', 280, 240, 0.05, 228.57, 70, 4, '-', 45, 4.8],
  ['Demo Zeta Peeler (Box)', 200, 180, '18%', 152.54, 140, 4, '-', 45, 5.4],
];
const { products, skippedRows } = parseCostRows([['', 'Product details'], header, ...rows, ['', '', '', '', '', '', '', '', '', '']]);
assert.strictEqual(products.length, 6);
assert.strictEqual(skippedRows, 0);
assert.deepStrictEqual(products.map((p) => p.commissionPct), [5, 2, 4, 8, 2, 3], 'commission %');
assert.deepStrictEqual(products.map((p) => p.taxPct), [18, 18, 18, 18, 5, 18], 'tax %');
assert.strictEqual(products[0].storageFee, 20);
assert.strictEqual(products[1].storageFee, 0, 'a dash means no fee');
near(unitEconomics(products[0]).profit, 99.98, 'unit profit, first product');
near(unitEconomics(products[1]).profit, -72.14, 'unit profit, second product');

assert.throws(() => parseCostRows([['Name', 'Price']]), /Missing expected column/);
assert.throws(() => parseCostRows([header]), /No product rows/);

// One October month: 10 units of product 1, 5 of product 2, one product that has no cost row.
const slots = [{
  monthKey: '2026-10',
  products: [
    { productName: 'DEMO Alpha Spoon Set (Box)', revenue: 4000, units: 10, orderCount: 9 },
    { productName: 'Demo Beta Fork Set (Box)', revenue: 1250, units: 5, orderCount: 5 },
    { productName: 'Unknown Gadget', revenue: 500, units: 1, orderCount: 1 },
  ],
}];
const monthInfo = [{ monthKey: '2026-10', label: 'October 2026', from: '2026-10-01', to: '2026-10-31', partial: false, revenue: 5750, units: 16 }];
const costs = { fileName: 'costs.xlsx', uploadedAt: '2026-11-04', products, otherCosts: { '2026-10': 200 } };
const result = buildBrandProfit({ brand: 'Demo Brand', monthInfo, slots, costs, adSpendByMonth: { '2026-10': 300 } });

const m = result.months[0];
assert.strictEqual(m.status, 'incomplete');
near(m.netSales, 4449.15, 'net sales');           // 4000/1.18 + 1250/1.18
near(m.productCost, 2650, 'product cost');         // 10 x 150 + 5 x 230
near(m.fees, 1160, 'fees');                        // commission 225 + inward 60 + fulfilment 675 + storage 200
assert.strictEqual(m.adSpend, 300);
assert.strictEqual(m.otherCosts, 200);
near(m.totalCosts, 4310, 'total costs');
near(m.profit, 139.15, 'profit');
near(m.marginPct, 3.1, 'margin %', 0.05);
near(m.roiPct, 3.2, 'ROI %', 0.05);
near(m.matchedRevenuePct, 91.3, 'matched revenue %', 0.05);
assert.deepStrictEqual(m.unmatchedProducts.map((u) => u.productName), ['Unknown Gadget']);
assert.strictEqual(result.totals.months, 1);
assert.strictEqual(result.totals.profit, m.profit);
assert.strictEqual(result.products.length, 6);
near(result.products[0].profitPerUnit, 99.98, 'per unit, best product first');
assert.strictEqual(result.products[1].units, 5);
near(result.products[1].profitPerUnit, -72.14, 'per unit, loss maker');

// No cost sheet: sales still listed, no profit invented. Months without ad data say so.
const bare = buildBrandProfit({ brand: 'Demo Brand', monthInfo, slots, costs: null, adSpendByMonth: {} });
assert.strictEqual(bare.hasCosts, false);
assert.strictEqual(bare.months[0].status, 'no-costs');
assert.strictEqual(bare.months[0].profit, null);
assert.strictEqual(bare.months[0].adDataMissing, true);
assert.strictEqual(bare.totals, null);

// --- Product x city data, one-product profit and the product-month-detail builder ---------
(async () => {
  const kvPath = require.resolve('../store/kv');
  const memory = new Map();
  require.cache[kvPath] = {
    id: kvPath, filename: kvPath, loaded: true,
    exports: {
      get: (k, f = null) => (memory.has(k) ? JSON.parse(JSON.stringify(memory.get(k))) : f),
      peek: (k, f = null) => (memory.has(k) ? memory.get(k) : f),
      set: async (k, v) => { memory.set(k, JSON.parse(JSON.stringify(v))); },
    },
  };
  const { buildMonthSlots, restoreMonth, slotsFor } = require('../parser/salesMonthly');
  const { buildProductMonthProfit } = require('../parser/brandProfit');
  const { buildProductMonthDetail, canSeeProductProfit, listProductNames } = require('../parser/productMonthDetail');

  const P1 = 'Demo Alpha Spoon Set (Box)';
  const P2 = 'Demo Beta Fork Set (Box)';
  const P3 = 'Demo Mystery Item';
  const line = (orderId, city, productName, quantity, revenue, orderDate = '2026-10-03') =>
    ({ orderId, orderDate, brandName: 'Demo Brand', customerCity: city, productName, quantity, revenue });

  // 1. buildMonthSlots: each product carries its cities; orders are counted like the product totals.
  const built = buildMonthSlots([
    line('A1', 'Jaipur', P1, 1, 400), line('A1', 'Jaipur', P1, 1, 400), // one order, two lines
    line('A2', 'Delhi', P1, 1, 400), line('A3', 'Jaipur', P2, 1, 250),
  ], 'oct.xlsx', '2026-11-01');
  const octSlot = built.slots[0];
  const p1 = octSlot.products.find((p) => p.productName === P1);
  assert.strictEqual(p1.orderCount, 2);
  assert.deepStrictEqual(p1.cities, [
    { city: 'Jaipur', revenue: 800, units: 2, orderCount: 1 },
    { city: 'Delhi', revenue: 400, units: 1, orderCount: 1 },
  ]);
  assert.strictEqual(p1.cities.reduce((s, c) => s + c.revenue, 0), p1.revenue, 'cities add up to the product');
  assert.deepStrictEqual(octSlot.products.find((p) => p.productName === P2).cities, [{ city: 'Jaipur', revenue: 250, units: 1, orderCount: 1 }]);

  // 2. The slot validator keeps cities when present and invents none when absent (older months).
  await restoreMonth(octSlot);
  assert.strictEqual(slotsFor('Demo Brand', 'blinkit')[0].products[0].cities.length > 0, true, 'cities survive a restore');
  const oldSlot = JSON.parse(JSON.stringify({ ...octSlot, monthKey: '2026-09', from: '2026-09-01', to: '2026-09-30' }));
  oldSlot.products.forEach((p) => { delete p.cities; });
  await restoreMonth(oldSlot);
  const storedOld = slotsFor('Demo Brand', 'blinkit').find((s) => s.monthKey === '2026-09');
  assert.strictEqual(storedOld.products[0].cities, undefined, 'old months stay without cities');
  const augSlot = { ...oldSlot, monthKey: '2026-08', from: '2026-08-01', to: '2026-08-31', products: [{ productName: P3, revenue: 100, units: 1, orderCount: 1 }] };
  await restoreMonth(augSlot);

  // 3. One-product profit uses the same formulas as the brand profit.
  const slotsAll = slotsFor('Demo Brand', 'blinkit');
  const monthInfoAll = ['2026-08', '2026-09', '2026-10'].map((monthKey) => ({
    monthKey, label: monthKey, from: `${monthKey}-01`, to: `${monthKey}-28`, partial: true,
    revenue: slotsAll.find((s) => s.monthKey === monthKey).totals.revenue, units: 1,
  }));
  const costsAll = { fileName: 'c.xlsx', uploadedAt: '2026-11-01', products, otherCosts: {} };
  const perMonth = buildProductMonthProfit({ productName: P1.toUpperCase(), monthInfo: monthInfoAll, slots: slotsAll, costs: costsAll });
  assert.strictEqual(perMonth.length, 3);
  assert.strictEqual(perMonth[0].units, 0, 'month without the product: zero units');
  assert.strictEqual(perMonth[0].profitBeforeAds, 0);
  assert.strictEqual(perMonth[0].profitPerUnit, null);
  const brandView = buildBrandProfit({ brand: 'Demo Brand', monthInfo: monthInfoAll, slots: slotsAll, costs: costsAll, adSpendByMonth: {} });
  const brandRow = brandView.products.find((p) => p.productName === P1);
  near(perMonth.reduce((s, m) => s + m.profitBeforeAds, 0), brandRow.profitBeforeAds, 'product months add up to the brand products table');
  near(perMonth[2].profitBeforeAds, 299.95, 'October profit before ads: 3 units at the list-price profit', 0.05);
  const noCost = buildProductMonthProfit({ productName: P3, monthInfo: monthInfoAll, slots: slotsAll, costs: costsAll });
  noCost.forEach((m) => {
    assert.strictEqual(m.netSales, null); assert.strictEqual(m.profitBeforeAds, null); assert.strictEqual(m.profitPerUnit, null); assert.strictEqual(m.marginPct, null);
  });

  // 4. product-month-detail: list mode, trimming, missing city data, profit visibility.
  assert.deepStrictEqual(listProductNames(slotsAll)[0], P1);
  const list = buildProductMonthDetail({ slots: slotsAll });
  assert.deepStrictEqual(Object.keys(list), ['products']);
  const input = { brand: 'Demo Brand', product: P1.toLowerCase(), monthInfo: monthInfoAll, slots: slotsAll, costs: costsAll, brandProfit: brandView, profitVisible: true };
  const detail = buildProductMonthDetail(input);
  assert.strictEqual(detail.product, P1);
  assert.strictEqual(detail.profitVisible, true);
  assert.deepStrictEqual(detail.months.map((m) => m.monthKey), ['2026-09', '2026-10'], 'months start at the first sale');
  assert.strictEqual(detail.months[0].cityDataMissing, true);
  assert.strictEqual(detail.months[0].topCity, null);
  assert.deepStrictEqual(detail.months[0].cities, []);
  assert.strictEqual(detail.months[1].cityDataMissing, false);
  assert.deepStrictEqual(detail.months[1].topCity, { city: 'Jaipur', revenue: 800, sharePct: 66.7 });
  assert.strictEqual(detail.months[1].cities[1].sharePct, 33.3);
  assert.strictEqual(detail.months[1].profit.profitBeforeAds, perMonth[2].profitBeforeAds);
  assert.strictEqual(detail.brandMonths.length, 3);
  near(detail.brandMonths[2].profitBeforeAds, brandView.months[2].netSales - brandView.months[2].productCost - brandView.months[2].fees, 'brand month before ads');
  assert.strictEqual(detail.brandMonths[2].profitAfterAds, brandView.months[2].profit);
  assert.strictEqual(detail.brandMonths[2].adDataMissing, true);
  near(detail.brandTotals.profitAfterAds, brandView.totals.profit, 'brand totals');
  const unpriced = buildProductMonthDetail({ ...input, product: P3 });
  assert.strictEqual(unpriced.months[0].monthKey, '2026-08');
  assert.strictEqual(unpriced.months[0].profit, null, 'no cost sheet row: profit is null');
  const hidden = buildProductMonthDetail({ ...input, profitVisible: false });
  assert.strictEqual(hidden.profitVisible, false);
  hidden.months.forEach((m) => assert.strictEqual(m.profit, null));
  assert.deepStrictEqual(hidden.brandMonths, []);
  assert.strictEqual(hidden.brandTotals, null);
  assert.strictEqual(hidden.months[1].revenue, detail.months[1].revenue, 'sales figures stay visible');
  assert.strictEqual(buildProductMonthDetail({ ...input, product: 'Nothing sold' }).months.length, 0);

  assert.strictEqual(canSeeProductProfit(false, null), true);
  assert.strictEqual(canSeeProductProfit(false, { role: 'viewer' }), true);
  assert.strictEqual(canSeeProductProfit(true, { role: 'viewer' }), false);
  assert.strictEqual(canSeeProductProfit(true, null), false);
  assert.strictEqual(canSeeProductProfit(true, { role: 'admin' }), true);

  console.log('profit smoke test passed');
})().catch((err) => { console.error('profit smoke test FAILED:', err.message); process.exit(1); });
