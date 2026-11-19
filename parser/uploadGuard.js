const crypto = require('crypto');
const fs = require('fs');
const kv = require('../store/kv');
const { todayDateString } = require('./snapshotHistory');

// kv key "uploadHashes" = { inventory: { "<sha256>": "<YYYY-MM-DD>" }, sales: {...}, campaign: {...} }
// Remembers which exact files were already processed today so an accidental re-upload
// (double click, same file twice) is skipped. Only today's entries are kept.
const KEY = 'uploadHashes';

function hashFile(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

/** True when this exact file was already processed today for this kind (inventory|sales|campaign). */
function isDuplicateUpload(kind, hash) {
  return kv.peek(KEY, {})?.[kind]?.[hash] === todayDateString();
}

/** Remembers a processed file; drops entries from earlier days. */
async function recordUpload(kind, hash) {
  const today = todayDateString();
  const store = kv.get(KEY, {}) || {};
  for (const k of Object.keys(store)) {
    for (const h of Object.keys(store[k])) if (store[k][h] !== today) delete store[k][h];
  }
  store[kind] = { ...store[kind], [hash]: today };
  await kv.set(KEY, store);
}

/** Forgets a kind's hashes, so data that was deleted can be re-uploaded from the same file. */
async function clearUploadHashes(kind) {
  const store = kv.get(KEY, {}) || {};
  if (!store[kind]) return;
  delete store[kind];
  await kv.set(KEY, store);
}

module.exports = { hashFile, isDuplicateUpload, recordUpload, clearUploadHashes };
