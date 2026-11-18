/**
 * Strategy tab. Mounted at /api/strategy.
 *   GET  /scorecard?brand=[&product=][&report=<id|draft>]  pills, top 3 actions, rows, saved inputs, saved reports. No AI, instant.
 *   PUT  /inputs {brand, inputs}                      manual inputs the reports do not contain.
 *   POST /generate {brand, product, source, modules}  asks the AI; a good answer is SAVED AS A NEW REPORT, never over an old one.
 *   POST /clear {brand[, reportId]}                   cancels a running Generate; with reportId also deletes that one report.
 *   GET  /quota                                       free requests left today (OpenRouter), when the key reports it.
 * Three separate places, nothing overwrites anything:
 *   reports (kv, saved)   every successful AI report, newest first, capped at REPORT_CAP.
 *   failed  (kv, saved)   one entry per failed Generate (reason, models tried, start of the bad answer), capped at FAILED_CAP.
 *   draft   (memory only) the built-in report shown when the AI fails. Never saved, gone on restart.
 * Colours and numbers come from parser/strategyScorecard.js. The AI only writes the words, using strategy/playbook.md.
 * Brand access is enforced before this router by middleware/access.js (brandGuard).
 */
const express = require('express');
const fs = require('fs');
const path = require('path');
const kv = require('../store/kv');
const { computeScorecard } = require('../parser/strategyScorecard');
const { listPeriods, selectRows, aggregateTotals } = require('../parser/campaignStore');

const KEY = 'strategyTab'; // kv: { [brand lower-case]: { inputs, reports: [...], failed: [...] } }
const REPORT_CAP = 30;
const FAILED_CAP = 20;
const PLAYBOOK_PATH = path.join(__dirname, '..', 'strategy', 'playbook.md');
const MODULES = {
  A1: 'Festive & seasonal calendar', A2: 'Trend / viral response', A3: 'Creator seeding', A4: 'Multi-platform expansion',
  A5: 'Packs, combos, gift sets', A6: 'Competitor conquesting', A7: 'Banners, brand store, video', A8: 'Off-platform demand',
  A9: 'Price & promo tests', A10: 'New product launch test',
};
const MODULE_NEEDS = { // playbook Part 5 prerequisites
  A1: 'Needs stock planning working first.', A2: 'Needs a ready listing, a stock buffer and a fast approval path.',
  A3: 'Needs reviews at 4 stars or more and a fixed brand look.', A4: 'Needs the base green on Blinkit for 2+ months.',
  A5: 'Needs a clear hero SKU and known margin.', A6: 'Needs a strong listing and reviews.',
  A7: 'Needs a fixed brand look and budget beyond search.', A8: 'Needs stock in the target cities.',
  A9: 'Needs a floor price set.', A10: 'Needs a stable hero. Launch in 1-2 cities first.',
};
const SOURCES = new Set(['raw', 'dashboard', 'both']);
const INPUT_KEYS = ['compliance', 'title', 'description', 'imageCount', 'firstImageHasText', 'mrp', 'price', 'rating', 'reviewCount', 'cities', 'adBudget'];
const MAX_PAYLOAD_CHARS = 45000; // free models have small limits; drop the heaviest data first
const drafts = new Map(); // brand -> built-in draft report (memory only)
const runs = new Map(); // brand -> { at, cancelled } for the report being written
const RUN_STALE_MS = 150000; // a run older than this never blocks a new one

const brandKey = (b) => String(b || '').trim().toLowerCase();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((err) => {
  console.error(`${req.method} ${req.originalUrl} failed:`, err && err.stack ? err.stack : err);
  if (!res.headersSent) res.status(err && err.status ? err.status : 500).json({ error: err && err.status ? err.message : 'Strategy failed. See the server log.' });
});

function cleanInputs(raw) {
  const out = {};
  for (const k of INPUT_KEYS) {
    const v = raw && raw[k];
    if (v === undefined || v === null || v === '') continue;
    out[k] = typeof v === 'string' ? v.trim().slice(0, 600) : v;
  }
  if (out.compliance && !['confirmed', 'doubt'].includes(out.compliance)) delete out.compliance;
  if ('firstImageHasText' in out) out.firstImageHasText = out.firstImageHasText === true || out.firstImageHasText === 'true';
  return out;
}

