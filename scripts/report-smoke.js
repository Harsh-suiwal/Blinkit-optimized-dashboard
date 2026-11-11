// Offline test for the client Report data (no database, no .env). Usage: node scripts/report-smoke.js
const assert = require('assert');

// The builder reads campaign figures through campaignStore, which touches storage only when asked to.
const kvPath = require.resolve('../store/kv');
require.cache[kvPath] = { id: kvPath, filename: kvPath, loaded: true, exports: { peek: (k, f = null) => f, get: (k, f = null) => f } };
const { buildBrandReport } = require('../parser/brandReport');

const near = (a, e, label, tol = 0.011) => assert.ok(Math.abs(a - e) <= tol, `${label}: got ${a}, expected ${e}`);

// ---- Sales: three months, five products ----------------------------------------------------
const P = ['Demo Alpha', 'Demo Beta', 'Demo Gamma', 'Demo Delta', 'Demo Epsilon'];
const slot = (monthKey, to, perProduct) => {
  const products = P.map((productName, i) => ({ productName, units: perProduct[i], revenue: perProduct[i] * 140, orderCount: perProduct[i] })).filter((p) => p.units > 0);
  const units = perProduct.reduce((s, v) => s + v, 0);
  return { brandName: 'Demo Brand', platform: 'blinkit', monthKey, from: `${monthKey}-01`, to,
    totals: { revenue: units * 140, units, orderCount: units, avgOrderValue: 140 }, products,
    cities: [{ city: 'Jaipur', revenue: units * 100, units }, { city: 'Delhi', revenue: units * 40, units: 0 }] };
};
const slots = [slot('2026-08', '2026-08-31', [1, 2, 1, 1, 0]), slot('2026-09', '2026-09-30', [22, 22, 20, 21, 20]), slot('2026-10', '2026-10-16', [32, 22, 4, 4, 3])];

// ---- Advertising: a few hand-made daily rows, plus a 14-day weekday pattern ----------------
const row = (periodKey, date, campaignId, campaignName, sheetType, keyword, spend, sales, units, impressions, atc) => ({
  periodKey, sheetType, date, campaignId, campaignName, brandName: 'Demo Brand', targetingType: keyword ? 'KEYWORD' : 'CATEGORY', targetingValue: keyword,
  estimatedBudgetConsumed: spend, directSales: sales, indirectSales: 0, impressions, directAtc: atc, indirectAtc: 0, directQtySold: units, indirectQtySold: 0, newUsersAcquired: 0,
});
const PB = 'PRODUCT_BOOSTING'; const RC = 'PRODUCT_RECOMMENDATION';
const hand = [
  row('2026-09', '2026-09-03', 'c1', 'Top Performing', PB, 'kw alpha', 1000, 300, 2, 3000, 6),
  row('2026-09', '2026-09-20', 'c1', 'Top Performing', PB, 'kw beta', 500, 0, 0, 1000, 1),
  row('2026-09', '2026-09-21', 'c2', 'Second', PB, 'kw alpha', 400, 120, 1, 800, 2),
  row('2026-09', '2026-09-22', 'c3', 'Recs', RC, '', 100, 0, 0, 200, 0),
  row('2026-10', '2026-10-02', 'c1', 'Top Performing', PB, 'kw alpha', 600, 100, 1, 500, 1),
  row('2026-10', '2026-10-16', 'c2', 'Second', PB, 'kw beta', 300, 40, 1, 300, 1),
];
const base = { brand: 'Demo Brand', monthKeys: null, slots, campaignRows: hand, campaignPeriods: [{ periodKey: '2026-09', periodLabel: 'September 2026' }, { periodKey: '2026-10', periodLabel: 'October 2026' }], inventoryRows: [], profit: null, today: '2026-10-17' };
const rep = buildBrandReport(base);

