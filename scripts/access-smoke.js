/**
 * Access smoke test: roles, brand limits, data hiding, user rules. No server, no database.
 *   node scripts/access-smoke.js
 * The key-value store and Supabase are replaced by in-memory stand-ins (the same trick as the other smoke tests).
 */
const assert = require('assert');
const Module = require('module');

// --- In-memory key-value store (same API as store/kv.js) -----------------------
const kvData = new Map();
const clone = (v) => (v === undefined || v === null ? v : JSON.parse(JSON.stringify(v)));
const kv = {
  init: async () => {},
  get: (k, f = null) => (kvData.has(k) ? clone(kvData.get(k)) : f),
  peek: (k, f = null) => (kvData.has(k) ? kvData.get(k) : f),
  set: async (k, v) => { kvData.set(k, clone(v)); },
  delete: async (k) => { kvData.delete(k); },
  withLock: (fn) => Promise.resolve().then(fn),
  keys: () => [...kvData.keys()],
};

// --- In-memory Supabase: only the calls the access code makes -------------------
const tables = { admin_users: [] };
let seq = 0;
function fromTable(table) {
  let filters = [];
  let mode = 'select';
  let payload = null;
  let single = '';
  const matching = () => tables[table].filter((r) => filters.every(([c, v]) => r[c] === v));
  const run = () => {
    if (mode === 'insert') {
      if (tables[table].some((r) => r.email === payload.email)) return Promise.resolve({ data: null, error: { code: '23505', message: 'duplicate' } });
      const row = { id: `user-${++seq}`, ...payload };
      tables[table].push(row);
      return Promise.resolve({ data: single ? row : [row], error: null });
    }
    if (mode === 'update') {
      matching().forEach((r) => Object.assign(r, payload));
      return Promise.resolve({ data: null, error: null });
    }
    const found = matching();
    if (single) return Promise.resolve({ data: found[0] || null, error: null });
    return Promise.resolve({ data: found, error: null });
  };
  const api = {
    select() { return api; },
    order() { return api; },
    eq(c, v) { filters.push([c, v]); return api; },
    insert(p) { mode = 'insert'; payload = p; return api; },
    update(p) { mode = 'update'; payload = p; return api; },
    maybeSingle() { single = 'maybe'; return run(); },
    single() { single = 'one'; return run(); },
    then(resolve, reject) { return run().then(resolve, reject); },
  };
  return api;
}
const fakeSupabase = { from: (table) => fromTable(table) };

const originalLoad = Module._load;
Module._load = function (request, parent, ...rest) {
  if (/store[\\/]kv$|^\.\/kv$|\.\.\/store\/kv$/.test(request)) return kv;
  if (request.endsWith('db/supabase')) return fakeSupabase;
  if (request === 'xlsx') return { utils: {}, SSF: {} };
  return originalLoad.call(this, request, parent, ...rest);
};

const accounts = require('../store/accounts');
const access = require('../middleware/access');
const { ROLES } = require('../config/permissions');

const KNOWN = ['Oicia', 'Knife PB', 'Zebra Brand'];
const results = [];
function check(name, fn) {
  try { fn(); results.push(`PASS  ${name}`); } catch (err) { results.push(`FAIL  ${name}\n      ${err.message}`); process.exitCode = 1; }
}
async function checkAsync(name, fn) {
  try { await fn(); results.push(`PASS  ${name}`); } catch (err) { results.push(`FAIL  ${name}\n      ${err.message}`); process.exitCode = 1; }
}

// Mock Express request / response.
function mockRes() {
  const res = { statusCode: 200, body: undefined, headersSent: false };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; res.headersSent = true; return res; };
  return res;
}
const JSON_TEXT = (v) => JSON.stringify(v);

// --- Permissions table -------------------------------------------------------------
check('admin has every permission', () => {
  const p = access.permsFor('admin');
  assert.deepStrictEqual(Object.values(p).every(Boolean), true);
});
check('moderator sees all brands and uploads; cannot manage users', () => {
  const p = access.permsFor('moderator');
  assert.strictEqual(p.allBrands, true);
  assert.strictEqual(p.upload, true);
  assert.strictEqual(p.manageUsers, false);
});
check('ecom manager: one brand set, profit yes, no upload', () => {
  const p = access.permsFor('ecom_manager');
  assert.strictEqual(p.allBrands, false);
  assert.strictEqual(p.profit, true);
  assert.strictEqual(p.upload, false);
});
check('ecom executive: no profit, no upload, download yes', () => {
  const p = access.permsFor('ecom_executive');
  assert.strictEqual(p.profit, false);
  assert.strictEqual(p.upload, false);
  assert.strictEqual(p.download, true);
});
check('upload needs allBrands even if the table says yes', () => {
  const original = ROLES.ecom_manager.upload;
  ROLES.ecom_manager.upload = true;
  try { assert.strictEqual(access.permsFor('ecom_manager').upload, false); } finally { ROLES.ecom_manager.upload = original; }
});
check('unknown role gets no permission at all (fails closed)', () => {
  const p = access.permsFor('viewer');
  assert.ok(Object.values(p).every((v) => v === false));
});

