// Offline test for the Profit tab view (no database, no .env). Usage: node scripts/profit-view-smoke.js
const assert = require('assert');
const Module = require('module');

// Typed numbers are stored through store/kv.js (Supabase). Swap in a tiny in-memory kv so this runs offline.
const memory = new Map();
const kvStub = {
  peek: (key, fallback = null) => (memory.has(key) ? memory.get(key) : fallback),
  get: (key, fallback = null) => (memory.has(key) ? structuredClone(memory.get(key)) : fallback),
  set: async (key, value) => { memory.set(key, structuredClone(value)); },
};
const originalLoad = Module._load;
Module._load = function load(request, ...rest) {
  if (/store\/kv$/.test(request)) return kvStub;
  return originalLoad.call(this, request, ...rest);
};

const { buildProfitView, apportion, cleanSettingsPatch, DEFAULT_SETTINGS } = require('../parser/profitView');
const brandCosts = require('../parser/brandCosts');

// --- 1. Hand-checkable maths: one product, one city, one month ---------------------------------
// 10 units, Rs 1180 gross at 18% GST -> Rs 1000 net. COGS 40 x 10 = 400. Commission 5% of 1180 = 59.
// Defaults: inward 5 x 10 = 50, fulfilment 50 x 10 = 500, storage 30 x 10 = 300. Ads 100, other 50.
// profit = 1000 - 400 - 59 - 50 - 500 - 300 - 100 - 50 = -459
const oneMonth = [{ monthKey: '2026-10', label: 'October 2026', from: '2026-10-01', to: '2026-10-31', partial: false, revenue: 1180 }];
const oneSlot = [{ monthKey: '2026-10', products: [{ productName: 'Demo Spoon Set', revenue: 1180, units: 10, orderCount: 9, cities: [{ city: 'Mumbai', revenue: 1180, units: 10, orderCount: 9 }] }] }];
const simple = buildProfitView({
  brand: 'Demo', slots: oneSlot, monthInfo: oneMonth, adSpendByMonth: { '2026-10': 100 },
  costs: { products: [], otherCosts: { '2026-10': 50 }, manual: { products: { demospoonset: { productName: 'Demo Spoon Set', cogs: 40, commissionPct: 5 } } } },
});
assert.deepStrictEqual(
  { gross: simple.totals.gross, gst: simple.totals.gst, net: simple.totals.net, cogs: simple.totals.cogs, fees: simple.totals.fees, storage: simple.totals.storage, ads: simple.totals.ads, other: simple.totals.other, profit: simple.totals.profit },
  { gross: 1180, gst: 180, net: 1000, cogs: 400, fees: 59 + 50 + 500, storage: 300, ads: 100, other: 50, profit: -459 },
  'hand-worked example',
);
assert.strictEqual(simple.totals.marginPct, -45.9);
assert.ok(simple.checks.every((c) => c.ok), 'every tie-out check passes');

// A product with no COGS: shown, but left out of profit, and it takes no share of ads or other expenses.
const noCogs = buildProfitView({ brand: 'Demo', slots: oneSlot, monthInfo: oneMonth, adSpendByMonth: { '2026-10': 100 }, costs: null });
assert.strictEqual(noCogs.totals.gross, 1180);
assert.strictEqual(noCogs.totals.net, 1000, 'net sales still shown');
assert.strictEqual(noCogs.totals.leftOut, 1000);
assert.strictEqual(noCogs.totals.profit, 0, 'nothing priced, nothing counted');
assert.strictEqual(noCogs.totals.ads, 0);
assert.deepStrictEqual(noCogs.notes.leftOutProducts.map((p) => p.productName), ['Demo Spoon Set']);
assert.strictEqual(noCogs.notes.unallocated.length, 1, 'the unshared ad spend is reported, not lost');