/** Values read from the uploads. A typed value in Inputs always wins over these. */
function autoInputsFor(data, hero) {
  const name = String(hero || '').trim().toLowerCase();
  const out = {};
  if (!name) return out;
  let revenue = 0;
  let units = 0;
  const cityRevenue = new Map();
  for (const slot of data.slots || []) {
    for (const p of slot.products || []) {
      if (String(p.productName || '').trim().toLowerCase() !== name) continue;
      revenue += Number(p.revenue) || 0;
      units += Number(p.units) || 0;
      for (const c of p.cities || []) cityRevenue.set(c.city, (cityRevenue.get(c.city) || 0) + (Number(c.revenue) || 0));
    }
  }
  const costProduct = ((data.costs && data.costs.products) || []).find((p) => String(p.productName || '').trim().toLowerCase() === name);
  if (costProduct && Number(costProduct.sellingPrice) > 0) out.price = Number(costProduct.sellingPrice);
  else if (units > 0) out.price = Math.round((revenue / units) * 100) / 100;
  if (costProduct && Number(costProduct.mrp) > 0) out.mrp = Number(costProduct.mrp);
  const topCities = [...cityRevenue.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([city]) => city);
  if (topCities.length) out.cities = topCities.join(', ');
  const months = Object.keys(data.adSpendByMonth || {}).sort().slice(-3);
  if (months.length) {
    const total = months.reduce((sum, m) => sum + (Number(data.adSpendByMonth[m]) || 0), 0);
    out.adBudget = Math.round(total / months.length);
  }
  return out;
}

/** One brand's stored data. Old single-`last` data is read as the first saved report, once. */
function normalize(raw) {
  const s = raw || {};
  const reports = Array.isArray(s.reports) ? s.reports : (s.last ? [{ id: 'r0', model: '', ...s.last }] : []);
  return { inputs: s.inputs || {}, reports, failed: Array.isArray(s.failed) ? s.failed : [] };
}

/** Total sales Blinkit credits to ads, per campaign month (periodKey looks like YYYY-MM). */
function adSalesByMonthFor(store, brand) {
  const out = {};
  try {
    if (!store || !Array.isArray(store.rows)) return out;
    for (const p of listPeriods(store)) {
      const rows = selectRows(store, { periodKey: p.periodKey, brand, sheetType: '' });
      if (rows.length) out[p.periodKey] = Number(aggregateTotals(rows).sales) || 0;
    }
  } catch (err) { console.error('strategy: could not read ad sales per month:', err.message); }
  return out;
}

const AI_ID = { stock: 'stock', listing: 'page', hero: 'hero', ads: 'kw', organic: 'nonad', trend: 'trend', margin: 'profit' };
const LINKS = { stock: 'Stock tab', listing: 'Inputs panel', hero: 'Sales tab', ads: 'Advertising tab', organic: 'Sales and Advertising tabs', trend: 'Trends tab', margin: 'Profit tab' };

/** One row per pill (same value, note, rule and fix as the pill), then buyers and the 6-month plan. AI points go under each. */
function composeRows(card, report) {
  const gen = (report && report.sections) || {};
  const pts = (id) => (gen[id] && Array.isArray(gen[id].points) ? gen[id].points : []).map(String);
  const rows = card.pills.map((p) => ({
    id: p.key, title: p.name, status: p.status, value: p.value, summary: p.note, rule: p.rule, fix: p.fix,
    link: LINKS[p.key], points: pts(AI_ID[p.key]),
  }));
  rows.push({ id: 'buyers', title: 'Buyers & buying situations', status: 'n', value: '', summary: (gen.buyers && gen.buyers.summary) || card.summaries.buyers, rule: '', fix: '', link: 'Sales tab', points: pts('buyers') });
  rows.push({ id: 'plan', title: '6-month plan', status: 'n', value: '', summary: (gen.plan && gen.plan.summary) || card.summaries.plan, rule: '', fix: '', link: 'Month 1 gate: listing done, hero in stock', points: pts('plan') });
  return rows;
}