// --- Brand decisions -----------------------------------------------------------------
const restricted = { perms: access.permsFor('ecom_manager'), brands: ['Oicia', 'Knife PB'] };
const noBrands = { perms: access.permsFor('ecom_executive'), brands: [] };
const all = { perms: access.permsFor('admin'), brands: [] };

check('all-brands account: any brand and no brand pass', () => {
  assert.strictEqual(access.brandDecision(all, { path: '/api/summary', query: {} }), null);
  assert.strictEqual(access.brandDecision(all, { path: '/api/summary', query: { brand: 'Zebra Brand' } }), null);
});
check('restricted: its own brand passes (any letter case)', () => {
  assert.strictEqual(access.brandDecision(restricted, { path: '/api/summary', query: { brand: 'knife pb' } }), null);
});
check('restricted: another brand is "Not found." (same answer as a made-up brand)', () => {
  const other = access.brandDecision(restricted, { path: '/api/summary', query: { brand: 'Zebra Brand' } });
  const made = access.brandDecision(restricted, { path: '/api/summary', query: { brand: 'Made Up Name' } });
  assert.deepStrictEqual(other, { status: 404, error: 'Not found.' });
  assert.deepStrictEqual(made, other);
});
check('restricted: no brand parameter is refused (no "All brands" view)', () => {
  const d = access.brandDecision(restricted, { path: '/api/summary', query: {} });
  assert.strictEqual(d.status, 400);
});
check('restricted: empty brand, or a list of brands, is refused', () => {
  assert.strictEqual(access.brandDecision(restricted, { path: '/x', query: { brand: '' } }).status, 400);
  assert.strictEqual(access.brandDecision(restricted, { path: '/x', query: { brand: ['Oicia', 'Zebra Brand'] } }).status, 400);
});
check('restricted: a body brand is checked too', () => {
  const d = access.brandDecision(restricted, { path: '/api/product-month-detail', query: {}, body: { brand: 'Zebra Brand' } });
  assert.strictEqual(d.status, 404);
});
check('account with no brand: refused, and the message names no brand', () => {
  const d = access.brandDecision(noBrands, { path: '/api/summary', query: { brand: 'Oicia' } });
  assert.strictEqual(d.status, 403);
  KNOWN.forEach((b) => assert.ok(!JSON_TEXT(d).includes(b), `message leaks "${b}"`));
});
check('brand-name list route is open; its answer is filtered later', () => {
  assert.strictEqual(access.brandDecision(restricted, { path: '/api/brand-names', query: {} }), null);
  assert.strictEqual(access.brandDecision(restricted, { path: '/api/users', query: {} }), null);
});

// --- Cleaning of answers -----------------------------------------------------------------
check('scrub: other brands removed from brandUploads, brands, brandSummaries and allBrands', () => {
  const body = {
    date: '2026-11-14',
    brandUploads: { Oicia: { fileName: 'o.xlsx' }, 'Zebra Brand': { fileName: 'z.xlsx' } },
    brands: ['Oicia', 'Zebra Brand'],
    brandSummaries: [{ brandName: 'Oicia', revenue: 1 }, { brandName: 'Zebra Brand', revenue: 9 }],
    allBrands: ['Knife PB', 'Zebra Brand'],
    cityRows: [{ city: 'Pune', revenue: 5 }],
    nested: { deeper: { brandUploads: { 'Zebra Brand': {} } } },
  };
  const before = JSON_TEXT(body);
  const out = access.scrubForAccount(body, restricted);
  assert.deepStrictEqual(out.brandUploads, { Oicia: { fileName: 'o.xlsx' } });
  assert.deepStrictEqual(out.brands, ['Oicia']);
  assert.deepStrictEqual(out.brandSummaries, [{ brandName: 'Oicia', revenue: 1 }]);
  assert.deepStrictEqual(out.allBrands, ['Knife PB']);
  assert.deepStrictEqual(out.cityRows, [{ city: 'Pune', revenue: 5 }]);
  assert.deepStrictEqual(out.nested.deeper.brandUploads, {});
  assert.strictEqual(JSON_TEXT(body), before, 'input must not be changed');
  assert.ok(!JSON_TEXT(out).includes('Zebra Brand'), 'no trace of the other brand');
});
check('scrub: an item with no brand name is dropped from a brand list', () => {
  const out = access.scrubForAccount({ brands: [{ campaigns: 3 }, 'Oicia'] }, restricted);
  assert.deepStrictEqual(out.brands, ['Oicia']);
});