// --- 2. Sharing: brand-wide costs follow sales, and a filter shows a slice of the same profit -----------
const months = [
  { monthKey: '2026-08', label: 'August 2026', from: '2026-08-01', to: '2026-08-31', partial: false, revenue: 2360 },
  { monthKey: '2026-09', label: 'September 2026', from: '2026-09-01', to: '2026-09-30', partial: false, revenue: 4720 },
  { monthKey: '2026-10', label: 'October 2026', from: '2026-10-01', to: '2026-10-31', partial: false, revenue: 4720 },
  { monthKey: '2026-11', label: 'November 2026', from: '2026-11-01', to: '2026-11-01', partial: true, revenue: 118 },
];
const city = (name, revenue, units) => ({ city: name, revenue, units, orderCount: units });
const slots = [
  // August was stored before city data existed: products carry no `cities`
  { monthKey: '2026-08', products: [{ productName: 'Alpha Set', revenue: 1180, units: 10 }, { productName: 'Beta Set', revenue: 1180, units: 10 }] },
  { monthKey: '2026-09', products: [
    { productName: 'Alpha Set', revenue: 3540, units: 30, cities: [city('Mumbai', 2360, 20), city('Delhi', 1180, 10)] },
    { productName: 'Beta Set', revenue: 1180, units: 10, cities: [city('Mumbai', 1180, 10)] }] },
  { monthKey: '2026-10', products: [
    { productName: 'Alpha Set', revenue: 2360, units: 20, cities: [city('Mumbai', 1180, 10), city('Delhi', 1180, 10)] },
    { productName: 'Beta Set', revenue: 1180, units: 10, cities: [city('Mumbai', 1180, 10)] },
    { productName: 'Gamma Set', revenue: 1180, units: 10, cities: [city('Delhi', 1180, 10)] }] },
  { monthKey: '2026-11', products: [{ productName: 'Alpha Set', revenue: 118, units: 1, cities: [city('Mumbai', 118, 1)] }] },
];
const costs = {
  products: [],
  otherCosts: { '2026-09': 700, '2026-10': 1001 },
  manual: {
    products: {
      alphaset: { productName: 'Alpha Set', cogs: 30, commissionPct: 4 },
      betaset: { productName: 'Beta Set', cogs: 60, commissionPct: 2, taxPct: 5 },
      // Gamma Set has no COGS on purpose
    },
    settings: { inwardFee: 5, fulfilmentFee: 40, storageFee: 20 },
  },
};
const base = { brand: 'Demo', slots, monthInfo: months, costs, adSpendByMonth: { '2026-09': 600.5, '2026-10': 1000 } };

const full = buildProfitView({ ...base, groupBy: 'product', months: ['2026-10'] });
const alpha = full.rows.find((r) => r.label === 'Alpha Set');
const beta = full.rows.find((r) => r.label === 'Beta Set');
const gamma = full.rows.find((r) => r.label === 'Gamma Set');
// October ads 1000 shared by gross over the PRICED facts only: Alpha 2360 + Beta 1180 = 3540 (Gamma has no COGS).
assert.strictEqual(alpha.ads + beta.ads, 1000, 'priced products carry all of the ad spend');
assert.strictEqual(alpha.ads, 667); // 1000 x 2360 / 3540 = 666.67
assert.strictEqual(beta.ads, 333);
assert.strictEqual(gamma.ads, 0);
assert.strictEqual(alpha.other + beta.other, 1001, 'other expenses are shared out exactly');
assert.strictEqual(gamma.leftOut, 1000, 'Gamma net sales (1180 / 1.18) shown but left out');

// Filtering to one product shows that product's own row of the full view, not a different number.
const justAlpha = buildProfitView({ ...base, groupBy: 'month', months: ['2026-10'], products: ['Alpha Set'] });
assert.strictEqual(justAlpha.totals.profit, alpha.profit);
assert.strictEqual(justAlpha.totals.ads, alpha.ads);
assert.strictEqual(justAlpha.brandCosts.wholeBrand, false);

// A city + product slice: Alpha in Delhi only.
const alphaDelhi = buildProfitView({ ...base, groupBy: 'month', months: ['2026-10'], products: ['Alpha Set'], cities: ['Delhi'] });
assert.strictEqual(alphaDelhi.totals.gross, 1180);
assert.strictEqual(alphaDelhi.totals.units, 10);

