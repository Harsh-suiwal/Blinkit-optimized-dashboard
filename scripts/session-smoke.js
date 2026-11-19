// Offline test for the session store (no database, no .env). Usage: node scripts/session-smoke.js
const assert = require('assert');

// An in-memory stand-in for kv, with the same functions the store uses.
const kvPath = require.resolve('../store/kv');
const memory = new Map();
let failNextSet = false;
require.cache[kvPath] = {
  id: kvPath, filename: kvPath, loaded: true,
  exports: {
    peek: (k, f = null) => (memory.has(k) ? memory.get(k) : f),
    keys: () => Array.from(memory.keys()),
    set: async (k, v) => { if (failNextSet) { failNextSet = false; throw new Error('database down'); } memory.set(k, JSON.parse(JSON.stringify(v))); },
    delete: async (k) => { memory.delete(k); },
  },
};
const KvSessionStore = require('../store/sessionStore');
const call = (fn, ...args) => new Promise((resolve) => fn(...args, (error, value) => resolve({ error, value })));

(async () => {
  const store = new KvSessionStore();
  const login = { cookie: { expires: new Date(Date.now() + 3600 * 1000).toISOString() }, user: { id: 1, email: 'a@b.c', role: 'admin' } };

  // A saved session comes back, as a private copy.
  assert.strictEqual((await call(store.set.bind(store), 'abc', login)).error, null);
  const first = await call(store.get.bind(store), 'abc');
  assert.deepStrictEqual(first.value, login);
  first.value.user.role = 'viewer';
  assert.strictEqual((await call(store.get.bind(store), 'abc')).value.user.role, 'admin', 'callers cannot edit the stored copy');

  // "Server restart": a brand new store object reads the same saved session.
  const afterRestart = new KvSessionStore();
  assert.deepStrictEqual((await call(afterRestart.get.bind(afterRestart), 'abc')).value, login);

  // Unknown ids and logout.
  assert.strictEqual((await call(store.get.bind(store), 'nope')).value, null);
  assert.strictEqual((await call(store.destroy.bind(store), 'abc')).error, null);
  assert.strictEqual((await call(store.get.bind(store), 'abc')).value, null);

  // Expired sessions are not returned, and are removed.
  memory.set('session:old', { sess: login, expires: Date.now() - 1000 });
  assert.strictEqual((await call(store.get.bind(store), 'old')).value, null);
  await new Promise((r) => setImmediate(r));
  assert.strictEqual(memory.has('session:old'), false);

  // Saving prunes expired sessions and never touches other kv keys.
  memory.set('session:stale', { sess: login, expires: Date.now() - 5000 });
  memory.set('salesLatest', { rows: [1, 2, 3] });
  await call(store.set.bind(store), 'fresh', login);
  await new Promise((r) => setImmediate(r));
  assert.strictEqual(memory.has('session:stale'), false);
  assert.strictEqual(memory.has('session:fresh'), true);
  assert.deepStrictEqual(memory.get('salesLatest'), { rows: [1, 2, 3] });

  // A session without an expiry gets 24 hours; a failed save is reported, not hidden.
  await call(store.set.bind(store), 'noexp', { cookie: {}, user: { id: 2 } });
  assert.ok(memory.get('session:noexp').expires > Date.now() + 23 * 3600 * 1000);
  failNextSet = true;
  assert.strictEqual((await call(store.set.bind(store), 'x', login)).error.message, 'database down');

  console.log('session smoke test passed');
})().catch((err) => { console.error('session smoke test FAILED:', err.message); process.exit(1); });
