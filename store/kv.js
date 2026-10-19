// Key-value persistence for report data: one Supabase row (kv_store) per JSON document.
// All rows are loaded into memory at startup; reads are synchronous, writes go to
// Supabase first and update the in-memory copy only after the upsert succeeded.
const supabase = require('../db/supabase');

const TABLE = 'kv_store';
const cache = new Map();
const keyQueues = new Map(); // key -> tail of that key's write chain
let ready = false;
let lockTail = Promise.resolve();

// Errors from Supabase writes carry kvError so routes can answer 500 (not 400).
function kvError(message) {
  return Object.assign(new Error(message), { kvError: true });
}

function assertReady() {
  if (!ready) throw new Error('kv store used before kv.init() finished');
}

/** Loads every row. Throws on failure; the caller must exit rather than start empty. */
async function init() {
  const { data, error } = await supabase.from(TABLE).select('key, value');
  if (error) throw new Error(`kv init failed: ${error.message}`);
  cache.clear();
  for (const row of data) cache.set(row.key, row.value);
  ready = true;
  return cache.size;
}

/** A private copy, safe to mutate. */
function get(key, fallback = null) {
  assertReady();
  return cache.has(key) ? structuredClone(cache.get(key)) : fallback;
}

/** The cached value itself, no copy. READ-ONLY: never mutate the result. */
function peek(key, fallback = null) {
  assertReady();
  return cache.has(key) ? cache.get(key) : fallback;
}

// Writes to one key run one after another, in call order.
function enqueue(key, task) {
  const run = (keyQueues.get(key) || Promise.resolve()).then(task, task);
  const tail = run.catch(() => {});
  keyQueues.set(key, tail);
  tail.then(() => { if (keyQueues.get(key) === tail) keyQueues.delete(key); });
  return run;
}

async function set(key, value) {
  assertReady();
  // Store what Postgres will return (JSON round trip), detached from the caller's object.
  const stored = JSON.parse(JSON.stringify(value));
  return enqueue(key, async () => {
    const { error } = await supabase
      .from(TABLE)
      .upsert({ key, value: stored, updated_at: new Date().toISOString() }, { onConflict: 'key' });
    if (error) throw kvError(`kv set "${key}" failed: ${error.message}`);
    cache.set(key, stored);
  });
}

async function del(key) {
  assertReady();
  return enqueue(key, async () => {
    const { error } = await supabase.from(TABLE).delete().eq('key', key);
    if (error) throw kvError(`kv delete "${key}" failed: ${error.message}`);
    cache.delete(key);
  });
}

/**
 * Runs fn exclusively. Mutating routes do get -> modify -> await set; without this, a second
 * request could read the old value while the first one's upsert is in flight and overwrite it.
 */
function withLock(fn) {
  const run = lockTail.then(() => fn());
  lockTail = run.catch(() => {});
  return run;
}

module.exports = { init, get, peek, set, delete: del, withLock };
