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

console.log('profit smoke test passed');
