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
  memory.set('latest', { date: '2026-11-01', rows: [{ productName: 'A' }], brandUploads: { Oicia: { date: '2026-11-01', fileName: 'old.xlsx' } } });
  memory.set('salesLatest', { cityRows: [{ city: 'Jaipur' }] });          // another report type: must stay untouched
  const before = JSON.parse(JSON.stringify(Array.from(memory.entries())));
  await captureUndo('inventory', { fileName: 'new.xlsx', brands: ['Oicia', 'Smarteez', 'Oicia'] });
  memory.set('latest', { date: '2026-11-05', rows: [{ productName: 'B' }, { productName: 'C' }], brandUploads: {} });   // what the upload does
  memory.set('history', { snapshots: [1, 2, 3] });                          // `history` did not exist before
  memory.set('salesLatest', { cityRows: [{ city: 'Delhi' }] });          // changed by someone else: not ours to restore

  const list = listUndo();
  assert.strictEqual(list.length, 1);
  assert.deepStrictEqual({ kind: list[0].kind, label: list[0].label, fileName: list[0].fileName, brands: list[0].brands },
    { kind: 'inventory', label: 'Stock report', fileName: 'new.xlsx', brands: ['Oicia', 'Smarteez'] });
  assert.ok(!('keys' in list[0]), 'the saved data is never listed');

  const undone = await undoUpload('inventory');
  assert.deepStrictEqual(undone, { kind: 'inventory', label: 'Stock report', fileName: 'new.xlsx', brands: ['Oicia', 'Smarteez'] });
  assert.deepStrictEqual(memory.get('latest'), JSON.parse(JSON.stringify(before.find(([k]) => k === 'latest')[1])), 'stock is back as it was');
  assert.strictEqual(memory.has('history'), false, 'a key that did not exist before is removed again');
  assert.deepStrictEqual(memory.get('salesLatest'), { cityRows: [{ city: 'Delhi' }] }, 'other report types are not touched');
  assert.strictEqual(listUndo().length, 0, 'an undo can only be used once');
  assert.strictEqual(await undoUpload('inventory'), null);

  // Only the latest upload of a report type can be undone: a second capture replaces the first.
  memory.set('brandCosts', { brands: [{ brandName: 'Oicia', products: [1] }] });
  await captureUndo('costs', { fileName: 'first.xlsx', brands: ['Oicia'] });
  memory.set('brandCosts', { brands: [{ brandName: 'Oicia', products: [1, 2] }] });
  await captureUndo('costs', { fileName: 'second.xlsx', brands: ['Oicia'] });
  memory.set('brandCosts', { brands: [{ brandName: 'Oicia', products: [1, 2, 3] }] });
  await undoUpload('costs');
  assert.deepStrictEqual(memory.get('brandCosts'), { brands: [{ brandName: 'Oicia', products: [1, 2] }] }, 'back to just before the second upload');

  // Sales and Monthly sales both write `salesMonthly`: a newer upload of one drops the other's undo.
  memory.set('salesMonthly', { slots: [{ monthKey: '2026-09' }] });
  await captureUndo('sales', { fileName: 's.xlsx', brands: ['Oicia'] });
  memory.set('salesMonthly', { slots: [{ monthKey: '2026-09' }, { monthKey: '2026-10' }] });
  await captureUndo('salesMonthly', { fileName: 'm.xlsx', brands: ['Oicia'] });
  assert.deepStrictEqual(listUndo().map((u) => u.kind), ['salesMonthly'], 'the sales undo is no longer a clean "before"');
  await undoUpload('salesMonthly');
  assert.deepStrictEqual(memory.get('salesMonthly'), { slots: [{ monthKey: '2026-09' }, { monthKey: '2026-10' }] });

  // Independent report types keep their own undo.
  await captureUndo('campaign', { fileName: 'c.xlsx', brands: ['Oicia'] });
  await captureUndo('inventory', { fileName: 'i.xlsx', brands: ['Oicia'] });
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

  console.log('uploads smoke test passed');
})().catch((err) => { console.error('uploads smoke test FAILED:', err.message); process.exit(1); });