/** Tolerant JSON reader for free models: strips <think> blocks and fences, fixes trailing commas. */
function parseJson(text) {
  let clean = String(text || '').replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/```(?:json)?/gi, '').trim();
  const start = clean.indexOf('{');
  const end = clean.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('The AI did not return JSON.');
  clean = clean.slice(start, end + 1);
  try { return JSON.parse(clean); } catch { return JSON.parse(clean.replace(/,\s*([}\]])/g, '$1')); }
}

function validReport(out) {
  if (!out || typeof out !== 'object') return false;
  const n = Object.values(out.sections || {}).filter((x) => x && Array.isArray(x.points) && x.points.length).length;
  return n >= 3 || (Array.isArray(out.talkingPoints) && out.talkingPoints.length >= 3);
}

/** Reads the plain-text format (## headings, "summary:", "- points"). One bad line never breaks the rest. */
function parseMarked(text) {
  const clean = String(text || '').replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/```[a-z]*/gi, '');
  const secIds = new Set(['buyers', 'page', 'kw', 'stock', 'hero', 'profit', 'plan', 'trend', 'nonad']);
  const out = { sections: {}, modules: {}, talkingPoints: [], assumptions: [] };
  const tidy = (t, n) => String(t).replace(/\*\*/g, '').trim().slice(0, n);
  let cur = null;
  for (const raw of clean.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const h = line.match(/^#{1,4}\s*([A-Za-z0-9_ -]+?)\s*:?\s*$/);
    if (h) {
      const id = h[1].toLowerCase().replace(/\s+/g, '');
      if (secIds.has(id)) { cur = { t: 's', id }; out.sections[id] = { summary: '', points: [] }; }
      else if (/^a\d+$/.test(id) && MODULES[id.toUpperCase()]) { const M = id.toUpperCase(); cur = { t: 'm', id: M }; out.modules[M] = { summary: '', points: [] }; }
      else if (id.startsWith('talking')) cur = { t: 't' };
      else if (id.startsWith('assum')) cur = { t: 'a' };
      else cur = null;
      continue;
    }
    if (!cur) continue;
    const sm = line.match(/^summary\s*:\s*(.+)$/i);
    const item = line.match(/^(?:[-*\u2022]|\d+[.)])\s+(.+)$/);
    const target = cur.t === 's' ? out.sections[cur.id] : cur.t === 'm' ? out.modules[cur.id] : null;
    if (target) { if (sm) target.summary = tidy(sm[1], 140); else if (item) target.points.push(tidy(item[1], 300)); }
    else if (cur.t === 't' && item) out.talkingPoints.push(tidy(item[1], 300));
    else if (cur.t === 'a' && item) out.assumptions.push(tidy(item[1], 300));
  }
  return out;
}

