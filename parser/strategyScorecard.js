// Strategy tab: the Health Scorecard (playbook Part 3) as pure functions. No kv, no Supabase, no AI.
// The server passes in the brand's data; this returns the 7 coloured pills, the top 3 actions and the
// text of each row. Colours and numbers are NEVER chosen by the AI. Each pill carries the same four things the row
// shows: value (the headline number), note (what it means now), rule (what makes it green/amber/red), fix (what to do).
//
// Status: 'g' green, 'a' amber, 'r' red, 'na' = the data to judge it is not in the system.
// ASSUMPTIONS (not in the playbook, change here only): HERO_CLEAR_PCT, HERO_THIN_PCT, MARGIN_FLAT_PCT, ROAS_BAND, NONAD_FLAT_PCT.
const { STOCK_SETTINGS } = require('./stockStatus');

const HERO_CLEAR_PCT = 35;  // top product is at least this share of revenue (and 3+ products) = green
const HERO_THIN_PCT = 20;   // below this = sales spread thin = red
const MARGIN_FLAT_PCT = 1;  // margin after ads within +-1% counts as "about zero" = amber
const ROAS_BAND = 0.1;      // ROAS within 10% of break-even = amber
const NONAD_FLAT_PCT = 5;   // non-ad sales moving less than +-5% counts as flat

const FIX_ORDER = ['stock', 'listing', 'margin', 'ads', 'trend', 'hero', 'organic'];
// 'organic' stays the internal key; the label says what it is: sales that did not come through ads.
const LABELS = { stock: 'Stock', listing: 'Listing', hero: 'Hero', ads: 'Ads', organic: 'Non-ad sales', trend: 'Trend', margin: 'Margin' };
const SHOWN_ORDER = ['stock', 'listing', 'hero', 'ads', 'organic', 'trend', 'margin'];

const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const r1 = (n) => Math.round(n * 10) / 10;
const inr = (n) => '\u20B9' + Math.round(n).toLocaleString('en-IN');
const sign = (n) => (n > 0 ? '+' : '');
const same = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