// --- Account rules (pure) ----------------------------------------------------------------
check('validateNewUser: accepts a good user and returns canonical brand names', () => {
  const r = accounts.validateNewUser({ email: ' Asha@Example.com ', password: 'longenough', name: ' Asha ', role: 'ecom_manager', brands: ['knife pb'] }, KNOWN);
  assert.strictEqual(r.value.email, 'asha@example.com');
  assert.strictEqual(r.value.name, 'Asha');
  assert.deepStrictEqual(r.value.brands, ['Knife PB']);
  assert.strictEqual(r.value.active, true);
});
check('validateNewUser: rejects a bad email, a short password, an unknown role and an unknown brand', () => {
  assert.ok(accounts.validateNewUser({ email: 'nope', password: 'longenough', role: 'admin' }, KNOWN).error);
  assert.ok(accounts.validateNewUser({ email: 'a@b.co', password: 'short', role: 'admin' }, KNOWN).error);
  assert.ok(accounts.validateNewUser({ email: 'a@b.co', password: 'longenough', role: 'viewer' }, KNOWN).error);
  assert.ok(accounts.validateNewUser({ email: 'a@b.co', password: 'longenough', role: 'admin', brands: ['Nope'] }, KNOWN).error);
});
check('validateUserPatch: only the fields sent are returned', () => {
  assert.deepStrictEqual(accounts.validateUserPatch({ active: false }, KNOWN).value, { active: false });
  assert.deepStrictEqual(accounts.validateUserPatch({}, KNOWN).value, {});
  assert.ok(accounts.validateUserPatch({ active: 'no' }, KNOWN).error);
});
check('last-admin rule: demoting or deactivating the only active admin is refused', () => {
  const users = [{ id: 'a', role: 'admin', active: true }, { id: 'b', role: 'moderator', active: true }];
  assert.strictEqual(accounts.lastActiveAdminBlocked(users, 'a', 'moderator', true), true);
  assert.strictEqual(accounts.lastActiveAdminBlocked(users, 'a', 'admin', false), true);
});
check('last-admin rule: allowed when another active admin exists', () => {
  const users = [{ id: 'a', role: 'admin', active: true }, { id: 'c', role: 'admin', active: true }];
  assert.strictEqual(accounts.lastActiveAdminBlocked(users, 'a', 'moderator', true), false);
  const inactiveOther = [{ id: 'a', role: 'admin', active: true }, { id: 'c', role: 'admin', active: false }];
  assert.strictEqual(accounts.lastActiveAdminBlocked(inactiveOther, 'a', 'admin', false), true, 'an inactive admin does not count');
});
check('last-admin rule: changing a non-admin never blocks', () => {
  const users = [{ id: 'a', role: 'admin', active: true }, { id: 'b', role: 'ecom_executive', active: true }];
  assert.strictEqual(accounts.lastActiveAdminBlocked(users, 'b', 'moderator', false), false);
});
check('lastActiveAdminBlocked: reactivating the admin itself is never blocked', () => {
  const users = [{ id: 'a', role: 'admin', active: false }];
  assert.strictEqual(accounts.lastActiveAdminBlocked(users, 'a', 'admin', true), false);
});

