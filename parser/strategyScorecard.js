// Strategy tab: the Health Scorecard (playbook Part 3) as pure functions. No kv, no Supabase, no AI.
// The server passes in the brand's data; this returns the 8 coloured pills, the top 3 actions and the
// one-line summary of each accordion row. Colours are NEVER chosen by the AI.
//
// Status: 'g' green, 'a' amber, 'r' red, 'na' = the data to judge it is not in the system.
// ASSUMPTIONS (not in the playbook, change here only): HERO_CLEAR_PCT, HERO_THIN_PCT, MARGIN_FLAT_PCT, ROAS_BAND.
const { STOCK_SETTINGS } = require('./stockStatus');

const HERO_CLEAR_PCT = 35;  // top product is at least this share of revenue (and 3+ products) = green
const HERO_THIN_PCT = 20;   // below this = sales spread thin = red
const MARGIN_FLAT_PCT = 1;  // margin after ads within +-1% counts as "about zero" = amber
const ROAS_BAND = 0.1;      // net ROAS within 10% of break-even = amber

const FIX_ORDER = ['stock', 'listing', 'margin', 'ads', 'trend', 'hero', 'organic'];
const LABELS = { compliance: 'Compliance', stock: 'Stock', listing: 'Listing', hero: 'Hero', ads: 'Ads', organic: 'Organic', trend: 'Trend', margin: 'Margin' };
const SHOWN_ORDER = ['stock', 'listing', 'hero', 'ads', 'organic', 'trend', 'margin'];

const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const r1 = (n) => Math.round(n * 10) / 10;
const same = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

function pill(key, status, note, facts = {}) {
  return { key, name: LABELS[key], status, note, facts };
}

/** Hero = the chosen product, else the best seller of the latest sales upload, else the best 30-day seller in stock. */
function heroName({ product, overview }) {
  if (product) return product;
  const sales = overview && overview.sales && overview.sales.topProducts;
  if (sales && sales.length) return sales[0].productName;
  const stock = overview && overview.inventory && overview.inventory.topSellers;
  return stock && stock.length ? stock[0].productName : '';
}

function stockCover(stockRows, hero) {
  const rows = (stockRows || []).filter((r) => same(r.productName, hero));
  if (!hero || !rows.length) return null;
  const stock = rows.reduce((s, r) => s + (r.totalStockAvailable || 0), 0);
  const pace = rows.reduce((s, r) => s + ((r.stockHealth && r.stockHealth.pacePerDay) || 0), 0);
  const incoming = rows.reduce((s, r) => s + (r.incomingScheduledInventory || 0), 0);
  return { stock, incoming, pace: r1(pace), days: pace > 0 ? r1(stock / pace) : null };
}

function evalCompliance(inputs) {
  if (inputs.compliance === 'confirmed') return pill('compliance', 'g', 'Confirmed by the brand');
  if (inputs.compliance === 'doubt') return pill('compliance', 'r', 'Doubt or violation: stop ads until resolved');
  return pill('compliance', 'a', 'Not checked yet');
}

function evalStock(cover, hero) {
  if (!cover) return pill('stock', 'na', 'No stock upload for the hero product', { hero });
  const { HEALTHY_DAYS, LEAD_TIME_DAYS } = STOCK_SETTINGS;
  const facts = { hero, ...cover };
  if (cover.stock === 0) return pill('stock', 'r', `${hero} is out of stock`, facts);
  if (cover.days === null) return pill('stock', 'na', 'Hero has no sales in the last 30 days', facts);
  if (cover.days < LEAD_TIME_DAYS) return pill('stock', 'r', `${cover.days} days of cover (under ${LEAD_TIME_DAYS})`, facts);
  if (cover.days < HEALTHY_DAYS) return pill('stock', 'a', `${cover.days} days of cover (target ${HEALTHY_DAYS})`, facts);
  return pill('stock', 'g', `${cover.days} days of cover`, facts);
}