function pill(key, status, value, note, rule, fix = '', facts = {}) {
  return { key, name: LABELS[key], status, value: value || '', note, rule, fix, facts };
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

function evalStock(cover, hero) {
  const { HEALTHY_DAYS: H, LEAD_TIME_DAYS: L } = STOCK_SETTINGS;
  const rule = `Green: ${H}+ days of cover. Amber: ${L} to ${H} days. Red: under ${L} days or out of stock.`;
  const fix = `Reorder ${hero || 'the hero'} so it has ${H} days of cover. Reorders take ${L}+ days, so order now.`;
  if (!cover) return pill('stock', 'na', '', `No inventory upload covers the hero product${hero ? ' (' + hero + ')' : ''}.`, rule, '', { hero });
  const facts = { hero, ...cover };
  if (cover.stock === 0) return pill('stock', 'r', 'Out of stock', `${hero} is out of stock.`, rule, fix, facts);
  if (cover.days === null) return pill('stock', 'na', '', `${hero} had no sales in the last 30 days, so cover cannot be worked out.`, rule, '', facts);
  const note = `${hero}: ${cover.stock} units in stock, selling about ${cover.pace} a day = ${cover.days} days of cover.`;
  if (cover.days < L) return pill('stock', 'r', `${cover.days} days`, note, rule, fix, facts);
  if (cover.days < H) return pill('stock', 'a', `${cover.days} days`, note, rule, fix, facts);
  return pill('stock', 'g', `${cover.days} days`, note, rule, '', facts);
}

function evalListing(i) {
  const rule = 'Green: 15+ reviews, 4 stars or more, first image has no text, title entered. Red: first image has text, under 3.5 stars, or no reviews.';
  const rating = num(i.rating);
  const reviews = num(i.reviewCount);
  const imgKnown = i.firstImageHasText === true || i.firstImageHasText === false;
  const missing = [];
  if (rating === null) missing.push('rating');
  if (reviews === null) missing.push('review count');
  if (!imgKnown) missing.push('first-image check');
  if (!i.title) missing.push('title');
  const facts = { rating, reviews, firstImageHasText: imgKnown ? i.firstImageHasText : null, hasTitle: Boolean(i.title) };
  const value = rating !== null || reviews !== null ? `${rating !== null ? rating + '\u2605' : '?'} \u00B7 ${reviews !== null ? reviews : '?'} reviews` : '';
  const fixes = [];
  if (i.firstImageHasText === true) fixes.push('Replace the first image with a product-only shot, no text.');
  if (rating !== null && rating < 4) fixes.push('Read the 1-2 star reviews and fix what they complain about.');
  if (reviews !== null && reviews < 15) fixes.push('Ask early buyers for honest reviews (aim for 15+).');
  if (missing.length) fixes.push(`Fill in Inputs: ${missing.join(', ')}.`);
  const reasons = [];
  if (i.firstImageHasText === true) reasons.push('first image has text');
  if (rating !== null && rating < 3.5) reasons.push(`rating ${rating} is under 3.5`);
  if (reviews === 0) reasons.push('no reviews');
  if (reasons.length) return pill('listing', 'r', value, `Problem: ${reasons.join(', ')}.`, rule, fixes.join(' '), facts);
  const ok = reviews !== null && reviews >= 15 && rating !== null && rating >= 4 && i.firstImageHasText === false && Boolean(i.title);
  if (ok) return pill('listing', 'g', value, 'Page is retail-ready.', rule, '', facts);
  const note = missing.length ? `Not entered yet: ${missing.join(', ')}.` : 'Rating or review count is below the green bar (15+ reviews, 4 stars or more).';
  return pill('listing', 'a', value, note, rule, fixes.join(' '), facts);
}

function evalHero(overview) {
  const rule = `Green: top product is ${HERO_CLEAR_PCT}%+ of sales and the brand has 3+ products. Red: top product under ${HERO_THIN_PCT}%. Otherwise amber.`;
  const fix = 'Pick one hero and build a ladder around it: trial, hero, combo, gift. Drop products that do not move.';
  const sales = overview && overview.sales;
  const top = sales && sales.topProducts && sales.topProducts[0];
  if (!top) return pill('hero', 'na', '', 'No product sales are uploaded.', rule);
  const facts = { hero: top.productName, sharePct: top.sharePct, productCount: sales.productCount };
  const note = `${top.productName} is ${top.sharePct}% of revenue, out of ${sales.productCount} products.`;
  if (top.sharePct >= HERO_CLEAR_PCT && sales.productCount >= 3) return pill('hero', 'g', `${top.sharePct}%`, note, rule, '', facts);
  if (top.sharePct < HERO_THIN_PCT) return pill('hero', 'r', `${top.sharePct}%`, note + ' Sales are spread thin.', rule, fix, facts);
  return pill('hero', 'a', `${top.sharePct}%`, note + (top.sharePct >= HERO_CLEAR_PCT ? ' Hero is clear but there is no ladder yet.' : ' The hero is not clear yet.'), rule, fix, facts);
}

const mk = (marginBeforeAds, basis) => ({ marginBeforeAds: r1(marginBeforeAds * 100), roas: marginBeforeAds > 0 ? r1(1 / marginBeforeAds) : null, basis });

/** Break-even ROAS = 1 / margin before ads (playbook Part 3). Uses the campaign's own month when it has costs, else every month with costs. */
function breakEvenFor(profit, periodKey) {
  if (!profit) return null;
  const m = (profit.months || []).find((x) => x.monthKey === periodKey && x.status !== 'no-costs' && x.netSales);
  if (m) return mk((m.profit + m.adSpend) / m.netSales, m.label);
  const t = profit.totals;
  if (!t || !t.netSales) return null;
  return mk((t.profit + t.adSpend) / t.netSales, 'all months with costs');
}

function evalAds(overview, profit, canSeeProfit) {
  const rule = `Green: ROAS more than ${Math.round(ROAS_BAND * 100)}% above break-even. Amber: within ${Math.round(ROAS_BAND * 100)}%. Red: below. Break-even ROAS = 1 divided by margin before ads.`;
  const c = overview && overview.campaign;
  if (!c || c.roas === null || c.roas === undefined) return pill('ads', 'na', '', 'No campaign data for this brand.', rule);
  const value = `ROAS ${c.roas}`;
  if (!canSeeProfit) return pill('ads', 'na', value, 'Break-even needs profit access, which your role does not have.', rule, '', { roas: c.roas });
  const be = breakEvenFor(profit, c.periodKey);
  if (!be) return pill('ads', 'na', value, `ROAS is ${c.roas} in ${c.periodLabel}, but break-even needs costs (COGS, fees) entered on the Profit tab for at least one month.`, rule, 'Enter COGS and fees for the products on the Profit tab.', { roas: c.roas });
  const base = { roas: c.roas, breakEvenRoas: be.roas, marginBeforeAdsPct: be.marginBeforeAds, marginBasis: be.basis, period: c.periodLabel };
  if (be.roas === null) return pill('ads', 'r', value, `Margin before ads is ${be.marginBeforeAds}% (${be.basis}), so no ROAS can break even. Ads lose money until price or costs change.`, rule, 'Raise price or cut costs before spending more on ads.', base);
  const note = `ROAS ${c.roas} in ${c.periodLabel} against break-even ${be.roas} (margin before ads ${be.marginBeforeAds}%, ${be.basis}).`;
  if (c.roas > be.roas * (1 + ROAS_BAND)) return pill('ads', 'g', value, note, rule, '', base);
  if (c.roas >= be.roas * (1 - ROAS_BAND)) return pill('ads', 'a', value, note, rule, 'Tighten bids on weak keywords; keep the best campaigns.', base);
  return pill('ads', 'r', value, note, rule, 'Cut or pause campaigns below break-even; keep the best ones (Advertising tab).', base);
}

/** Non-ad sales = total sales of a month minus the sales Blinkit credits to ads that month. An estimate. */
function evalNonAd(adSalesByMonth, monthInfo) {
  const rule = `Green: non-ad sales up ${NONAD_FLAT_PCT}%+ on the month before. Red: non-ad sales down ${NONAD_FLAT_PCT}%+ while ad sales rise. Otherwise amber. Needs 2 full months.`;
  const ads = adSalesByMonth || {};
  const rows = (monthInfo || [])
    .filter((m) => ads[m.monthKey] !== undefined && m.revenue > 0)
    .map((m) => {
      const adSales = Number(ads[m.monthKey]) || 0;
      const nonAd = Math.max(0, m.revenue - adSales);
      return { monthKey: m.monthKey, label: m.label, partial: m.partial, total: m.revenue, adSales, nonAd, nonAdPct: r1((nonAd / m.revenue) * 100) };
    });
  if (!rows.length) return pill('organic', 'na', '', 'No month has both a monthly sales upload and campaign data, so ad sales cannot be taken off total sales.', rule);
  const full = rows.filter((r) => !r.partial);
  const latest = (full.length ? full : rows)[(full.length ? full : rows).length - 1];
  const base = `${latest.label}: sales ${inr(latest.total)}, of which ${inr(latest.adSales)} came through ads and ${inr(latest.nonAd)} did not (${latest.nonAdPct}%). This is an estimate: ad sales are Blinkit's own attribution.`;
  const facts = { months: rows.slice(-3) };
  if (full.length < 2) return pill('organic', 'na', `${latest.nonAdPct}%`, base + ' Needs 2 full months with both sales and campaign data to judge the direction.', rule, '', facts);
  const prev = full[full.length - 2];
  const nonAdChg = prev.nonAd > 0 ? r1(((latest.nonAd - prev.nonAd) / prev.nonAd) * 100) : null;
  const adChg = prev.adSales > 0 ? r1(((latest.adSales - prev.adSales) / prev.adSales) * 100) : null;
  const note = `${base} Against ${prev.label}: non-ad sales ${nonAdChg === null ? 'unknown' : sign(nonAdChg) + nonAdChg + '%'}, ad sales ${adChg === null ? 'unknown' : sign(adChg) + adChg + '%'}.`;
  const f2 = { ...facts, nonAdChangePct: nonAdChg, adSalesChangePct: adChg };
  if (nonAdChg !== null && nonAdChg <= -NONAD_FLAT_PCT && adChg !== null && adChg > 0) {
    return pill('organic', 'r', `${latest.nonAdPct}%`, note, rule, 'Ads are carrying the sales while other sales fall. Fix the listing (images, title, reviews) before adding ad budget.', f2);
  }
  if (nonAdChg !== null && nonAdChg >= NONAD_FLAT_PCT) return pill('organic', 'g', `${latest.nonAdPct}%`, note, rule, '', f2);
  return pill('organic', 'a', `${latest.nonAdPct}%`, note, rule, 'Watch it next month.', f2);
}

function evalTrend(monthInfo) {
  const rule = 'Green: last full month is above the month before. Red: sales fell 2 months in a row. Otherwise amber. Needs 2 full months.';
  const full = (monthInfo || []).filter((m) => !m.partial).slice(-3);
  if (full.length < 2) {
    return pill('trend', 'na', '', `Only ${full.length} full month${full.length === 1 ? '' : 's'} of sales uploaded${full.length ? ' (' + full.map((m) => m.label).join(', ') + ')' : ''}. Needs 2.`, rule);
  }
  const a = full[full.length - 3];
  const b = full[full.length - 2];
  const c = full[full.length - 1];
  const lastPct = b.revenue > 0 ? r1(((c.revenue - b.revenue) / b.revenue) * 100) : null;
  const facts = { months: full.map((m) => ({ monthKey: m.monthKey, revenue: m.revenue })), lastChangePct: lastPct };
  const value = lastPct === null ? '' : `${sign(lastPct)}${lastPct}%`;
  const note = `${b.label} ${inr(b.revenue)} to ${c.label} ${inr(c.revenue)}${lastPct === null ? '' : ' (' + value + ')'}.`;
  if (a && a.revenue > b.revenue && b.revenue > c.revenue) return pill('trend', 'r', value, note + ' Down 2 months in a row.', rule, 'Find what dropped: a product, a city, or stock (Trends tab).', facts);
  if (c.revenue > b.revenue) return pill('trend', 'g', value, note, rule, '', facts);
  return pill('trend', 'a', value, note, rule, 'Find what dropped: a product, a city, or stock (Trends tab).', facts);
}

function evalMargin(profit, canSeeProfit) {
  const rule = `Green: profit after ads is above ${MARGIN_FLAT_PCT}% of net sales. Amber: about zero (within ${MARGIN_FLAT_PCT}%). Red: negative.`;
  if (!canSeeProfit) return pill('margin', 'na', '', 'Profit is not available for your role.', rule);
  const months = ((profit && profit.months) || []).filter((m) => m.status !== 'no-costs' && m.marginPct !== null);
  if (!months.length) return pill('margin', 'na', '', 'No product has costs entered for any month. Enter COGS on the Profit tab.', rule, 'Enter COGS (and GST / commission if they differ) for the products on the Profit tab.');
  const m = months.filter((x) => !x.partial).pop() || months[months.length - 1];
  const facts = { monthKey: m.monthKey, label: m.label, marginPct: m.marginPct, profit: m.profit, adSpend: m.adSpend, partial: m.partial, matchedRevenuePct: m.matchedRevenuePct };
  let note = `${m.label}: profit ${inr(m.profit)} after ads and every cost entered, which is ${m.marginPct}% of net sales.`;
  if (m.status === 'incomplete') note += ` Counts ${m.matchedRevenuePct}% of sales; some products have no costs entered.`;
  if (m.partial) note += ' The month is still partial.';
  const value = `${m.marginPct}%`;
  const fix = 'Raise price or cut COGS, fees or ad spend until margin after ads is above zero.';
  if (m.marginPct < 0) return pill('margin', 'r', value, note, rule, fix, facts);
  if (m.marginPct <= MARGIN_FLAT_PCT) return pill('margin', 'a', value, note, rule, fix, facts);
  return pill('margin', 'g', value, note, rule, '', facts);
}

const ACTIONS = {
  stock: (p) => ({ title: `Rebuild stock on ${p.facts.hero}`, why: p.note, result: 'Ads run without stockouts.' }),
  listing: (p) => ({ title: 'Fix the product page first', why: p.note, result: 'The same traffic converts better.' }),
  margin: (p) => ({ title: 'Fix margin before scaling ads', why: p.note, result: 'Each extra sale adds profit.' }),
  ads: (p) => ({ title: p.status === 'r' ? 'Cut or fix low-ROAS campaigns' : 'Tighten bids on weak keywords', why: p.note, result: 'Ad spend earns more than it costs.' }),
  trend: (p) => ({ title: 'Find out why sales are slipping', why: p.note, result: 'Sales growth returns.' }),
  hero: (p) => ({ title: 'Pick one hero and build a price ladder', why: p.note, result: 'One product carries the brand.' }),
  organic: (p) => ({ title: 'Fix the listing before adding ad budget', why: p.note, result: 'Sales no longer depend on ads.' }),
};

function topActions(pills) {
  const by = Object.fromEntries(pills.map((p) => [p.key, p]));
  const pick = (status) => FIX_ORDER.map((k) => by[k]).filter((p) => p && p.status === status);
  return [...pick('r'), ...pick('a')].slice(0, 3).map((p) => ({ area: p.key, status: p.status, ...ACTIONS[p.key](p) }));
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

function computeScorecard({ overview, stockRows, profit, monthInfo, inputs, product, canSeeProfit, adSalesByMonth }) {
  const i = inputs || {};
  const hero = heroName({ product, overview });
  const pills = [
    evalStock(stockCover(stockRows, hero), hero),
    evalListing(i),
    evalHero(overview),
    evalAds(overview, profit, canSeeProfit),
    evalNonAd(adSalesByMonth, monthInfo),
    evalTrend(monthInfo),
    evalMargin(profit, canSeeProfit),
  ];
  pills.sort((a, b) => SHOWN_ORDER.indexOf(a.key) - SHOWN_ORDER.indexOf(b.key));
  const campaign = overview && overview.campaign;
  return {
    hero, pills, actions: topActions(pills), missing: missingInputs(i),
    summaries: { buyers: 'Needs generating', plan: 'Start at month 1: fix the shelf' },
    breakEven: canSeeProfit ? breakEvenFor(profit, campaign && campaign.periodKey) : null,
  };
}

module.exports = { computeScorecard, FIX_ORDER };