// Ads tick off: only the ads come out of the costs.
const noAds = buildProfitView({ ...base, groupBy: 'month', months: ['2026-10'], includeAds: false });
const withAds = buildProfitView({ ...base, groupBy: 'month', months: ['2026-10'] });
assert.strictEqual(noAds.totals.ads, 0);
assert.strictEqual(noAds.totals.profit - withAds.totals.profit, 1000);

// --- 3. Every filter mix: rows add up, each row adds up, all groupings agree -----------------------
const cols = ['units', 'gross', 'gst', 'net', 'leftOut', 'cogs', 'fees', 'storage', 'ads', 'other', 'profit'];
let combos = 0;
for (const m of [['2026-10'], ['2026-09', '2026-10'], ['2026-08', '2026-09', '2026-10', '2026-11']]) {
  for (const p of [undefined, ['Alpha Set'], ['Alpha Set', 'Gamma Set'], []]) {
    for (const c of [undefined, ['Mumbai'], ['Mumbai', 'Delhi'], ['Nowhere']]) {
      for (const includeAds of [true, false]) {
        const totals = {};
        for (const groupBy of ['month', 'product', 'city']) {
          const v = buildProfitView({ ...base, groupBy, months: m, products: p, cities: c, includeAds });
          const tag = `${groupBy} ${m.length}m p${p ? p.length : 'all'} c${c ? c.length : 'all'} ads${includeAds}`;
          for (const col of cols) assert.strictEqual(v.rows.reduce((t, r) => t + r[col], 0), v.totals[col], `${tag}: rows do not add up (${col})`);
          for (const r of [...v.rows, v.totals]) {
            assert.strictEqual(r.net - r.leftOut - r.cogs - r.fees - r.storage - r.ads - r.other, r.profit, `${tag}: row arithmetic`);
            assert.strictEqual(r.gross - r.gst, r.net, `${tag}: GST arithmetic`);
          }
          assert.ok(v.checks.every((k) => k.ok), `${tag}: a tie-out check failed`);
          totals[groupBy] = v.totals;
        }
        for (const col of cols) assert.ok(totals.month[col] === totals.product[col] && totals.product[col] === totals.city[col], `groupings disagree on ${col}`);
        combos += 1;
      }
    }
  }
}

// --- 4. Months: default, partial, missing ad data, missing city data ---------------------------------
assert.deepStrictEqual(buildProfitView({ ...base, groupBy: 'month' }).filters.months, ['2026-10'], 'default = latest FULL month');
const compare = buildProfitView({ ...base, groupBy: 'month', months: ['2026-08', '2026-09', '2026-10', '2026-11'] });
assert.deepStrictEqual(compare.rows.map((r) => r.key), ['2026-08', '2026-09', '2026-10', '2026-11']);
assert.strictEqual(compare.rows[3].partial, true);
assert.deepStrictEqual(compare.notes.adMissingMonths, ['August 2026', 'November 2026']);
assert.strictEqual(compare.rows[1].changeGrossPct, 100, 'Sep vs Aug: 2360 to 4720 is +100%');
assert.strictEqual(compare.rows[3].changeGrossPct, null, 'a partial month is never compared');
const cityOnly = buildProfitView({ ...base, groupBy: 'city', months: ['2026-08', '2026-10'], cities: ['Mumbai'] });
assert.deepStrictEqual(cityOnly.notes.cityGapMonths, ['August 2026'], 'a month without city data is named, not guessed');
const augCities = buildProfitView({ ...base, groupBy: 'city', months: ['2026-08'] });
assert.deepStrictEqual(augCities.rows.map((r) => r.label), ['City not recorded']);
assert.strictEqual(augCities.totals.gross, 2360, 'without a city filter the old month still counts');

