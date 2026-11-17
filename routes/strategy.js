/**
 * Strategy tab. Mounted at /api/strategy.
 *   GET  /api/strategy/scorecard?brand=[&product=]   pills, top 3 actions, row summaries, saved inputs, last report. No AI, instant.
 *   PUT  /api/strategy/inputs {brand, inputs}        the manual inputs the reports do not contain (title, price, rating...).
 *   POST /api/strategy/generate {brand, product, source, modules}   writes the report + talking points.
 * Colours and numbers come from parser/strategyScorecard.js. The AI only writes the words, using strategy/playbook.md.
 * Generate ALWAYS returns a report: it retries the AI, and if the AI still fails it builds the report from the
 * scorecard + playbook rules (response has `note` saying so). Only a wrong key/model or missing playbook is shown as an error.
 * Brand access is enforced before this router by middleware/access.js (brandGuard).
 */
const express = require('express');
const fs = require('fs');
const path = require('path');
const kv = require('../store/kv');
const { computeScorecard } = require('../parser/strategyScorecard');

const KEY = 'strategyTab'; // kv: { [brand lower-case]: { inputs, last } }
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
const inFlight = new Set();

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

/** The accordion rows: deterministic summary (+ status dot from the scorecard) and the report's points once generated. */
function composeRows(card, last) {
  const st = Object.fromEntries(card.pills.map((p) => [p.key, p.status]));
  const gen = (last && last.sections) || {};
  const defs = [
    ['buyers', 'Buyers & buying situations', 'n', 'Sales tab'],
    ['page', 'Product page', st.listing, 'Needs your listing inputs'],
    ['kw', 'Keywords & campaigns', st.ads, 'Advertising tab'],
    ['stock', 'Stock plan', st.stock, 'Stock tab'],
    ['hero', 'Hero product & pricing', st.hero, 'Sales tab'],
    ['profit', 'Profit check', st.margin, 'Profit tab'],
    ['plan', '6-month plan', 'n', 'Month 1 gate: listing done, hero in stock'],
  ];
  const dataRows = new Set(['stock', 'hero', 'profit', 'page']); // numbers-based rows keep the computed summary
  return defs.map(([id, title, status, link]) => ({
    id, title, status: status || 'n', link,
    summary: (dataRows.has(id) || !gen[id]) ? card.summaries[id] : gen[id].summary || card.summaries[id],
    points: (gen[id] && Array.isArray(gen[id].points) ? gen[id].points : []).map(String),
  }));
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
  return out && typeof out === 'object' && ((out.sections && typeof out.sections === 'object') || (Array.isArray(out.talkingPoints) && out.talkingPoints.length));
}

const OUTPUT_RULES = `
OUTPUT: return ONLY one JSON object, no markdown fences, no text before or after, in this shape:
{"sections":{"buyers":{"summary":"","points":[]},"page":{"summary":"","points":[]},"kw":{...},"stock":{...},"hero":{...},"profit":{...},"plan":{...}},
 "modules":{"<module id>":{"summary":"","points":[]}},
 "talkingPoints":["8 to 12 one-line points: biggest problem first, then quick wins, 6-month direction, what we need from the brand"],
 "assumptions":["every assumption you made"]}
Rules: summary max 12 words. points: 2 to 4 per section, max 25 words each. Use only numbers present in the data.
Missing data: write "needs input" and give the playbook's safe default. Never change the scorecard colours or numbers.
When a number comes from the data, add its source in brackets: (dashboard) or (sheets). If PROFIT is absent, write nothing about profit.`;

