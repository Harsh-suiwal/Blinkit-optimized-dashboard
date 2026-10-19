// Smoke test for store/kv.js: set / get / delete a throwaway key and re-init from Supabase
// to prove values persist. Usage: node scripts/kv-smoke.js
require('dotenv').config();
const assert = require('assert');
const kv = require('../store/kv');

const KEY = '__test__';

(async () => {
  await kv.init();
  const value = { n: Math.random(), list: [1, 2, { a: 'b' }] };

  await kv.set(KEY, value);
  assert.deepStrictEqual(kv.get(KEY), value, 'get after set');
  const copy = kv.get(KEY);
  copy.n = -1;
  assert.notStrictEqual(kv.get(KEY).n, -1, 'get must return a copy');

  await kv.init();
  assert.deepStrictEqual(kv.get(KEY), value, 'value survives re-init');

  await kv.delete(KEY);
  assert.strictEqual(kv.get(KEY), null, 'gone after delete');
  await kv.init();
  assert.strictEqual(kv.get(KEY), null, 'still gone after re-init');

  console.log('kv smoke test passed');
})().catch((err) => {
  console.error('kv smoke test FAILED:', err.message);
  process.exit(1);
});
