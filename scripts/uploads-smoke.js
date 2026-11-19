// Offline test for the Uploads panel's undo (no database, no .env). Usage: node scripts/uploads-smoke.js
const assert = require('assert');

// An in-memory stand-in for kv, with the functions the undo store uses.
const kvPath = require.resolve('../store/kv');
const memory = new Map();
const kvStub = {
  peek: (k, f = null) => (memory.has(k) ? memory.get(k) : f),
  set: async (k, v) => { memory.set(k, JSON.parse(JSON.stringify(v))); },
  delete: async (k) => { memory.delete(k); },
};
require.cache[kvPath] = { id: kvPath, filename: kvPath, loaded: true, exports: kvStub };
const { captureUndo, listUndo, undoUpload, UNDO_KINDS } = require('../store/uploadUndo');

(async () => {
  assert.deepStrictEqual(UNDO_KINDS, ['inventory', 'sales', 'salesMonthly', 'campaign', 'costs']);

  // Stock: an upload changes `history` and `latest`; undo puts back what was there, and removes what was not.
  memory.set('latest', { date: '2026-11-01', rows: [{ productName: 'A' }], brandUploads: { 'Demo Brand': { date: '2026-11-01', fileName: 'old.xlsx' } } });
  memory.set('salesLatest', { cityRows: [{ city: 'Jaipur' }] });          // another report type: must stay untouched
  const before = JSON.parse(JSON.stringify(Array.from(memory.entries())));
  await captureUndo('inventory', { fileName: 'new.xlsx', brands: ['Demo Brand', 'Other Brand', 'Demo Brand'] });
  memory.set('latest', { date: '2026-11-05', rows: [{ productName: 'B' }, { productName: 'C' }], brandUploads: {} });   // what the upload does
  memory.set('history', { snapshots: [1, 2, 3] });                          // `history` did not exist before
  memory.set('salesLatest', { cityRows: [{ city: 'Delhi' }] });          // changed by someone else: not ours to restore

  const list = listUndo();
  assert.strictEqual(list.length, 1);
  assert.deepStrictEqual({ kind: list[0].kind, label: list[0].label, fileName: list[0].fileName, brands: list[0].brands },
    { kind: 'inventory', label: 'Stock report', fileName: 'new.xlsx', brands: ['Demo Brand', 'Other Brand'] });
  assert.ok(!('keys' in list[0]), 'the saved data is never listed');

  const undone = await undoUpload('inventory');
  assert.deepStrictEqual(undone, { kind: 'inventory', label: 'Stock report', fileName: 'new.xlsx', brands: ['Demo Brand', 'Other Brand'] });
  assert.deepStrictEqual(memory.get('latest'), JSON.parse(JSON.stringify(before.find(([k]) => k === 'latest')[1])), 'stock is back as it was');
  assert.strictEqual(memory.has('history'), false, 'a key that did not exist before is removed again');
  assert.deepStrictEqual(memory.get('salesLatest'), { cityRows: [{ city: 'Delhi' }] }, 'other report types are not touched');
  assert.strictEqual(listUndo().length, 0, 'an undo can only be used once');
  assert.strictEqual(await undoUpload('inventory'), null);

  // Only the latest upload of a report type can be undone: a second capture replaces the first.
  memory.set('brandCosts', { brands: [{ brandName: 'Demo Brand', products: [1] }] });
  await captureUndo('costs', { fileName: 'first.xlsx', brands: ['Demo Brand'] });
  memory.set('brandCosts', { brands: [{ brandName: 'Demo Brand', products: [1, 2] }] });
  await captureUndo('costs', { fileName: 'second.xlsx', brands: ['Demo Brand'] });
  memory.set('brandCosts', { brands: [{ brandName: 'Demo Brand', products: [1, 2, 3] }] });
  await undoUpload('costs');
  assert.deepStrictEqual(memory.get('brandCosts'), { brands: [{ brandName: 'Demo Brand', products: [1, 2] }] }, 'back to just before the second upload');

  // Sales and Monthly sales both write `salesMonthly`: a newer upload of one drops the other's undo.
  memory.set('salesMonthly', { slots: [{ monthKey: '2026-09' }] });
  await captureUndo('sales', { fileName: 's.xlsx', brands: ['Demo Brand'] });
  memory.set('salesMonthly', { slots: [{ monthKey: '2026-09' }, { monthKey: '2026-10' }] });
  await captureUndo('salesMonthly', { fileName: 'm.xlsx', brands: ['Demo Brand'] });
  assert.deepStrictEqual(listUndo().map((u) => u.kind), ['salesMonthly'], 'the sales undo is no longer a clean "before"');
  await undoUpload('salesMonthly');
  assert.deepStrictEqual(memory.get('salesMonthly'), { slots: [{ monthKey: '2026-09' }, { monthKey: '2026-10' }] });

  // Independent report types keep their own undo.
  await captureUndo('campaign', { fileName: 'c.xlsx', brands: ['Demo Brand'] });
  await captureUndo('inventory', { fileName: 'i.xlsx', brands: ['Demo Brand'] });
  assert.deepStrictEqual(listUndo().map((u) => u.kind).sort(), ['campaign', 'inventory']);

  // Unknown report types are refused, and a failed restore keeps the undo for a retry.
  await assert.rejects(captureUndo('nope', { fileName: 'x', brands: [] }), /Unknown upload kind/);
  memory.set('campaignData', { rows: [1] });
  await captureUndo('campaign', { fileName: 'c2.xlsx', brands: [] });
  memory.set('campaignData', { rows: [1, 2] });
  const realSet = kvStub.set; kvStub.set = async () => { throw new Error('database down'); };
  await assert.rejects(undoUpload('campaign'), /database down/);
  kvStub.set = realSet;
  assert.ok(listUndo().some((u) => u.kind === 'campaign'), 'still undoable after a failed restore');
  await undoUpload('campaign');
  assert.deepStrictEqual(memory.get('campaignData'), { rows: [1] });

// --- What is uploaded for each brand -------------------------------------------------------
{
  const { buildUploadsOverview } = require('../parser/uploadsOverview');
  const overview = buildUploadsOverview({
    stockUploads: { 'Demo Brand': { date: '2026-11-01', fileName: 'stock.xlsx' } },
    salesUploads: { 'demo brand': { date: '2026-11-02', fileName: 'sales.xlsx', from: '2026-10-01', to: '2026-10-20' }, 'Other Brand': { date: '2026-11-02', fileName: 'sales.xlsx' } },
    monthlySlots: [
      { brandName: 'Demo Brand', platform: 'blinkit', monthKey: '2026-09', fileName: 'sep.xlsx', uploadedAt: '2026-10-02' },
      { brandName: 'Demo Brand', platform: 'blinkit', monthKey: '2026-10', fileName: 'oct.xlsx', uploadedAt: '2026-11-02' },
      { brandName: 'DEMO BRAND', platform: 'blinkit', monthKey: '2026-08', fileName: 'aug.xlsx', uploadedAt: '2026-09-01' },
    ],
    campaignUploads: [
      { brandName: 'Demo Brand', periodKey: '2026-09', fileName: 'ads-sep.xls', uploadedDate: '2026-10-03' },
      { brandName: 'Demo Brand', periodKey: '2026-10', sheetType: 'PRODUCT_BOOSTING', fileName: 'ads-oct.xls', uploadedDate: '2026-11-03' },
      { brandName: 'Demo Brand', periodKey: '2026-10', sheetType: 'PRODUCT_RECOMMENDATION', fileName: 'ads-oct.xls', uploadedDate: '2026-11-03' },
      { periodKey: '2026-10', fileName: 'old-shape.xls' },
    ],
    campaignPeriods: [{ periodKey: '2026-09', periodLabel: 'September 2026' }, { periodKey: '2026-10', periodLabel: 'October 2026' }],
    costs: [{ brandName: 'Demo Brand', fileName: 'costs.xlsx', uploadedAt: '2026-11-04', productCount: 10 }, { brandName: 'Empty', fileName: '', uploadedAt: '', productCount: 0 }],
    undo: [{ kind: 'inventory', label: 'Stock report', fileName: 'stock.xlsx', at: '2026-11-01T10:00:00.000Z', brands: ['Demo Brand'] }],
  });
  assert.deepStrictEqual(overview.brands.map((b) => b.brand), ['Demo Brand', 'Other Brand'], 'one row per brand, any spelling of the name');
  const demo = overview.brands[0];
  assert.deepStrictEqual(demo.stock, { fileName: 'stock.xlsx', date: '2026-11-01' });
  assert.deepStrictEqual(demo.sales, { fileName: 'sales.xlsx', date: '2026-11-02', from: '2026-10-01', to: '2026-10-20' });
  assert.deepStrictEqual(demo.monthly, { months: 3, first: 'August 2026', last: 'October 2026', fileName: 'oct.xlsx', date: '2026-11-02' });
  assert.deepStrictEqual(demo.advertising, { periods: ['September 2026', 'October 2026'], fileName: 'ads-oct.xls', date: '2026-11-03' });
  assert.deepStrictEqual(demo.costs, { fileName: 'costs.xlsx', date: '2026-11-04', productCount: 10 });
  const other = overview.brands[1];
  assert.deepStrictEqual(other.sales, { fileName: 'sales.xlsx', date: '2026-11-02', from: null, to: null });
  assert.strictEqual(other.stock, null); assert.strictEqual(other.monthly, null);
  assert.strictEqual(other.advertising, null); assert.strictEqual(other.costs, null);
  assert.strictEqual(overview.undo.length, 1);
  assert.deepStrictEqual(buildUploadsOverview({}), { brands: [], undo: [] });
}


  console.log('uploads smoke test passed');
})().catch((err) => { console.error('uploads smoke test FAILED:', err.message); process.exit(1); });