// Sales
const s = rep.sales;
assert.deepStrictEqual(s.months.map((m) => [m.label, m.days, m.partial, m.units]), [['August 2026', 31, false, 5], ['September 2026', 30, false, 105], ['October 2026', 16, true, 65]]);
near(s.latest.unitsPerDay, 4.06, 'October units per day'); near(s.previous.unitsPerDay, 3.5, 'September units per day');
near(s.rateChangePct, 16.1, 'daily rate change', 0.05);
assert.strictEqual(s.multiple, 21);
assert.deepStrictEqual(s.projection, { units: 126, perDay: 4.06, days: 31 });
assert.deepStrictEqual(s.rows.slice(0, 2).map((r) => r.name), ['Demo Alpha', 'Demo Beta']);
near(s.rows[0].rateChangePct, 172.7, 'top product daily rate change', 0.05);
near(s.rows[1].rateChangePct, 87.5, 'second product daily rate change', 0.05);
near(s.rows[2].rateChangePct, -64.3, 'third product (a tie on units: more units over all months first) daily rate change', 0.05);
near(s.rows[3].rateChangePct, -62.5, 'fourth product daily rate change', 0.05);
near(s.rows[0].mixPct, 49.2, 'mix', 0.05); near(s.rows[0].runRate, 62, 'run rate', 0.05);
assert.deepStrictEqual(s.rows[0].perMonth, [1, 22, 32]);
const c = s.concentration;
assert.deepStrictEqual(c.top, ['Demo Alpha', 'Demo Beta']);
assert.deepStrictEqual([c.previous.top1, c.previous.top2, c.previous.rest, c.previous.topShare], [21, 21, 58.1, 41.9]);
assert.deepStrictEqual([c.latest.top1, c.latest.top2, c.latest.rest, c.latest.topShare], [49.2, 33.8, 16.9, 83.1]);
assert.deepStrictEqual([c.latest.topUnits, c.latest.restUnits, c.previous.restUnits], [54, 11, 61]);
near(c.topChange, 1.91, 'change of the top two per day', 0.005); near(c.restChange, -1.35, 'change of the rest per day', 0.005); near(c.netChange, 0.56, 'net change per day', 0.005);
assert.deepStrictEqual(c.totalPerDay, { previous: 3.5, latest: 4.06 });
near(c.topPerDay.previous, 1.47, 'top two per day before'); near(c.topPerDay.latest, 3.38, 'top two per day now');
near(c.restPerDay.previous, 2.03, 'the rest per day before'); near(c.restPerDay.latest, 0.69, 'the rest per day now');
assert.strictEqual(s.latest.cityCount, 2);

// Advertising
const a = rep.ads;
assert.deepStrictEqual(a.months.map((m) => m.label), ['September 2026', 'October 2026']);
assert.deepStrictEqual(a.months.map((m) => m.campaignCount), [3, 2]);
const sep = a.months[0]; const oct = a.months[1];
assert.deepStrictEqual([sep.spend, sep.sales, sep.units, sep.impressions, sep.roas], [2000, 420, 3, 5000, 0.21]);
assert.strictEqual(sep.spendPerUnit, 666.67); assert.strictEqual(sep.spendPer1000, 400); assert.strictEqual(sep.revenuePer1000, 84);
assert.deepStrictEqual(sep.byType.map((t) => [t.label, t.spend]), [['Product Booster', 1900], ['Recommendation Ads', 100]]);
assert.deepStrictEqual(sep.campaigns.map((x) => [x.name, x.spend]), [['Top Performing', 1500], ['Second', 400], ['Recs', 100]]);
assert.strictEqual(sep.campaigns[0].roas, 0.2);
assert.deepStrictEqual([oct.spend, oct.units, oct.roas, oct.days], [900, 2, 0.16, 15]);
assert.strictEqual(a.change.roas, -23.8); assert.strictEqual(a.change.spend, -55);
assert.strictEqual(sep.campaigns[2].status.startsWith('Ended') || sep.campaigns[2].status === 'Active', true);

// Keywords: zero-sale spend is flagged, the best ROAS gets a controlled test
const kws = rep.keywords.list;
const kw = (name) => kws.find((k) => k.keyword === name);
assert.strictEqual(kws[0].keyword, 'kw alpha');                              // biggest spend first
assert.strictEqual(kw('kw alpha').decision, 'Controlled test');                // best ROAS with sales
assert.strictEqual(kw('kw beta').decision === 'Reduce expenditure' || kw('kw beta').decision === 'Test lower bid', true);
assert.strictEqual(kw('kw alpha').evidence, 'Low to medium');