/** JSON answers still work; anything else is read as the plain-text format. */
function parseReport(text) {
  const t = String(text || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  if (t.startsWith('{') || t.startsWith('```')) { try { const j = parseJson(t); if (validReport(j)) return j; } catch { /* fall through */ } }
  return parseMarked(t);
}

const OUTPUT_RULES = `
OUTPUT FORMAT: plain text only. No JSON, no markdown fences, no text before the first heading.
Use exactly these headings, each alone on its own line, in this order:
## stock
summary: <max 12 words>
- <point, max 22 words>
- <point>
Repeat that block for: ## page, ## hero, ## kw, ## nonad, ## trend, ## profit, ## buyers, ## plan. Then one block for each advanced module id in the data (heading like ## A1).
Meaning: stock = hero stock cover; page = product page; hero = hero product and price ladder; kw = ads, keywords and bids;
nonad = sales that did not come through ads; trend = month on month sales; profit = margin after ads; buyers = buyer groups and buying situations; plan = 6-month plan.
Each block: one summary line, then 2 to 3 points starting with "- ". Each block must agree with the scorecard note for that area; add advice, do not repeat it.
## talking
1. <8 to 12 one-line points: biggest problem first, then quick wins, 6-month direction, what we need from the brand>
## assumptions
- <each assumption you made>
Rules: use only numbers present in the data. Missing data: write "needs input" and give the playbook's safe default.
Never change the scorecard colours or numbers. When a number comes from the data, add its source in brackets: (dashboard) or (sheets).
If PROFIT is absent, write nothing about profit. Keep every line short.`;

/** One call to the AI. OpenRouter if OPENROUTER_API_KEY is set, else Anthropic. Errors carry .status and .fatal (config problems). */
async function callModel(system, user, model, timeoutMs) {
  const orKey = process.env.OPENROUTER_API_KEY;
  const anKey = process.env.ANTHROPIC_API_KEY;
  const useOr = Boolean(orKey);
  const resp = await fetch(useOr ? 'https://openrouter.ai/api/v1/chat/completions' : 'https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: useOr
      ? { 'content-type': 'application/json', authorization: 'Bearer ' + orKey, 'x-title': 'Faucek dashboard' }
      : { 'content-type': 'application/json', 'x-api-key': anKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify(useOr
      ? { model, max_tokens: 7000, temperature: 0.3, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }
      : { model, max_tokens: 6000, system, messages: [{ role: 'user', content: user }] }),
    signal: AbortSignal.timeout(timeoutMs || 60000),
  });
  if (!resp.ok) {
    const detail = await resp.text().catch(() => '');
    console.error('strategy model error', resp.status, model, detail.slice(0, 600));
    const daily = resp.status === 429 && /per[- ]day|daily/i.test(detail); // the account's free requests for today are used up
    const e = new Error(resp.status === 401 || resp.status === 403 ? 'The AI key was rejected. Check the key in .env.'
      : resp.status === 404 ? 'Model not found. Check STRATEGY_MODEL in .env.'
      : resp.status === 429 ? 'The model is rate limited.' : 'The AI service failed (' + resp.status + ').');
    e.status = 502;
    e.fatal = resp.status === 401 || resp.status === 403;
    if (daily) { e.message = 'The free daily request limit is used up (resets 00:00 UTC).'; e.stop = true; } // more tries would only waste requests
    throw e;
  }
  const data = await resp.json();
  if (data && data.error) { const e = new Error('The AI service returned an error.'); e.status = 502; console.error('strategy model error body', JSON.stringify(data.error).slice(0, 400)); throw e; }
  let text;
  if (useOr) {
    const choice = (data.choices && data.choices[0]) || {};
    const m = choice.message || {};
    const part = (v) => (Array.isArray(v) ? v.map((x) => (typeof x === 'string' ? x : (x && x.text) || '')).join('') : typeof v === 'string' ? v : '');
    // Reasoning models may leave `content` empty and put the answer (or the JSON inside their thinking) in `reasoning`.
    text = part(m.content).trim() || part(m.reasoning).trim() || part(m.reasoning_content).trim();
    if (!text) console.error('strategy empty answer from', data.model || model, 'finish_reason:', choice.finish_reason, 'message:', JSON.stringify(m).slice(0, 400));
  } else {
    text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  }
  if (!String(text).trim()) throw new Error('The AI returned an empty answer.');
  return text;
}

/** Up to 3 tries inside a 110 second budget, one model per try from STRATEGY_MODELS (cycling). Stops early when the daily free limit is hit.
 *  On success the parsed report carries `.model`. On failure the thrown error carries `.models` (tried) and `.raw` (start of the last unusable answer). */
async function askWithRetry(system, payload) {
  const orKey = process.env.OPENROUTER_API_KEY;
  if (!orKey && !process.env.ANTHROPIC_API_KEY) { const e = new Error('Set OPENROUTER_API_KEY in .env, then restart the server.'); e.status = 503; throw e; }
  const listed = String(process.env.STRATEGY_MODELS || process.env.STRATEGY_MODEL || '').split(',').map((m) => m.trim()).filter(Boolean);
  const models = listed.length ? listed : [orKey ? 'openrouter/free' : 'claude-sonnet-5-5'];
  if (orKey && models.length === 1 && models[0] !== 'openrouter/free') models.push('openrouter/free');
  const plan = Array.from({ length: 3 }, (_, i) => models[i % models.length]); // 3 tries max: each one counts toward the daily free limit
  let user = JSON.stringify(payload);
  if (user.length > MAX_PAYLOAD_CHARS) user = JSON.stringify({ ...payload, rawData: undefined });
  if (user.length > MAX_PAYLOAD_CHARS) user = JSON.stringify({ ...payload, rawData: undefined, dashboardData: undefined });
  const deadline = Date.now() + 110000;
  const tried = [];
  let last;
  let lastRaw = '';
  for (let i = 0; i < plan.length; i++) {
    const left = deadline - Date.now();
    if (left < 15000) break;
    tried.push(plan[i]);
    try {
      const text = await callModel(system, user, plan[i], Math.min(60000, left));
      lastRaw = String(text).slice(0, 500);
      const out = parseReport(text);
      if (!validReport(out)) throw new Error('The AI answer was unusable.');
      out.model = plan[i];
      return out;
    } catch (err) {
      last = err;
      if (err.fatal || err.stop) { err.models = tried; err.raw = lastRaw; throw err; }
      console.error(`strategy try ${i + 1}/${plan.length} (${plan[i]}) failed:`, err.message);
      if (i < plan.length - 1) await sleep(1000);
    }
  }
  const e = last || new Error('The AI did not answer in time.');
  e.models = tried;
  e.raw = lastRaw;
  throw e;
}

/** Built-in report: playbook rules + this brand's scorecard. Used to fill gaps, or whole when the AI cannot answer. */
function fallbackReport(card, moduleIds) {
  const p = Object.fromEntries(card.pills.map((x) => [x.key, x]));
  const be = card.breakEven && card.breakEven.roas ? `Break-even ROAS is ${card.breakEven.roas} (margin before ads ${card.breakEven.marginBeforeAds}%).` : 'Break-even ROAS = 1 / margin before ads. Needs a cost sheet.';
  const sections = {
    buyers: { summary: 'Own 3 buying situations first', points: ['List 2-4 buyer groups and 5-8 buying situations (why, when, where, while, with whom, with what, how feeling).', 'Pick the 3 most common, least contested situations to own.', 'Write one line of reason to buy for each buyer group. Needs input from the brand.'] },
    page: { summary: p.listing.note, points: ['Image 1: product only, plain background, no text. Then features, use case, who uses it, comparison, size and specs.', 'Title: Brand + product type + key feature + material/size + use. Main keyword early.', 'Aim for 15+ reviews and 3.5 stars or more (4+ is better) before scaling ads.'] },
    kw: { summary: p.ads.note, points: ['Keep 4 campaign buckets apart: brand, category, use-case, competitor/discovery.', 'Decide nothing on a keyword before about 10 clicks. Add wasters as negatives every week.', be] },
    stock: { summary: p.stock.note, points: ['Keep stock at 2x the last 30 days of units (about 60 days). Reorders take 15+ days.', 'Never run ads on a product or city that is out of stock.', 'Build stock 15+ days before known peaks.'] },
    hero: { summary: p.hero.note, points: ['Name one hero product. Everything else supports it.', 'Build a ladder: trial, hero, bundle or combo, premium or gift.', 'Drop or fix SKUs that do not move.'] },
    profit: { summary: p.margin.note, points: ['Contribution margin = net sales - COGS - platform fees - storage - GST effect - ads.', be, 'Push ads only on SKUs with positive margin after ads.'] },
    nonad: { summary: p.organic.note, points: ['Sales that do not come through ads show how strong the listing is on its own.', 'If they fall while ad sales rise, ads are hiding a weak listing: fix images, title and reviews first.', 'Check the direction again next month.'] },
    trend: { summary: p.trend.note, points: ['Compare the last 3 full months of sales.', 'Find the product or city that moved most (Trends tab).', 'Check that stock did not run out in the weak month.'] },
    plan: { summary: 'Month 1: fix the shelf', points: ['M1 shelf: compliance, listing, 60-day stock on the hero. M2 learn keywords. M3 prove the hero and ladder.', 'M4 add cities only where stock can follow. M5 prepare for peaks. M6 scale what works.', 'Do not move to the next month until the gate is passed.'] },
  };
  const modules = {};
  for (const id of moduleIds) modules[id] = { summary: 'Prerequisite check', points: [MODULE_NEEDS[id] || 'See playbook Part 5.'] };
  const talking = [
    ...card.actions.map((a) => `${a.title}. ${a.why}`),
    'Month 1: fix the shelf, then run a small ad test in 1-2 strong cities.',
    'Months 2-3: find 5-10 keywords above break-even ROAS before adding budget.',
    'Month 4 onward: add cities only where stock can follow.',
    card.missing.length ? 'We need from the brand: ' + card.missing.map((m) => m.label.toLowerCase()).join(', ') + '.' : 'We have all the inputs we need from the brand.',
  ].slice(0, 12);
  return { sections, modules, talkingPoints: talking, assumptions: ['Built-in report: the AI did not answer, so this uses the playbook rules and your numbers only. Press Generate again for a written version.'] };
}

/**
 * getBrandData(brand, { includeProfit }) comes from server.js and returns
 * { overview, stockRows, monthInfo, profit, rawMonthly, slots, costs, adSpendByMonth, campaignStore }.
 */
function createStrategyRouter({ getBrandData }) {
  const router = express.Router();
  let quotaCache = null;

  const load = (brand) => normalize((kv.get(KEY, {}) || {})[brandKey(brand)]);
  const save = async (brand, patch) => {
    const all = { ...(kv.get(KEY, {}) || {}) };
    all[brandKey(brand)] = { ...normalize(all[brandKey(brand)]), ...patch }; // rewrites the whole entry, so the old `last` is dropped after migrating
    await kv.set(KEY, all);
  };
  const needBrand = (req, res) => {
    const brand = String((req.method === 'GET' ? req.query.brand : req.body && req.body.brand) || '').trim();
    if (!brand) { res.status(400).json({ error: 'Choose a brand first.' }); return null; }
    return brand;
  };
  const scoreFor = (brand, product, req) => {
    const canSeeProfit = Boolean(req.account && req.account.perms && req.account.perms.profit);
    const data = getBrandData(brand, { includeProfit: canSeeProfit });
    const saved = load(brand);
    const adSalesByMonth = adSalesByMonthFor(data.campaignStore, brand);
    const first = computeScorecard({ ...data, adSalesByMonth, inputs: saved.inputs || {}, product, canSeeProfit });
    const auto = autoInputsFor(data, first.hero);
    const card = computeScorecard({ ...data, adSalesByMonth, inputs: { ...auto, ...(saved.inputs || {}) }, product, canSeeProfit });
    return { data, saved, card, canSeeProfit, auto };
  };

  router.get('/scorecard', wrap(async (req, res) => {
    const brand = needBrand(req, res); if (!brand) return;
    const product = typeof req.query.product === 'string' ? req.query.product.trim() : '';
    const want = typeof req.query.report === 'string' ? req.query.report : '';
    const { data, saved, card, auto } = scoreFor(brand, product, req);
    const draft = drafts.get(brandKey(brand)) || null;
    let selected = null;
    if (want === 'draft' && draft) selected = draft;
    else selected = saved.reports.find((r) => r.id === want) || saved.reports[0] || null;
    const products = Array.from(new Set((data.stockRows || []).map((r) => r.productName))).sort();
    res.json({
      brand, products, hero: card.hero, pills: card.pills, actions: card.actions, missing: card.missing,
      rows: composeRows(card, selected), inputs: saved.inputs || {}, auto,
      modules: MODULES,
      reports: saved.reports.map((r) => ({ id: r.id, at: r.at, product: r.product || '', source: r.source, model: r.model || '', filled: (r.filled || []).length })),
      selectedId: selected ? selected.id : '',
      hasDraft: Boolean(draft),
      failed: saved.failed.slice(0, 5).map((f) => ({ at: f.at, model: f.model || '', reason: f.reason || '', sample: f.sample || '' })),
      failedCount: saved.failed.length,
      last: selected ? { at: selected.at, source: selected.source, product: selected.product || '', modules: selected.moduleIds || [], model: selected.model || '', builtin: selected.id === 'draft' } : null,
      talkingPoints: (selected && selected.talkingPoints) || [],
      moduleRows: Object.entries((selected && selected.modules) || {}).map(([id, v]) => ({ id, title: MODULES[id] || id, summary: (v && v.summary) || '', points: ((v && v.points) || []).map(String) })),
      assumptions: (selected && selected.assumptions) || [],
    });
  }));

  router.put('/inputs', wrap(async (req, res) => {
    const brand = needBrand(req, res); if (!brand) return;
    await save(brand, { inputs: cleanInputs(req.body && req.body.inputs) });
    res.json({ ok: true });
  }));

  // Free requests left today. OpenRouter's key endpoint reports it for free-model keys; when it does not, the page just hides the counter.
  router.get('/quota', wrap(async (req, res) => {
    const key = process.env.OPENROUTER_API_KEY;
    if (!key) return res.json({ available: false });
    if (quotaCache && Date.now() - quotaCache.at < 15000) return res.json(quotaCache.body);
    let body = { available: false };
    try {
      const r = await fetch('https://openrouter.ai/api/v1/key', { headers: { authorization: 'Bearer ' + key }, signal: AbortSignal.timeout(8000) });
      if (r.ok) {
        const j = await r.json();
        const d = (j && j.data) || j || {};
        const f = d.free_model_daily_requests || (j && j.free_model_daily_requests);
        if (f && Number.isFinite(Number(f.limit))) body = { available: true, remaining: Number(f.remaining), limit: Number(f.limit), used: Number(f.used) };
      }
    } catch (err) { console.error('strategy quota lookup failed:', err.message); }
    quotaCache = { at: Date.now(), body };
    res.json(body);
  }));

  // Clear: cancels a running Generate and drops the draft. With reportId it also deletes that ONE saved report. Other reports and the failed log stay.
  router.post('/clear', wrap(async (req, res) => {
    const brand = needBrand(req, res); if (!brand) return;
    const lock = brandKey(brand);
    const run = runs.get(lock);
    if (run) { run.cancelled = true; runs.delete(lock); }
    drafts.delete(lock);
    const reportId = req.body && typeof req.body.reportId === 'string' ? req.body.reportId : '';
    if (reportId && reportId !== 'draft') await save(brand, { reports: load(brand).reports.filter((r) => r.id !== reportId) });
    res.json({ ok: true });
  }));

  router.post('/generate', wrap(async (req, res) => {
    const brand = needBrand(req, res); if (!brand) return;
    const body = req.body || {};
    const source = SOURCES.has(body.source) ? body.source : 'dashboard';
    const product = typeof body.product === 'string' ? body.product.trim().slice(0, 300) : '';
    const moduleIds = (Array.isArray(body.modules) ? body.modules : []).filter((m) => MODULES[m]);
    const lock = brandKey(brand);
    const busy = runs.get(lock);
    if (busy && !busy.cancelled && Date.now() - busy.at < RUN_STALE_MS) return res.status(429).json({ error: 'A report is already being written for this brand. Press Cancel to start fresh.' });
    const run = { at: Date.now(), cancelled: false };
    runs.set(lock, run);
    try {
      const { data, saved, card, canSeeProfit } = scoreFor(brand, product, req);
      let playbook;
      try { playbook = fs.readFileSync(PLAYBOOK_PATH, 'utf8'); } catch {
        const e = new Error('strategy/playbook.md is missing. Create the strategy folder and put the playbook there.'); e.status = 503; throw e;
      }
      const facts = {
        brand, product: product || '(all products, hero = ' + card.hero + ')', dataSource: source,
        scorecard: card.pills.map((p) => ({ area: p.name, status: p.status, value: p.value, note: p.note, facts: p.facts })),
        topActions: card.actions, missingInputs: card.missing.map((m) => m.label),
        manualInputs: saved.inputs || {}, advancedModules: moduleIds.map((id) => ({ id, name: MODULES[id] })),
        PROFIT: canSeeProfit ? { breakEven: card.breakEven } : undefined,
      };
      if (source !== 'raw') facts.dashboardData = { overview: data.overview, monthly: data.monthInfo };
      if (source !== 'dashboard') {
        facts.rawData = {
          stockRows: (data.stockRows || []).slice(0, 150).map((r) => ({ product: r.productName, warehouse: r.warehouseName, stock: r.totalStockAvailable, sold30: r.unitsSold30 })),
          monthlyProducts: data.rawMonthly || [],
        };
      }
      if (canSeeProfit && source !== 'raw' && facts.dashboardData) facts.dashboardData.profitMonths = (data.profit && data.profit.months) || [];

      let out = null;
      let failure = null;
      try {
        out = await Promise.race([
          askWithRetry(`${playbook}\n\n---\n${OUTPUT_RULES}`, facts),
          new Promise((_, reject) => setTimeout(() => reject(new Error('The AI took too long.')), 125000)),
        ]);
      } catch (err) {
        if (err.fatal || err.status === 503) throw err; // key, model or setup problems: tell the user
        failure = err;
      }
      if (run.cancelled) return res.json({ ok: true, saved: false, note: 'Cancelled.' }); // Clear/Cancel pressed meanwhile: save nothing
      const at = new Date().toISOString();
      const fb = fallbackReport(card, moduleIds);

      if (!out) {
        // The AI failed. Log it, keep every saved report untouched, and show the built-in report as a draft that is never saved.
        const reason = (failure && failure.message) || 'The AI did not answer.';
        console.error('strategy: AI failed, nothing saved:', reason);
        const fresh = load(brand);
        await save(brand, { failed: [{ at, source, product, model: ((failure && failure.models) || []).join(', '), reason, sample: String((failure && failure.raw) || '').slice(0, 500) }, ...fresh.failed].slice(0, FAILED_CAP) });
        drafts.set(lock, { ...fb, id: 'draft', at, source, product, moduleIds, model: 'built-in' });
        return res.json({ ok: true, saved: false, note: reason + ' Your saved reports are unchanged. Showing a built-in draft (not saved).' });
      }

      // The AI answered. Keep what it wrote; fill any section it skipped from the built-in report, and record which ones.
      const good = (v) => v && Array.isArray(v.points) && v.points.length;
      const sections = { ...fb.sections };
      const filled = [];
      for (const k of Object.keys(fb.sections)) {
        const v = (out.sections || {})[k];
        if (good(v)) sections[k] = { summary: v.summary || fb.sections[k].summary, points: v.points.map(String) };
        else filled.push(k);
      }
      const modules = { ...fb.modules };
      for (const [k, v] of Object.entries(out.modules || {})) if (modules[k] && good(v)) modules[k] = { summary: v.summary || modules[k].summary, points: v.points.map(String) };
      const talking = Array.isArray(out.talkingPoints) && out.talkingPoints.length >= 3 ? out.talkingPoints : fb.talkingPoints;
      const report = {
        id: 'r' + Date.now().toString(36), at, source, product, moduleIds, model: out.model || '', filled,
        sections, modules, talkingPoints: talking.slice(0, 12).map(String),
        assumptions: (Array.isArray(out.assumptions) ? out.assumptions : []).slice(0, 20).map(String),
      };
      drafts.delete(lock);
      await save(brand, { reports: [report, ...load(brand).reports].slice(0, REPORT_CAP) });
      res.json({ ok: true, saved: true, reportId: report.id, note: filled.length ? 'Saved. ' + filled.length + ' section(s) the AI skipped use the built-in text.' : '' });
    } finally {
      if (runs.get(lock) === run) runs.delete(lock);
    }
  }));

  return router;
}

module.exports = { createStrategyRouter };