function evalListing(i) {
  const rating = num(i.rating);
  const reviews = num(i.reviewCount);
  const reasons = [];
  if (i.firstImageHasText === true) reasons.push('first image has text');
  if (rating !== null && rating < 3.5) reasons.push(`rating ${rating} is under 3.5`);
  if (reviews === 0) reasons.push('no reviews');
  const facts = { rating, reviews, firstImageHasText: i.firstImageHasText ?? null, hasTitle: Boolean(i.title) };
  if (reasons.length) return pill('listing', 'r', reasons.join(', '), facts);
  const ok = reviews !== null && reviews >= 15 && rating !== null && rating >= 4 && i.firstImageHasText === false && Boolean(i.title);
  if (ok) return pill('listing', 'g', 'Page is retail-ready', facts);
  return pill('listing', 'a', rating === null && reviews === null ? 'Needs listing inputs' : 'Partly done', facts);
}

function evalHero(overview) {
  const sales = overview && overview.sales;
  const top = sales && sales.topProducts && sales.topProducts[0];
  if (!top) return pill('hero', 'na', 'No product sales uploaded');
  const facts = { hero: top.productName, sharePct: top.sharePct, productCount: sales.productCount };
  if (top.sharePct >= HERO_CLEAR_PCT && sales.productCount >= 3) return pill('hero', 'g', `${top.productName} is ${top.sharePct}% of revenue`, facts);
  if (top.sharePct < HERO_THIN_PCT) return pill('hero', 'r', `Sales spread thin: top product is ${top.sharePct}%`, facts);
  return pill('hero', 'a', top.sharePct >= HERO_CLEAR_PCT ? 'Hero clear, no ladder yet' : 'Hero unclear', facts);
}

/** Margin before ads over every month that has a cost sheet match. Break-even ROAS = 1 / that margin (playbook Part 3). */
function breakEven(profit) {
  const t = profit && profit.totals;
  if (!t || !t.netSales) return null;
  const marginBeforeAds = (t.profit + t.adSpend) / t.netSales;
  return marginBeforeAds > 0 ? { marginBeforeAds: r1(marginBeforeAds * 100), roas: r1(1 / marginBeforeAds) } : { marginBeforeAds: r1(marginBeforeAds * 100), roas: null };
}

function evalAds(overview, profit, canSeeProfit) {
  const c = overview && overview.campaign;
  if (!c || c.roas === null || c.roas === undefined) return pill('ads', 'na', 'No advertising data');
  if (!canSeeProfit) return pill('ads', 'na', 'Break-even needs profit access', { roas: c.roas });
  const be = breakEven(profit);
  if (!be || be.roas === null) return pill('ads', 'na', 'Needs a cost sheet to get break-even ROAS', { roas: c.roas });
  const facts = { roas: c.roas, breakEvenRoas: be.roas, marginBeforeAdsPct: be.marginBeforeAds, period: c.periodLabel };
  if (c.roas > be.roas * (1 + ROAS_BAND)) return pill('ads', 'g', `ROAS ${c.roas} vs break-even ${be.roas}`, facts);
  if (c.roas >= be.roas * (1 - ROAS_BAND)) return pill('ads', 'a', `ROAS ${c.roas} is near break-even ${be.roas}`, facts);
  return pill('ads', 'r', `ROAS ${c.roas} is below break-even ${be.roas}`, facts);
}

function evalTrend(monthInfo) {
  const full = (monthInfo || []).filter((m) => !m.partial).slice(-3);
  if (full.length < 2) return pill('trend', 'na', 'Needs 2 full months of sales');
  const [a, b, c] = [full[full.length - 3], full[full.length - 2], full[full.length - 1]];
  const lastPct = b.revenue > 0 ? r1(((c.revenue - b.revenue) / b.revenue) * 100) : null;
  const facts = { months: full.map((m) => ({ monthKey: m.monthKey, revenue: m.revenue })), lastChangePct: lastPct };
  if (a && a.revenue > b.revenue && b.revenue > c.revenue) return pill('trend', 'r', 'Down 2 months in a row', facts);
  if (c.revenue > b.revenue) return pill('trend', 'g', `Up ${lastPct}% on the month before`, facts);
  return pill('trend', 'a', lastPct === null ? 'Flat' : `${lastPct}% on the month before`, facts);
}