// Weekday and funnel: a 14-day pattern, Mon/Tue/Fri spend and never sell
const days = [];
for (let d = 1; d <= 14; d += 1) {
  const date = `2026-09-${String(d).padStart(2, '0')}`;
  const dow = new Date(Date.UTC(2026, 8, d)).getUTCDay();                       // 0 = Sunday
  const plan = { 1: [300, 0, 0], 2: [300, 0, 0], 3: [100, 300, 2], 4: [100, 320, 2], 5: [300, 0, 0], 6: [150, 140, 1], 0: [150, 140, 1] }[dow];
  days.push(row('2026-09', date, 'w1', 'Weekday test', PB, '', plan[0], plan[1], plan[2], 1000, 2));
}
const rep2 = buildBrandReport({ ...base, campaignRows: days, slots: [], monthKeys: ['2026-09'] });
assert.strictEqual(rep2.sales, null, 'no sales months: the sales section is absent, not empty');
const w = rep2.weekday;
assert.deepStrictEqual(w.days.map((d) => d.short), ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
assert.ok(w.days.every((d) => d.daysWithData === 2));
assert.deepStrictEqual(w.winners, ['Thu', 'Wed']);
assert.deepStrictEqual(w.priorities.sort(), ['Fri', 'Mon', 'Tue']);
assert.deepStrictEqual(w.priorityShare, { spend: Math.round((1800 / 2800) * 100), units: 0 });
assert.strictEqual(w.totals.daysWithData, 14);
const f = rep2.funnel;
assert.deepStrictEqual([f.impressions, f.atc, f.units, f.spend], [14000, 28, 12, 2800]);   // 6 units a week x 2 weeks
assert.strictEqual(f.atcRatePct, 0.2); assert.strictEqual(f.spendPerAtc, 100); assert.strictEqual(f.spendPerUnit, 233.33);
assert.ok(rep2.available.weekday && rep2.available.funnel && !rep2.available.sales);

// Months, stock and profit
assert.deepStrictEqual(buildBrandReport({ ...base, monthKeys: ['2026-09', '2026-10'] }).selectedMonths, ['2026-09', '2026-10']);
assert.deepStrictEqual(rep.selectedMonths, ['2026-08', '2026-09', '2026-10'], 'default: every month with data (at most the latest four)');
assert.deepStrictEqual(rep.availableMonths.map((m) => [m.monthKey, m.hasSales, m.hasAds]), [['2026-08', true, false], ['2026-09', true, true], ['2026-10', true, true]]);
const stockRows = [
  { productName: 'Demo Alpha', warehouseName: 'W1', totalStockAvailable: 10, unitsSold30: 30, stockStatus: 'ok' },
  { productName: 'Demo Alpha', warehouseName: 'W2', totalStockAvailable: 0, unitsSold30: 5, stockStatus: 'out' },
  { productName: 'Demo Beta', warehouseName: 'W1', totalStockAvailable: 4, unitsSold30: 12, stockStatus: 'low' },
];
const withStock = buildBrandReport({ ...base, inventoryRows: stockRows });
assert.deepStrictEqual(withStock.stock.totals, { stock: 14, sold30: 47, listings: 3, lowOrOut: 2, products: 2 });
assert.strictEqual(withStock.stock.products[0].name, 'Demo Alpha');
assert.ok(withStock.insights.management.fix[0].includes('2 of 3'));
assert.strictEqual(rep.profit, null, 'no profit unless it was passed in');
const profit = { hasCosts: true, months: [
  { monthKey: '2026-09', label: 'September 2026', partial: false, status: 'ok', netSales: 1000, productCost: 400, fees: 100, adSpend: 200, otherCosts: 0, totalCosts: 700, profit: 300, marginPct: 30, roiPct: 42.9, adDataMissing: false },
  { monthKey: '2026-10', label: 'October 2026', partial: true, status: 'no-costs', netSales: null }],
  products: [{ productName: 'Demo Alpha', units: 10, netSales: 500, profitBeforeAds: 200, profitPerUnit: 20, listUnitProfit: 21 }] };
const withProfit = buildBrandReport({ ...base, profit });
assert.deepStrictEqual(withProfit.profit.months.length, 1, 'months without costs are left out');
assert.strictEqual(withProfit.profit.contributionMarginPct, 50); assert.strictEqual(withProfit.profit.breakEvenRoas, 2);
assert.strictEqual(withProfit.profit.products[0].marginPct, 40);

// Rule-based text never claims more than the numbers show
assert.ok(rep.insights.trajectory.includes('16.1% above'));
assert.ok(rep.insights.concentration.includes('Demo Alpha + Demo Beta'));
assert.ok(rep.insights.decisions.length >= 2 && rep.insights.decisions.length <= 3);
assert.deepStrictEqual(buildBrandReport({ ...base, slots: [], campaignRows: [] }).available, { sales: false, trajectory: false, concentration: false, ads: false, efficiency: false, weekday: false, funnel: false, keywords: false, stock: false, profit: false });

console.log('report smoke test passed');