/** One call to the AI. OpenRouter if OPENROUTER_API_KEY is set, else Anthropic. Errors carry .status and .fatal (config problems). */
async function callModel(system, user, model) {
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
    signal: AbortSignal.timeout(120000),
  });
  if (!resp.ok) {
    const detail = await resp.text().catch(() => '');
    console.error('strategy model error', resp.status, model, detail.slice(0, 600));
    const e = new Error(resp.status === 401 || resp.status === 403 ? 'The AI key was rejected. Check the key in .env.'
      : resp.status === 404 ? 'Model not found. Check STRATEGY_MODEL in .env.'
      : resp.status === 429 ? 'The model is rate limited.' : 'The AI service failed (' + resp.status + ').');
    e.status = 502;
    e.fatal = resp.status === 401 || resp.status === 403;
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

/** Up to 4 tries (OpenRouter: your STRATEGY_MODEL twice, then openrouter/free twice). Returns the parsed report or throws the last error. */
async function askWithRetry(system, payload) {
  const orKey = process.env.OPENROUTER_API_KEY;
  if (!orKey && !process.env.ANTHROPIC_API_KEY) { const e = new Error('Set OPENROUTER_API_KEY in .env, then restart the server.'); e.status = 503; throw e; }
  const own = process.env.STRATEGY_MODEL || (orKey ? 'openrouter/free' : 'claude-sonnet-5-5');
  const models = orKey ? [own, own, 'openrouter/free', 'openrouter/free'] : [own, own];
  let user = JSON.stringify(payload);
  if (user.length > MAX_PAYLOAD_CHARS) user = JSON.stringify({ ...payload, rawData: undefined });
  if (user.length > MAX_PAYLOAD_CHARS) user = JSON.stringify({ ...payload, rawData: undefined, dashboardData: undefined });
  let last;
  for (let i = 0; i < models.length; i++) {
    try {
      const out = parseJson(await callModel(system, user, models[i]));
      if (!validReport(out)) throw new Error('The AI answer had the wrong shape.');
      return out;
    } catch (err) {
      last = err;
      if (err.fatal) throw err;
      console.error(`strategy try ${i + 1}/${models.length} (${models[i]}) failed:`, err.message);
      if (i < models.length - 1) await sleep(1500 * (i + 1));
    }
  }
  throw last;
}

/** Built-in report: playbook rules + this brand's scorecard. Used only when the AI cannot answer. */
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
 * { overview, stockRows, monthInfo, profit, rawMonthly }.
 */
function createStrategyRouter({ getBrandData }) {
  const router = express.Router();

  const load = (brand) => (kv.get(KEY, {}) || {})[brandKey(brand)] || {};
  const save = async (brand, patch) => {
    const all = { ...(kv.get(KEY, {}) || {}) };
    all[brandKey(brand)] = { ...(all[brandKey(brand)] || {}), ...patch };
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
    const first = computeScorecard({ ...data, inputs: saved.inputs || {}, product, canSeeProfit });
    const auto = autoInputsFor(data, first.hero);
    const card = computeScorecard({ ...data, inputs: { ...auto, ...(saved.inputs || {}) }, product, canSeeProfit });
    return { data, saved, card, canSeeProfit, auto };
  };

  router.get('/scorecard', wrap(async (req, res) => {
    const brand = needBrand(req, res); if (!brand) return;
    const product = typeof req.query.product === 'string' ? req.query.product.trim() : '';
    const { data, saved, card, auto } = scoreFor(brand, product, req);
    const products = Array.from(new Set((data.stockRows || []).map((r) => r.productName))).sort();
    res.json({
      brand, products, hero: card.hero, pills: card.pills, actions: card.actions, missing: card.missing,
      rows: composeRows(card, saved.last), inputs: saved.inputs || {}, auto,
      modules: MODULES, last: saved.last ? { at: saved.last.at, source: saved.last.source, product: saved.last.product || '', modules: saved.last.moduleIds || [] } : null,
      talkingPoints: (saved.last && saved.last.talkingPoints) || [],
      moduleRows: Object.entries((saved.last && saved.last.modules) || {}).map(([id, v]) => ({ id, title: MODULES[id] || id, summary: (v && v.summary) || '', points: ((v && v.points) || []).map(String) })),
      assumptions: (saved.last && saved.last.assumptions) || [],
    });
  }));

  router.put('/inputs', wrap(async (req, res) => {
    const brand = needBrand(req, res); if (!brand) return;
    await save(brand, { inputs: cleanInputs(req.body && req.body.inputs) });
    res.json({ ok: true });
  }));
  
  router.post('/clear', wrap(async (req, res) => {
    const brand = needBrand(req, res); if (!brand) return;
    if (inFlight.has(brandKey(brand))) return res.status(429).json({ error: 'A report is being written for this brand. Wait for it to finish.' });
    await save(brand, { last: undefined });
    res.json({ ok: true });
  }));  

  router.post('/generate', wrap(async (req, res) => {
    const brand = needBrand(req, res); if (!brand) return;
    const body = req.body || {};
    const source = SOURCES.has(body.source) ? body.source : 'dashboard';
    const product = typeof body.product === 'string' ? body.product.trim().slice(0, 300) : '';
    const moduleIds = (Array.isArray(body.modules) ? body.modules : []).filter((m) => MODULES[m]);
    const lock = brandKey(brand);
    if (inFlight.has(lock)) return res.status(429).json({ error: 'A report is already being written for this brand.' });
    inFlight.add(lock);
    try {
      const { data, saved, card, canSeeProfit } = scoreFor(brand, product, req);
      let playbook;
      try { playbook = fs.readFileSync(PLAYBOOK_PATH, 'utf8'); } catch {
        const e = new Error('strategy/playbook.md is missing. Create the strategy folder and put the playbook there.'); e.status = 503; throw e;
      }
      const facts = {
        brand, product: product || '(all products, hero = ' + card.hero + ')', dataSource: source,
        scorecard: card.pills.map((p) => ({ area: p.name, status: p.status, note: p.note, facts: p.facts })),
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
      let note = '';
      try {
        out = await askWithRetry(`${playbook}\n\n---\n${OUTPUT_RULES}`, facts);
      } catch (err) {
        if (err.fatal || err.status === 503) throw err; // key, model or setup problems: tell the user
        console.error('strategy: AI failed, using the built-in report:', err.message);
        note = err.message + ' Showing the built-in report instead. Press Generate to try again.';
      }
      if (!out) out = fallbackReport(card, moduleIds);
      await save(brand, {
        last: {
          at: new Date().toISOString(), source, product, moduleIds,
          sections: out.sections || {}, modules: out.modules || {},
          talkingPoints: Array.isArray(out.talkingPoints) ? out.talkingPoints.slice(0, 12).map(String) : [],
          assumptions: Array.isArray(out.assumptions) ? out.assumptions.slice(0, 20).map(String) : [],
        },
      });
      res.json({ ok: true, note });
    } finally {
      inFlight.delete(lock);
    }
  }));

  return router;
}

module.exports = { createStrategyRouter };