// Offline test for the Profit tab maths (no database, no .env). Usage: node scripts/profit-smoke.js
const assert = require('assert');
const { parseCostRows, unitEconomics } = require('../parser/parseBrandCosts');
const { buildBrandProfit } = require('../parser/brandProfit');

const near = (actual, expected, label, tolerance = 0.011) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: got ${actual}, expected ${expected}`);

// A cost sheet laid out like the real one (the two header names in the first row are a group row).
const header = ['Product Name', 'MRP', 'Selling Price', 'Tax %', 'Selling Price Excl. Tax', 'Product COGS',
  'Blinkit Inward Fee', 'Blinkit Storage Fee', 'Blinkit Fulfilment Fee', 'Blinkit Commission Fee'];
const rows = [
  ['Oicia Stainless Steel Linea Knife, Spoon & Fork Set(Box)', 497, 415, '18%', 351.7, 176.44, 5, 30, 50, 24.9],
  ['Oicia Stainless Steel Mystic Silver Salad Fork Set(Box)', 351, 280, 0.18, 237.3, 227.5, 5, '-', 50, 5.6],
  ['Oicia Stainless Steel Linea Silver Dessert Spoon Set(Box)', 483, 395, 18, 334.7, 185.35, 5, '-', 50, 15.8],
  ['Oicia Stainless Steel Modern Mystic Silver Dessert Spoon Set(Box)', 351, 280, '18%', 237.3, 223.6, 5, '-', 50, 5.6],
  ['Oicia Broad Blade Chef Knife (Stainless Steel)(Box)', 340, 280, '18%', 237.3, 149.38, 5, '-', 50, 5.6],
  ['Oicia Santoku-Style Waldon Butcher Knife (Stainless Steel, Wood)(Box)', 467, 380, '18%', 322.0, 108.01, 5, '-', 50, 15.2],
  ['Oicia Stainless Steel Fork Set(Box)', 483, 370, '18%', 313.6, 230.28, 5, '-', 50, 14.8],
  ['Oicia Heavy Duty Cleaver Knife (Stainless Steel)(Box) (1 unit)', 607, 509, '18%', 431.4, 170.51, 5, '-', 50, 40.72],
  ['Oicia NonStick Brush & Spatula Set (Silicone) (Box, Pack) (1 pair)', 294, 250, 0.05, 238.1, 63.75, 5, '-', 50, 5],
  ['Oicia Stainless Steel Spoon Set(Box)', 461, 399, '18%', 338.1, 256.75, 5, '-', 50, 15.96],
];
const { products, skippedRows } = parseCostRows([['', 'Product details'], header, ...rows, ['', '', '', '', '', '', '', '', '', '']]);
assert.strictEqual(products.length, 10);
assert.strictEqual(skippedRows, 0);
assert.deepStrictEqual(products.map((p) => p.commissionPct), [6, 2, 4, 2, 2, 4, 4, 8, 2, 4], 'commission %');
assert.deepStrictEqual(products.map((p) => p.taxPct), [18, 18, 18, 18, 18, 18, 18, 18, 5, 18], 'tax %');
assert.strictEqual(products[0].storageFee, 30);
assert.strictEqual(products[1].storageFee, 0, 'a dash means no fee');
near(unitEconomics(products[0]).profit, 65.35, 'unit profit, first product');
near(unitEconomics(products[1]).profit, -50.81, 'unit profit, second product');

assert.throws(() => parseCostRows([['Name', 'Price']]), /Missing expected column/);
assert.throws(() => parseCostRows([header]), /No product rows/);

// One October month: 10 units of product 1, 5 of product 2, one product that has no cost row.
const slots = [{
  monthKey: '2026-10',
  products: [
    { productName: 'OICIA Stainless Steel Linea Knife, Spoon & Fork Set(Box)', revenue: 4150, units: 10, orderCount: 9 },
    { productName: 'Oicia Stainless Steel Mystic Silver Salad Fork Set(Box)', revenue: 1400, units: 5, orderCount: 5 },
    { productName: 'Unknown Gadget', revenue: 500, units: 1, orderCount: 1 },
  ],
}];
const monthInfo = [{ monthKey: '2026-10', label: 'October 2026', from: '2026-10-01', to: '2026-10-31', partial: false, revenue: 6050, units: 16 }];
const costs = { fileName: 'costs.xlsx', uploadedAt: '2026-11-04', products, otherCosts: { '2026-10': 200 } };
const result = buildBrandProfit({ brand: 'Oicia', monthInfo, slots, costs, adSpendByMonth: { '2026-10': 300 } });

const m = result.months[0];
assert.strictEqual(m.status, 'incomplete');
near(m.netSales, 4703.39, 'net sales');           // 4150/1.18 + 1400/1.18
near(m.productCost, 2901.9, 'product cost');       // 10 x 176.44 + 5 x 227.5
near(m.fees, 1402, 'fees');                        // commission 277 + inward 75 + fulfilment 750 + storage 300
assert.strictEqual(m.adSpend, 300);
assert.strictEqual(m.otherCosts, 200);
near(m.totalCosts, 4803.9, 'total costs');
near(m.profit, -100.51, 'profit');
near(m.marginPct, -2.1, 'margin %', 0.05);
near(m.roiPct, -2.1, 'ROI %', 0.05);
near(m.matchedRevenuePct, 91.7, 'matched revenue %', 0.05);
assert.deepStrictEqual(m.unmatchedProducts.map((u) => u.productName), ['Unknown Gadget']);
assert.strictEqual(result.totals.months, 1);
assert.strictEqual(result.totals.profit, m.profit);
assert.strictEqual(result.products.length, 10);
near(result.products[0].profitPerUnit, 65.35, 'per unit, best product first');
assert.strictEqual(result.products[1].units, 5);
near(result.products[1].profitPerUnit, -50.81, 'per unit, loss maker');

// No cost sheet: sales still listed, no profit invented. Months without ad data say so.
const bare = buildBrandProfit({ brand: 'Oicia', monthInfo, slots, costs: null, adSpendByMonth: {} });
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

  const P1 = 'Oicia Stainless Steel Linea Knife, Spoon & Fork Set(Box)';
  const P2 = 'Oicia Stainless Steel Mystic Silver Salad Fork Set(Box)';
  const P3 = 'Oicia Mystery Item';
  const line = (orderId, city, productName, quantity, revenue, orderDate = '2026-10-03') =>
    ({ orderId, orderDate, brandName: 'Oicia', customerCity: city, productName, quantity, revenue });

  // 1. buildMonthSlots: each product carries its cities; orders are counted like the product totals.
  const built = buildMonthSlots([
    line('A1', 'Jaipur', P1, 1, 415), line('A1', 'Jaipur', P1, 1, 415), // one order, two lines
    line('A2', 'Delhi', P1, 1, 415), line('A3', 'Jaipur', P2, 1, 280),
  ], 'oct.xlsx', '2026-11-01');
  const octSlot = built.slots[0];
  const p1 = octSlot.products.find((p) => p.productName === P1);
  assert.strictEqual(p1.orderCount, 2);
  assert.deepStrictEqual(p1.cities, [
    { city: 'Jaipur', revenue: 830, units: 2, orderCount: 1 },
    { city: 'Delhi', revenue: 415, units: 1, orderCount: 1 },
  ]);
  assert.strictEqual(p1.cities.reduce((s, c) => s + c.revenue, 0), p1.revenue, 'cities add up to the product');
  assert.deepStrictEqual(octSlot.products.find((p) => p.productName === P2).cities, [{ city: 'Jaipur', revenue: 280, units: 1, orderCount: 1 }]);

  // 2. The slot validator keeps cities when present and invents none when absent (older months).
  await restoreMonth(octSlot);
  assert.strictEqual(slotsFor('Oicia', 'blinkit')[0].products[0].cities.length > 0, true, 'cities survive a restore');
  const oldSlot = JSON.parse(JSON.stringify({ ...octSlot, monthKey: '2026-09', from: '2026-09-01', to: '2026-09-30' }));
  oldSlot.products.forEach((p) => { delete p.cities; });
  await restoreMonth(oldSlot);
  const storedOld = slotsFor('Oicia', 'blinkit').find((s) => s.monthKey === '2026-09');
  assert.strictEqual(storedOld.products[0].cities, undefined, 'old months stay without cities');
  const augSlot = { ...oldSlot, monthKey: '2026-08', from: '2026-08-01', to: '2026-08-31', products: [{ productName: P3, revenue: 100, units: 1, orderCount: 1 }] };
  await restoreMonth(augSlot);

  // 3. One-product profit uses the same formulas as the brand profit.
  const slotsAll = slotsFor('Oicia', 'blinkit');
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
  const brandView = buildBrandProfit({ brand: 'Oicia', monthInfo: monthInfoAll, slots: slotsAll, costs: costsAll, adSpendByMonth: {} });
  const brandRow = brandView.products.find((p) => p.productName === P1);
  near(perMonth.reduce((s, m) => s + m.profitBeforeAds, 0), brandRow.profitBeforeAds, 'product months add up to the brand products table');
  near(perMonth[2].profitBeforeAds, 3 * 65.35, 'October profit before ads: 3 units at the list-price profit', 0.05);
  const noCost = buildProductMonthProfit({ productName: P3, monthInfo: monthInfoAll, slots: slotsAll, costs: costsAll });
  noCost.forEach((m) => {
    assert.strictEqual(m.netSales, null); assert.strictEqual(m.profitBeforeAds, null); assert.strictEqual(m.profitPerUnit, null); assert.strictEqual(m.marginPct, null);
  });

  // 4. product-month-detail: list mode, trimming, missing city data, profit visibility.
  assert.deepStrictEqual(listProductNames(slotsAll)[0], P1);
  const list = buildProductMonthDetail({ slots: slotsAll });
  assert.deepStrictEqual(Object.keys(list), ['products']);
  const input = { brand: 'Oicia', product: P1.toLowerCase(), monthInfo: monthInfoAll, slots: slotsAll, costs: costsAll, brandProfit: brandView, profitVisible: true };
  const detail = buildProductMonthDetail(input);
  assert.strictEqual(detail.product, P1);
  assert.strictEqual(detail.profitVisible, true);
  assert.deepStrictEqual(detail.months.map((m) => m.monthKey), ['2026-09', '2026-10'], 'months start at the first sale');
  assert.strictEqual(detail.months[0].cityDataMissing, true);
  assert.strictEqual(detail.months[0].topCity, null);
  assert.deepStrictEqual(detail.months[0].cities, []);
  assert.strictEqual(detail.months[1].cityDataMissing, false);
  assert.deepStrictEqual(detail.months[1].topCity, { city: 'Jaipur', revenue: 830, sharePct: 66.7 });
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
