// Run: node scripts/strategy-smoke.js
// Checks that the Strategy tab's Margin and Ads pills see COGS typed on the Profit tab, that the base plan is
// well formed, and that unknown tick ids cannot exist. No server, no kv, no AI.
const assert = require('assert');
const { buildProfitView } = require('../parser/profitView');
const { productKey } = require('../parser/parseBrandCosts');
const { computeScorecard, profitFromView } = require('../parser/strategyScorecard');
const { PILLARS, PLAN, MODULES, allTickIds, planAsText } = require('../strategy/basePlan');

// One brand, one full month (2026-10), one product sold in one city. COGS is TYPED (costs.manual), not in an uploaded sheet.
const slots = [{ monthKey: '2026-10', products: [{ productName: 'Knife', revenue: 11800, units: 100, orderCount: 90, cities: [{ city: 'Delhi', revenue: 11800, units: 100, orderCount: 90 }] }] }];
const monthInfo = [{ monthKey: '2026-10', label: 'Oct 2026', partial: false, revenue: 11800 }];
const costs = { manual: { products: { [productKey('Knife')]: { cogs: 40 } }, settings: {} }, products: [], otherCosts: {} };
const view = buildProfitView({ brand: 'Oicia', slots, monthInfo, costs, adSpendByMonth: { '2026-10': 1000 }, groupBy: 'month', months: ['2026-10'], includeAds: true });
const profit = profitFromView(view);

assert.ok(profit && profit.months.length === 1, 'one month row');
const m = profit.months[0];
assert.notStrictEqual(m.status, 'no-costs', 'typed COGS must count as costs');
assert.ok(m.marginPct !== null, 'margin is a number');
// net 10000 (11800 / 1.18), COGS 4000, inward 500, fulfilment 5000, storage 3000, ads 1000 => profit -3500, margin -35%
assert.strictEqual(m.netSales, 10000);
assert.strictEqual(m.profit, -3500);
assert.strictEqual(m.marginPct, -35);

const overview = { sales: { topProducts: [{ productName: 'Knife', sharePct: 100 }], productCount: 1 }, campaign: { roas: 4, periodKey: '2026-10', periodLabel: 'Oct 2026' } };
const card = computeScorecard({ overview, stockRows: [], profit, monthInfo: [{ monthKey: '2026-10', label: 'Oct 2026', partial: false, revenue: 11800 }], inputs: {}, product: '', canSeeProfit: true, adSalesByMonth: {} });
const pill = (k) => card.pills.find((p) => p.key === k);
assert.strictEqual(pill('margin').status, 'r', 'negative margin is red');
assert.notStrictEqual(pill('ads').status, 'na', 'Ads pill has a break-even now');

// Without the profit permission, nothing profit-related is judged.
const noPerm = computeScorecard({ overview, stockRows: [], profit: null, monthInfo: [], inputs: {}, product: '', canSeeProfit: false, adSalesByMonth: {} });
assert.strictEqual(noPerm.pills.find((p) => p.key === 'margin').status, 'na');

// Base plan shape.
const ids = allTickIds();
assert.strictEqual(new Set(ids).size, ids.length, 'tick ids are unique');
assert.strictEqual(PLAN.length, 6);
assert.strictEqual(Object.keys(MODULES).length, 10);
for (const p of PILLARS) assert.ok(p.musts.length > 0 && p.title && p.why, p.id);
for (const mod of Object.values(MODULES)) for (const n of mod.needs) if (n.tick) assert.ok(ids.includes(n.tick), 'add-on points at a real tick: ' + n.tick);
assert.ok(planAsText().includes('6-MONTH PLAN'));

console.log('strategy smoke: all checks passed');