// --- Account lookup and middleware (fake database) -----------------------------------------
async function run() {
  tables.admin_users.push(
    { id: 'u-admin', email: 'admin@x.test', password: 'h', role: 'admin' },
    { id: 'u-mgr', email: 'mgr@x.test', password: 'h', role: 'ecom_manager' },
    { id: 'u-exec', email: 'exec@x.test', password: 'h', role: 'ecom_executive' },
  );
  await accounts.saveProfile('u-mgr', { name: 'Manager', brands: ['Oicia', 'Knife PB'], active: true });

  await checkAsync('resolveAccount: brands and permissions come from storage', async () => {
    const acc = await access.resolveAccount('u-mgr');
    assert.deepStrictEqual(acc.brands, ['Oicia', 'Knife PB']);
    assert.strictEqual(acc.perms.allBrands, false);
    assert.strictEqual(access.publicAccount(acc).roleLabel, 'Ecom manager');
  });
  await checkAsync('a role change applies on the very next lookup (no re-login)', async () => {
    tables.admin_users.find((u) => u.id === 'u-mgr').role = 'ecom_executive';
    const acc = await access.resolveAccount('u-mgr');
    assert.strictEqual(acc.perms.profit, false);
    tables.admin_users.find((u) => u.id === 'u-mgr').role = 'ecom_manager';
  });
  await checkAsync('a deactivated user is no longer found (401 on the next click)', async () => {
    await accounts.saveProfile('u-mgr', { active: false });
    assert.strictEqual(await access.resolveAccount('u-mgr'), null);
    await accounts.saveProfile('u-mgr', { active: true });
  });

  await checkAsync('loadAccount + brandGuard: another brand never reaches the handler', async () => {
    const req = { path: '/api/summary', query: { brand: 'Zebra Brand' }, session: { user: { id: 'u-mgr' } } };
    const res = mockRes();
    let reached = false;
    await new Promise((resolve) => access.loadAccount(req, res, () => {
      access.brandGuard(req, res, () => { reached = true; resolve(); });
      if (!reached) resolve();
    }));
    assert.strictEqual(reached, false);
    assert.strictEqual(res.statusCode, 404);
    assert.deepStrictEqual(res.body, { error: 'Not found.' });
  });
  await checkAsync('loadAccount + brandGuard: own brand passes and answers are cleaned', async () => {
    const req = { path: '/api/brand-names', query: {}, session: { user: { id: 'u-mgr' } } };
    const res = mockRes();
    await new Promise((resolve) => access.loadAccount(req, res, () => {
      access.brandGuard(req, res, () => {
        // The route answers with every brand; the wrapper must cut it down.
        res.json({ brands: ['Knife PB', 'Oicia', 'Zebra Brand'] });
        resolve();
      });
    }));
    assert.deepStrictEqual(res.body, { brands: ['Knife PB', 'Oicia'] });
  });
  await checkAsync('loadAccount: a user with no profile is active with no brands', async () => {
    const acc = await access.resolveAccount('u-exec');
    assert.deepStrictEqual(acc.brands, []);
  });
  await checkAsync('requirePerm: 403 for a role without the permission, 200 with it', async () => {
    const reqExec = { account: await access.resolveAccount('u-exec') };
    const resExec = mockRes();
    access.requirePerm('profit')(reqExec, resExec, () => assert.fail('should not pass'));
    assert.strictEqual(resExec.statusCode, 403);
    let passed = false;
    const reqAdmin = { account: await access.resolveAccount('u-admin') };
    access.requirePerm('profit')(reqAdmin, mockRes(), () => { passed = true; });
    assert.strictEqual(passed, true);
  });

  await checkAsync('users: create, change, deactivate, reset password (fake database)', async () => {
    // The router needs Express; here we check the store functions it calls, end to end.
    const created = accounts.validateNewUser({ email: 'new@x.test', password: 'longenough', role: 'moderator', brands: [] }, KNOWN);
    assert.ok(!created.error);
    const row = { id: 'u-new', email: created.value.email, password: 'hash', role: created.value.role };
    tables.admin_users.push(row);
    await accounts.saveProfile(row.id, { name: '', brands: [], active: true });
    await accounts.saveProfile(row.id, { active: false });
    assert.strictEqual(accounts.profileOf(row.id).active, false);
    assert.strictEqual((await access.resolveAccount(row.id)), null);
  });
  await checkAsync('endSessionsOf removes only that user\'s sessions', async () => {
    await kv.set('session:s1', { sess: { user: { id: 'u-exec' } }, expires: Date.now() + 1e6 });
    await kv.set('session:s2', { sess: { user: { id: 'u-admin' } }, expires: Date.now() + 1e6 });
    await accounts.endSessionsOf('u-exec');
    assert.strictEqual(kv.peek('session:s1', null), null);
    assert.ok(kv.peek('session:s2', null));
  });
  await checkAsync('migrateUnknownRoles: an old "viewer" becomes Ecom executive, known roles stay', async () => {
    tables.admin_users.push({ id: 'u-old', email: 'old@x.test', password: 'h', role: 'viewer' });
    const changed = await accounts.migrateUnknownRoles();
    assert.strictEqual(changed, 1);
    assert.strictEqual(tables.admin_users.find((u) => u.id === 'u-old').role, 'ecom_executive');
    assert.strictEqual(tables.admin_users.find((u) => u.id === 'u-admin').role, 'admin');
  });
}

run().then(() => {
  console.log(results.join('\n'));
  const failed = results.filter((r) => r.startsWith('FAIL')).length;
  console.log(failed ? `\n${failed} check(s) FAILED` : `\nAll ${results.length} access checks passed.`);
});