// --- 5. Rounding helper ---------------------------------------------------------------------------
assert.deepStrictEqual(apportion([1.4, 1.4, 1.2], 4), [2, 1, 1]);
assert.strictEqual(apportion([10.5, 10.5], 21).reduce((a, b) => a + b, 0), 21);
assert.deepStrictEqual(apportion([2, 3], 5), [2, 3]);

// --- 6. Settings and typed values --------------------------------------------------------------------
assert.deepStrictEqual(cleanSettingsPatch({ storageFee: '25' }), { storageFee: 25 });
assert.throws(() => cleanSettingsPatch({ storageFee: -1 }), /storageFee/);
assert.throws(() => cleanSettingsPatch({ defaultTaxPct: 101 }), /defaultTaxPct/);
assert.throws(() => cleanSettingsPatch({ nonsense: 1 }), /Unknown setting/);
assert.throws(() => cleanSettingsPatch({}), /No settings/);
assert.strictEqual(DEFAULT_SETTINGS.storageFee, 30);
assert.strictEqual(DEFAULT_SETTINGS.defaultTaxPct, 18);

(async () => {
  await brandCosts.setProductField('Demo', 'Alpha Set', 'cogs', 30);
  await brandCosts.setProductField('Demo', 'alpha  set', 'commissionPct', 4); // same product: case and spaces ignored
  await brandCosts.setProductField('Demo', 'Beta Set', 'cogs', 60);
  await brandCosts.setProfitSettings('Demo', { storageFee: 20 });
  await brandCosts.setOtherCost('Demo', '2026-10', 1001);
  let stored = brandCosts.getBrandCosts('Demo');
  assert.deepStrictEqual(Object.keys(stored.manual.products).sort(), ['alphaset', 'betaset']);
  assert.strictEqual(stored.manual.products.alphaset.cogs, 30);
  assert.strictEqual(stored.manual.products.alphaset.commissionPct, 4);
  assert.deepStrictEqual(stored.products, [], 'typed values never touch the uploaded sheet rows');
  assert.strictEqual(stored.manual.settings.storageFee, 20);

  // The view reads exactly what was stored.
  const viaStore = buildProfitView({ ...base, costs: stored, groupBy: 'product', months: ['2026-10'] });
  const alphaStored = viaStore.rows.find((r) => r.label === 'Alpha Set');
  assert.strictEqual(alphaStored.cogs, 600, '20 units x 30');
  assert.strictEqual(viaStore.inputs.products.find((p) => p.productName === 'Alpha Set').cogsSource, 'typed');
  assert.strictEqual(viaStore.inputs.settings.storageFee, 20);

  // Clearing a value, and the row disappears once nothing is typed for it.
  await brandCosts.setProductField('Demo', 'Beta Set', 'cogs', null);
  stored = brandCosts.getBrandCosts('Demo');
  assert.strictEqual(stored.manual.products.betaset, undefined);
  await assert.rejects(() => brandCosts.setProductField('Demo', 'Alpha Set', 'cogs', -5), /cogs/);
  await assert.rejects(() => brandCosts.setProductField('Demo', 'Alpha Set', 'colour', 5), /field must be/);
  await assert.rejects(() => brandCosts.setProductField('Demo', '', 'cogs', 5), /productName/);
  await assert.rejects(() => brandCosts.setProductField('Demo', 'Alpha Set', 'taxPct', 150), /taxPct/);

  // A cost-sheet upload replaces the sheet rows but keeps what was typed and the other expenses.
  await brandCosts.saveBrandProducts('Demo', [{ productName: 'Sheet Item', cogs: 10 }], 'sheet.xlsx', '2026-11-13');
  stored = brandCosts.getBrandCosts('Demo');
  assert.strictEqual(stored.products.length, 1);
  assert.strictEqual(stored.manual.products.alphaset.cogs, 30, 'typed values survive an upload');
  assert.strictEqual(stored.manual.settings.storageFee, 20);
  assert.strictEqual(stored.otherCosts['2026-10'], 1001);

  console.log(`profit-view smoke test passed (${combos} filter mixes x 3 groupings checked)`);
})().catch((error) => { console.error(error); process.exit(1); });