function evalMargin(profit, canSeeProfit) {
  if (!canSeeProfit) return pill('margin', 'na', 'Profit is not available for your role');
  const months = ((profit && profit.months) || []).filter((m) => m.status !== 'no-costs' && m.marginPct !== null);
  if (!months.length) return pill('margin', 'na', 'Needs a cost sheet');
  const m = months.filter((x) => !x.partial).pop() || months[months.length - 1];
  const facts = { monthKey: m.monthKey, label: m.label, marginPct: m.marginPct, profit: m.profit, adSpend: m.adSpend, partial: m.partial };
  if (m.marginPct < 0) return pill('margin', 'r', `${m.marginPct}% after ads in ${m.label}`, facts);
  if (m.marginPct <= MARGIN_FLAT_PCT) return pill('margin', 'a', `${m.marginPct}% after ads in ${m.label}`, facts);
  return pill('margin', 'g', `${m.marginPct}% after ads in ${m.label}`, facts);
}

const ACTIONS = {
  stock: (p) => ({ title: `Rebuild stock on ${p.facts.hero}`, why: p.note + '. Target is 60 days.', result: 'Ads run without stockouts.' }),
  listing: (p) => ({ title: 'Fix the product page first', why: p.note + '.', result: 'The same traffic converts better.' }),
  margin: (p) => ({ title: 'Fix margin before scaling ads', why: p.note + '.', result: 'Each extra sale adds profit.' }),
  ads: (p) => ({ title: p.status === 'r' ? 'Cut or fix low-ROAS campaigns' : 'Tighten bids on weak keywords', why: p.note + '.', result: 'Ad spend earns more than it costs.' }),
  trend: (p) => ({ title: 'Find out why sales are slipping', why: p.note + '.', result: 'Sales growth returns.' }),
  hero: (p) => ({ title: 'Pick one hero and build a price ladder', why: p.note + '.', result: 'One product carries the brand.' }),
  organic: (p) => ({ title: 'Check organic vs paid sales', why: p.note + '.', result: 'Ads stop hiding a weak listing.' }),
};

function topActions(pills) {
  const by = Object.fromEntries(pills.map((p) => [p.key, p]));
  const pick = (status) => FIX_ORDER.map((k) => by[k]).filter((p) => p && p.status === status);
  const chosen = [...pick('r'), ...pick('a')].slice(0, 3);
  return chosen.map((p) => ({ area: p.key, status: p.status, ...ACTIONS[p.key](p) }));
}

/** Missing manual inputs. Only these are required for the "N inputs needed" chip. */
function missingInputs(i) {
  const need = [
    ['title', 'Current title', !i.title],
    ['price', 'Price', num(i.price) === null],
    ['rating', 'Rating', num(i.rating) === null],
    ['reviewCount', 'Review count', num(i.reviewCount) === null],
    ['adBudget', 'Monthly ad budget', num(i.adBudget) === null],
  ];
  return need.filter(([, , missing]) => missing).map(([key, label]) => ({ key, label }));
}

const SUMMARY_NA = 'Needs data';
function rowSummaries(pills) {
  const by = Object.fromEntries(pills.map((p) => [p.key, p]));
  return {
    page: by.listing.note,
    kw: by.ads.status === 'na' ? by.ads.note : by.ads.note,
    stock: by.stock.note,
    hero: by.hero.note,
    profit: by.margin.note,
    plan: 'Start at month 1: fix the shelf',
    buyers: SUMMARY_NA,
  };
}

function computeScorecard({ overview, stockRows, profit, monthInfo, inputs, product, canSeeProfit }) {
  const i = inputs || {};
  const hero = heroName({ product, overview });
  const pills = [
    evalCompliance(i),
    evalStock(stockCover(stockRows, hero), hero),
    evalListing(i),
    evalHero(overview),
    evalAds(overview, profit, canSeeProfit),
    pill('organic', 'na', 'Reports have no organic vs paid split yet'),
    evalTrend(monthInfo),
    evalMargin(profit, canSeeProfit),
  ];
  pills.sort((a, b) => SHOWN_ORDER.indexOf(a.key) - SHOWN_ORDER.indexOf(b.key));
  return { hero, pills, actions: topActions(pills), summaries: rowSummaries(pills), missing: missingInputs(i), breakEven: canSeeProfit ? breakEven(profit) : null };
}

module.exports = { computeScorecard, FIX_ORDER };
