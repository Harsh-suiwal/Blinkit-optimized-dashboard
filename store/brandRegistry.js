// NEW FILE: store/brandRegistry.js  (in the server project, next to store/accounts.js)
// Brand names an admin adds on the Users page. They exist without any uploaded data.
const kv = require('./kv');

const KEY = 'brandRegistry';
const MAX = 80;

function list() {
  return (kv.get(KEY, []) || []).filter((name) => typeof name === 'string');
}

/**
 * Adds a brand name. `existing` is every brand name already known (from data and the registry);
 * matching ignores case. Returns { value } or { error }.
 */
async function add(name, existing) {
  const clean = typeof name === 'string' ? name.trim() : '';
  if (!clean) return { error: 'Enter a brand name.' };
  if (clean.length > MAX) return { error: `Brand name must be ${MAX} characters or fewer.` };
  if ((existing || []).some((b) => b.toLowerCase() === clean.toLowerCase())) {
    return { error: 'That brand already exists.' };
  }
  await kv.withLock(async () => {
    const current = list();
    if (!current.some((b) => b.toLowerCase() === clean.toLowerCase())) current.push(clean);
    await kv.set(KEY, current);
  });
  return { value: clean };
}

/** Removes a brand name from the registry only. Returns { ok } or { error }. */
async function remove(name) {
  const wanted = typeof name === 'string' ? name.trim().toLowerCase() : '';
  let found = false;
  await kv.withLock(async () => {
    const next = list().filter((b) => {
      if (b.toLowerCase() === wanted) { found = true; return false; }
      return true;
    });
    if (found) await kv.set(KEY, next);
  });
  return found ? { ok: true } : { error: 'Brand not found.' };
}

module.exports = { list, add, remove };
